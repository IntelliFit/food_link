package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMealHarnessHistoryUsesThirtyDaysAndReducesRepeatedFoods(t *testing.T) {
	now := time.Now().In(chinaTZ)
	yesterday, older, future := now.AddDate(0, 0, -1), now.AddDate(0, 0, -35), now.Add(time.Hour)
	records := []domain.FoodRecord{
		{RecordTime: &yesterday, MealType: "lunch", Items: []map[string]any{{"name": "鸡肉饭"}}, TotalCalories: 500, TotalProtein: 30},
		{RecordTime: &yesterday, MealType: "dinner", Items: []map[string]any{{"name": "鸡肉饭"}}, TotalCalories: 500, TotalProtein: 30},
		{RecordTime: &older, TotalCalories: 9000}, {RecordTime: &future, TotalCalories: 9000},
	}
	summary := summarizeMealHistory(records, now)
	assert.Equal(t, 2, summary.RecordCount)
	assert.Equal(t, 1, summary.RecordedDays)
	assert.Equal(t, 1000.0, summary.Average.Calories)
	require.Len(t, summary.FoodFrequency, 1)
	assert.Equal(t, 2, summary.FoodFrequency[0].RecentCount)
	state := newCampusDietAgentTestState("initial", nil)
	state.PersonalContext = summary
	chicken := campusDietAgentTestCandidate("chicken", "鸡肉饭", 500, 30)
	fish := campusDietAgentTestCandidate("fish", "鱼肉饭", 500, 30)
	assert.Equal(t, "fish", mealHarnessRank(state, []DietRecommendationCandidate{chicken, fish})[0].SourceID)
}

func TestMealHarnessModelUsesContextNearbyAndRepairsUnknownSelection(t *testing.T) {
	now := time.Now().In(chinaTZ)
	past := now.AddDate(0, 0, -1)
	fish := campusDietAgentTestCandidate("fish", "蒸鱼饭", 450, 35)
	chicken := campusDietAgentTestCandidate("chicken", "鸡肉饭", 450, 35)
	fish.Price = 18
	chicken.Price = 18
	distance := 0.5
	fish.DistanceKM, chicken.DistanceKM = &distance, &distance
	repo := &mockStatsRepo{records: []domain.FoodRecord{{RecordTime: &past, Items: []map[string]any{{"name": "鸡肉饭"}}, TotalCalories: 550}}, candidates: []domain.DietRecommendationCandidate{chicken, fish}, user: &domain.StatsUserProfile{HealthCondition: map[string]any{"allergies": []any{"花生"}}}}
	state := newCampusDietAgentTestState("refine", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.32, CapturedAt: now.UnixMilli(), CoordinateType: "gcj02"}
	state.Question = "刚训练完，还是20元以内，不吃鸡肉"
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, state.Question)
	state.Constraints.AllowedSchoolIDs = []string{"school-tsinghua"}
	state.History = []domain.PetChatMessage{{Role: "user", Content: "我今天午餐预算20元"}}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		raw, _ := json.Marshal(body)
		call++
		switch call {
		case 1:
			assert.Contains(t, string(raw), "我今天午餐预算20元")
			writeCampusDietAgentTestToolCall(t, w, "ctx", "get_meal_context", `{}`)
		case 2:
			assert.Contains(t, string(raw), "food_frequency")
			assert.Contains(t, string(raw), "鸡肉饭")
			assert.Contains(t, string(raw), "花生")
			writeCampusDietAgentTestToolCall(t, w, "prefs", "set_meal_preferences", `{"avoid_foods":["鸡肉"]}`)
		case 3:
			writeCampusDietAgentTestToolCall(t, w, "nearby", "search_nearby_foods", `{}`)
		case 4:
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "给你选好了", "selections": []map[string]any{{"source_id": "invented"}}})
		default:
			assert.Contains(t, string(raw), "结果校验未通过")
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "你刚训练完，又想换掉最近吃过的鸡肉，这次可以考虑蒸鱼配主食。", "selections": []map[string]any{{"source_id": "fish", "reason": "换一种蛋白来源，也照顾你刚训练完的需求"}}})
		}
	}))
	defer server.Close()
	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state)
	require.True(t, result.AgentUsed, result.FallbackReason)
	require.Len(t, result.Recommendation.Recommendations, 1)
	assert.Equal(t, "fish", result.Recommendation.Recommendations[0].SourceID)
	assert.Contains(t, result.Answer, "刚训练完")
	assert.Equal(t, "nearby", result.Recommendation.SearchScope)
	require.Len(t, repo.campusSearchFilters, 1)
	assert.NotNil(t, repo.campusSearchFilters[0].Location)
	assert.Equal(t, 20.0, *repo.campusSearchFilters[0].MaxPrice)
	assert.Equal(t, 5, call)
}

func TestMealHarnessKeepsModelChoiceAndExplanation(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.LastSearch = campusDietAgentTestCandidates(6)
	for _, c := range state.LastSearch {
		state.Candidates[c.SourceID] = c
	}
	chosen := state.LastSearch[5]
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Answer: "考虑到你今天想换换口味，可以先选这个。", Selections: []campusDietAgentFinalSelection{{SourceID: chosen.SourceID, Reason: "符合你今天的口味偏好"}}}, true, "")
	require.NoError(t, err)
	require.Len(t, result.Recommendation.Recommendations, 1)
	assert.Equal(t, chosen.SourceID, result.Recommendation.Recommendations[0].SourceID)
	assert.Contains(t, result.Answer, "换换口味")
}

func TestMealHarnessRejectsAllergenAndDoesNotWidenRadius(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContext.Allergies = []string{"花生"}
	_, err := mealHarnessPreferences(state, `{"avoid_foods":[],"radius_km":10}`)
	require.NoError(t, err)
	assert.Zero(t, state.Constraints.RadiusKM)
	candidate := campusDietAgentTestCandidate("unsafe", "花生鸡肉饭", 500, 30)
	state.Candidates[candidate.SourceID] = candidate
	state.LastSearch = []DietRecommendationCandidate{candidate}
	_, err = buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: "unsafe"}}}, true, "")
	require.Error(t, err)
}

func TestMealHarnessMissingLocationAndEmptyPoolAreFree(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{}, nil)
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	result := svc.runCampusDietAgent(context.Background(), state)
	assert.True(t, result.Recommendation.NeedsClarification)
	assert.Contains(t, result.Answer, "当前位置")
	cost, _, _ := svc.chargeCampusDietAgent(context.Background(), "user", "session", result, false, state.MealContext)
	assert.Zero(t, cost)
	state.School = domain.DietRecommendationSchool{ID: "school"}
	result = svc.runCampusDietAgent(context.Background(), state)
	assert.True(t, result.Recommendation.NeedsClarification)
	assert.Empty(t, result.Recommendation.Recommendations)
}

func TestMealHarnessRoutingTrainingContextAndExpiredLocation(t *testing.T) {
	previous := DietRecommendationResult{HarnessVersion: mealHarnessVersion, SearchScope: "nearby"}
	repo := &mockStatsRepo{petChatMessages: []domain.PetChatMessage{{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": previous}}}}
	svc := NewStatsService(repo, nil)
	for _, q := range []string{"我刚健身完", "不要鸡肉", "预算20元", "附近吃什么", "减脂"} {
		assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: q, SessionID: "s"}), q)
	}
	assert.False(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: "训练怎么安排", SessionID: "s"}))
	assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: "附近有什么清淡的饭可以选？"}))
	assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: "刚健身完", EntryContext: &PetChatEntryContext{Source: "home_next_meal"}}))
	_, err := svc.normalizePetChatInput(PetChatInput{Question: "附近吃什么", Location: &domain.DietLocation{Latitude: 40, Longitude: 116, CoordinateType: "gcj02", CapturedAt: time.Now().Add(-time.Hour).UnixMilli()}})
	require.Error(t, err)
}

func TestMealHarnessToolFailureIsNotReportedAsNoNearbyFood(t *testing.T) {
	repo := &mockStatsRepo{campusSearchErr: fmt.Errorf("offline")}
	result := NewStatsService(repo, nil).runCampusDietAgent(context.Background(), newCampusDietAgentTestState("initial", nil))
	assert.Contains(t, result.Answer, "查询失败")
	assert.False(t, strings.Contains(result.Answer, "没有找到"))
}

func TestMealHarnessEmptyMerchantDataDoesNotPretendGPSIsMissing(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Location = &domain.DietLocation{Latitude: 40, Longitude: 116, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
	state.Constraints.Scene = "takeout"
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "context", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "search", "search_nearby_foods", `{}`)
		default:
			writeCampusDietAgentTestFinal(t, w, map[string]any{"needs_clarification": true, "answer": "缺少地点，请问你在哪里？", "selections": []any{}})
		}
	}))
	defer server.Close()
	result := newCampusDietAgentTestService(&mockStatsRepo{}, server.URL).runCampusDietAgent(context.Background(), state)
	assert.Contains(t, result.Answer, "这不代表当地没有商家")
	assert.NotContains(t, result.Answer, "缺少地点")
	assert.Empty(t, result.Recommendation.Recommendations)
}

func TestMealHarnessStopsRepeatedContextCallsAndRetrievesEvidence(t *testing.T) {
	candidates := campusDietAgentTestCandidates(3)
	repo := &mockStatsRepo{candidates: candidates}
	call := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		call++
		switch call {
		case 1, 2:
			writeCampusDietAgentTestToolCall(t, w, fmt.Sprintf("context-%d", call), "get_meal_context", `{}`)
		case 3:
			choice := body["tool_choice"].(map[string]any)
			assert.Equal(t, "search_campus_foods", choice["function"].(map[string]any)["name"])
			writeCampusDietAgentTestToolCall(t, w, "search", "search_campus_foods", `{}`)
		default:
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "根据你这餐的需求可以选这个。", "selections": []map[string]any{{"source_id": candidates[0].SourceID}}})
		}
	}))
	defer server.Close()
	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), newCampusDietAgentTestState("initial", nil))
	require.True(t, result.AgentUsed)
	assert.Equal(t, 4, call)
	require.Len(t, repo.campusSearchFilters, 1)
}

func TestMealHarnessRevalidatesDistanceAndSceneAfterPreferencesChange(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Location = &domain.DietLocation{Latitude: 40, Longitude: 116}
	state.School = domain.DietRecommendationSchool{}
	near, far := campusDietAgentTestCandidate("near", "鱼肉饭", 500, 30), campusDietAgentTestCandidate("far", "牛肉饭", 500, 30)
	d1, d2 := 0.5, 2.0
	near.DistanceKM, far.DistanceKM = &d1, &d2
	state.LastSearch = []DietRecommendationCandidate{near, far}
	state.Candidates = map[string]DietRecommendationCandidate{near.SourceID: near, far.SourceID: far}
	state.Question = "搜索范围缩小到1公里"
	_, err := mealHarnessPreferences(state, `{"radius_km":1}`)
	require.NoError(t, err)
	require.Len(t, state.Candidates, 1)
	assert.Contains(t, state.Candidates, "near")
	state.Question = "只看外卖商家"
	_, err = mealHarnessPreferences(state, `{"scene":"takeout"}`)
	require.NoError(t, err)
	assert.Empty(t, state.Candidates, "campus/unknown merchants must not survive takeout filtering")
	assert.Equal(t, "附近已收录餐食", mealHarnessSourceLabel(state))
}

func TestMealHarnessContextToolIncludesHomeAdviceAsHint(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.EntryContext = &PetChatEntryContext{Source: "home_next_meal", BasicAdvice: "下一餐换一种蛋白来源"}
	svc := NewStatsService(&mockStatsRepo{}, nil)
	output, err := svc.executeCampusDietAgentTool(context.Background(), state, newCampusDietAgentToolCall("context", "get_meal_context", `{}`))
	require.NoError(t, err)
	assert.Equal(t, state.EntryContext, output["entry_context"])
	assert.True(t, state.MealContextLoaded)
}

func TestMealHarnessDropsUnevidencedCookingAndHealthClaims(t *testing.T) {
	for _, claim := range []string{"酸汤烹制避免了重油重辣", "蒸制工艺避免了额外油脂摄入", "鱼汤清爽不腻", "有助于缓解疲劳", "保证安全，不会过敏"} {
		assert.Empty(t, campusDietAgentQualitativeAnswer(claim), claim)
	}
	assert.Equal(t, "你今天不想吃鸡肉，可以换一种蛋白来源", campusDietAgentQualitativeAnswer("你今天不想吃鸡肉，可以换一种蛋白来源"))
}
