package repo

import (
	"encoding/json"
	"reflect"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	"gorm.io/datatypes"
)

func TestManualMissingNutrientsExplicitEvidence(t *testing.T) {
	evidence := map[string]any{
		"missing_fields": []any{"fiber", "riboflavin_mg_per_100g", "not-a-nutrient"},
		"raw_nutrition_per_basis": map[string]any{
			"sugar":    map[string]any{},
			"sodiumMg": map[string]any{"value": 0, "unit": "mg"},
		},
		"data_cleanup": map[string]any{"unknown_fields": []string{"potassiumMg", "riboflavinMg"}},
	}
	want := []string{"fiber", "sugar", "potassiumMg", "riboflavinMg"}
	if got := manualMissingNutrients(evidence); !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit missing values not normalized: got=%v want=%v", got, want)
	}
	if got := manualMissingNutrients(nil); got != nil {
		t.Fatalf("legacy zero values must not be relabeled missing by guess: %v", got)
	}
}

func TestManualFoodMappersExposeMissingNutrients(t *testing.T) {
	p := manualFoodResultFromPackaged(fooddomain.PackagedFood{RawLabelPayload: map[string]any{"missing_fields": []string{"riboflavinMg"}}}, 0)
	if !reflect.DeepEqual(p.MissingNutrients, []string{"riboflavinMg"}) {
		t.Fatalf("packaged missing evidence lost: %v", p.MissingNutrients)
	}
	s := manualFoodResultFromNutrition(fooddomain.FoodNutrition{QualityEvidence: datatypes.JSONMap{"data_cleanup": map[string]any{"unknown_nutrients": []string{"saturated_fat_per_100g"}}}}, 0)
	if !reflect.DeepEqual(s.MissingNutrients, []string{"saturatedFat"}) {
		t.Fatalf("standard missing evidence lost: %v", s.MissingNutrients)
	}
}

func TestFoodSnapshotRetainsMissingNutrientEvidence(t *testing.T) {
	original := fooddomain.FoodItem{Name: "标签未提供B2", MissingNutrients: []string{"riboflavinMg"}}
	body, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var restored fooddomain.FoodItem
	if err := json.Unmarshal(body, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original.MissingNutrients, restored.MissingNutrients) {
		t.Fatal("new record snapshot lost source missingness")
	}
}
