package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func textFood(name string, grams, protein, carbs, fat float64) map[string]any {
	nutrients := map[string]any{"calories": protein*4 + carbs*4 + fat*9, "protein": protein, "carbs": carbs, "fat": fat}
	for _, key := range preciseMicronutrientKeys {
		nutrients[key] = 1.0
	}
	return map[string]any{"description": name, "items": []any{map[string]any{
		"name": name, "type": "normal", "estimatedWeightGrams": grams, "foodState": "raw", "weightBasis": "as_served",
		"basisEvidence": "用户给出克数", "isComposite": false, "addedIngredients": []any{}, "assumptions": []any{}, "suggestedRatio": 100.0,
		"nutrients": nutrients,
	}}}
}

func newTextRoutingService(t *testing.T, c balancedChannels, qwen LLMClient) *AnalyzeService {
	t.Helper()
	s := newBalancedRoutingService(t, c)
	if qwen != nil {
		s.ConfigureDashScopeLLMClient(qwen)
	}
	return s
}

func TestAnalyzeTextDefaultsToFastestGeminiChannel(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: textFood("五花肉", 200, 27, 1, 75)},
		openlux: &channelFixture{result: textFood("五花肉", 200, 27, 1, 75)},
		a6:      &channelFixture{result: textFood("五花肉", 200, 27, 1, 75)},
	}
	qwen := &mockLLMClient{result: textFood("五花肉", 200, 20, 1, 50)}
	s := newTextRoutingService(t, c, qwen)

	result, err := s.AnalyzeText(standardVisionCtx(), "", AnalyzeInput{Text: "200g五花肉"})
	require.NoError(t, err)
	require.Equal(t, gemini3FlashModel, result["model_name"])
	require.EqualValues(t, 1, c.openlux.calls.Load())
	require.Zero(t, c.wanjie.calls.Load())
	require.Zero(t, qwen.calls, "Qwen is only the fallback")
	require.InDelta(t, 787.0, numberFromAny(mapFromAny(toItems(result["items"])[0]["nutrients"])["calories"]), 1)
}

func TestAnalyzeTextFallsBackToQwenWithoutThinkingWhenGeminiFails(t *testing.T) {
	failing := func() *channelFixture { return &channelFixture{err: errors.New("upstream 503")} }
	c := balancedChannels{wanjie: failing(), openlux: failing(), a6: failing()}
	qwen := &mockLLMClient{result: textFood("五花肉", 200, 27, 1, 75)}
	s := newTextRoutingService(t, c, qwen)

	result, err := s.AnalyzeText(standardVisionCtx(), "", AnalyzeInput{Text: "200g五花肉"})
	require.NoError(t, err)
	require.Equal(t, qwen38FlashModel, result["model_name"])
	require.Equal(t, 1, qwen.calls)
}

func TestAnalyzeTextHedgesPastImplausibleNutrition(t *testing.T) {
	c := balancedChannels{
		wanjie: &channelFixture{result: textFood("芝士夹心饼干", 19, 1, 12, 5)},
		// Per-100g values reported as the portion: macros exceed the 19g edible weight.
		openlux: &channelFixture{result: textFood("芝士夹心饼干", 19, 7, 65, 22)},
		a6:      &channelFixture{result: textFood("芝士夹心饼干", 19, 1, 12, 5)},
	}
	s := newTextRoutingService(t, c, &mockLLMClient{})

	result, err := s.AnalyzeText(standardVisionCtx(), "", AnalyzeInput{Text: "芝士夹心饼干19g"})
	require.NoError(t, err)
	require.EqualValues(t, 1, c.openlux.calls.Load())
	require.EqualValues(t, 1, c.a6.calls.Load(), "an invalid answer moves on to the next channel")
	require.Less(t, numberFromAny(mapFromAny(toItems(result["items"])[0]["nutrients"])["calories"]), 120.0)
}

func TestAnalyzeTextFastModeUsesDefaultRoute(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: textFood("橙子", 139, 1, 16, 0.2)},
		openlux: &channelFixture{result: textFood("橙子", 139, 1, 16, 0.2)},
		a6:      &channelFixture{result: textFood("橙子", 139, 1, 16, 0.2)},
	}
	qwen := &mockLLMClient{result: textFood("橙子", 139, 1, 16, 0.2)}
	s := newTextRoutingService(t, c, qwen)
	mode := fastExecutionMode

	result, err := s.AnalyzeText(WithVisionRequest(context.Background(), mode, "task-fast-text", false), "", AnalyzeInput{Text: "橙子139g", ExecutionMode: &mode})
	require.NoError(t, err)
	require.Equal(t, gemini3FlashModel, result["model_name"])
	require.Zero(t, qwen.calls, "fast text no longer uses qwen-flash, which misreported per-100g values")
}

func TestAnalyzeTextKeepsExplicitlyRequestedModel(t *testing.T) {
	c := balancedChannels{openlux: &channelFixture{result: textFood("五花肉", 200, 27, 1, 75)}}
	qwen := &mockLLMClient{result: textFood("五花肉", 200, 27, 1, 75)}
	s := newTextRoutingService(t, c, qwen)

	_, err := s.AnalyzeText(standardVisionCtx(), "", AnalyzeInput{Text: "200g五花肉", ModelName: "qwen"})
	require.NoError(t, err)
	require.Equal(t, 1, qwen.calls)
	require.Zero(t, c.openlux.calls.Load())
}
