package service

import (
	"math"
	"testing"
)

func TestPackagedImportConvertsNutrientMassUnits(t *testing.T) {
	for _, tc := range []struct {
		value    float64
		from, to string
		want     float64
	}{
		{65, "毫克", "g", .065}, {130000, "μg", "mg", 130},
		{.2, "mg", "ug", 200}, {37.93, "mg α-TE", "mg", 37.93},
	} {
		got, err := convertLabelMass(PackagedLabelNutritionValue{Value: tc.value, Unit: tc.from}, tc.to)
		if err != nil || math.Abs(got-tc.want) > 1e-9 {
			t.Fatalf("%+v got=%v error=%v", tc, got, err)
		}
	}
}

func TestPackagedImportRejectsUnresolvedPercentBeforeAutoIngest(t *testing.T) {
	result := &PackagedProductExtractResult{
		RawNutritionBasis: PackagedLabelNutritionBasis{Value: 100, Unit: "g"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{
			Energy:       PackagedLabelNutritionValue{Value: 100, Unit: "kcal"},
			Fat:          PackagedLabelNutritionValue{Value: 1, Unit: "g"},
			SaturatedFat: PackagedLabelNutritionValue{Value: 66, Unit: "%"},
		},
		UnitNutritionPer100g: map[string]any{"saturatedFat": 66.0},
	}
	convertPackagedNutrition(result)
	if result.ConversionStatus != "unsupported_nutrient_unit" || len(result.UnitNutritionPer100g) != 0 {
		t.Fatalf("unresolved percent accepted: %+v", result)
	}
}

func TestPackagedImportRejectsRawNegativeAndUnknownEnergyUnits(t *testing.T) {
	if value := parseNutritionValue(map[string]any{"value": -65.0, "unit": "mg"}); value.Value != -65 {
		t.Fatalf("invalid value was silently zeroed: %+v", value)
	}
	result := &PackagedProductExtractResult{
		RawNutritionBasis:    PackagedLabelNutritionBasis{Value: 100, Unit: "g"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{Energy: PackagedLabelNutritionValue{Value: 66, Unit: "%"}},
	}
	convertPackagedNutrition(result)
	if result.ConversionStatus != "unsupported_energy_unit" || len(result.RawLabelPayload) == 0 {
		t.Fatalf("invalid energy accepted or evidence lost: %+v", result)
	}
}

func TestPackagedImportBlocksCrossNutrientContradiction(t *testing.T) {
	result := &PackagedProductExtractResult{
		RawNutritionBasis: PackagedLabelNutritionBasis{Value: 100, Unit: "ml"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{
			Energy: PackagedLabelNutritionValue{Value: 184, Unit: "kJ"},
			Carbs:  PackagedLabelNutritionValue{Value: 0, Unit: "g"},
			Sugar:  PackagedLabelNutritionValue{Value: 10.5, Unit: "g"},
		},
	}
	convertPackagedNutrition(result)
	if result.ConversionStatus != "invalid_nutrition" {
		t.Fatalf("contradiction accepted: %+v", result)
	}
}
