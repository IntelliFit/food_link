package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func fullPortionNutrients(calories, protein, carbs, fat float64) map[string]any {
	n := map[string]any{"calories": calories, "protein": protein, "carbs": carbs, "fat": fat}
	for _, key := range preciseMicronutrientKeys {
		n[key] = 1.0
	}
	return n
}

func TestApplyPrecisionNutritionUsesInlineEstimateNutrition(t *testing.T) {
	fallback := &fakeNutritionFallbackEstimator{}
	s := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	s.nutritionAI = fallback
	items := []map[string]any{{"name": "熟米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 200.0, "nutrients": fullPortionNutrients(232, 5, 52, 0.6)}}

	resolved, err := s.ApplyPrecisionNutrition(context.Background(), items, AnalyzeInput{AnalysisEngine: analysisEngineAIDirect, PreciseMicronutrients: true})
	require.NoError(t, err)
	require.Zero(t, fallback.calls, "plausible inline nutrition skips the separate estimate")
	require.InDelta(t, 232.0, numberFromAny(mapFromAny(resolved[0]["nutrients"])["calories"]), 1)
}

func TestApplyPrecisionNutritionReestimatesOnlyImplausibleInlineItems(t *testing.T) {
	unit := map[string]any{"calories": 400.0, "protein": 7.0, "carbs": 65.0, "fat": 13.0}
	for _, key := range preciseMicronutrientKeys {
		unit[key] = 1.0
	}
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{1: unit}}
	s := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	s.nutritionAI = fallback
	items := []map[string]any{
		{"name": "熟米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 200.0, "nutrients": fullPortionNutrients(232, 5, 52, 0.6)},
		// Per-100g values reported as the portion: macros exceed the 19g weight.
		{"name": "芝士夹心饼干", "foodState": "packaged", "weightBasis": "as_served", "estimatedWeightGrams": 19.0, "nutrients": fullPortionNutrients(480, 7, 65, 22)},
	}

	resolved, err := s.ApplyPrecisionNutrition(context.Background(), items, AnalyzeInput{AnalysisEngine: analysisEngineAIDirect, PreciseMicronutrients: true})
	require.NoError(t, err)
	require.Equal(t, 1, fallback.calls)
	require.Len(t, fallback.candidates, 1)
	require.Equal(t, 1, fallback.candidates[0].Index)
	require.Less(t, numberFromAny(mapFromAny(resolved[1]["nutrients"])["calories"]), 100.0)
}
