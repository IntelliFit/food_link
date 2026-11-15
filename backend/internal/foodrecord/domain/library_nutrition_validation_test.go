package domain

import (
	"math"
	"testing"
)

func TestLibraryImportNutrientBounds(t *testing.T) {
	for _, tc := range []struct {
		name, basis string
		values      map[string]float64
		invalid     bool
	}{
		{"chacha shifted column", "100g", map[string]float64{"protein": 28.8, "carbs": 34, "fat": 48.7}, true},
		{"corrected chacha", "100g", map[string]float64{"protein": 28.8, "carbs": 7.9, "fat": 48.7, "sugar": 4.6}, false},
		{"sodium mistaken for sugar", "100g", map[string]float64{"carbs": 5.6, "sugar": 65}, true},
		{"fatty acid percent mistaken for grams", "100g", map[string]float64{"fat": .6, "saturatedFat": 100}, true},
		{"volume is not mass", "每100毫升", map[string]float64{"carbs": 110, "calories": 440}, false},
		{"legacy basis spelling", "per-100g", map[string]float64{"carbs": 80}, false},
		{"missing basis", "", map[string]float64{"carbs": 10}, true},
		{"count is not grams", "serving", map[string]float64{"carbs": 10}, true},
		{"negative", "100g", map[string]float64{"carbs": -1}, true},
		{"nonfinite", "100ml", map[string]float64{"fat": math.Inf(1)}, true},
		{"rounding", "100g", map[string]float64{"carbs": 1, "sugar": 1.1}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateLibraryNutrition(tc.basis, tc.values)
			if (err != nil) != tc.invalid {
				t.Fatalf("error=%v invalid=%v", err, tc.invalid)
			}
		})
	}
}
