package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func validRow() importRow {
	return importRow{LeadID: "ML-1", DishID: "D1", FoodName: "白切鸡", MerchantName: "一家店", DetailAddress: "人民路1号",
		City: "广州市", Latitude: 23.1, Longitude: 113.3}
}

func TestValidateRowRejectsBadData(t *testing.T) {
	require.NoError(t, validateRow(validRow()))
	for name, mutate := range map[string]func(*importRow){
		"blank food":     func(r *importRow) { r.FoodName = " " },
		"long food":      func(r *importRow) { r.FoodName = strings.Repeat("菜", maxFoodNameLen+1) },
		"no merchant":    func(r *importRow) { r.MerchantName = "" },
		"no lead":        func(r *importRow) { r.LeadID = "" },
		"zero coord":     func(r *importRow) { r.Latitude, r.Longitude = 0, 0 },
		"swapped coord":  func(r *importRow) { r.Latitude, r.Longitude = 113.3, 23.1 },
		"outside bounds": func(r *importRow) { r.Longitude = 150 },
	} {
		t.Run(name, func(t *testing.T) {
			row := validRow()
			mutate(&row)
			assert.Error(t, validateRow(row))
		})
	}
}

func TestItemIDIsStablePerLeadAndDish(t *testing.T) {
	first, second := validRow(), validRow()
	assert.Equal(t, itemID(first), itemID(second))
	second.DishID = "D2"
	assert.NotEqual(t, itemID(first), itemID(second))
}

func TestLoadRowsFiltersCitiesAndFailsOnBadLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rows.jsonl")
	body := `{"lead_id":"L1","dish_id":"D1","food_name":"甲","merchant_name":"店","city":"广州市","latitude":23.1,"longitude":113.3}
{"lead_id":"L2","dish_id":"D1","food_name":"乙","merchant_name":"店","city":"上海市","latitude":31.2,"longitude":121.5}
`
	require.NoError(t, os.WriteFile(path, []byte(body), 0o644))
	rows, err := loadRows(path, "上海市")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "L2", rows[0].LeadID)

	require.NoError(t, os.WriteFile(path, []byte(`{"lead_id":"L1"}`+"\n"), 0o644))
	_, err = loadRows(path, "")
	assert.Error(t, err)
}

func setupImportDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&do.PublicFoodItemDO{}))
	return db
}

func TestRunIsIdempotentAndSkipsDeletedDishes(t *testing.T) {
	db := setupImportDB(t)
	ctx := context.Background()
	deletedFood, merchant := "已删的菜", "一家店"
	deleted := do.PublicFoodItemDO{ID: "00000000-0000-4000-8000-000000000001", FoodName: &deletedFood, MerchantName: &merchant,
		Status: "deleted", Type: "common", NutritionStatus: "pending", AvailabilityStatus: "available", ContentVersion: 1,
		ImagePaths: []string{}, Items: []map[string]any{}}
	require.NoError(t, db.Create(&deleted).Error)

	second := validRow()
	second.DishID, second.FoodName = "D2", "烧鹅"
	again := validRow()
	again.DishID = "D3" // same merchant and dish name as the first row
	removed := validRow()
	removed.DishID, removed.FoodName = "D4", deletedFood
	rows := []importRow{validRow(), second, again, removed}

	dry, _, err := run(ctx, db, rows, false)
	require.NoError(t, err)
	assert.Equal(t, 2, dry.WouldInsert)
	assert.Equal(t, 2, dry.ExistingByName)
	var count int64
	require.NoError(t, db.Table("public_food_library").Count(&count).Error)
	assert.EqualValues(t, 1, count, "dry-run must not write")

	applied, ids, err := run(ctx, db, rows, true)
	require.NoError(t, err)
	assert.EqualValues(t, 2, applied.Inserted)
	assert.Len(t, ids, 2)

	var stored do.PublicFoodItemDO
	require.NoError(t, db.First(&stored, "id = ?", itemID(validRow())).Error)
	assert.Equal(t, "published", stored.Status)
	assert.Equal(t, "common", stored.Type)
	assert.Equal(t, "unknown", stored.AvailabilityStatus)
	assert.Equal(t, "pending", stored.NutritionStatus)
	assert.Nil(t, stored.UserID)
	assert.Nil(t, stored.PublishedAt)
	assert.InDelta(t, 23.1, *stored.Latitude, 1e-9)

	rerun, _, err := run(ctx, db, rows, true)
	require.NoError(t, err)
	assert.EqualValues(t, 0, rerun.Inserted)
	assert.Equal(t, 2, rerun.ExistingByID)
}

func TestRollbackOnlyTouchesImportedPublishedRows(t *testing.T) {
	db := setupImportDB(t)
	ctx := context.Background()
	_, ids, err := run(ctx, db, []importRow{validRow()}, true)
	require.NoError(t, err)
	require.Len(t, ids, 1)
	path := filepath.Join(t.TempDir(), "ids.txt")
	require.NoError(t, os.WriteFile(path, []byte(ids[0]+"\n"), 0o644))

	would, err := rollbackImport(ctx, db, path, false)
	require.NoError(t, err)
	assert.EqualValues(t, 1, would)
	var stored do.PublicFoodItemDO
	require.NoError(t, db.First(&stored, "id = ?", ids[0]).Error)
	assert.Equal(t, "published", stored.Status, "dry-run must not change rows")

	changed, err := rollbackImport(ctx, db, path, true)
	require.NoError(t, err)
	assert.EqualValues(t, 1, changed)
	require.NoError(t, db.First(&stored, "id = ?", ids[0]).Error)
	assert.Equal(t, "deleted", stored.Status)
}
