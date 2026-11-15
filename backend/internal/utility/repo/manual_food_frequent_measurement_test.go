package repo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFrequentFoodsPreserveNativeUnits(t *testing.T) {
	for _, unit := range []string{"ml", "piece", "serving"} {
		item := measuredFrequentRecordResult("样例食物", unit, 8, 0.25, 60, 2, 8, 1, nil)
		require.NotNil(t, item.Measurement)
		require.Equal(t, unit, string(item.Measurement.Unit))
		require.Equal(t, 0.25, item.Measurement.Amount)
		require.Equal(t, 60.0, item.TotalCalories)
		require.Zero(t, item.DefaultWeightGrams)
		require.Nil(t, item.NutrientsPer100g)
	}
	g := measuredFrequentRecordResult("米饭", "g", 8, 100, 120, 2, 25, 1, nil)
	require.NotNil(t, g.Measurement)
}

func TestCommonCatalogSeparatesMassAndVolumeBeforeAveraging(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db, nil)
	items := `[
 {"name":"同名饮品","manual_source":"nutrition_library","intake":250,"measurement":{"amount":250,"unit":"ml","basis_amount":100,"basis_unit":"ml","nutrients_per_basis":{"calories":50}},"nutrients":{"calories":125,"protein":5,"carbs":15,"fat":3}},
 {"name":"同名饮品","manual_source":"nutrition_library","intake":100,"weight":100,"nutrients":{"calories":200,"protein":5,"carbs":25,"fat":9}},
 {"name":"旧毫升饮品","manual_source":"nutrition_library","manual_portion_label":"","unit":"ml","intake":250,"nutrients":{"calories":125,"protein":5,"carbs":15,"fat":3}},
 {"name":"旧个数食物","manual_source":"nutrition_library","manual_portion_label":"","unit":"piece","intake":50,"nutrients":{"calories":200,"protein":5,"carbs":25,"fat":9}},
 {"name":"比例饮品","manual_source":"nutrition_library","ratio":50,"measurement":{"amount":250,"unit":"ml","basis_amount":100,"basis_unit":"ml","nutrients_per_basis":{"calories":50}},"nutrients":{"calories":62.5,"protein":2,"carbs":8,"fat":1}}
 ]`
	for _, id := range []string{"one", "two", "three"} {
		require.NoError(t, db.Exec(`INSERT INTO user_food_records(id,user_id,items) VALUES (?, 'viewer', ?::jsonb)`, id, items).Error)
	}
	result, err := r.Catalog(context.Background(), "viewer", "common", 1, 30)
	require.NoError(t, err)
	require.Len(t, result.Items, 5)
	units := map[string]float64{}
	for _, item := range result.Items {
		require.NotNil(t, item.Measurement)
		if item.Title == "同名饮品" {
			units[string(item.Measurement.Unit)] = item.TotalCalories
		}
		if item.Title == "旧个数食物" {
			require.Equal(t, "serving", string(item.Measurement.Unit))
			require.Equal(t, 1.0, item.Measurement.Amount)
		}
		if item.Title == "旧毫升饮品" {
			require.Equal(t, "ml", string(item.Measurement.Unit))
			require.Zero(t, item.DefaultWeightGrams)
		}
		if item.Title == "比例饮品" {
			require.Equal(t, 125.0, item.Measurement.Amount)
			require.Equal(t, 62.5, item.TotalCalories)
		}
	}
	require.Equal(t, 125.0, units["ml"])
	require.Equal(t, 200.0, units["g"])
	found, err := r.searchCatalogItems(context.Background(), "viewer", "同名饮品", 30)
	require.NoError(t, err)
	require.Len(t, found, 2)
	require.NotEqual(t, found[0].ID, found[1].ID)
}

func TestManualFoodSearchFindsPackagedAlias(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Exec(`INSERT INTO packaged_food_library (id,product_name,normalized_name,kcal_per_100g,is_active) VALUES ('00000000-0000-0000-0000-000000000123','阿尔卑斯糖','阿尔卑斯糖',400,true)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO packaged_food_aliases(id,food_id,alias_name,normalized_alias) VALUES ('00000000-0000-0000-0000-000000000124','00000000-0000-0000-0000-000000000123','Alpenliebe','alpenliebe')`).Error)
	items, err := NewManualFoodRepo(db, nil).searchPackagedLibrary(context.Background(), "Alpenliebe", 20)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "00000000-0000-0000-0000-000000000123", items[0].ID)
}
