package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCampusDietAgentFunctionCallingQueriesContextAndFiveRealFoods(t *testing.T) {
	candidates := campusDietAgentTestCandidates(6)
	repo := &mockStatsRepo{
		candidates: candidates,
		resolvedSchool: &domain.DietRecommendationSchool{
			ID: "school-tsinghua", Name: "清华大学",
		},
	}
	var mu sync.Mutex
	requests := make([]map[string]any, 0, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		mu.Lock()
		requests = append(requests, body)
		call := len(requests)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "call-context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "call-search", "search_campus_foods", `{"max_calories":400,"sort_by":"protein_density","limit":20}`)
		default:
			selections := make([]map[string]any, 0, 5)
			for _, candidate := range candidates[:5] {
				selections = append(selections, map[string]any{"source_id": candidate.SourceID, "reason": "高蛋白且适合本餐目标"})
			}
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "已核对真实数据", "selections": selections})
		}
	}))
	defer server.Close()

	svc := newCampusDietAgentTestService(repo, server.URL)
	state := newCampusDietAgentTestState("initial", nil)
	state.Question = "我是清华学生，今天减脂，推荐400卡以下的午餐"
	result := svc.runCampusDietAgent(context.Background(), state)

	require.True(t, result.AgentUsed)
	require.Len(t, result.Recommendation.Recommendations, 5)
	assert.Equal(t, campusDietAgentModel, result.Recommendation.GeneratedBy)
	assert.Equal(t, 2, result.ToolCount)
	for _, option := range result.Recommendation.Recommendations {
		assert.LessOrEqual(t, option.Calories, 400.0)
		assert.Equal(t, "school-tsinghua", option.SchoolID)
	}
	require.Len(t, repo.campusSearchFilters, 1)
	require.NotNil(t, repo.campusSearchFilters[0].MaxCalories)
	assert.Equal(t, 400.0, *repo.campusSearchFilters[0].MaxCalories)

	mu.Lock()
	defer mu.Unlock()
	require.Len(t, requests, 3)
	assert.Equal(t, campusDietAgentModel, requests[0]["model"])
	assert.Equal(t, false, requests[0]["enable_thinking"])
	forcedChoice := requests[0]["tool_choice"].(map[string]any)
	assert.Equal(t, "get_meal_context", forcedChoice["function"].(map[string]any)["name"])
	assert.Equal(t, "required", requests[1]["tool_choice"])
	assert.True(t, campusDietAgentRequestHasToolResult(requests[1], "call-context"))
	assert.True(t, campusDietAgentRequestHasToolResult(requests[2], "call-search"))
}

func TestCampusDietAgentReservesLastRoundForFinalAnswer(t *testing.T) {
	candidates := campusDietAgentTestCandidates(5)
	repo := &mockStatsRepo{candidates: candidates}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "call-context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "call-search", "search_campus_foods", `{"limit":20}`)
		case 3:
			writeCampusDietAgentTestToolCall(t, w, "call-details", "get_campus_food_details", `{"source_ids":["food-1","food-2","food-3","food-4","food-5"]}`)
		default:
			assert.Equal(t, "none", body["tool_choice"])
			selections := make([]map[string]any, 0, 5)
			for _, candidate := range candidates {
				selections = append(selections, map[string]any{"source_id": candidate.SourceID, "reason": "已核对"})
			}
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "完成最终解读", "selections": selections})
		}
	}))
	defer server.Close()

	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(
		context.Background(), newCampusDietAgentTestState("initial", nil),
	)

	require.True(t, result.AgentUsed)
	assert.Equal(t, 4, call)
	assert.NotContains(t, result.Answer, "AI 解读暂不可用")
	require.Len(t, result.Recommendation.Recommendations, 5)
}

func TestGeneratePetChatStreamRoutesCampusQuestionThroughAgentSSEWithoutFoodRecords(t *testing.T) {
	candidates := campusDietAgentTestCandidates(5)
	repo := &mockStatsRepo{
		candidates: candidates,
		resolvedSchool: &domain.DietRecommendationSchool{
			ID: "school-tsinghua", Name: "清华大学",
		},
	}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "call-context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "call-search", "search_campus_foods", `{"limit":20}`)
		default:
			selections := make([]map[string]any, 0, 5)
			for _, candidate := range candidates {
				selections = append(selections, map[string]any{"source_id": candidate.SourceID, "reason": "符合当前目标"})
			}
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "已完成", "selections": selections})
		}
	}))
	defer server.Close()

	chunks, err := newCampusDietAgentTestService(repo, server.URL).GeneratePetChatStream(context.Background(), "user-1", PetChatInput{
		Question: "我是清华学生，今天午餐吃什么？", Range: "week", NewSession: true,
	})
	require.NoError(t, err)
	types := make([]string, 0, 12)
	var dietResult *CampusDietAgentResult
	var doneMeta *PetChatStreamMeta
	for chunk := range chunks {
		types = append(types, chunk.Type)
		if chunk.DietResult != nil {
			dietResult = chunk.DietResult
		}
		if chunk.Meta != nil {
			doneMeta = chunk.Meta
		}
	}

	require.NotEmpty(t, types)
	assert.Equal(t, "start", types[0])
	assert.Contains(t, types, "progress")
	assert.Contains(t, types, "diet_result")
	assert.Contains(t, types, "chunk")
	assert.Equal(t, "done", types[len(types)-1])
	require.NotNil(t, dietResult)
	require.Len(t, dietResult.Recommendation.Recommendations, 5)
	require.NotNil(t, doneMeta)
	assert.Equal(t, 1, doneMeta.CreditsCharged)
	require.Len(t, repo.petChatMessages, 2)
	assert.Equal(t, "diet_recommendation", repo.petChatMessages[1].MessageType)
	assert.Contains(t, repo.petChatMessages[1].Meta, "diet_recommendation")
	assert.Contains(t, repo.petChatMessages[1].Meta, "agent_run")
}

func TestCampusDietAgentFactsFollowUpUsesExactActiveFoodValues(t *testing.T) {
	candidates := []domain.DietRecommendationCandidate{
		campusDietAgentTestCandidate("chicken", "鸡胸", 286.23, 56.73),
		campusDietAgentTestCandidate("chicken-rice", "日烧意式鸡排饭", 525, 43.75),
		campusDietAgentTestCandidate("roast-chicken", "意式秘制烤鸡排", 428.4, 47.7),
	}
	repo := &mockStatsRepo{candidates: candidates}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "call-context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "call-details", "get_campus_food_details", `{"source_ids":["chicken","chicken-rice","roast-chicken"]}`)
		default:
			writeCampusDietAgentTestFinal(t, w, map[string]any{
				"answer": "它们大概是150到180、350到400、300到350卡",
				"selections": []map[string]any{
					{"source_id": "chicken"}, {"source_id": "chicken-rice"}, {"source_id": "roast-chicken"},
				},
			})
		}
	}))
	defer server.Close()

	active := &DietRecommendationResult{
		ResolvedSchool: &domain.DietRecommendationSchool{ID: "school-tsinghua", Name: "清华大学"},
		Recommendations: []DietRecommendationOption{
			{SourceID: "chicken"}, {SourceID: "chicken-rice"}, {SourceID: "roast-chicken"},
		},
	}
	state := newCampusDietAgentTestState("facts", active)
	state.Question = "这三个菜各自热量是多少？"
	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state)

	require.True(t, result.AgentUsed)
	require.Len(t, result.Evidence, 3)
	assert.Equal(t, 286.23, result.Evidence[0].Calories)
	assert.Equal(t, 525.0, result.Evidence[1].Calories)
	assert.Equal(t, 428.4, result.Evidence[2].Calories)
	assert.Contains(t, result.Answer, "鸡胸：库内记录约 286.2 kcal")
	assert.Contains(t, result.Answer, "日烧意式鸡排饭：库内记录约 525 kcal")
	assert.Contains(t, result.Answer, "意式秘制烤鸡排：库内记录约 428.4 kcal")
	assert.NotContains(t, result.Answer, "150到180")
	require.Len(t, repo.campusSearchFilters, 1)
	assert.ElementsMatch(t, []string{"chicken", "chicken-rice", "roast-chicken"}, repo.campusSearchFilters[0].IncludeSourceIDs)
}

func TestCampusDietAgentIntentDistinguishesFactsFromConstraintRefinement(t *testing.T) {
	active := &DietRecommendationResult{}
	assert.Equal(t, "facts", campusDietAgentIntent("这五道菜价格分别是多少？", active))
	assert.Equal(t, "facts", campusDietAgentIntent("它们各自热量是多少？", active))
	assert.Equal(t, "refine", campusDietAgentIntent("这些太贵了，给我20元以内的", active))
	assert.Equal(t, "refine", campusDietAgentIntent("重新推荐减脂餐，500大卡以下", active))
	assert.Equal(t, "compare", campusDietAgentIntent("这几个哪个更适合减脂？", active))
}

func TestCampusDietAgentDatabaseFallbackHandlesFourTurnConstraintRefinement(t *testing.T) {
	repo := &mockStatsRepo{
		candidates:     campusDietAgentMultiTurnCandidates(),
		resolvedSchool: &domain.DietRecommendationSchool{ID: "school-tsinghua", Name: "清华大学"},
	}
	svc := NewStatsService(repo, nil)

	first := runCampusDietAgentStreamTurn(t, svc, PetChatInput{
		Question: "我是清华大学的学生，今天想增肌，推荐一些增肌餐", Range: "week", NewSession: true,
	})
	require.Len(t, first.Recommendation.Recommendations, 5)
	assert.False(t, first.AgentUsed)
	assertCampusDietOptionsMatch(t, first.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Calories <= 1200
	})
	firstIDs := recommendationSourceIDsFromResult(&first.Recommendation)

	second := runCampusDietAgentStreamTurn(t, svc, PetChatInput{
		Question: "你推荐这些价格太贵了，我需要更便宜的，20元以内最好", Range: "week", SessionID: "session-diet",
	})
	require.Len(t, second.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, second.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Price > 0 && option.Price <= 20
	})
	secondIDs := recommendationSourceIDsFromResult(&second.Recommendation)
	assertNoCampusDietIDOverlap(t, firstIDs, secondIDs)
	require.NotNil(t, second.Recommendation.AgentConstraints)
	assert.Equal(t, "muscle_gain", second.Recommendation.AgentConstraints.Goal)
	require.NotNil(t, second.Recommendation.AgentConstraints.MaxPrice)
	assert.Equal(t, 20.0, *second.Recommendation.AgentConstraints.MaxPrice)

	third := runCampusDietAgentStreamTurn(t, svc, PetChatInput{
		Question: "假如我想减脂呢？重新推荐500大卡以下的餐", Range: "week", SessionID: "session-diet",
	})
	require.Len(t, third.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, third.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Calories <= 500 && option.Price > 0 && option.Price <= 20
	})
	thirdIDs := recommendationSourceIDsFromResult(&third.Recommendation)
	assertNoCampusDietIDOverlap(t, secondIDs, thirdIDs)
	require.NotNil(t, third.Recommendation.AgentConstraints)
	assert.Equal(t, "fat_loss", third.Recommendation.AgentConstraints.Goal)
	require.NotNil(t, third.Recommendation.AgentConstraints.MaxCalories)
	assert.Equal(t, 500.0, *third.Recommendation.AgentConstraints.MaxCalories)
	require.NotNil(t, third.Recommendation.AgentConstraints.MaxPrice)
	assert.Equal(t, 20.0, *third.Recommendation.AgentConstraints.MaxPrice)

	fourth := runCampusDietAgentStreamTurn(t, svc, PetChatInput{
		Question: "换一批", Range: "week", SessionID: "session-diet",
	})
	require.Len(t, fourth.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, fourth.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Calories <= 500 && option.Price > 0 && option.Price <= 20
	})
	fourthIDs := recommendationSourceIDsFromResult(&fourth.Recommendation)
	assertNoCampusDietIDOverlap(t, append(append(firstIDs, secondIDs...), thirdIDs...), fourthIDs)

	require.GreaterOrEqual(t, len(repo.campusSearchFilters), 4)
	priceFilter := repo.campusSearchFilters[1]
	require.NotNil(t, priceFilter.MaxPrice)
	assert.Equal(t, 20.0, *priceFilter.MaxPrice)
	calorieFilter := repo.campusSearchFilters[2]
	require.NotNil(t, calorieFilter.MaxCalories)
	assert.Equal(t, 500.0, *calorieFilter.MaxCalories)
	require.NotNil(t, calorieFilter.MaxPrice)
	assert.Equal(t, 20.0, *calorieFilter.MaxPrice)
}

func TestCampusDietAgentRejectsInventedSourceIDAndMakesFallbackFree(t *testing.T) {
	repo := &mockStatsRepo{candidates: campusDietAgentTestCandidates(5)}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "call-context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "call-search", "search_campus_foods", `{"limit":20}`)
		default:
			writeCampusDietAgentTestFinal(t, w, map[string]any{
				"answer":     "推荐一个不存在的菜",
				"selections": []map[string]any{{"source_id": "invented-id"}},
			})
		}
	}))
	defer server.Close()

	svc := newCampusDietAgentTestService(repo, server.URL)
	result := svc.runCampusDietAgent(context.Background(), newCampusDietAgentTestState("initial", nil))
	require.False(t, result.AgentUsed)
	assert.Equal(t, "invalid_model_selection", result.FallbackReason)
	require.Len(t, result.Recommendation.Recommendations, 5)
	for _, option := range result.Recommendation.Recommendations {
		assert.NotEqual(t, "invented-id", option.SourceID)
	}
	credits, status, pricing := svc.chargeCampusDietAgent(context.Background(), "user-1", "session-1", result)
	assert.Zero(t, credits)
	assert.Equal(t, "free_database_fallback", status)
	assert.Nil(t, pricing)
}

func TestCampusDietAgentCurrentQuestionGoalOverridesProfileGoal(t *testing.T) {
	profileGoal := "fat_loss"
	repo := &mockStatsRepo{user: &domain.StatsUserProfile{DietGoal: &profileGoal}}
	contextValue := NewStatsService(repo, nil).buildCampusDietAgentMealContext(context.Background(), "user-1", "我这顿想增肌，帮我选")
	assert.Equal(t, "muscle_gain", contextValue.UserGoal)
}

func TestCampusDietAgentDeadlineStillReturnsDatabaseFallbackWithinReservedWindow(t *testing.T) {
	repo := &mockStatsRepo{candidates: campusDietAgentTestCandidates(5)}
	state := newCampusDietAgentTestState("initial", nil)
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()

	result := NewStatsService(repo, nil).campusDietAgentFallback(ctx, state, "model_timeout")

	require.False(t, result.AgentUsed)
	require.Len(t, result.Recommendation.Recommendations, 5)
	assert.Equal(t, "model_timeout", result.FallbackReason)
	assert.Contains(t, result.Answer, "AI 解读暂不可用")
}

func newCampusDietAgentTestService(repo *mockStatsRepo, baseURL string) *StatsService {
	cfg := &config.Config{}
	cfg.External.DashScopeAPIKey = "test-key"
	cfg.External.DashScopeBaseURL = baseURL
	svc := NewStatsService(repo, nil, cfg)
	svc.client = &http.Client{}
	return svc
}

func newCampusDietAgentTestState(intent string, active *DietRecommendationResult) *campusDietAgentRunState {
	school := domain.DietRecommendationSchool{ID: "school-tsinghua", Name: "清华大学"}
	return &campusDietAgentRunState{
		RunID: "agent-run-test", UserID: "user-1", Question: "我是清华学生，今天吃什么",
		Intent: intent, School: school, ActiveResult: active,
		ActiveSourceIDs: recommendationSourceIDsFromResult(active),
		Candidates:      map[string]DietRecommendationCandidate{},
	}
}

func campusDietAgentTestCandidates(count int) []domain.DietRecommendationCandidate {
	result := make([]domain.DietRecommendationCandidate, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, campusDietAgentTestCandidate(
			fmt.Sprintf("food-%d", index+1), fmt.Sprintf("真实校园菜%d", index+1), 280+float64(index*20), 30+float64(index),
		))
	}
	return result
}

func campusDietAgentTestCandidate(id, title string, calories, protein float64) domain.DietRecommendationCandidate {
	return domain.DietRecommendationCandidate{
		Source: "public_food_library", SourceID: id, Title: title,
		Calories: calories, Protein: protein, Carbs: 30, Fat: 8,
		IsCampusFood: true, SchoolID: "school-tsinghua", SchoolName: "清华大学",
		CanteenName: "紫荆园", Floor: "4F", WindowName: "健康轻食",
		NutritionBasis: "library_record",
		Items:          []domain.DietRecommendationFoodItem{{Name: title, Amount: "1份", Source: "public_food_library", SourceID: id}},
	}
}

func campusDietAgentMultiTurnCandidates() []domain.DietRecommendationCandidate {
	type group struct {
		prefix   string
		calories float64
		protein  float64
		fat      float64
		price    float64
	}
	groups := []group{
		{prefix: "standard", calories: 650, protein: 90, fat: 18, price: 30},
		{prefix: "cheap-high", calories: 640, protein: 80, fat: 20, price: 20},
		{prefix: "lean", calories: 450, protein: 50, fat: 10, price: 18},
		{prefix: "lean-cheap", calories: 400, protein: 45, fat: 9, price: 16},
		{prefix: "lean-more", calories: 480, protein: 40, fat: 8, price: 19},
	}
	result := make([]domain.DietRecommendationCandidate, 0, len(groups)*5)
	for _, item := range groups {
		for index := 1; index <= 5; index++ {
			candidate := campusDietAgentTestCandidate(
				fmt.Sprintf("%s-%d", item.prefix, index), fmt.Sprintf("%s菜%d", item.prefix, index), item.calories, item.protein,
			)
			candidate.Fat = item.fat
			candidate.Price = item.price
			candidate.PriceUnit = "份"
			result = append(result, candidate)
		}
	}
	return result
}

func runCampusDietAgentStreamTurn(t *testing.T, svc *StatsService, input PetChatInput) *CampusDietAgentResult {
	t.Helper()
	chunks, err := svc.GeneratePetChatStream(context.Background(), "user-1", input)
	require.NoError(t, err)
	var result *CampusDietAgentResult
	for chunk := range chunks {
		if chunk.DietResult != nil {
			result = chunk.DietResult
		}
	}
	require.NotNil(t, result)
	return result
}

func assertCampusDietOptionsMatch(t *testing.T, options []DietRecommendationOption, predicate func(DietRecommendationOption) bool) {
	t.Helper()
	for _, option := range options {
		assert.Truef(t, predicate(option), "unexpected option: %+v", option)
	}
}

func assertNoCampusDietIDOverlap(t *testing.T, previous, current []string) {
	t.Helper()
	seen := make(map[string]bool, len(previous))
	for _, id := range previous {
		seen[id] = true
	}
	for _, id := range current {
		assert.Falsef(t, seen[id], "source_id %s was repeated", id)
	}
}

func writeCampusDietAgentTestToolCall(t *testing.T, w http.ResponseWriter, id, name, arguments string) {
	t.Helper()
	writeCampusDietAgentTestResponse(t, w, map[string]any{
		"choices": []map[string]any{{"message": map[string]any{
			"role": "assistant", "content": "",
			"tool_calls": []map[string]any{{"id": id, "type": "function", "function": map[string]any{"name": name, "arguments": arguments}}},
		}}},
		"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
	})
}

func writeCampusDietAgentTestFinal(t *testing.T, w http.ResponseWriter, final map[string]any) {
	t.Helper()
	content, err := json.Marshal(final)
	require.NoError(t, err)
	writeCampusDietAgentTestResponse(t, w, map[string]any{
		"choices": []map[string]any{{"message": map[string]any{"role": "assistant", "content": string(content)}}},
		"usage":   map[string]any{"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
	})
}

func writeCampusDietAgentTestResponse(t *testing.T, w http.ResponseWriter, payload map[string]any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	require.NoError(t, json.NewEncoder(w).Encode(payload))
}

func campusDietAgentRequestHasToolResult(request map[string]any, toolCallID string) bool {
	messages, _ := request["messages"].([]any)
	for _, raw := range messages {
		message, _ := raw.(map[string]any)
		if message["role"] == "tool" && strings.TrimSpace(fmt.Sprintf("%v", message["tool_call_id"])) == toolCallID {
			return true
		}
	}
	return false
}
