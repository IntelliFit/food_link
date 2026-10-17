package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func continuationTestPayload(input *SubmitTaskInput) map[string]any {
	preparePrecisionContinuationFields(input)
	input.AnalysisEngine = normalizeAnalysisEngine(input.AnalysisEngine, "strict", false)
	return buildSubmitTaskPayload(*input, "2026-10-17", "strict")
}

func TestPrecisionContinuationPreservesOmittedContextDateAndEngine(t *testing.T) {
	sessionID := "session"
	prior := map[string]any{
		"additionalContext": "这是牛肉，去皮净重", "recorded_on": "2026-10-16", "analysis_engine": "ai_direct",
		"meal_type": "dinner", "city": "北京", "suggest_ratio_enabled": true,
		"image_url": "https://example.com/meal.jpg", "reference_objects": []map[string]any{{"reference_name": "餐盘"}},
		"precision_options": map[string]any{"interactive": true, "separate": true, "web_search": false},
		"answers":           []map[string]any{{"question_id": "identity", "value": "牛肉"}},
	}
	input := SubmitTaskInput{PrecisionSessionID: &sessionID, Answers: []PrecisionAnswerInput{{QuestionID: "weight", Value: "200克"}}, ContinuationFields: map[string]bool{"answers": true}}
	submitted := continuationTestPayload(&input)
	applyPrecisionSubmitPayload(submitted, input, "strict")
	merged := mergePrecisionContinuationPayload(input, submitted, prior)
	for _, key := range []string{"additionalContext", "recorded_on", "analysis_engine", "meal_type", "city", "suggest_ratio_enabled", "image_url", "reference_objects", "precision_options"} {
		require.Equal(t, prior[key], merged[key], key)
	}
	require.Equal(t, []map[string]any{{"question_id": "identity", "value": "牛肉"}, {"question_id": "weight", "value": "200克"}}, merged["answers"])
	require.Equal(t, "这是牛肉，去皮净重", prior["additionalContext"], "must not mutate previous session")
}

func TestPrecisionContinuationAppendsNewContextAndReplacesAnswerByID(t *testing.T) {
	sessionID := "session"
	prior := map[string]any{"additionalContext": "去皮后净肉", "answers": []map[string]any{{"question_id": "identity", "value": "羊肉"}}}
	input := SubmitTaskInput{PrecisionSessionID: &sessionID, AdditionalContext: "这是牛肉", Answers: []PrecisionAnswerInput{{QuestionID: "identity", Value: "牛肉"}}}
	submitted := continuationTestPayload(&input)
	merged := mergePrecisionContinuationPayload(input, submitted, prior)
	require.Equal(t, "去皮后净肉\n本轮补充（与先前说明冲突时以本轮为准）：这是牛肉", merged["additionalContext"])
	require.Equal(t, []map[string]any{{"question_id": "identity", "value": "牛肉"}}, merged["answers"])
}

func TestPrecisionContinuationExplicitFalseAndPartialOptions(t *testing.T) {
	sessionID := "session"
	no := false
	prior := map[string]any{"suggest_ratio_enabled": true, "is_multi_view": true, "continue_with_uncertainty": true,
		"precision_options": map[string]any{"interactive": true, "separate": true, "web_search": true}}
	input := SubmitTaskInput{PrecisionSessionID: &sessionID, PrecisionOptions: &PrecisionOptionsInput{Interactive: &no},
		ContinuationFields: map[string]bool{"suggest_ratio_enabled": true, "is_multi_view": true, "continue_with_uncertainty": true, "precision_options": true, "precision_options.interactive": true}}
	submitted := continuationTestPayload(&input)
	merged := mergePrecisionContinuationPayload(input, submitted, prior)
	require.Equal(t, false, merged["suggest_ratio_enabled"])
	require.Equal(t, false, merged["is_multi_view"])
	require.Equal(t, false, merged["continue_with_uncertainty"])
	require.Equal(t, map[string]any{"interactive": false, "separate": true, "web_search": true}, merged["precision_options"])
	require.Equal(t, true, prior["precision_options"].(map[string]any)["interactive"])
}

func TestPrecisionContinuationExplicitDateEngineAndEmptyOptionalContext(t *testing.T) {
	sessionID := "session"
	input := SubmitTaskInput{PrecisionSessionID: &sessionID, Date: "2026-10-17", AnalysisEngine: "db_candidates_ai", ContinuationFields: map[string]bool{"date": true, "analysis_engine": true, "additionalContext": true}}
	submitted := continuationTestPayload(&input)
	merged := mergePrecisionContinuationPayload(input, submitted, map[string]any{"recorded_on": "2026-10-16", "analysis_engine": "ai_direct", "additionalContext": "旧说明"})
	require.Equal(t, "2026-10-17", merged["recorded_on"])
	require.Equal(t, "db_candidates_ai", merged["analysis_engine"])
	require.Equal(t, "", merged["additionalContext"])
}

func TestPrecisionContinuationLegacyDTOCapturesFieldsBeforeDefaults(t *testing.T) {
	sessionID := "session"
	input := SubmitTaskInput{PrecisionSessionID: &sessionID, AdditionalContext: "这是牛肉"}
	submitted := continuationTestPayload(&input)
	merged := mergePrecisionContinuationPayload(input, submitted, map[string]any{"recorded_on": "2026-10-16", "analysis_engine": "ai_direct", "additionalContext": "这是牛肉"})
	require.Equal(t, "2026-10-16", merged["recorded_on"])
	require.Equal(t, "ai_direct", merged["analysis_engine"])
	require.Equal(t, "这是牛肉", merged["additionalContext"], "same full reply must not duplicate itself")
}
