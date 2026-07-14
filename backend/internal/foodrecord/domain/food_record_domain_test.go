package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMacroCaloriesAndAIGeneratedSource(t *testing.T) {
	assert.Equal(t, 200.0, MacroCalories(13, 10, 12))
	assert.Equal(t, 0.0, MacroCalories(-1, -2, -3))
	assert.True(t, IsAIGeneratedNutritionSource("qwen_generated"))
	assert.True(t, IsAIGeneratedNutritionSource("gemini_generated"))
	assert.True(t, IsAIGeneratedNutritionSource("deepseek_v4_pro_auto"))
	assert.True(t, IsAIGeneratedNutritionSource("llm_generated"))
	assert.False(t, IsAIGeneratedNutritionSource("ingredient_label"))
	assert.False(t, IsAIGeneratedNutritionSource("library_exact_canonical"))
}

func TestFoodItemUnmarshalJSON_Ingredients(t *testing.T) {
	input := `{
		"name": "奥利奥饼干",
		"weight": 100,
		"ratio": 100,
		"intake": 100,
		"ingredients": {
			"ingredientsText": "小麦粉、白砂糖、植物油、可可粉...",
			"servingSize": "每份 19.4g",
			"nutritionPer100g": {
				"calories": 2000,
				"protein": 6.5,
				"fat": 21,
				"carbs": 67,
				"sodiumMg": 520
			}
		}
	}`

	var item FoodItem
	if err := json.Unmarshal([]byte(input), &item); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if item.Ingredients == nil {
		t.Fatal("expected Ingredients to be non-nil")
	}
	if item.Ingredients.IngredientsText != "小麦粉、白砂糖、植物油、可可粉..." {
		t.Errorf("IngredientsText: expected %q, got %q", "小麦粉、白砂糖、植物油、可可粉...", item.Ingredients.IngredientsText)
	}
	if item.Ingredients.ServingSize != "每份 19.4g" {
		t.Errorf("ServingSize: expected %q, got %q", "每份 19.4g", item.Ingredients.ServingSize)
	}
	calories, ok := item.Ingredients.NutritionPer100g["calories"].(float64)
	if !ok || calories != 2000 {
		t.Errorf("NutritionPer100g calories: expected 2000, got %v", item.Ingredients.NutritionPer100g["calories"])
	}

	marshaled, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if !strings.Contains(string(marshaled), "ingredientsText") {
		t.Error("marshaled JSON should contain ingredientsText")
	}
}

func TestFoodItemUnmarshalJSON_ClampsRatioAndIntake(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		expectRatio  float64
		expectIntake float64
	}{
		{
			name:         "intake exceeding weight clamps ratio to 100",
			input:        `{"weight":200,"intake":250}`,
			expectRatio:  100,
			expectIntake: 200,
		},
		{
			name:         "ratio over 100 is clamped",
			input:        `{"weight":200,"ratio":120,"intake":200}`,
			expectRatio:  100,
			expectIntake: 200,
		},
		{
			name:         "normal ratio and intake preserved",
			input:        `{"weight":200,"ratio":50,"intake":100}`,
			expectRatio:  50,
			expectIntake: 100,
		},
		{
			name:         "ratio exactly 100 preserved",
			input:        `{"weight":281.6,"ratio":100.2,"intake":282.2}`,
			expectRatio:  100,
			expectIntake: 281.6,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var item FoodItem
			if err := json.Unmarshal([]byte(tt.input), &item); err != nil {
				t.Fatalf("unmarshal failed: %v", err)
			}
			if item.Ratio != tt.expectRatio {
				t.Errorf("Ratio: expected %v, got %v", tt.expectRatio, item.Ratio)
			}
			if item.Intake != tt.expectIntake {
				t.Errorf("Intake: expected %v, got %v", tt.expectIntake, item.Intake)
			}
		})
	}
}
