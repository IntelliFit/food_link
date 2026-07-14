package domain

import (
	"math"
	"strings"
)

const (
	proteinKcalPerGram = 4.0
	carbsKcalPerGram   = 4.0
	fatKcalPerGram     = 9.0
)

// MacroCalories returns the deterministic energy represented by the three
// macronutrients. AI-generated nutrition must use this value as its calories
// so independently generated fields cannot drift apart.
func MacroCalories(protein, carbs, fat float64) float64 {
	protein = math.Max(0, protein)
	carbs = math.Max(0, carbs)
	fat = math.Max(0, fat)
	return math.Round((protein*proteinKcalPerGram+carbs*carbsKcalPerGram+fat*fatKcalPerGram)*10000) / 10000
}

// IsAIGeneratedNutritionSource identifies nutrition estimates that do not
// come from a label or curated database and therefore must satisfy 4/4/9
// exactly before they are displayed or persisted.
func IsAIGeneratedNutritionSource(source string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	switch source {
	case "qwen_generated", "gemini_generated", "deepseek_generated", "deepseek_v4_pro_auto", "llm_generated":
		return true
	default:
		return strings.HasSuffix(source, "_generated")
	}
}
