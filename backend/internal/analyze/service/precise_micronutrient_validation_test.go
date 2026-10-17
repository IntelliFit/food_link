package service

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func usableMicronutrientUnitForValidationTest() map[string]any {
	unit := zeroUnitNutritionPer100g()
	unit["fiber"], unit["sodiumMg"], unit["calciumMg"], unit["potassiumMg"] = 1.0, 2.0, 3.0, 4.0
	return unit
}

func TestValidatePreciseMicronutrientUnitRejectsInvalidFields(t *testing.T) {
	for _, invalid := range []any{"0", "25mg", -0.1, math.NaN(), math.Inf(1), math.Inf(-1), nil, true} {
		t.Run(fmtValidationValueType(invalid), func(t *testing.T) {
			unit := usableMicronutrientUnitForValidationTest()
			unit["vitaminB12Mcg"] = invalid
			require.ErrorContains(t, validatePreciseMicronutrientUnit(unit), "vitaminB12Mcg")
		})
	}
	unit := usableMicronutrientUnitForValidationTest()
	require.NoError(t, validatePreciseMicronutrientUnit(unit))
	delete(unit, "vitaminB12Mcg")
	require.ErrorContains(t, validatePreciseMicronutrientUnit(unit), "vitaminB12Mcg")
}

func fmtValidationValueType(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case float64:
		return "invalid_number"
	case bool:
		return "boolean"
	default:
		return "null"
	}
}

func TestValidatePreciseMicronutrientItemsRejectsInvalidScaledProfile(t *testing.T) {
	unit := usableMicronutrientUnitForValidationTest()
	unit["vitaminCMg"] = -1.0
	require.ErrorContains(t, ValidatePreciseMicronutrientItems([]map[string]any{{
		"micronutrient_analysis": preciseMicronutrientAnalysisMarker,
		"micronutrient_source":   "test_generated", "nutrients": unit,
	}}), "vitaminCMg")
}
