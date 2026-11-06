package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A judge model that picks the given IDs after delay.
func judgeTestService(t *testing.T, delay time.Duration, ids ...string) (*StatsService, *int32) {
	t.Helper()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
		picks := []string{}
		for _, id := range ids {
			picks = append(picks, `{"source_id":"`+id+`","reason":"清淡又顺路"}`)
		}
		writeCampusDietAgentTestResponse(t, w, map[string]any{"choices": []map[string]any{{"message": map[string]any{"role": "assistant", "content": `{"selections":[` + strings.Join(picks, ",") + `]}`}}}})
	}))
	t.Cleanup(server.Close)
	cfg := &config.Config{}
	cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL = "test-key", server.URL
	svc := NewStatsService(&mockStatsRepo{}, nil, cfg)
	svc.client = &http.Client{}
	return svc, &calls
}

func withJudgeTimeouts(t *testing.T, inline, background time.Duration) {
	t.Helper()
	oldInline, oldBackground := mealJudgeTimeout, mealJudgeBackgroundTimeout
	mealJudgeTimeout, mealJudgeBackgroundTimeout = inline, background
	t.Cleanup(func() { mealJudgeTimeout, mealJudgeBackgroundTimeout = oldInline, oldBackground })
}

func judgePool() []groundedMeal {
	return []groundedMeal{pickMeal("a", "番茄牛腩饭", 96), pickMeal("b", "香辣爆肚面", 95), pickMeal("c", "鸡汤馄饨", 94)}
}

func TestMealJudgeSkipReturnsRulePickAtOnce(t *testing.T) {
	svc, calls := judgeTestService(t, 0, "b")
	result := &DietRecommendationResult{}
	state := &campusDietAgentRunState{UserID: "u1", IsHomePreview: true, JudgeMode: mealJudgeModeSkip}

	chosen := svc.arbitratePreviewMeals(context.Background(), state, judgePool(), result)
	assert.Equal(t, pickIDs(selectHealthBoundedMeals(applyMealVarietyContext(state, judgePool()), 3)), pickIDs(chosen), "the card shows the rule pick")
	assert.True(t, result.JudgePending, "the client is told to ask for the model's pick")
	assert.Equal(t, "judge_deferred", result.SelectionAudit.Fallback)
	assert.Zero(t, atomic.LoadInt32(calls), "no model call while the user waits")
}

func TestMealJudgeBackgroundWaitsLongerThanInline(t *testing.T) {
	withJudgeTimeouts(t, 100*time.Millisecond, 3*time.Second)
	svc, _ := judgeTestService(t, 400*time.Millisecond, "b", "a")

	inline := &DietRecommendationResult{}
	svc.arbitratePreviewMeals(context.Background(), &campusDietAgentRunState{UserID: "u1", IsHomePreview: true}, judgePool(), inline)
	assert.Equal(t, "rules", inline.SelectionAudit.Method, "an old client keeps the short inline wait")
	assert.False(t, inline.JudgePending)

	background := &DietRecommendationResult{}
	chosen := svc.arbitratePreviewMeals(context.Background(), &campusDietAgentRunState{UserID: "u1", IsHomePreview: true, JudgeMode: mealJudgeModeBackground}, judgePool(), background)
	require.Equal(t, "model_validated", background.SelectionAudit.Method)
	assert.Equal(t, []string{"b", "a"}, pickIDs(chosen))
	assert.False(t, background.JudgePending)
}

func TestMealPreviewRejectsUnknownJudgeMode(t *testing.T) {
	assert.True(t, validMealJudgeMode(""))
	assert.True(t, validMealJudgeMode(mealJudgeModeSkip))
	assert.True(t, validMealJudgeMode(mealJudgeModeBackground))
	assert.False(t, validMealJudgeMode("forever"))
	svc := NewStatsService(&mockStatsRepo{}, nil, &config.Config{})
	_, err := svc.PreviewMeals(context.Background(), "u1", MealPreviewInput{MealType: "lunch", JudgeMode: "forever"})
	require.ErrorIs(t, err, commonerrors.ErrBadRequest)
}
