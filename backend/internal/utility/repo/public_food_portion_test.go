package repo

import (
	"testing"

	publicdomain "food_link/backend/internal/publicfood/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPublicFoodItemWeightGramsFallsBackToAnalysisWeightFields(t *testing.T) {
	for _, tc := range []struct {
		name string
		item map[string]any
		want float64
	}{
		{name: "record intake", item: map[string]any{"intake": 80.0, "weight": 100.0}, want: 80},
		{name: "record weight", item: map[string]any{"weight": 100.0}, want: 100},
		{name: "analysis estimate", item: map[string]any{"estimatedWeightGrams": 50.0, "final_weight_g": 48.0}, want: 50},
		{name: "analysis final", item: map[string]any{"final_weight_g": 48.0}, want: 48},
		{name: "portion description ml", item: map[string]any{"portion_description": "约500ml/杯（临时估算）"}, want: 500},
		{name: "portion description gram", item: map[string]any{"portion_description": "一碗约 350 克"}, want: 350},
		{name: "unknown", item: map[string]any{"name": "菜"}, want: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.want, publicFoodItemWeightGrams(tc.item), 0.001)
		})
	}
}

func TestPublicFoodPortionWeightGramsNeverFallsBackToOneGram(t *testing.T) {
	assert.InDelta(t, 300, publicFoodPortionWeightGrams([]map[string]any{{"weight": 120.0}, {"estimatedWeightGrams": 180.0}}), 0.001)
	assert.InDelta(t, publicFoodFallbackWeightGrams, publicFoodPortionWeightGrams([]map[string]any{{"weight": 120.0}, {"name": "未知"}}), 0.001)
	assert.InDelta(t, publicFoodFallbackWeightGrams, publicFoodPortionWeightGrams(nil), 0.001)
}

// 回归：北大家园食堂「鸡蛋」只有识别结果字段，旧逻辑把「1份」当成 1g，
// 用户记 120 时得到 8640 kcal。
func TestManualFoodResultFromPublicUsesAnalysisPortionWeight(t *testing.T) {
	egg := publicdomain.PublicFoodItem{
		ID:            "3d02a047-4ae7-49c3-9099-a78f93cda985",
		FoodName:      "鸡蛋",
		TotalCalories: 72,
		TotalProtein:  6.4,
		TotalCarbs:    0.65,
		TotalFat:      4.8,
		Items: []map[string]any{{
			"name":                 "鸡蛋",
			"estimatedWeightGrams": 50.0,
			"final_weight_g":       50.0,
			"nutrients":            map[string]any{"calories": 72.0, "protein": 6.4, "carbs": 0.65, "fat": 4.8},
		}},
	}

	result := (&ManualFoodRepo{}).manualFoodResultFromPublic(egg, false)

	assert.InDelta(t, 50, result.DefaultWeightGrams, 0.001)
	require.NotNil(t, result.NutrientsPer100g)
	assert.InDelta(t, 144, result.NutrientsPer100g.Calories, 0.01)
	assert.InDelta(t, 12.8, result.NutrientsPer100g.Protein, 0.01)
	require.NotEmpty(t, result.ServingPresets)
	assert.InDelta(t, 50, result.ServingPresets[1].Grams, 0.001)
}

func TestManualFoodResultFromPublicWithoutAnyWeightSkipsPer100g(t *testing.T) {
	drink := publicdomain.PublicFoodItem{
		ID:            "drink",
		FoodName:      "果茶",
		TotalCalories: 185,
		Items:         []map[string]any{{"name": "果茶", "calorie": 185.0}},
	}

	result := (&ManualFoodRepo{}).manualFoodResultFromPublic(drink, false)

	assert.InDelta(t, publicFoodFallbackWeightGrams, result.DefaultWeightGrams, 0.001)
	assert.Nil(t, result.NutrientsPer100g, "没有营养明细时不能生成全零的每100g")
}
