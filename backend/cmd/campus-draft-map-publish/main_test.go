package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fixture struct {
	db                         *gorm.DB
	schoolID, canteenID, batch string
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&do.PublicFoodItemDO{}, &do.SchoolDO{}, &do.SchoolCanteenDO{},
		&do.CampusFoodCollectionBatchDO{}, &do.CampusFoodCatalogItemDO{}))
	f := fixture{db: db, schoolID: uuid.NewString(), canteenID: uuid.NewString(), batch: uuid.NewString()}
	require.NoError(t, db.Exec(`INSERT INTO schools (id, name, location_type, status) VALUES (?, '测试大学', 'university', 'active')`, f.schoolID).Error)
	require.NoError(t, db.Exec(`INSERT INTO school_canteens (id, school_id, name, status) VALUES (?, ?, '一食堂', 'active')`, f.canteenID, f.schoolID).Error)
	require.NoError(t, db.Exec(`INSERT INTO campus_food_collection_batches (id, client_batch_key, batch_name, venue_type, organization_name, canteen_name)
		VALUES (?, ?, '批次', 'university', '测试大学', '一食堂')`, f.batch, uuid.NewString()).Error)
	return f
}

func (f fixture) addItem(t *testing.T, name, status, entryType, channel string) string {
	t.Helper()
	id := uuid.NewString()
	price := 12.5
	require.NoError(t, f.db.Create(&do.CampusFoodCatalogItemDO{
		ID: id, BatchID: f.batch, EntryType: entryType, Name: &name, SchoolID: &f.schoolID, CanteenID: &f.canteenID,
		OrganizationName: "测试大学", CanteenName: "一食堂", Price: &price, PriceType: "by_weight", Status: status, SourceChannel: channel,
		Version: 3, ImagePaths: []string{}, MealPeriods: []string{}, AvailableWeekdays: []string{}, MissingFields: []string{},
		PriceOptions: map[string]any{},
	}).Error)
	return id
}

func TestValidDishNameRejectsNonDishes(t *testing.T) {
	for _, name := range []string{"红烧肉", "番茄炒蛋盖饭", "Pizza"} {
		assert.True(t, validDishName(name), name)
	}
	for _, name := range []string{"", "菜", "12.5", "套餐C", "荤菜50g/3", "基本伙食限定价目", "codex-similar-campus", "第二食堂", "一楼窗口", "这是一道名字特别特别特别特别特别特别特别特别特别特别特别特别长的菜品名称"} {
		assert.False(t, validDishName(name), name)
	}
}

func TestRunPublishesDraftsOnlyAndLeavesCatalogDraft(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	dish := f.addItem(t, "红烧肉", "draft", "dish", "admin_batch")
	duplicate := f.addItem(t, "红 烧 肉", "draft", "dish", "admin_batch")
	badName := f.addItem(t, "测试菜品", "draft", "dish", "admin_batch")
	stall := f.addItem(t, "麻辣烫", "draft", "stall_overview", "admin_batch")
	legacy := f.addItem(t, "拿铁", "draft", "dish", "legacy_public")
	published := f.addItem(t, "鱼香肉丝", "published", "dish", "admin_batch")

	dry, ids, _, err := run(ctx, f.db, false)
	require.NoError(t, err)
	assert.Equal(t, []string{dish}, ids)
	assert.Equal(t, 1, dry.WouldInsert)
	assert.Equal(t, 1, dry.Skipped["skip_bad_name"])
	assert.Equal(t, 1, dry.Skipped["skip_same_dish_in_canteen"])
	var count int64
	require.NoError(t, f.db.Table("public_food_library").Count(&count).Error)
	assert.Zero(t, count, "dry-run must not write")

	applied, _, _, err := run(ctx, f.db, true)
	require.NoError(t, err)
	assert.EqualValues(t, 1, applied.Inserted)

	var stored do.PublicFoodItemDO
	require.NoError(t, f.db.First(&stored, "id = ?", dish).Error)
	assert.Equal(t, "published", stored.Status)
	assert.Equal(t, "campus", stored.Type)
	assert.True(t, stored.IsCampusFood)
	assert.Equal(t, "pending", stored.NutritionStatus)
	assert.Equal(t, "unknown", stored.AvailabilityStatus)
	assert.Nil(t, stored.PublishedAt)
	assert.Nil(t, stored.AnalysisTaskID)
	assert.Equal(t, f.canteenID, *stored.CanteenID)
	assert.Equal(t, "weight", *stored.PriceType)
	assert.InDelta(t, 12.5, *stored.Price, 1e-9)
	assert.EqualValues(t, 3, stored.ContentVersion)
	assert.Equal(t, "测试大学 · 一食堂", *stored.CampusLocationText)

	for _, skipped := range []string{duplicate, badName, stall, legacy, published} {
		require.NoError(t, f.db.Table("public_food_library").Where("id = ?", skipped).Count(&count).Error)
		assert.Zero(t, count, skipped)
	}
	var catalogStatus string
	require.NoError(t, f.db.Table("campus_food_catalog_items").Select("status").Where("id = ?", dish).Scan(&catalogStatus).Error)
	assert.Equal(t, "draft", catalogStatus, "a published catalog item would trigger paid analysis")

	rerun, _, _, err := run(ctx, f.db, true)
	require.NoError(t, err)
	assert.EqualValues(t, 0, rerun.Inserted)
}

func TestRunSkipsDishDeletedFromCanteen(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	name, status := "红烧肉", "deleted"
	require.NoError(t, f.db.Create(&do.PublicFoodItemDO{ID: uuid.NewString(), FoodName: &name, CanteenID: &f.canteenID, Status: status,
		Type: "campus", NutritionStatus: "pending", AvailabilityStatus: "available", ContentVersion: 1,
		ImagePaths: []string{}, Items: []map[string]any{}}).Error)
	f.addItem(t, "红烧肉", "draft", "dish", "admin_batch")

	result, ids, _, err := run(ctx, f.db, false)
	require.NoError(t, err)
	assert.Empty(t, ids)
	assert.Equal(t, 1, result.Skipped["skip_same_dish_in_canteen"])
}

func TestRollbackMarksOnlyThisRunsRowsDeleted(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	dish := f.addItem(t, "红烧肉", "draft", "dish", "admin_batch")
	_, ids, _, err := run(ctx, f.db, true)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "ids.txt")
	require.NoError(t, os.WriteFile(path, []byte(ids[0]+"\n"), 0o644))

	would, err := rollbackRun(ctx, f.db, path, false)
	require.NoError(t, err)
	assert.EqualValues(t, 1, would)
	changed, err := rollbackRun(ctx, f.db, path, true)
	require.NoError(t, err)
	assert.EqualValues(t, 1, changed)
	var status string
	require.NoError(t, f.db.Table("public_food_library").Select("status").Where("id = ?", dish).Scan(&status).Error)
	assert.Equal(t, "deleted", status)
}
