package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type fastEmptyQwenClient struct{ qwenFallbackLLMClient }

func (m *fastEmptyQwenClient) AnalyzeWithImagesDashScopeWebSearch(context.Context, string, []string, DashScopeWebSearchOptions) (map[string]any, map[string]any, error) {
	m.models = append(m.models, qwen38FlashModel)
	return m.results[qwen38FlashModel], map[string]any{"native_search": true}, nil
}

func fastRegressionFoodResult() map[string]any {
	return map[string]any{"items": []any{map[string]any{
		"name": "菜包", "estimatedWeightGrams": 100.0,
		"nutrients": map[string]any{"calories": 220.0, "protein": 8.0, "carbs": 35.0, "fat": 4.0},
	}}}
}

func TestFastFoodEmptyResultRecovery(t *testing.T) {
	for _, mode := range []string{fastExecutionMode, fastWebSearchMode} {
		for _, scenario := range []string{"empty primary recovers", "both empty fail", "valid primary stays"} {
			t.Run(mode+"/"+scenario, func(t *testing.T) {
				primary, backup := map[string]any{"items": []any{}}, fastRegressionFoodResult()
				if scenario == "both empty fail" {
					backup = map[string]any{}
				}
				if scenario == "valid primary stays" {
					primary = fastRegressionFoodResult()
				}
				client := &fastEmptyQwenClient{qwenFallbackLLMClient{results: map[string]map[string]any{
					qwen38FlashModel: primary, qwen36FlashModel: backup,
				}}}
				svc := NewAnalyzeService(nil, nil, nil)
				svc.ConfigureDashScopeLLMClient(client)
				svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
				result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
					ImageURL: "https://example.com/meal.jpg", ExecutionMode: &mode, ModelName: qwen38FlashModel,
				})
				if scenario == "both empty fail" {
					require.Error(t, err)
					require.True(t, errors.Is(err, ErrEmptyFoodAnalysisResult))
					require.Nil(t, result)
				} else {
					require.NoError(t, err)
					require.NotEmpty(t, toItems(result["items"]))
					meta := mapFromAny(result["hybrid_review"])
					require.Equal(t, scenario == "empty primary recovers", meta["fallback_used"])
					if scenario == "empty primary recovers" {
						require.Equal(t, "empty_food_result", meta["fallback_reason"])
						require.Equal(t, qwen36FlashModel, meta["base_model"])
					}
				}
				if scenario == "valid primary stays" {
					require.Equal(t, []string{qwen38FlashModel}, client.models)
				} else {
					require.Equal(t, []string{qwen38FlashModel, qwen36FlashModel}, client.models)
					require.Contains(t, client.withoutThinkingModels, qwen36FlashModel)
				}
			})
		}
	}
}
