package service

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNutritionInputsDistinguishOmittedNullAndZero(t *testing.T) {
	var create CreateFoodNutritionInput
	require.NoError(t, json.Unmarshal([]byte(`{"canonical_name":"样本","sugar_per_100g":0,"fiber_per_100g":null}`), &create))
	require.Contains(t, create.UnknownNutritionFields, "fiber_per_100g")
	require.Contains(t, create.UnknownNutritionFields, "vitamin_d_mcg_per_100g")
	require.NotContains(t, create.UnknownNutritionFields, "sugar_per_100g")
	var update UpdateFoodNutritionInput
	require.NoError(t, json.Unmarshal([]byte(`{"fiber_per_100g":null,"sugar_per_100g":0}`), &update))
	require.Equal(t, []string{"fiber_per_100g"}, update.UnknownNutritionFields)
	require.NotNil(t, update.SugarPer100g)
	require.Equal(t, 0.0, *update.SugarPer100g)
}
