package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImagePromptsRequirePhysicalEdiblePortionDecomposition(t *testing.T) {
	prompts := map[string]string{
		"standard": buildImageDBFirstPrompt(AnalyzeInput{}, nil),
		"lite":     buildLiteImageDBFirstPrompt(AnalyzeInput{}, nil),
		"precision": buildGemini35ImageDBFirstPrompt(
			AnalyzeInput{}, nil, gemini35FlashExecutionMode,
		),
		"grouped_weight": buildGemini35GroupedWeightPrompt(AnalyzeInput{}, map[string]any{
			"items": []any{map[string]any{"name": "完整食物", "groupId": 1}},
		}),
	}

	for name, prompt := range prompts {
		t.Run(name, func(t *testing.T) {
			assert.Contains(t, prompt, "hasInedibleParts")
			assert.Contains(t, prompt, "ediblePortionRatio")
			assert.Contains(t, prompt, "ediblePortionReason")
			assert.Contains(t, prompt, "不可食")
			assert.NotContains(t, prompt, "后端会用文本模型单独计算 ediblePortionRatio")
			assert.NotContains(t, prompt, "后端会用文本模型单独折算可食比例")
		})
	}
}

func TestParseItemsExplicitEdibleRatioControlsWeightAcrossFoodTypes(t *testing.T) {
	tests := []struct {
		name       string
		item       map[string]any
		wantGross  float64
		wantRatio  float64
		wantEdible float64
	}{
		{
			name: "完整带厚外皮食物",
			item: map[string]any{
				"name": "完整带厚外皮食物", "grossWeightGrams": 4000.0,
				"ediblePortionRatio": 62.0, "estimatedWeightGrams": 4000.0,
			},
			wantGross: 4000, wantRatio: 62, wantEdible: 2480,
		},
		{
			name: "带壳食物",
			item: map[string]any{
				"name": "带壳食物", "grossWeightGrams": 600.0,
				"ediblePortionRatio": 35.0, "estimatedWeightGrams": 600.0,
			},
			wantGross: 600, wantRatio: 35, wantEdible: 210,
		},
		{
			name: "已去皮切块食物",
			item: map[string]any{
				"name": "已去皮切块食物", "grossWeightGrams": 300.0,
				"ediblePortionRatio": 100.0, "estimatedWeightGrams": 180.0,
			},
			wantGross: 300, wantRatio: 100, wantEdible: 300,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items := parseItems(map[string]any{"items": []any{tt.item}})
			require.Len(t, items, 1)
			assert.Equal(t, tt.wantGross, items[0]["grossWeightGrams"])
			assert.Equal(t, tt.wantRatio, items[0]["ediblePortionRatio"])
			assert.Equal(t, tt.wantEdible, items[0]["estimatedWeightGrams"])
			assert.Equal(t, tt.wantEdible, items[0]["originalWeightGrams"])
		})
	}
}

func TestImageEdiblePortionKeepsExistingDeepSeekSecondStep(t *testing.T) {
	var calls atomic.Int32
	var prompt string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		messages := request["messages"].([]any)
		prompt = messages[0].(map[string]any)["content"].(string)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{
				"content": `{"items":[{"index":0,"ediblePortionRatio":62,"reason":"视觉结构与常见出成率交叉校验后微调"}]}`,
			}}},
		})
	}))
	defer server.Close()

	svc := NewAnalyzeService(nil, nil, nil)
	svc.deepseek = NewDeepSeekNutritionEstimator("test-key", server.URL, "deepseek-test")
	resp := map[string]any{"items": []map[string]any{map[string]any{
		"name": "完整带厚外层食物", "grossWeightGrams": 1000.0,
		"hasInedibleParts": true, "ediblePortionRatio": 58.0,
		"ediblePortionReason":  "按原图可见外层厚度和内部体积折算",
		"estimatedWeightGrams": 580.0,
	}}}

	result := svc.applyEdiblePortionRatios(context.Background(), resp, AnalyzeInput{})

	assert.Equal(t, int32(1), calls.Load())
	assert.Contains(t, prompt, `"visualHasInedibleParts":true`)
	assert.Contains(t, prompt, `"visualEdiblePortionRatio":58`)
	assert.Contains(t, prompt, "不得忽略后仅按食物名称重新猜测")
	items := result["items"].([]map[string]any)
	require.Len(t, items, 1)
	assert.Equal(t, 62.0, items[0]["ediblePortionRatio"])
	assert.Equal(t, 620.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "deepseek", items[0]["ediblePortionSource"])
}

func TestImageEdiblePortionSkipsDeepSeekWhenVisionSaysFullyEdible(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "unexpected call", http.StatusInternalServerError)
	}))
	defer server.Close()

	svc := NewAnalyzeService(nil, nil, nil)
	svc.deepseek = NewDeepSeekNutritionEstimator("test-key", server.URL, "deepseek-test")
	resp := map[string]any{"items": []map[string]any{map[string]any{
		"name": "米饭", "grossWeightGrams": 180.0,
		"hasInedibleParts": false, "ediblePortionRatio": 100.0,
		"ediblePortionReason":  "装盘后可直接食用",
		"estimatedWeightGrams": 180.0,
	}}}

	result := svc.applyEdiblePortionRatios(context.Background(), resp, AnalyzeInput{})

	assert.Equal(t, int32(0), calls.Load())
	assert.Equal(t, "deterministic", result["edible_portion_status"])
	items := result["items"].([]map[string]any)
	assert.Equal(t, 180.0, items[0]["estimatedWeightGrams"])
}

func TestImageEdiblePortionKeepsVisionEstimateWhenDeepSeekFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream timeout", http.StatusGatewayTimeout)
	}))
	defer server.Close()

	svc := NewAnalyzeService(nil, nil, nil)
	svc.deepseek = NewDeepSeekNutritionEstimator("test-key", server.URL, "deepseek-test")
	resp := map[string]any{"items": []map[string]any{map[string]any{
		"name": "完整带壳食物", "grossWeightGrams": 500.0,
		"hasInedibleParts": true, "ediblePortionRatio": 60.0,
		"ediblePortionReason":  "按可见外壳厚度和内部体积折算",
		"estimatedWeightGrams": 300.0,
	}}}

	result := svc.applyEdiblePortionRatios(context.Background(), resp, AnalyzeInput{})

	assert.Equal(t, "fallback", result["edible_portion_status"])
	items := result["items"].([]map[string]any)
	assert.Equal(t, 60.0, items[0]["ediblePortionRatio"])
	assert.Equal(t, 300.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "vision_fallback", items[0]["ediblePortionSource"])
}

func TestTextEdiblePortionPostprocessPrefersDeepSeek(t *testing.T) {
	qwen := &mockLLMClient{}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(qwen)
	svc.deepseek = NewDeepSeekNutritionEstimator("test-key", "http://127.0.0.1:1", "deepseek-test")

	client, provider, model := svc.ediblePortionPostprocessClient()

	assert.Same(t, svc.deepseek, client)
	assert.Equal(t, "deepseek", provider)
	assert.Equal(t, "deepseek-test", model)
}
