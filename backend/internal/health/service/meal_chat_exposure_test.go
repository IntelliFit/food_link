package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A repository that also keeps the recommendation memory, as the real one does.
type memoryTestRepo struct {
	*mockStatsRepo
	rows    []domain.MealRecommendationMemory
	listed  int
	saved   []domain.MealRecommendationMemory
	saveErr error
}

func (r *memoryTestRepo) ListMealRecommendationMemory(context.Context, string, time.Time) ([]domain.MealRecommendationMemory, error) {
	r.listed++
	return r.rows, nil
}

func (r *memoryTestRepo) SaveMealRecommendationOptions(_ context.Context, rows []domain.MealRecommendationMemory) error {
	r.saved = append(r.saved, rows...)
	return r.saveErr
}

func (r *memoryTestRepo) RecordMealRecommendationFeedback(context.Context, string, string, []string, string, time.Time) error {
	return nil
}

// The first assembled meal the search offered, read back from the tool message the model received.
func assembledMealIDFromToolMessage(t *testing.T, body map[string]any) string {
	t.Helper()
	messages, _ := body["messages"].([]any)
	for i := len(messages) - 1; i >= 0; i-- {
		message, _ := messages[i].(map[string]any)
		content, _ := message["content"].(string)
		var output struct {
			Candidates []struct {
				SourceID string `json:"source_id"`
				Source   string `json:"source"`
			} `json:"candidates"`
		}
		if message["role"] == "tool" && json.Unmarshal([]byte(content), &output) == nil {
			for _, candidate := range output.Candidates {
				if candidate.Source == "meal_plan" {
					return candidate.SourceID
				}
			}
		}
	}
	t.Fatalf("no assembled meal was sent back to the model")
	return ""
}

// One chat turn against a canned model that takes the first assembled meal.
func runWholeMealChatTurn(t *testing.T, repo StatsRepo, pool []DietRecommendationCandidate) (*campusDietAgentRunState, *CampusDietAgentResult, *StatsService) {
	t.Helper()
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "ctx", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "ctx-again", "get_meal_context", `{"updates":[]}`)
		case 3:
			writeCampusDietAgentTestToolCall(t, w, "search", "search_campus_foods", `{}`)
		default:
			writeCampusDietAgentTestFinal(t, w, map[string]any{
				"answer":     "搭配好了",
				"selections": []map[string]any{{"source_id": assembledMealIDFromToolMessage(t, body), "reason": "营养均衡"}},
			})
		}
	}))
	t.Cleanup(server.Close)
	svc := newCampusDietAgentTestService(&mockStatsRepo{candidates: pool}, server.URL)
	svc.repo = repo
	state := newCampusDietAgentTestState("initial", nil)
	state.RunID = uuid.NewString()
	state.Question = "我在紫荆园，中午吃什么"
	state.Constraints = CampusDietRecommendationConstraints{Scene: "campus", CompleteMeal: true, MealType: "lunch"}
	result := svc.runCampusDietAgent(context.Background(), state)
	require.True(t, result.AgentUsed, "fallback=%s answer=%s", result.FallbackReason, result.Answer)
	return state, result, svc
}

func TestChatRunReadsRecentExposureOnceAndRecordsWhatItShowed(t *testing.T) {
	repo := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: comboRotationPool()}}
	state, result, svc := runWholeMealChatTurn(t, repo, comboRotationPool())
	assert.Equal(t, 1, repo.listed, "the memory is read once per run however often the context is requested")
	require.NotEmpty(t, state.PreviewContextKey)

	svc.recordChatMealExposure(context.Background(), state, result)
	require.NotEmpty(t, repo.saved)
	byDish := map[string]domain.MealRecommendationMemory{}
	ids := map[string]bool{}
	for _, row := range repo.saved {
		_, err := uuid.Parse(row.RunID)
		require.NoError(t, err)
		_, err = uuid.Parse(row.ID)
		require.NoError(t, err)
		assert.False(t, ids[row.ID], "memory ids are unique")
		ids[row.ID] = true
		assert.NotNil(t, row.ShownAt, "a chat answer is on the user's screen the moment it is saved")
		assert.Equal(t, state.MealContext.Date, row.MealDate)
		assert.Equal(t, "lunch", row.MealType)
		assert.Equal(t, state.PreviewContextKey, row.ContextKey)
		assert.Equal(t, "user-1", row.UserID)
		byDish[row.SourceID] = row
	}
	for _, option := range result.Recommendation.Recommendations {
		assert.Contains(t, byDish, option.SourceID, "the offered meal itself is remembered")
		for _, component := range option.MealComponents {
			if mealComboRoleOf(component) == mealRoleStaple {
				assert.NotContains(t, byDish, component.SourceID, "staples never rotate and are not stored")
				continue
			}
			assert.Contains(t, byDish, component.SourceID, "so is every dish it is made of")
			assert.Equal(t, mealDecisionHash(component.Source, component.SourceID), byDish[component.SourceID].OptionKey)
		}
	}
}

func TestChatExposureMakesTheNextSessionOfferDifferentDishes(t *testing.T) {
	pool := comboRotationPool()
	first := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: pool}}
	state1, result1, svc1 := runWholeMealChatTurn(t, first, pool)
	svc1.recordChatMealExposure(context.Background(), state1, result1)
	require.NotEmpty(t, first.saved)

	second := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: pool}, rows: first.saved}
	_, result2, _ := runWholeMealChatTurn(t, second, pool)
	dishes := func(result *CampusDietAgentResult) map[string]bool {
		out := map[string]bool{}
		for _, option := range result.Recommendation.Recommendations {
			for _, c := range option.MealComponents {
				if mealComboRoleOf(c) != mealRoleStaple {
					out[c.SourceID] = true
				}
			}
		}
		return out
	}
	before, after := dishes(result1), dishes(result2)
	require.NotEmpty(t, before)
	require.NotEmpty(t, after)
	for id := range after {
		assert.False(t, before[id], "dish %s was shown in the previous session and equally good alternatives exist", id)
	}
}

func TestChatExposureIsNotRecordedForFollowUpsClarificationsOrWithoutAMemoryStore(t *testing.T) {
	repo := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: comboRotationPool()}}
	state, result, svc := runWholeMealChatTurn(t, repo, comboRotationPool())

	followUp := *state
	followUp.Intent = "facts"
	svc.recordChatMealExposure(context.Background(), &followUp, result)
	assert.Empty(t, repo.saved, "asking about a dish already shown is not a new impression")

	clarification := *result
	clarification.Recommendation.NeedsClarification = true
	svc.recordChatMealExposure(context.Background(), state, &clarification)
	assert.Empty(t, repo.saved)

	history := *result
	history.Recommendation.Recommendations = []DietRecommendationOption{{Source: "food_record", SourceID: "record-1", Title: "鸡肉饭"}}
	svc.recordChatMealExposure(context.Background(), state, &history)
	assert.Empty(t, repo.saved, "the user's own past meals are not menu exposure")

	plain := newCampusDietAgentTestService(&mockStatsRepo{}, "http://127.0.0.1:0")
	assert.NotPanics(t, func() { plain.recordChatMealExposure(context.Background(), state, result) })

	failing := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{}, saveErr: assert.AnError}
	svc.repo = failing
	assert.NotPanics(t, func() { svc.recordChatMealExposure(context.Background(), state, result) }, "a memory failure never fails the chat")
	assert.Empty(t, result.Recommendation.RecommendationID, "chat answers do not hand out feedback ids")
}

// Equal nutrition: a whole meal shown yesterday yields to one the user has not seen,
// also when the rule fallback (not the model) makes the final selection.
func TestRuleFallbackSelectionRotatesMealsShownEarlier(t *testing.T) {
	dish := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 520, 30, 60, 14, 12, "盖饭")
	}
	pool := []DietRecommendationCandidate{dish("a", "黄焖鸡米饭"), dish("b", "香菇滑鸡饭"), dish("c", "咖喱牛肉饭"), dish("d", "红烧排骨饭")}
	run := func(shown ...DietRecommendationCandidate) []string {
		state := newComboTestState()
		state.Constraints.CompleteMeal = false
		selections := []campusDietAgentFinalSelection{}
		for _, c := range pool {
			state.Candidates[c.SourceID] = c
			selections = append(selections, campusDietAgentFinalSelection{SourceID: c.SourceID})
		}
		state.LastSearch = pool
		comboShown(state, 1, shown...)
		result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: selections}, false, "model_unavailable")
		require.NoError(t, err)
		ids := []string{}
		for _, option := range result.Recommendation.Recommendations {
			ids = append(ids, option.SourceID)
		}
		return ids
	}
	baseline := run()
	require.NotEmpty(t, baseline)
	byID := map[string]DietRecommendationCandidate{}
	for _, c := range pool {
		byID[c.SourceID] = c
	}
	rotated := run(byID[baseline[0]])
	require.NotEmpty(t, rotated)
	assert.NotEqual(t, baseline[0], rotated[0], "the fallback does not repeat yesterday's first choice when others are equally good")
}
