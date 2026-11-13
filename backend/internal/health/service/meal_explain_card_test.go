package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Trial 2026-11-13: "你为什么推荐这些？" and "我在问你为什么推荐这些，不要再给我推荐了" each
// searched again and showed new meals; "你确定没有获取到位置？" listed every dish's address.

func explainTestCard() *DietRecommendationResult {
	return &DietRecommendationResult{
		Scene: "campus", HarnessVersion: mealHarnessVersion,
		Recommendations: []DietRecommendationOption{
			{SourceID: "food-1", Title: "蒸鸡肉、米饭", SelectionReason: "蛋白质补到今天还差的一半"},
			{SourceID: "food-2", Title: "番茄牛腩面", Reason: "碳水足，下午不容易饿"},
		},
	}
}

func TestMealExplainIntentReadsQuestionsAboutTheCard(t *testing.T) {
	for _, q := range []string{"你为什么推荐这些？", "我在问你为什么推荐这些，不要再给我推荐了", "别推荐了，说说理由", "为什么是这几个"} {
		assert.Equal(t, "explain", mealExplainIntent(q, true), q)
		assert.Equal(t, "explain", campusDietAgentIntent(q, explainTestCard()), q)
	}
	// Without a card there is nothing to explain.
	assert.Equal(t, "", mealExplainIntent("你为什么推荐这些？", false))
	// A new constraint is a new search, even when phrased with 为什么.
	assert.NotEqual(t, "explain", mealExplainIntent("为什么没有便宜点的？要20元以内", true))
	// Questions about the user's own location retry the search once the location arrived.
	for _, q := range []string{"你确定没有获取到位置？", "你没有拿到我的定位吗", "定位了吗", "你知道我在哪吗"} {
		assert.Equal(t, "initial", mealExplainIntent(q, true), q)
	}
	assert.Equal(t, "", mealExplainIntent("这些在哪里买", true))
}

func TestExplainAnswersFromTheCardWithoutSearching(t *testing.T) {
	var payload string
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, "none", body["tool_choice"])
		messages := body["messages"].([]any)
		payload = messages[len(messages)-1].(map[string]any)["content"].(string)
		writeCampusDietAgentTestFinal(t, w, map[string]any{"reply": "你只睡了两个小时还要撑到十点，蒸鸡肉米饭最稳，吃到七八分饱，别配含糖饮料。"})
	}))
	defer server.Close()
	repo := &mockStatsRepo{candidates: campusDietAgentTestCandidates(3)}
	state := newCampusDietAgentTestState("explain", explainTestCard())
	state.Question = "你为什么推荐这些？"
	state.History = []domain.PetChatMessage{{Role: "user", Content: "我昨晚只睡了两个小时，今天要撑到晚上十点"}}
	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state)
	assert.Equal(t, 1, calls)
	assert.Empty(t, repo.campusSearchFilters, "an explanation does not search")
	assert.True(t, result.AgentUsed)
	assert.True(t, result.Recommendation.ExplainsPrevious)
	assert.Empty(t, result.Recommendation.Recommendations)
	assert.Contains(t, result.Answer, "睡了两个小时")
	assert.Contains(t, payload, "只睡了两个小时", "what the user said earlier reaches the model")
	assert.Contains(t, payload, "蒸鸡肉、米饭")
}

func TestExplainFallsBackToCardReasonsWhenModelIsDown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"余额不足"}`, http.StatusInternalServerError)
	}))
	defer server.Close()
	repo := &mockStatsRepo{candidates: campusDietAgentTestCandidates(3)}
	state := newCampusDietAgentTestState("explain", explainTestCard())
	state.Question = "不要再给我推荐了，为什么是这些"
	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state)
	assert.False(t, result.AgentUsed)
	assert.Equal(t, "explained_from_card", result.FallbackReason)
	assert.Empty(t, result.Recommendation.Recommendations, "no new meals when the model fails either")
	assert.Empty(t, repo.campusSearchFilters)
	assert.Contains(t, result.Answer, "蒸鸡肉、米饭：蛋白质补到今天还差的一半")
	assert.Contains(t, result.Answer, "番茄牛腩面：碳水足")
}

func TestExplanationKeepsTheCardItExplains(t *testing.T) {
	card := explainTestCard()
	explained := DietRecommendationResult{HarnessVersion: mealHarnessVersion, ExplainsPrevious: true, Recommendations: []DietRecommendationOption{}}
	messages := []domain.PetChatMessage{
		{Role: "user", Content: "晚饭吃什么"},
		{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": card}},
		{Role: "user", Content: "你为什么推荐这些？"},
		{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": explained}},
	}
	active, _ := activeCampusDietRecommendation(messages)
	require.NotNil(t, active)
	assert.Len(t, active.Recommendations, 2)
}

func TestQuestionsAboutTheCardGoToTheMealAgent(t *testing.T) {
	repo := &mockStatsRepo{petChatMessages: []domain.PetChatMessage{
		{Role: "user", Content: "晚饭吃什么"},
		{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": explainTestCard()}},
	}}
	svc := newCampusDietAgentTestService(repo, "http://127.0.0.1:1")
	for _, q := range []string{"你为什么推荐这些？", "我在问你为什么推荐这些，不要再给我推荐了"} {
		assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: q, SessionID: "s1"}), q)
	}
}

func TestMealLocationsAnswerNamesEachPlaceOnce(t *testing.T) {
	a := campusDietAgentTestCandidate("a", "手擀面", 400, 12)
	b := campusDietAgentTestCandidate("b", "鸡胸肉", 200, 30)
	c := campusDietAgentTestCandidate("c", "小白菜", 60, 2)
	c.WindowName = ""
	shop := DietRecommendationCandidate{Title: "牛肉饭", Address: "海淀区成府路 28 号"}
	answer := mealLocationsAnswer([]DietRecommendationCandidate{a, b, c, shop, a})
	assert.Equal(t, 1, strings.Count(answer, "手擀面"))
	assert.Contains(t, answer, "手擀面、鸡胸肉：清华大学 · 紫荆园 · 4F · 健康轻食")
	assert.Contains(t, answer, "小白菜：清华大学 · 紫荆园 · 4F（具体窗口尚未收录）")
	assert.Contains(t, answer, "牛肉饭：海淀区成府路 28 号")
}
