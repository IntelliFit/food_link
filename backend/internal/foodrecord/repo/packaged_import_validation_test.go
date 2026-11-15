package repo

import (
	"food_link/backend/internal/foodrecord/domain"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestPackagedImportDoesNotOverwriteReviewedData(t *testing.T) {
	for _, status := range []string{"corrected", "needs_review"} {
		if rejectProtectedPackagedImport(domain.PackagedFood{RawLabelPayload: map[string]any{"data_cleanup": map[string]any{"status": status}}}) == nil {
			t.Fatalf("protected %s row accepted", status)
		}
	}
	if err := rejectProtectedPackagedImport(domain.PackagedFood{}); err != nil {
		t.Fatal(err)
	}
}

func TestPackagedImportValidatesEveryNutrientValue(t *testing.T) {
	typeOfInput := reflect.TypeOf(PackagedFoodInput{})
	for i := 0; i < typeOfInput.NumField(); i++ {
		field := typeOfInput.Field(i)
		if !strings.HasSuffix(field.Name, "Per100g") {
			continue
		}
		for _, invalid := range []float64{-1, math.Inf(1), math.NaN()} {
			t.Run(field.Name, func(t *testing.T) {
				input := PackagedFoodInput{NutritionBasisUnit: "100g"}
				reflect.ValueOf(&input).Elem().Field(i).SetFloat(invalid)
				if err := ValidatePackagedFoodInput(input); err == nil {
					t.Fatalf("invalid %s value accepted", field.Name)
				}
			})
		}
	}
}

func TestPackagedImportValidationBeforeDatabaseWrite(t *testing.T) {
	for _, input := range []PackagedFoodInput{
		{NutritionBasisUnit: "100g", ProteinPer100g: 28.8, CarbsPer100g: 34, FatPer100g: 48.7},
		{NutritionBasisUnit: "100ml", CarbsPer100g: 0, SugarPer100g: 10.5},
		{NetContentUnit: "ml", CarbsPer100g: 10},
	} {
		if ValidatePackagedFoodInput(input) == nil {
			t.Fatalf("invalid input accepted: %+v", input)
		}
	}
	if err := ValidatePackagedFoodInput(PackagedFoodInput{NutritionBasisUnit: "100ml", CarbsPer100g: 110, KcalPer100g: 440}); err != nil {
		t.Fatal(err)
	}
}
