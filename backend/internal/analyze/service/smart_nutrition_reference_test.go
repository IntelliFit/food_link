package service

import (
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
)

func smartDishItem(name string, weight, kcal float64, components ...[2]any) map[string]any {
	list := make([]any, 0, len(components))
	for _, c := range components {
		list = append(list, map[string]any{"name": c[0], "grams": c[1], "foodState": "cooked"})
	}
	return smartItem(name, "cooked", weight, kcal, map[string]any{"isComposite": true, "components": list})
}

func TestSmartVegetableDishCountsTheOilTheModelListed(t *testing.T) {
	library := newSmartLibrary()
	// The live library aliases the raw vegetable to a stir-fried row; using it
	// would count the oil twice.
	library.foods["包菜"] = foodrecorddomain.FoodNutrition{ID: "fried-cabbage", CanonicalName: "清炒卷心菜", KcalPer100g: 58.4, FatPer100g: 4, IsActive: true, QualityTier: "legacy_curated"}
	items := runSmart(t, library, smartDishItem("炒包菜", 130, 48, [2]any{"包菜", 122.0}, [2]any{"植物油", 8.0}))

	require.Equal(t, "matched_dish_reference", items[0]["smart_match_status"])
	require.Equal(t, "component_library", items[0]["nutrition_source"])
	require.InDelta(t, 122*0.24+8*8.99, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.5,
		"122 g cabbage + 8 g oil, although the model said 48 kcal")
	require.NotContains(t, library.queries, "包菜", "a vegetable dish never reads the library")
	require.InDelta(t, 130, numberFromAny(items[0]["estimatedWeightGrams"]), 0.01, "the photo weight is kept")
}

func TestSmartVegetableDishKeepsWaterAndSeasoningOutOfCoverage(t *testing.T) {
	items := runSmart(t, newSmartLibrary(), smartDishItem("白灼菜心", 180, 70,
		[2]any{"菜心", 150.0}, [2]any{"水", 20.0}, [2]any{"生抽", 5.0}, [2]any{"植物油", 5.0}))
	require.Equal(t, "matched_dish_reference", items[0]["smart_match_status"])
}

func TestSmartDishWithMeatKeepsTheLibraryPath(t *testing.T) {
	items := runSmart(t, newSmartLibrary(), smartDishItem("青椒炒肉", 160, 260,
		[2]any{"青椒", 100.0}, [2]any{"猪肉", 50.0}, [2]any{"植物油", 10.0}))
	require.Equal(t, "dish_low_coverage", items[0]["smart_match_status"], "猪肉 is not in the test library and the table has no meat")
}

func TestSmartVegetableDishStillRejectsAnImplausibleSplit(t *testing.T) {
	items := runSmart(t, newSmartLibrary(), smartDishItem("炒包菜", 130, 300, [2]any{"包菜", 122.0}, [2]any{"植物油", 8.0}))
	require.Equal(t, "dish_sum_disagrees_with_model", items[0]["smart_match_status"], "101 kcal is under half of the model's 300")
	require.True(t, smartDishSumDisagrees(300, 50, 100), "excess beyond the listed oil is still rejected")
	require.False(t, smartDishSumDisagrees(101, 72, 48), "excess that is the listed oil is accepted")
}

func TestSmartReferenceIngredientNames(t *testing.T) {
	for name, want := range map[string]string{"土豆丝": "土豆", "圆白菜": "卷心菜", "红油": "植物油", "菜心": "菜心", "新鲜菠菜": "菠菜", "西红柿块": "番茄"} {
		_, label, ok := smartReferenceIngredient(name)
		require.True(t, ok, name)
		require.Equal(t, want, label, name)
	}
	_, _, ok := smartReferenceIngredient("猪肉")
	require.False(t, ok)
	require.False(t, smartReferenceDish([]smartComponent{{name: "植物油", grams: 10}, {name: "盐", grams: 2}}), "oil alone is not a vegetable dish")
}
