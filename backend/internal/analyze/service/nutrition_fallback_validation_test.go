package service

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestChainedNutritionFallbackInvalidFastResultDoesNotCancelValidProvider(t *testing.T) {
	for _, tc := range []struct {
		name string
		row  map[string]any
	}{
		{name: "nil_source_only", row: nil},
		{name: "missing_macros", row: map[string]any{"calories": 200.0}},
		{name: "non_numeric_macro", row: map[string]any{"calories": 200.0, "protein": "10g", "carbs": 20.0, "fat": 8.0}},
		{name: "negative_macro", row: map[string]any{"calories": 200.0, "protein": -10.0, "carbs": 20.0, "fat": 8.0}},
		{name: "non_finite_macro", row: map[string]any{"calories": 200.0, "protein": math.Inf(1), "carbs": 20.0, "fat": 8.0}},
		{name: "zero_food", row: map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}},
		{name: "impossible_mass", row: map[string]any{"calories": 570.0, "protein": 60.0, "carbs": 60.0, "fat": 10.0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fast := &delayedNutritionFallbackEstimator{rows: map[int]map[string]any{0: tc.row}}
			valid := &delayedNutritionFallbackEstimator{delay: 10 * time.Millisecond, rows: map[int]map[string]any{
				0: {"calories": 192.0, "protein": 10.0, "carbs": 20.0, "fat": 8.0},
			}}
			estimator := newChainedNutritionFallbackEstimator(
				namedNutritionFallbackEstimator{source: "invalid_generated", estimator: fast, timeout: time.Second},
				namedNutritionFallbackEstimator{source: "valid_generated", estimator: valid, timeout: time.Second},
			)
			rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{Index: 0, Name: "汉堡", EstimatedWeightGrams: 300}}, "")
			require.NoError(t, err)
			require.Equal(t, "valid_generated", rows[0][fallbackNutritionSourceKey])
			require.Equal(t, 192.0, rows[0]["calories"])
		})
	}
}

func TestUsableNutritionFallbackRequiresBasicFieldsEvenForWater(t *testing.T) {
	require.False(t, usableNutritionFallbackRow("水", map[string]any{fallbackNutritionSourceKey: "test_generated"}))
	require.True(t, usableNutritionFallbackRow("水", map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}))
	require.True(t, usableNutritionFallbackRow("清汤", map[string]any{"calories": 0.1, "protein": 0.025, "carbs": 0.0, "fat": 0.0}))
	require.False(t, usableNutritionFallbackRow("汉堡", map[string]any{"calories": 100.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}))
}

func TestValidateResolvedNutritionItemsRejectsImpossibleMacroMass(t *testing.T) {
	require.ErrorContains(t, ValidateResolvedNutritionItems([]map[string]any{{
		"name": "食物", "estimatedWeightGrams": 100.0,
		"nutrients": map[string]any{"calories": 570.0, "protein": 60.0, "carbs": 60.0, "fat": 10.0},
	}}), "三大营养素总量超过可食重量")
}

func TestFallbackParsersRejectMissingCoreFieldsBeforeDefaults(t *testing.T) {
	for _, tc := range []struct {
		name string
		unit map[string]any
	}{
		{name: "missing_protein", unit: map[string]any{"calories": 100.0, "carbs": 20.0, "fat": 2.0}},
		{name: "string_protein", unit: map[string]any{"calories": 100.0, "protein": "2g", "carbs": 20.0, "fat": 2.0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parsed := map[string]any{"items": []any{map[string]any{"index": 0.0, "unitNutritionPer100g": tc.unit}}}
			qwen := NewQwenNutritionEstimator(&mockLLMClient{result: parsed})
			candidates := []UnresolvedNutritionCandidate{{Index: 0, Name: "菜品", EstimatedWeightGrams: 100}}
			rows, err := qwen.Estimate(context.Background(), candidates, "")
			require.NoError(t, err)
			require.Empty(t, rows)

			content, err := json.Marshal(parsed)
			require.NoError(t, err)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}}})
			}))
			defer server.Close()
			deepseek := NewDeepSeekNutritionEstimator("test-key", server.URL, "test-model")
			rows, err = deepseek.Estimate(context.Background(), candidates, "")
			require.NoError(t, err)
			require.Empty(t, rows)
		})
	}
	require.True(t, nutritionFallbackCoreFieldsValid(map[string]any{"energy": 100.0, "protein": 2.0, "carbohydrate": 20.0, "fat": 2.0}))
}
