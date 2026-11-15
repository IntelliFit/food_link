package service

import (
	"food_link/backend/internal/foodrecord/domain"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestAdminImportRejectsDirtyActivationAndPartialNutrients(t *testing.T) {
	basis := "100g"
	current := &domain.PackagedFood{IsActive: true, ReviewStatus: "active", NutritionBasisUnit: &basis, CarbsPer100g: 5.6, FatPer100g: 4.8}
	if validatePackagedImportPatch(current, map[string]any{"sugar_per_100g": 65.0}) == nil {
		t.Fatal("invalid sugar patch accepted")
	}
	current.IsActive = false
	current.SugarPer100g = 65
	if validatePackagedImportPatch(current, map[string]any{"is_active": true}) == nil {
		t.Fatal("invalid activation accepted")
	}
	if err := validatePackagedImportPatch(current, map[string]any{"display_name": "corrected title"}); err != nil {
		t.Fatal(err)
	}
	if err := validatePackagedImportPatch(current, map[string]any{"is_active": true, "sugar_per_100g": 4.0}); err != nil {
		t.Fatal(err)
	}
}

func TestAdminImportValidatesEveryNutrientValue(t *testing.T) {
	basis := "100g"
	typeOfFood := reflect.TypeOf(domain.PackagedFood{})
	for i := 0; i < typeOfFood.NumField(); i++ {
		field := typeOfFood.Field(i)
		if !strings.HasSuffix(field.Name, "Per100g") {
			continue
		}
		t.Run(field.Name, func(t *testing.T) {
			for _, invalid := range []float64{-1, math.Inf(1), math.NaN()} {
				item := &domain.PackagedFood{IsActive: true, ReviewStatus: "active", NutritionBasisUnit: &basis}
				reflect.ValueOf(item).Elem().Field(i).SetFloat(invalid)
				if err := validateActivePackagedImport(item); err == nil {
					t.Fatalf("invalid %s value accepted for active import", field.Name)
				}
			}
			item := &domain.PackagedFood{IsActive: true, ReviewStatus: "active", NutritionBasisUnit: &basis}
			jsonKey := strings.Split(field.Tag.Get("json"), ",")[0]
			if err := validatePackagedImportPatch(item, map[string]any{jsonKey: -1.0}); err == nil {
				t.Fatalf("invalid %s patch accepted", jsonKey)
			}
		})
	}
}
