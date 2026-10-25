package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type campusA6RoundTripFunc func(*http.Request) (*http.Response, error)

func (f campusA6RoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func campusA6Response(content string, status int) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(content))}
}

func campusA6Wire(answer any) string {
	content, _ := json.Marshal(answer)
	wire, _ := json.Marshal(map[string]any{"model": "deepseek-v4-pro", "choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": string(content), "reasoning_content": "private reasoning must not be retained"}}}, "usage": map[string]int{"completion_tokens": 9000}})
	return string(wire)
}

func TestCampusA6IndependentViewDoesNotChangeOrdinaryModels(t *testing.T) {
	t.Setenv("CAMPUS_A6_DEEPSEEK_ENABLED", "true")
	t.Setenv("CAMPUS_A6_DEEPSEEK_API_KEY", "campus-test-secret")
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureDeepSeekFallback("ordinary-test-secret", "https://ordinary.invalid")
	s.ConfigureDashScopeLLMClient(&mockLLMClient{})
	oldDeepSeek, oldQwen, oldFallback := s.deepseek, s.dashscopeClient, s.nutritionAI
	b, err := s.campusBudgetService(context.Background())
	require.NoError(t, err)
	require.Equal(t, campusA6DeepSeekModel, b.deepseek.Model)
	require.Equal(t, "campus-test-secret", b.deepseek.APIKey)
	require.Nil(t, b.dashscopeClient)
	require.Len(t, b.nutritionAI.(*chainedNutritionFallbackEstimator).estimators, 1)
	require.Same(t, oldDeepSeek, s.deepseek)
	require.Same(t, oldQwen, s.dashscopeClient)
	require.Same(t, oldFallback, s.nutritionAI)
}

func TestCampusA6MissingCredentialFailsClosed(t *testing.T) {
	t.Setenv("CAMPUS_A6_DEEPSEEK_ENABLED", "true")
	t.Setenv("CAMPUS_A6_DEEPSEEK_API_KEY", "")
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureDashScopeLLMClient(&mockLLMClient{})
	_, err := s.campusBudgetService(context.Background())
	require.ErrorContains(t, err, "独立凭证")
}

func TestCampusA6UsageAnomalyDoesNotRejectValidContent(t *testing.T) {
	e := newCampusDeepSeekEstimator("campus-test-secret")
	physical := 0
	e.client.Transport.(*campusA6Transport).delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
		physical++
		require.Equal(t, "Bearer campus-test-secret", r.Header.Get("Authorization"))
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, campusA6DeepSeekModel, body["model"])
		require.Equal(t, float64(4096), body["max_tokens"])
		return campusA6Response(campusA6Wire(map[string]any{"ok": true}), 200), nil
	})
	got, err := e.Analyze(context.Background(), "synthetic", "")
	require.NoError(t, err)
	require.Equal(t, true, got["ok"])
	require.Equal(t, 1, physical)
}

func TestCampusA6RetryLimitAndSanitizedErrors(t *testing.T) {
	e := newCampusDeepSeekEstimator("campus-test-secret")
	physical := 0
	e.client.Transport.(*campusA6Transport).delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
		physical++
		return campusA6Response(`{"error":"campus-test-secret should not appear"}`, 401), nil
	})
	_, err := e.Analyze(context.Background(), "synthetic", "")
	require.Error(t, err)
	require.NotContains(t, err.Error(), "campus-test-secret")
	require.Equal(t, 1, physical)
}

func TestCampusA6AttemptBudgetAppliesAcrossSemanticCalls(t *testing.T) {
	e := newCampusDeepSeekEstimator("test-secret")
	physical := 0
	e.client.Transport.(*campusA6Transport).delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
		physical++
		return campusA6Response(campusA6Wire(map[string]any{"ok": true}), 200), nil
	})
	for i := 0; i < 6; i++ {
		_, err := e.Analyze(context.Background(), "synthetic", "")
		require.NoError(t, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, err := e.Analyze(ctx, "synthetic", "")
	require.Error(t, err)
	require.Equal(t, 6, physical)
}

func TestCampusA6RetryAfterNeverRetriesEarly(t *testing.T) {
	e := newCampusDeepSeekEstimator("test-secret")
	tpt := e.client.Transport.(*campusA6Transport)
	physical := 0
	tpt.delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
		physical++
		resp := campusA6Response(`{}`, 429)
		resp.Header.Set("Retry-After", "60")
		return resp, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err := e.Analyze(ctx, "synthetic", "")
	require.Error(t, err)
	require.Equal(t, 1, physical)
}

func TestCampusA6BadResponsesNeverReachParser(t *testing.T) {
	for _, scenario := range []string{"wrong-model", "unfinished", "too-large"} {
		t.Run(scenario, func(t *testing.T) {
			e := newCampusDeepSeekEstimator("test-secret")
			e.client.Transport.(*campusA6Transport).delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
				body := campusA6Wire(map[string]any{"ok": true})
				if scenario == "wrong-model" {
					body = strings.ReplaceAll(body, "deepseek-v4-pro", "different-model")
				}
				if scenario == "unfinished" {
					body = strings.ReplaceAll(body, `"stop"`, `"length"`)
				}
				if scenario == "too-large" {
					body = strings.Repeat("x", campusA6BodyLimit+1)
				}
				return campusA6Response(body, 200), nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			_, err := e.Analyze(ctx, "synthetic", "")
			require.Error(t, err)
		})
	}
}

func TestCampusA6ImageWithoutCatalogTextIsNotSentToTextModel(t *testing.T) {
	t.Setenv("CAMPUS_A6_DEEPSEEK_ENABLED", "true")
	t.Setenv("CAMPUS_A6_DEEPSEEK_API_KEY", "test-secret")
	s := NewAnalyzeService(nil, nil, nil)
	_, err := s.AnalyzeCampus(context.Background(), "", AnalyzeInput{ImageURL: "https://example.invalid/menu.jpg"})
	require.ErrorContains(t, err, "菜品名称")
}

func TestCampusA6EnergyRepairPreservesAuthoritativeValues(t *testing.T) {
	item := map[string]any{"name": "熟米饭", "estimatedWeightGrams": 200.0, "nutrition_source": "ai_direct", "unit_nutrition_per_100g": map[string]any{"calories": 130.5, "protein": 2.6, "carbs": 28.0, "fat": 0.3}, "nutrients": map[string]any{"calories": 261.0, "protein": 5.2, "carbs": 56.0, "fat": 0.6}}
	got, err := normalizeCampusAIEnergy([]map[string]any{item})
	require.NoError(t, err)
	require.InDelta(t, 125.1, mapFromAny(got[0]["unit_nutrition_per_100g"])["calories"], 0.001)
	require.InDelta(t, 250.2, mapFromAny(got[0]["nutrients"])["calories"], 0.001)
	require.Equal(t, 130.5, mapFromAny(item["unit_nutrition_per_100g"])["calories"])
	item["nutrition_source"] = "database_exact"
	got, err = normalizeCampusAIEnergy([]map[string]any{item})
	require.NoError(t, err)
	require.Equal(t, 130.5, mapFromAny(got[0]["unit_nutrition_per_100g"])["calories"])
	item["nutrition_source"] = "ai_direct"
	delete(mapFromAny(item["unit_nutrition_per_100g"]), "fat")
	_, err = normalizeCampusAIEnergy([]map[string]any{item})
	require.Error(t, err)
}

func TestCampusA6RealBusinessTextPipelineUsesDedicatedModel(t *testing.T) {
	t.Setenv("CAMPUS_A6_DEEPSEEK_ENABLED", "true")
	t.Setenv("CAMPUS_A6_DEEPSEEK_API_KEY", "campus-test-secret")
	s := NewAnalyzeService(nil, nil, nil)
	b, err := s.campusBudgetService(context.Background())
	require.NoError(t, err)
	physical := 0
	b.deepseek.client.Transport.(*campusA6Transport).delegate = campusA6RoundTripFunc(func(r *http.Request) (*http.Response, error) {
		physical++
		return campusA6Response(campusA6Wire(textFood("熟米饭", 200, 5.2, 56, 0.6)), 200), nil
	})
	got, err := runCampusDeepSeekText(standardVisionCtx(), b, "", AnalyzeInput{Text: "200g熟米饭"})
	require.NoError(t, err)
	require.Equal(t, campusA6DeepSeekModel, got["model_name"])
	require.Equal(t, 1, physical)
	require.NoError(t, ValidateResolvedNutritionItems(toItems(got["items"])))
}
