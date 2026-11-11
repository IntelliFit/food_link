package repo

import (
	"context"
	"encoding/json"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodmeasure"
	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomFoodMeasurementPersistence(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	ctx := context.Background()
	input := customSnackInput("custom")
	input.Title = "每个标示点心"
	input.ShareToPublic = true
	input.TotalCalories = 9999 // 客户端汇总不可信，必须重新计算。
	input.Measurement = &foodmeasure.Measurement{Amount: 2, Unit: foodmeasure.Piece, BasisAmount: 1, BasisUnit: foodmeasure.Piece, NutrientsPerBasis: map[string]float64{"calories": 80, "protein": 3, "sodiumMg": 15}}
	saved, err := r.SaveCustomFood(ctx, customCategoryTestUserID, input)
	require.NoError(t, err)
	require.NotNil(t, saved.Measurement)
	assert.Equal(t, 160.0, saved.TotalCalories)
	assert.Equal(t, 0.0, saved.DefaultWeightGrams)
	assert.Nil(t, saved.NutrientsPer100g)
	assert.Equal(t, "piece", saved.DisplayUnit)
	assert.Equal(t, "2个", saved.PortionLabel)
	assert.Equal(t, 30.0, saved.ExtraNutrients.SodiumMg)
	var stored domain.UserCustomFood
	require.NoError(t, r.db.Where("id = ?", saved.ID).First(&stored).Error)
	require.NotNil(t, stored.Measurement)
	assert.Equal(t, foodmeasure.Piece, stored.Measurement.BasisUnit)
	assert.Empty(t, stored.NutrientsPer100g)
	items, err := r.Search(ctx, "22222222-2222-4222-8222-222222222222", input.Title, 20)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, foodmeasure.Piece, items[0].Measurement.Unit)
	legacy := input
	legacy.Measurement = nil
	legacy.ID = saved.ID
	_, err = r.SaveCustomFood(ctx, customCategoryTestUserID, legacy)
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, 409, appErr.HTTPStatus)
	legacy.ID = ""
	_, err = r.SaveCustomFood(ctx, customCategoryTestUserID, legacy)
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, 409, appErr.HTTPStatus)
	require.NoError(t, r.db.Where("id = ?", saved.ID).First(&stored).Error)
	assert.Equal(t, 160.0, stored.TotalCalories)
	input.ID = saved.ID
	input.Measurement.Amount = 3
	updated, err := r.SaveCustomFood(ctx, customCategoryTestUserID, input)
	require.NoError(t, err)
	assert.Equal(t, 240.0, updated.TotalCalories)
	assert.Equal(t, saved.ID, updated.ID)
}

func TestManualFoodMeasurementReadModels(t *testing.T) {
	t.Run("packaged milk uses volume and no guessed mass", func(t *testing.T) {
		basis, unit := "100ml", "ml"
		item := fooddomain.PackagedFood{ProductName: "牛奶", NutritionBasisUnit: &basis, NetContentValue: 250, NetContentUnit: &unit, NetWeightG: 250, ServingWeightG: 250, KcalPer100g: 60, ProteinPer100g: 3}
		result := manualFoodResultFromPackaged(item, 1)
		require.NotNil(t, result.Measurement)
		assert.Equal(t, 250.0, result.Measurement.Amount)
		assert.Equal(t, foodmeasure.Milliliter, result.Measurement.Unit)
		assert.Equal(t, 150.0, result.TotalCalories)
		assert.Zero(t, result.DefaultWeightGrams)
		assert.Nil(t, result.NutrientsPer100g)
		assert.Contains(t, result.NutritionHighlights[0], "100ml")
	})
	t.Run("standard drinks never infer density from their names", func(t *testing.T) {
		result := manualFoodResultFromNutrition(fooddomain.FoodNutrition{CanonicalName: "牛奶", KcalPer100g: 60}, 1)
		require.NotNil(t, result.Measurement)
		assert.Equal(t, foodmeasure.Gram, result.Measurement.Unit)
		assert.Equal(t, "g", result.DisplayUnit)
		assert.Equal(t, 100.0, result.DefaultWeightGrams)
		_, known := result.Measurement.Convert(1, foodmeasure.Milliliter, foodmeasure.Gram)
		assert.False(t, known)
	})
	t.Run("public meals with no gram evidence are one serving", func(t *testing.T) {
		r := NewManualFoodRepo(nil)
		result := r.manualFoodResultFromPublic(publicdomain.PublicFoodItem{FoodName: "一份汤", TotalCalories: 120}, false)
		require.NotNil(t, result.Measurement)
		assert.Equal(t, foodmeasure.Serving, result.Measurement.Unit)
		assert.Equal(t, 120.0, result.TotalCalories)
		assert.Zero(t, result.DefaultWeightGrams)
		_, known := result.Measurement.Grams()
		assert.False(t, known)
	})
	t.Run("public meal real gram evidence allows conversion", func(t *testing.T) {
		r := NewManualFoodRepo(nil)
		result := r.manualFoodResultFromPublic(publicdomain.PublicFoodItem{FoodName: "一份米饭", TotalCalories: 240, Items: []map[string]any{{"weight": 200.0, "nutrients": map[string]any{"calories": 240.0}}}}, false)
		grams, known := result.Measurement.Grams()
		assert.True(t, known)
		assert.Equal(t, 200.0, grams)
		require.NotNil(t, result.NutrientsPer100g)
		assert.Equal(t, 120.0, result.NutrientsPer100g.Calories)
	})
	t.Run("public measured item respects recorded intake ratio", func(t *testing.T) {
		m := &foodmeasure.Measurement{Amount: 200, Unit: foodmeasure.Gram, BasisAmount: 100, BasisUnit: foodmeasure.Gram, NutrientsPerBasis: map[string]float64{"calories": 120, "sodium_mg": 40}}
		r := NewManualFoodRepo(nil)
		result := r.manualFoodResultFromPublic(publicdomain.PublicFoodItem{FoodName: "半份米饭", TotalCalories: 120, Items: []map[string]any{{"measurement": m, "ratio": 50.0, "nutrients": map[string]any{"calories": 240.0, "sodium_mg": 80.0}}}}, false)
		grams, known := result.Measurement.Grams()
		assert.True(t, known)
		assert.Equal(t, 100.0, grams)
		assert.Equal(t, 40.0, result.ExtraNutrients.SodiumMg)
	})
	t.Run("recent snapshots keep native units and avoid nutrition enrichment", func(t *testing.T) {
		m := foodmeasure.Measurement{Amount: 2, Unit: foodmeasure.Piece, BasisAmount: 1, BasisUnit: foodmeasure.Piece, NutrientsPerBasis: map[string]float64{"calories": 80}}
		raw, err := json.Marshal(map[string]any{"name": "点心", "measurement": m, "weight": 0, "nutrients": map[string]any{"calories": 999}})
		require.NoError(t, err)
		result := manualFoodResultFromRecordItem("nutrition_library", "n1", "点心", "2个", 1, raw)
		require.NotNil(t, result.Measurement)
		assert.Equal(t, 160.0, result.TotalCalories)
		assert.Zero(t, result.DefaultWeightGrams)
		assert.False(t, shouldEnrichManualFoodWithNutritionLibrary(result))
	})
}
