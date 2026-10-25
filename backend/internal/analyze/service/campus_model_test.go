package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCampusBudgetNutritionUsesQwenWithoutProOrGemini(t *testing.T) {
	var expensiveCalls, qwenCalls atomic.Int32
	expensive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expensiveCalls.Add(1)
		http.Error(w, "unexpected expensive model", http.StatusInternalServerError)
	}))
	defer expensive.Close()
	unit := map[string]any{"calories": 97.0, "protein": 2.0, "carbs": 20.0, "fat": 1.0}
	for _, key := range preciseMicronutrientKeys {
		unit[key] = 1.0
	}
	qwen := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		qwenCalls.Add(1)
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "qwen3.8-flash", body["model"])
		content, err := json.Marshal(map[string]any{"items": []any{map[string]any{"index": 0, "unitNutritionPer100g": unit}}})
		require.NoError(t, err)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}}})
	}))
	defer qwen.Close()
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureDashScopeLLMClient(NewDashScopeClient("test-key", qwen.URL))
	s.ConfigureDeepSeekFallback("test-key", expensive.URL)
	s.ConfigureGemini35LLMClient(NewOfoxAIClient("test-key", "gemini-3.5-flash", expensive.URL))
	originalDeepSeek, originalFallback := s.deepseek, s.nutritionAI
	sharedChain := originalFallback.(*chainedNutritionFallbackEstimator)
	require.Len(t, sharedChain.estimators, 3)
	items, err := s.ApplyCampusPreciseMicronutrientsToResolvedItems(context.Background(), []map[string]any{{
		"name": "熟米饭", "estimatedWeightGrams": 200.0, "nutrition_source": "database_exact",
		"nutrients":               map[string]any{"calories": 194.0, "protein": 4.0, "carbs": 40.0, "fat": 2.0},
		"unit_nutrition_per_100g": map[string]any{"calories": 97.0, "protein": 2.0, "carbs": 20.0, "fat": 1.0},
	}}, "历史食堂资料，仅估算营养")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.EqualValues(t, 1, qwenCalls.Load())
	require.Zero(t, expensiveCalls.Load())
	require.Equal(t, "qwen_generated", items[0]["micronutrient_source"])
	require.NoError(t, ValidatePreciseMicronutrientItems(items))
	require.Same(t, originalDeepSeek, s.deepseek)
	require.Same(t, originalFallback, s.nutritionAI)
	require.Equal(t, "deepseek-v4-pro", s.deepseek.Model, "ordinary callers must retain their original routing")
}

func TestCampusBudgetMissingQwenDoesNotUsePro(t *testing.T) {
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureDeepSeekFallback("test-key", "http://127.0.0.1:1")
	_, err := s.campusBudgetService(context.Background())
	require.ErrorContains(t, err, "千问")
	require.NotNil(t, s.deepseek)
}

func TestCampusBudgetTextOverridesProWithoutChangingOrdinaryDefault(t *testing.T) {
	c := balancedChannels{openlux: &channelFixture{result: textFood("五花肉", 200, 27, 1, 75)}}
	qwen := &mockLLMClient{result: textFood("五花肉", 200, 27, 1, 75)}
	s := newTextRoutingService(t, c, qwen)
	result, err := s.AnalyzeCampusText(standardVisionCtx(), "", AnalyzeInput{Text: "200g五花肉", ModelName: "deepseek-v4-pro"})
	require.NoError(t, err)
	require.Equal(t, "qwen3.8-flash", result["model_name"])
	require.Equal(t, 1, qwen.calls)
	require.Zero(t, c.openlux.calls.Load())
	result, err = s.AnalyzeText(standardVisionCtx(), "", AnalyzeInput{Text: "200g五花肉"})
	require.NoError(t, err)
	require.Equal(t, gemini3FlashModel, result["model_name"])
	require.EqualValues(t, 1, c.openlux.calls.Load())
}
