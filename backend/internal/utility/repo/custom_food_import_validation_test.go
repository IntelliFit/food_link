package repo

import (
	"food_link/backend/internal/foodmeasure"
	"testing"
)

func TestCustomFoodImportValidationKeepsNativeUnits(t *testing.T) {
	for _, tc := range []struct {
		name    string
		input   CustomFoodInput
		invalid bool
	}{
		{"macro sum", CustomFoodInput{NutrientsPer100g: map[string]any{"protein": 28.8, "carbs": 34.0, "fat": 48.7}}, true},
		{"sugar", CustomFoodInput{NutrientsPer100g: map[string]any{"carbs": 5.6, "sugar": 65.0}}, true},
		{"volume", CustomFoodInput{Measurement: &foodmeasure.Measurement{Amount: 100, Unit: foodmeasure.Milliliter, BasisAmount: 100, BasisUnit: foodmeasure.Milliliter, NutrientsPerBasis: map[string]float64{"calories": 440, "carbs": 110}}}, false},
		{"count", CustomFoodInput{Measurement: &foodmeasure.Measurement{Amount: 1, Unit: foodmeasure.Piece, BasisAmount: 1, BasisUnit: foodmeasure.Piece, NutrientsPerBasis: map[string]float64{"calories": 800, "carbs": 150}}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateCustomFoodImport(tc.input); (err != nil) != tc.invalid {
				t.Fatalf("error=%v invalid=%v", err, tc.invalid)
			}
		})
	}
}
