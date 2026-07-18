package domain

import (
	"math"
	"strings"
)

const (
	proteinKcalPerGram = 4.0
	carbsKcalPerGram   = 4.0
	fatKcalPerGram     = 9.0

	NutritionQualityAuthoritative    = "authoritative"
	NutritionQualityReviewedEstimate = "reviewed_estimate"
	NutritionQualityLegacyCurated    = "legacy_curated"
	NutritionQualityPlausible        = "plausible"
	NutritionQualityUnreviewed       = "unreviewed"
	NutritionQualityRejected         = "rejected"

	NutritionAliasApprovedExact = "approved_exact"
	NutritionAliasCandidateOnly = "candidate_only"
	NutritionAliasBlocked       = "blocked"
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
	case "qwen_generated", "gemini_generated", "deepseek_generated", "deepseek_v4_pro_auto", "deepseek_auto", "llm_generated", "ai估算（deepseek）":
		return true
	default:
		return strings.HasSuffix(source, "_generated") || strings.HasPrefix(source, "ai估算")
	}
}

// EffectiveNutritionQualityTier provides a safe compatibility value while a
// database is being migrated. An absent tier never upgrades AI output.
func EffectiveNutritionQualityTier(food FoodNutrition) string {
	tier := strings.ToLower(strings.TrimSpace(food.QualityTier))
	if tier != "" {
		return tier
	}
	if IsAIGeneratedNutritionSource(food.Source) {
		return NutritionQualityPlausible
	}
	return NutritionQualityLegacyCurated
}

// IsNutritionExactMatchEligible allows reviewed estimates only through an
// exact canonical name or an explicitly approved exact alias.
func IsNutritionExactMatchEligible(food FoodNutrition) bool {
	if !food.IsActive {
		return false
	}
	switch EffectiveNutritionQualityTier(food) {
	case NutritionQualityAuthoritative, NutritionQualityReviewedEstimate, NutritionQualityLegacyCurated:
		return true
	default:
		return false
	}
}

// IsNutritionCandidateMatchEligible is intentionally stricter than exact
// matching. A reviewed estimate cannot become a fuzzy Top5 source because the
// identity model does not independently validate its nutrition values.
func IsNutritionCandidateMatchEligible(food FoodNutrition) bool {
	if !food.IsActive {
		return false
	}
	switch EffectiveNutritionQualityTier(food) {
	case NutritionQualityAuthoritative, NutritionQualityLegacyCurated:
		return true
	default:
		return false
	}
}

func IsApprovedExactNutritionAlias(status string) bool {
	return strings.EqualFold(strings.TrimSpace(status), NutritionAliasApprovedExact)
}
