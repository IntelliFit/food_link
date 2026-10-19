package domain

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateFoodNutritionValuesRespectsEdibleMass(t *testing.T) {
	for _, tc := range []struct {
		name                      string
		weight, calories, p, c, f float64
		wantError                 bool
	}{
		{name: "有效熟肉", weight: 100, calories: 160, p: 25, c: 1, f: 6},
		{name: "允许标签舍入", weight: 100, calories: 408, p: 32, c: 60, f: 10},
		{name: "合理低热量", weight: 100, calories: 0.1, c: 0.025},
		{name: "水", weight: 100},
		{name: "宏量略超舍入边界", weight: 100, calories: 412.4, p: 32.1, c: 60, f: 10, wantError: true},
		{name: "宏量130克", weight: 100, calories: 570, p: 60, c: 60, f: 10, wantError: true},
		{name: "宏量300克", weight: 100, calories: 1700, p: 100, c: 100, f: 100, wantError: true},
		{name: "整份量边界", weight: 1500, calories: 8500, p: 800, c: 800, f: 100, wantError: true},
		{name: "非有限宏量", weight: 100, calories: 100, p: math.NaN(), wantError: true},
		{name: "纯油脂上限", weight: 100, calories: 899, f: 99.9},
		{name: "只填热量但超过油脂密度", weight: 1, calories: 72, wantError: true},
		{name: "一份被当成一克", weight: 120, calories: 8640, p: 768, c: 84, f: 576, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFoodNutritionValues(tc.name, tc.weight, tc.calories, tc.p, tc.c, tc.f)
			if tc.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestValidateFoodItemsForRecordingRejectsImpossibleMacronutrientMass(t *testing.T) {
	require.Error(t, ValidateFoodItemsForRecording([]FoodItem{{
		Name: "食物", Weight: 100,
		Nutrients: FoodItemNutrients{Calories: 570, Protein: 60, Carbs: 60, Fat: 10},
	}}))
}
