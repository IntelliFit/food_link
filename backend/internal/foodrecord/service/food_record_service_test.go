package service

import (
	"testing"

	"food_link/backend/internal/foodrecord/domain"
)

func TestNormalizeFoodItems(t *testing.T) {
	tests := []struct {
		name     string
		input    []domain.FoodItem
		expected []domain.FoodItem
	}{
		{
			name: "ratio over 100 should be clamped",
			input: []domain.FoodItem{
				{Weight: 200, Ratio: 120, Intake: 200},
			},
			expected: []domain.FoodItem{
				{Weight: 200, Ratio: 100, Intake: 200},
			},
		},
		{
			name: "intake over weight should be clamped",
			input: []domain.FoodItem{
				{Weight: 200, Ratio: 100, Intake: 250},
			},
			expected: []domain.FoodItem{
				{Weight: 200, Ratio: 100, Intake: 200},
			},
		},
		{
			name: "negative ratio should be clamped to 0",
			input: []domain.FoodItem{
				{Weight: 200, Ratio: -10, Intake: 0},
			},
			expected: []domain.FoodItem{
				{Weight: 200, Ratio: 0, Intake: 0},
			},
		},
		{
			name: "negative intake should be clamped to 0",
			input: []domain.FoodItem{
				{Weight: 200, Ratio: 50, Intake: -20},
			},
			expected: []domain.FoodItem{
				{Weight: 200, Ratio: 50, Intake: 0},
			},
		},
		{
			name: "normal values should not change",
			input: []domain.FoodItem{
				{Weight: 200, Ratio: 50, Intake: 100},
			},
			expected: []domain.FoodItem{
				{Weight: 200, Ratio: 50, Intake: 100},
			},
		},
		{
			name: "ratio 100.2 should be clamped to 100",
			input: []domain.FoodItem{
				{Weight: 281.6, Ratio: 100.2, Intake: 282.2},
			},
			expected: []domain.FoodItem{
				{Weight: 281.6, Ratio: 100, Intake: 281.6},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeFoodItems(tt.input)
			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d items, got %d", len(tt.expected), len(result))
			}
			for i := range result {
				if result[i].Ratio != tt.expected[i].Ratio {
					t.Errorf("item[%d].Ratio: expected %v, got %v", i, tt.expected[i].Ratio, result[i].Ratio)
				}
				if result[i].Intake != tt.expected[i].Intake {
					t.Errorf("item[%d].Intake: expected %v, got %v", i, tt.expected[i].Intake, result[i].Intake)
				}
			}
		})
	}
}

func TestReconcileAIGeneratedFoodItems_UserCorrectionOverridesHistoricalAICategory(t *testing.T) {
	userCorrection := "user_correction_context"
	aiCategory := "gemini_generated"
	items, hasAI := reconcileAIGeneratedFoodItems([]domain.FoodItem{{
		NutritionSource:         &userCorrection,
		NutritionSourceCategory: &aiCategory,
		Nutrients: domain.FoodItemNutrients{
			Calories: 142,
			Protein:  2.6,
			Carbs:    18.2,
			Fat:      6.6,
		},
	}})

	if hasAI {
		t.Fatal("user correction must not be treated as AI-generated nutrition")
	}
	if got := items[0].Nutrients.Calories; got != 142 {
		t.Fatalf("corrected calories were overwritten: got %v want 142", got)
	}
}

func TestReconcileAIGeneratedFoodItems_UntouchedAIRemainsReconciled(t *testing.T) {
	aiSource := "gemini_generated"
	items, hasAI := reconcileAIGeneratedFoodItems([]domain.FoodItem{{
		NutritionSource: &aiSource,
		Nutrients: domain.FoodItemNutrients{
			Calories: 120,
			Protein:  3.8,
			Carbs:    27,
			Fat:      9.8,
		},
	}})

	if !hasAI {
		t.Fatal("untouched AI nutrition should still be reconciled")
	}
	if got := items[0].Nutrients.Calories; got != 211.4 {
		t.Fatalf("unexpected reconciled calories: got %v want 211.4", got)
	}
}
