package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Real-model replay 2026-11-26: "想吃猪肉炖粉条" near 清华 found 红烧肉炖粉条, but no rice was
// recorded at that shop, so nothing was offered and the user was asked to relax the request.

func TestNamedDishIsReadFromTheRequest(t *testing.T) {
	for question, want := range map[string]string{
		"想吃猪肉炖粉条":    "猪肉炖粉条",
		"我想吃鱼香肉丝吧":   "鱼香肉丝",
		"来一份宫保鸡丁":    "宫保鸡丁",
		"有没有酸菜鱼":     "酸菜鱼",
		"想吃清淡":       "",
		"想吃点清淡的":     "",
		"想吃辣的":       "",
		"想吃面":        "",
		"想吃什么都行":     "",
		"晚上吃什么":      "",
		"想吃便宜点的午餐":   "",
		"想吃食堂":       "",
		"推荐点吃的":      "",
		"想吃高蛋白的":     "",
		"今天想吃麻辣香锅呢":  "麻辣香锅",
		"想吃点外卖":      "",
		"想吃附近的":      "",
		"想吃番茄炒蛋，清淡点": "番茄炒蛋",
	} {
		assert.Equal(t, want, mealNamedDish(question), question)
	}
	assert.InDelta(t, 0.8, mealDishSimilarity("猪肉炖粉条", "红烧肉炖粉条"), 0.01)
	assert.InDelta(t, 1.0, mealDishSimilarity("猪肉炖粉条", "猪肉白菜炖粉条"), 0.01)
	assert.GreaterOrEqual(t, mealDishSimilarity("猪肉炖粉条", "酸菜炖粉条"), 0.6)
	assert.Zero(t, mealDishSimilarity("猪肉炖粉条", "猪肉大葱包子"), "sharing one ingredient is not the same dish")
	assert.Zero(t, mealDishSimilarity("猪肉炖粉条", "番茄牛腩饭"))
}

func TestNamedDishIsOfferedAsASingleDishWhenNoWholeMealHasIt(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			writeCampusDietAgentTestToolCall(t, w, "search", "search_nearby_foods", `{"keyword":"炖粉条"}`)
			return
		}
		writeCampusDietAgentTestFinal(t, w, map[string]any{"needs_clarification": true, "answer": "附近仅检索到单份红烧肉炖粉条，未找到同店主食，暂不推荐。请问是否放宽条件？", "selections": []any{}})
	}))
	defer server.Close()
	km := 0.8
	stew := campusDietAgentTestCandidate("stew", "红烧肉炖粉条", 420, 22)
	stew.IsCampusFood, stew.SchoolID, stew.SchoolName, stew.CanteenName, stew.WindowName, stew.Floor = false, "", "", "", "", ""
	stew.MerchantName, stew.Address, stew.DistanceKM, stew.Price = "东北小馆", "成府路 2 号", &km, 28
	other := campusDietAgentTestCandidate("bun", "猪肉大葱包子", 300, 12)
	other.IsCampusFood, other.SchoolID, other.SchoolName, other.CanteenName, other.WindowName, other.Floor = false, "", "", "", "", ""
	other.MerchantName, other.Address, other.DistanceKM = "包子铺", "成府路 3 号", &km
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Constraints = CampusDietRecommendationConstraints{CompleteMeal: true, MealType: "lunch"}
	state.Location = campusDietAgentTestLocation()
	state.Question = "想吃猪肉炖粉条"
	result := newCampusDietAgentTestService(&mockStatsRepo{candidates: []domain.DietRecommendationCandidate{stew, other}}, server.URL).runCampusDietAgent(context.Background(), state)
	require.Len(t, result.Recommendation.Recommendations, 1, result.Answer)
	assert.Equal(t, "stew", result.Recommendation.Recommendations[0].SourceID)
	assert.Contains(t, result.Answer, "没有收录「猪肉炖粉条」")
	assert.Contains(t, result.Answer, "最接近的是「红烧肉炖粉条」")
	assert.Contains(t, result.Answer, "主食")
	assert.NotContains(t, result.Answer, "放宽条件")
	assert.False(t, result.Recommendation.NeedsClarification)
	// The next turn is not stuck in single-dish mode (replay: "想吃麻辣香锅" then got three side dishes).
	require.NotNil(t, result.Recommendation.AgentConstraints)
	assert.True(t, result.Recommendation.AgentConstraints.CompleteMeal)
	assert.Empty(t, result.Recommendation.AgentConstraints.ItemKind)
}

// Real-model replay 2026-11-26, second run: the model chose the single dish six times, the
// whole-meal check rejected it six times, and after 51 s the rule fallback showed three
// meals that had nothing to do with the request.
func TestNamedDishIsGivenWhenTheModelsPickFailsValidation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			writeCampusDietAgentTestToolCall(t, w, "search", "search_nearby_foods", `{"keyword":"炖粉条"}`)
			return
		}
		writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "这道最接近。", "selections": []map[string]any{{"source_id": "stew"}}})
	}))
	defer server.Close()
	km := 0.8
	stew := campusDietAgentTestCandidate("stew", "红烧肉炖粉条", 420, 22)
	stew.IsCampusFood, stew.SchoolID, stew.SchoolName, stew.CanteenName, stew.WindowName, stew.Floor = false, "", "", "", "", ""
	stew.MerchantName, stew.Address, stew.DistanceKM, stew.Price = "东北小馆", "成府路 2 号", &km, 28
	meals := campusDietAgentTestCandidates(3)
	for i := range meals {
		meals[i].DistanceKM, meals[i].Carbs = &km, 60
	}
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Constraints = CampusDietRecommendationConstraints{CompleteMeal: true, MealType: "lunch"}
	state.Location = campusDietAgentTestLocation()
	state.Question = "想吃猪肉炖粉条"
	result := newCampusDietAgentTestService(&mockStatsRepo{candidates: append([]domain.DietRecommendationCandidate{stew}, meals...)}, server.URL).runCampusDietAgent(context.Background(), state)
	require.Len(t, result.Recommendation.Recommendations, 1, result.Answer)
	assert.Equal(t, "stew", result.Recommendation.Recommendations[0].SourceID)
	assert.Contains(t, result.Answer, "最接近的是「红烧肉炖粉条」")
	assert.LessOrEqual(t, calls, 2, "no repair rounds for a dish the user asked for")
}

func TestNamedDishPrefersAWholeMealThatContainsIt(t *testing.T) {
	bowl := campusDietAgentTestCandidate("bowl", "鱼香肉丝盖饭", 620, 26)
	bowl.Carbs = 80
	dish := campusDietAgentTestCandidate("dish", "鱼香肉丝", 380, 20)
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints = CampusDietRecommendationConstraints{CompleteMeal: true, MealType: "lunch"}
	state.Question = "想吃鱼香肉丝"
	state.Candidates = map[string]DietRecommendationCandidate{"bowl": bowl, "dish": dish}
	picks, name, single := mealNamedDishChoices(state)
	require.NotEmpty(t, picks)
	assert.Equal(t, "鱼香肉丝", name)
	assert.False(t, single)
	assert.Equal(t, "bowl", picks[0].SourceID)
	assert.Equal(t, "找到了「鱼香肉丝盖饭」。", mealNamedDishAnswer(name, picks[:1], single))
}

// Real-model replay 2026-11-26, third run: "想吃猪肉炖粉条" was answered with 炒合菜炒饼 (valid
// as a meal, but not the dish), and "想吃麻辣香锅" with two rice dishes and no word about it.
func TestNamedDishComesBeforeTheModelsOtherIdeas(t *testing.T) {
	km := 0.8
	shop := func(id, title string, kcal, carbs float64) domain.DietRecommendationCandidate {
		c := campusDietAgentTestCandidate(id, title, kcal, 24)
		c.IsCampusFood, c.SchoolID, c.SchoolName, c.CanteenName, c.WindowName, c.Floor = false, "", "", "", "", ""
		c.MerchantName, c.Address, c.DistanceKM, c.Price, c.Carbs = "小馆"+id, "成府路 "+id, &km, 26, carbs
		return c
	}
	ask := func(question string, candidates []domain.DietRecommendationCandidate, pick string) (*CampusDietAgentResult, *mockStatsRepo) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "这份可以直接当一餐。", "selections": []map[string]any{{"source_id": pick}}})
		}))
		t.Cleanup(server.Close)
		repo := &mockStatsRepo{candidates: candidates}
		state := newCampusDietAgentTestState("initial", nil)
		state.School = domain.DietRecommendationSchool{}
		state.Constraints = CampusDietRecommendationConstraints{CompleteMeal: true, MealType: "lunch"}
		state.Location = campusDietAgentTestLocation()
		state.Question = question
		return newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state), repo
	}
	stew, pancake := shop("stew", "红烧肉炖粉条", 420, 30), shop("pancake", "炒合菜炒饼", 560, 70)

	// The dish is on record: it is given, whatever else the model preferred.
	result, repo := ask("想吃猪肉炖粉条", []domain.DietRecommendationCandidate{stew, pancake}, "pancake")
	require.NotEmpty(t, result.Recommendation.Recommendations, result.Answer)
	assert.Equal(t, "stew", result.Recommendation.Recommendations[0].SourceID)
	assert.Contains(t, result.Answer, "最接近的是「红烧肉炖粉条」")
	require.NotEmpty(t, repo.campusSearchFilters)
	assert.Equal(t, "猪肉炖粉条", repo.campusSearchFilters[0].Keyword, "the server looks the dish up itself")

	// Nothing like it on record: the model's options stay, and the answer says so first.
	result, _ = ask("想吃麻辣香锅", []domain.DietRecommendationCandidate{pancake}, "pancake")
	require.NotEmpty(t, result.Recommendation.Recommendations, result.Answer)
	assert.Equal(t, "pancake", result.Recommendation.Recommendations[0].SourceID)
	assert.NotContains(t, result.Answer, "没有「麻辣香锅」", "the mock returns rows for any keyword, so nothing is claimed")
}

func TestAnswerSaysWhenTheNamedDishIsNotOnRecord(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Question = "想吃麻辣香锅"
	rice := campusDietAgentTestCandidate("rice", "肥牛石锅拌饭", 620, 28)
	state.Candidates = map[string]DietRecommendationCandidate{"rice": rice}
	result := &CampusDietAgentResult{Answer: "肥牛石锅拌饭可以直接当一餐。", Recommendation: DietRecommendationResult{Recommendations: []DietRecommendationOption{{SourceID: "rice", Title: "肥牛石锅拌饭"}}}}
	// Not searched by the server: nothing is claimed.
	assert.Nil(t, mealNamedDishInstead(state, result))
	assert.Equal(t, "肥牛石锅拌饭可以直接当一餐。", result.Answer)
	state.NamedDishSearched, state.NamedDishMatches = true, 0
	assert.Nil(t, mealNamedDishInstead(state, result))
	assert.Equal(t, "这里收录的餐食里没有「麻辣香锅」，先看看这几份。肥牛石锅拌饭可以直接当一餐。", result.Answer)
	assert.Equal(t, result.Answer, result.Recommendation.Summary)
	// A wish that names no dish changes nothing.
	state.Question = "想吃清淡"
	plain := &CampusDietAgentResult{Answer: "这份清淡。", Recommendation: result.Recommendation}
	assert.Nil(t, mealNamedDishInstead(state, plain))
	assert.Equal(t, "这份清淡。", plain.Answer)
}
