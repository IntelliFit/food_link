package service

import (
	fooddomain "food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNutritionUnitDoesNotInventMissingNutrients(t *testing.T) {
	food := &fooddomain.FoodNutrition{KcalPer100g: 22, ProteinPer100g: 2.1, CarbsPer100g: 3.5, FatPer100g: .4, SugarPer100g: 0, Source: "tfda_food_nutrition"}
	food.MarkNutritionUnknown("vitamin_d_mcg_per_100g")
	unit := nutritionUnit(food)
	require.Nil(t, unit["vitaminDMcg"])
	require.Equal(t, 0.0, unit["sugar"])
	require.Equal(t, 22.0, unit["calories"])
	food.IsActive = true
	food.QualityTier = "authoritative"
	food.MarkNutritionUnknown("protein_per_100g")
	require.False(t, fooddomain.IsNutritionExactMatchEligible(*food))
	require.False(t, fooddomain.IsNutritionCandidateMatchEligible(*food))
}
