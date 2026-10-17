package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrecisionContinuationHandlerPreservesExplicitAndOmittedFields(t *testing.T) {
	svc := &mockTaskService{submitTaskID: "continued"}
	router := setupRouter(NewAnalyzeHandler(&mockAnalyzeService{}, svc, ""))
	body := `{"source_type":"image","additionalContext":"","answers":[{"question_id":"identity","value":"牛肉"}],"suggest_ratio_enabled":false,"continue_with_uncertainty":false,"precision_options":{"interactive":false}}`
	request := httptest.NewRequest(http.MethodPost, "/api/precision-sessions/session/continue", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	fields := svc.lastSubmitInput.ContinuationFields
	for _, key := range []string{"source_type", "additionalContext", "answers", "suggest_ratio_enabled", "continue_with_uncertainty", "precision_options", "precision_options.interactive"} {
		require.True(t, fields[key], key)
	}
	for _, key := range []string{"date", "analysis_engine", "city", "meal_type", "precision_options.separate", "precision_options.web_search"} {
		require.False(t, fields[key], key)
	}
	require.False(t, svc.lastSubmitInput.SuggestRatioEnabled)
	require.NotNil(t, svc.lastSubmitInput.PrecisionOptions.Interactive)
	require.False(t, *svc.lastSubmitInput.PrecisionOptions.Interactive)
}
