package main

import (
	"encoding/json"
	"testing"

	"gorm.io/datatypes"
)

func TestEvaluateItemClassifiesSuspiciousUnresolvedZero(t *testing.T) {
	item := itemView{
		Index:           0,
		Item:            map[string]any{"name": "如实酸奶"},
		Name:            "如实酸奶",
		WeightG:         135,
		NutritionSource: "unresolved",
		ResolveStatus:   "unresolved",
	}

	row, classification := evaluateItem(zeroSuspicionRow{Surface: "test"}, item, 5)
	if classification != "suspicious_zero" {
		t.Fatalf("classification = %s, want suspicious_zero", classification)
	}
	if row == nil || row.SuggestedSeverity != "high" {
		t.Fatalf("row severity = %#v, want high", row)
	}
}

func TestEvaluateItemExcludesKnownZeroDrink(t *testing.T) {
	item := itemView{
		Item:     map[string]any{"name": "白开水"},
		Name:     "白开水",
		WeightG:  250,
		Calories: 0,
		Protein:  0,
		Carbs:    0,
		Fat:      0,
	}

	row, classification := evaluateItem(zeroSuspicionRow{Surface: "test"}, item, 5)
	if row != nil {
		t.Fatalf("row = %#v, want nil", row)
	}
	if classification != "known_zero" {
		t.Fatalf("classification = %s, want known_zero", classification)
	}
}

func TestEvaluateItemCountsNonZeroFood(t *testing.T) {
	item := itemView{
		Item:     map[string]any{"name": "双汇玉米热狗肠"},
		Name:     "双汇玉米热狗肠",
		WeightG:  40,
		Calories: 80,
		Protein:  4.4,
		Carbs:    6,
		Fat:      4.4,
	}

	row, classification := evaluateItem(zeroSuspicionRow{Surface: "test"}, item, 5)
	if row != nil {
		t.Fatalf("row = %#v, want nil", row)
	}
	if classification != "meaningful_non_zero" {
		t.Fatalf("classification = %s, want meaningful_non_zero", classification)
	}
}

func TestRunBenchmarkAppliesTargetRate(t *testing.T) {
	items := []map[string]any{
		{
			"name":                 "鸡蛋",
			"estimatedWeightGrams": 50,
			"nutrition_source":     "food_nutrition_library",
			"nutrients":            map[string]any{"calories": 72, "protein": 6.5, "carbs": 0.4, "fat": 5.0},
		},
		{
			"name":                 "如实酸奶",
			"estimatedWeightGrams": 135,
			"nutrition_source":     "unresolved",
			"resolve_status":       "unresolved",
			"nutrients":            map[string]any{"calories": 0, "protein": 0, "carbs": 0, "fat": 0},
		},
	}
	raw, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}

	report := runBenchmark([]recordRow{{ID: "record-1", Items: datatypes.JSON(raw)}}, nil, 30, 5, 0.0001)
	if report.Overall.MeaningfulItems != 2 {
		t.Fatalf("meaningful_items = %d, want 2", report.Overall.MeaningfulItems)
	}
	if report.Overall.SuspiciousZeroItems != 1 {
		t.Fatalf("suspicious_zero_items = %d, want 1", report.Overall.SuspiciousZeroItems)
	}
	if report.Overall.PassTarget {
		t.Fatalf("pass_target = true, want false")
	}
}
