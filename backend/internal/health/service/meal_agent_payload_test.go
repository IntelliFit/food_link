package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Replay 2026-11-05: collected dishes carry full micronutrients, and the model input grew to
// 250–490 KB per round until every meal turn ran out of time.
func TestMealToolNutrientEffectsKeepOnlyWhatMoves(t *testing.T) {
	value, zero := 760.0, 4.0
	effects := []DietNutrientEffect{
		{Key: "sodiumMg", Unit: "mg", Status: "recorded", Mode: "serving_share_no_day_total", CandidateValue: &value, Limit: 300, BeforeLoss: 0, AfterLoss: 2, Improvement: -2, ReferenceType: "guideline_limit_not_UL", SourceID: "who-healthy-diet"},
		{Key: "fiber", Unit: "g", CandidateValue: &zero, Target: 3.75, Improvement: 0},
		{Key: "vitaminC", Unit: "mg", Improvement: 1},
	}
	compact := mealToolNutrientEffects(effects)
	require.Len(t, compact, 1)
	assert.Equal(t, map[string]any{"key": "sodiumMg", "value": 760.0, "unit": "mg", "change": -2.0, "limit": 300.0}, compact[0])
	full, _ := json.Marshal(effects[:1])
	small, _ := json.Marshal(compact)
	assert.Less(t, len(small)*3, len(full))
}

func TestMealEvidenceIsNotResentUnchanged(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	for _, c := range campusDietAgentTestCandidates(3) {
		state.Candidates[c.SourceID] = c
	}
	messages := mealAppendEvidence([]map[string]any{{"role": "user", "content": "推荐点吃的"}}, state)
	require.Len(t, messages, 2)
	// A rejected choice and its repair instruction come after the evidence; the same evidence is not sent again.
	messages = append(messages, map[string]any{"role": "assistant", "content": "{}"}, map[string]any{"role": "user", "content": "结果校验未通过：换掉第一项"})
	messages = mealAppendEvidence(messages, state)
	require.Len(t, messages, 4)
	// New candidates are new evidence.
	extra := campusDietAgentTestCandidate("food-new", "番茄牛腩饭", 520, 30)
	state.Candidates[extra.SourceID] = extra
	messages = mealAppendEvidence(messages, state)
	require.Len(t, messages, 5)
	assert.True(t, strings.HasPrefix(messages[4]["content"].(string), mealEvidencePrefix))
}

// 2026-11-05 the text model answered "500 余额不足": a user known only by location got no
// recommendation at all, because the model failed before it could search.
func TestModelDownStillSearchesAndOffersRuleChosenMeals(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"余额不足"}`, http.StatusInternalServerError)
	}))
	defer server.Close()
	candidates := campusDietAgentTestCandidates(4)
	distance := 0.8
	for i := range candidates {
		candidates[i].DistanceKM = &distance
		candidates[i].Carbs = 60
	}
	svc := newCampusDietAgentTestService(&mockStatsRepo{candidates: candidates}, server.URL)
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Constraints = CampusDietRecommendationConstraints{CompleteMeal: true, MealType: "lunch"}
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.33, AccuracyM: 30, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
	state.Question = "推荐点吃的"
	result := svc.runCampusDietAgent(context.Background(), state)
	require.NotEmpty(t, result.Recommendation.Recommendations, result.Answer)
	assert.False(t, result.AgentUsed)
	assert.Equal(t, "model_request_failed", result.FallbackReason)
	assert.Contains(t, result.Recommendation.Recommendations[0].SelectionReason+result.Answer, "AI 解读")
}
