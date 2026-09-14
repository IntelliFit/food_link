package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type qwenFallbackLLMClient struct {
	results               map[string]map[string]any
	models                []string
	withoutThinkingModels []string
}

func (m *qwenFallbackLLMClient) Analyze(context.Context, string, string) (map[string]any, error) {
	return m.results[qwen38FlashModel], nil
}

func (m *qwenFallbackLLMClient) AnalyzeWithImagesAndTemperatureModel(_ context.Context, _ string, _ []string, _ float64, modelName string) (map[string]any, error) {
	m.models = append(m.models, modelName)
	return m.results[modelName], nil
}

func (m *qwenFallbackLLMClient) AnalyzeWithImagesWithoutThinkingModel(_ context.Context, _ string, _ []string, modelName string) (map[string]any, error) {
	m.models = append(m.models, modelName)
	m.withoutThinkingModels = append(m.withoutThinkingModels, modelName)
	return m.results[modelName], nil
}

func TestAnalyzeImageQwenEmptyResultFallsBackToQwen36WithoutThinking(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]any
	}{
		{name: "empty object", result: map[string]any{}},
		{name: "missing items", result: map[string]any{"description": "无法获取描述"}},
		{name: "empty items", result: map[string]any{"description": "无法获取描述", "items": []any{}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			qwenClient := &qwenFallbackLLMClient{results: map[string]map[string]any{
				qwen38FlashModel: tt.result,
				qwen36FlashModel: {
					"description": "千问 3.6 备用识别成功",
					"items": []any{map[string]any{
						"name":                 "白米饭",
						"estimatedWeightGrams": 100.0,
						"nutrients": map[string]any{
							"calories": 130.0,
							"protein":  2.6,
							"carbs":    28.0,
							"fat":      0.3,
						},
					}},
				},
			}}
			svc := NewAnalyzeService(nil, nil, nil)
			svc.ConfigureDashScopeLLMClient(qwenClient)
			svc.ConfigureImageModelTraffic(100, 0)
			svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

			result, err := svc.Analyze(context.Background(), "user-empty-fallback", AnalyzeInput{
				ImageURL: "https://example.com/meal.jpg",
			})

			require.NoError(t, err)
			assert.Equal(t, "千问 3.6 备用识别成功", result["description"])
			assert.Equal(t, []string{qwen38FlashModel, qwen36FlashModel}, qwenClient.models)
			assert.Equal(t, []string{qwen36FlashModel}, qwenClient.withoutThinkingModels)
			meta := mapFromAny(result["hybrid_review"])
			assert.Equal(t, "qwen", meta["primary_provider"])
			assert.Equal(t, qwen38FlashModel, meta["primary_model"])
			assert.Equal(t, "qwen", meta["base_provider"])
			assert.Equal(t, qwen36FlashModel, meta["base_model"])
			assert.Equal(t, true, meta["fallback_used"])
			assert.Equal(t, "empty_food_result", meta["fallback_reason"])
		})
	}
}

func TestAnalyzeImageQwen38AndQwen36EmptyResultReturnsError(t *testing.T) {
	qwenClient := &qwenFallbackLLMClient{results: map[string]map[string]any{
		qwen38FlashModel: {"items": []any{}},
		qwen36FlashModel: {"items": []any{}},
	}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(qwenClient)
	svc.ConfigureImageModelTraffic(100, 0)

	result, err := svc.Analyze(context.Background(), "user-empty-failure", AnalyzeInput{
		ImageURL: "https://example.com/meal.jpg",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.True(t, errors.Is(err, ErrEmptyFoodAnalysisResult))
	assert.Equal(t, []string{qwen38FlashModel, qwen36FlashModel}, qwenClient.models)
	assert.Equal(t, []string{qwen36FlashModel}, qwenClient.withoutThinkingModels)
}

func TestValidateResolvedNutritionItemsRejectsEmptyResult(t *testing.T) {
	err := ValidateResolvedNutritionItems(nil)

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrEmptyFoodAnalysisResult))
}
