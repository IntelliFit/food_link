package domain

import (
	"encoding/json"
	"testing"

	"food_link/backend/internal/foodmeasure"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFoodItemMeasurementPreservesNativeQuantity(t *testing.T) {
	var milk FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"牛奶","weight":250,"ratio":50,"measurement":{"amount":250,"unit":"ml","basis_amount":100,"basis_unit":"ml","nutrients_per_basis":{"calories":60,"protein":3,"sodium_mg":40}}}`), &milk))
	require.NoError(t, ApplyFoodItemMeasurement(&milk))
	assert.Equal(t, 0.0, milk.Weight, "没有密度证据的250ml不是250g")
	assert.Equal(t, 0.0, milk.Intake)
	assert.Equal(t, 150.0, milk.Nutrients.Calories)
	assert.Equal(t, 100.0, milk.Nutrients.SodiumMg)
	assert.Equal(t, 250.0, milk.Measurement.Amount)
	assert.Equal(t, foodmeasure.Milliliter, milk.Measurement.Unit)
	require.NoError(t, ValidateFoodItemsForRecording([]FoodItem{milk}))
	encoded, err := json.Marshal(milk)
	require.NoError(t, err)
	var copy FoodItem
	require.NoError(t, json.Unmarshal(encoded, &copy))
	assert.Equal(t, milk.Measurement, copy.Measurement)
	assert.Equal(t, 50.0, copy.Ratio)
}

func TestFoodItemMeasurementCountAndServing(t *testing.T) {
	for _, tt := range []struct {
		name            string
		measure         foodmeasure.Measurement
		calories, grams float64
	}{
		{"按个", foodmeasure.Measurement{Amount: 2, Unit: foodmeasure.Piece, BasisAmount: 1, BasisUnit: foodmeasure.Piece, NutrientsPerBasis: map[string]float64{"calories": 80}}, 160, 0},
		{"按份", foodmeasure.Measurement{Amount: 1, Unit: foodmeasure.Serving, BasisAmount: 100, BasisUnit: foodmeasure.Gram, NutrientsPerBasis: map[string]float64{"calories": 200}, UnitConversions: map[foodmeasure.Unit]float64{foodmeasure.Serving: 150}}, 300, 150},
	} {
		t.Run(tt.name, func(t *testing.T) {
			item := FoodItem{Name: "用户食物", Ratio: 100, Measurement: &tt.measure}
			require.NoError(t, ApplyFoodItemMeasurement(&item))
			require.NoError(t, ValidateFoodItemsForRecording([]FoodItem{item}))
			assert.Equal(t, tt.calories, item.Nutrients.Calories)
			assert.Equal(t, tt.grams, item.Weight)
		})
	}
}

func TestFoodItemMeasurementRejectsMissingConversionAndKeepsMassBounds(t *testing.T) {
	item := FoodItem{Name: "错误单位", Ratio: 100, Measurement: &foodmeasure.Measurement{
		Amount: 2, Unit: foodmeasure.Piece, BasisAmount: 100, BasisUnit: foodmeasure.Gram,
		NutrientsPerBasis: map[string]float64{"calories": 300},
	}}
	require.Error(t, ValidateFoodItemsForRecording([]FoodItem{item}))
	item.Measurement.Unit = foodmeasure.Gram
	require.NoError(t, ValidateFoodItemsForRecording([]FoodItem{item}))
	item.Measurement.NutrientsPerBasis["calories"] = 2000
	require.Error(t, ValidateFoodItemsForRecording([]FoodItem{item}), "明确克口径仍须遵守原物理上限")
	legacy := FoodItem{Name: "米饭", Weight: 100, Ratio: 100, Nutrients: FoodItemNutrients{Calories: 130}}
	require.NoError(t, ValidateFoodItemsForRecording([]FoodItem{legacy}))
	assert.Nil(t, legacy.Measurement, "旧历史不按名称推断和重写单位")
}
