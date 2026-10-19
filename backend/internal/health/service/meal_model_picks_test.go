package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pickMeal(id, title string, fit float64) groundedMeal {
	c := DietRecommendationCandidate{Source: "public_food_library", SourceID: id, Title: title, CanteenName: "桃李园"}
	return groundedMeal{candidate: c, evaluation: dietDecisionEvaluation{Candidate: c, Feasible: true, Scores: DietDecisionScorecard{HealthFit: fit}}, score: fit}
}

func pickIDs(meals []groundedMeal) []string {
	ids := []string{}
	for _, m := range meals {
		ids = append(ids, m.candidate.SourceID)
	}
	return ids
}

// The model may choose by taste, distance or the user's words among near-best options:
// anything within mealModelPickTolerance of the best is a valid answer, not only the top few.
func TestModelPicksWithinTheNearBestBandAreKept(t *testing.T) {
	pool := []groundedMeal{pickMeal("a", "番茄牛腩饭", 96), pickMeal("b", "香辣爆肚面", 92), pickMeal("c", "鸡汤馄饨", 88), pickMeal("d", "炸鸡汉堡", 70)}
	kept, rejected, _ := acceptNearBestPicks(pool, []string{"b", "c"}, 3)
	assert.Equal(t, []string{"b", "c"}, pickIDs(kept), "92 and 88 are within 10 of 96 although the engine alone would only take 91+")
	assert.Empty(t, rejected)

	kept, rejected, _ = acceptNearBestPicks(pool, []string{"b", "d"}, 3)
	assert.Equal(t, []string{"b"}, pickIDs(kept))
	assert.Equal(t, []string{"d"}, rejected, "a clearly worse meal is still replaced")
}

func TestModelPicksStillRespectHardRulesAndVariety(t *testing.T) {
	infeasible := pickMeal("x", "超预算套餐", 99)
	infeasible.evaluation.Feasible = false
	repeat := pickMeal("r", "昨天推荐过的牛肉面", 95)
	repeat.recentRepeat = true
	dup := pickMeal("a2", "番茄牛腩饭", 95) // same dish as "a" under another id
	pool := []groundedMeal{pickMeal("a", "番茄牛腩饭", 96), pickMeal("b", "香辣爆肚面", 92), infeasible, repeat, dup}

	kept, rejected, _ := acceptNearBestPicks(pool, []string{"x", "r", "a", "a2"}, 4)
	assert.Equal(t, []string{"a"}, pickIDs(kept))
	assert.Equal(t, []string{"x", "r", "a2"}, rejected, "infeasible, recently shown while fresh options exist, and the same dish twice")

	// Three of one kind is too samey when another kind is just as good.
	pool = []groundedMeal{pickMeal("n1", "牛肉面", 95), pickMeal("n2", "鸡丝面", 94), pickMeal("n3", "番茄鸡蛋面", 93), pickMeal("r1", "番茄牛腩饭", 92)}
	kept, rejected, _ = acceptNearBestPicks(pool, []string{"n1", "n2", "n3"}, 3)
	assert.Equal(t, []string{"n1", "n2"}, pickIDs(kept))
	assert.Equal(t, []string{"n3"}, rejected)
	pool = []groundedMeal{pickMeal("n1", "牛肉面", 95), pickMeal("n2", "鸡丝面", 94), pickMeal("n3", "番茄鸡蛋面", 93), pickMeal("z", "炸鸡汉堡", 60)}
	kept, _, _ = acceptNearBestPicks(pool, []string{"n1", "n2", "n3"}, 3)
	assert.Len(t, kept, 3, "when only noodles are good, three noodles are fine")
}

// Only the rejected picks are replaced, by the engine's best remaining choices.
func TestRejectedPicksAreFilledFromTheEngineInOrder(t *testing.T) {
	kept := []groundedMeal{pickMeal("b", "香辣爆肚面", 92)}
	engine := []groundedMeal{pickMeal("a", "番茄牛腩饭", 96), pickMeal("b", "香辣爆肚面", 92), pickMeal("c", "鸡汤馄饨", 88)}
	assert.Equal(t, []string{"b", "a", "c"}, pickIDs(fillModelPicks(kept, engine, 3)))
	assert.Equal(t, []string{"b", "a"}, pickIDs(fillModelPicks(kept, engine, 2)))
}

// End to end: two near-best noodle bowls chosen by the model, while an equally good rice
// bowl exists. The old rule replaced the whole answer (the rice bowl was "more varied");
// now the model's choice and its own explanation stand.
func TestModelsNearBestChoiceAndWordsAreKept(t *testing.T) {
	dish := func(id, title string, kcal, protein, carbs, fat float64) DietRecommendationCandidate {
		return comboDish(id, title, kcal, protein, carbs, fat, 15, "面食")
	}
	pool := []DietRecommendationCandidate{
		dish("noodle-1", "牛肉拉面", 560, 30, 72, 14),
		dish("noodle-2", "鸡丝拌面", 540, 29, 70, 13),
		dish("rice-1", "番茄牛腩饭", 570, 30, 74, 14),
	}
	state := newComboTestState()
	state.Constraints.CompleteMeal = false
	for _, c := range pool {
		state.Candidates[c.SourceID] = c
	}
	state.LastSearch = pool
	final := campusDietAgentFinal{
		Answer:     "你想吃面，就选牛肉拉面和鸡丝拌面，两碗都是汤面里比较均衡的。",
		Selections: []campusDietAgentFinalSelection{{SourceID: "noodle-1", Reason: "想吃面"}, {SourceID: "noodle-2", Reason: "清淡一些"}},
	}
	result, err := buildCampusDietAgentResult(state, final, true, "")
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, o := range result.Recommendation.Recommendations {
		ids = append(ids, o.SourceID)
	}
	assert.Equal(t, []string{"noodle-1", "noodle-2"}, ids)
	assert.Empty(t, result.FallbackReason)
	assert.Contains(t, result.Answer, "牛肉拉面和鸡丝拌面")
}

// The model picks a clearly worse meal; instead of overwriting the whole answer, the harness
// tells the model why and offers near-best alternatives once, and keeps its corrected answer.
func TestModelGetsOneChanceToReplaceAnOutOfRangePick(t *testing.T) {
	good := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 540, 30, 70, 13, 15, "盖饭")
	}
	pool := []DietRecommendationCandidate{
		good("g1", "黄焖鸡米饭"), good("g2", "番茄牛腩饭"), good("g3", "香菇滑鸡饭"),
		comboDish("bad", "炸鸡全家桶套饭", 1900, 60, 150, 110, 39, "炸鸡"),
	}
	call := 0
	var repairMessage string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		call++
		switch call {
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "ctx", "get_meal_context", `{}`)
		case 2:
			writeCampusDietAgentTestToolCall(t, w, "search", "search_campus_foods", `{}`)
		case 3:
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "来份炸鸡全家桶套饭和黄焖鸡米饭。", "selections": []map[string]any{{"source_id": "bad"}, {"source_id": "g1"}}})
		default:
			messages, _ := body["messages"].([]any)
			last, _ := messages[len(messages)-1].(map[string]any)
			repairMessage, _ = last["content"].(string)
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "炸鸡太油了，换成番茄牛腩饭，和黄焖鸡米饭一样是完整的一餐。", "selections": []map[string]any{{"source_id": "g2"}, {"source_id": "g1"}}})
		}
	}))
	defer server.Close()
	svc := newCampusDietAgentTestService(&mockStatsRepo{candidates: pool}, server.URL)
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints = CampusDietRecommendationConstraints{Scene: "campus", MealType: "lunch"}
	result := svc.runCampusDietAgent(context.Background(), state)

	require.True(t, result.AgentUsed, "fallback=%s answer=%s", result.FallbackReason, result.Answer)
	assert.Contains(t, repairMessage, "炸鸡全家桶套饭")
	assert.Contains(t, repairMessage, "营养上明显不如")
	assert.Contains(t, repairMessage, "番茄牛腩饭", "near-best alternatives are offered")
	ids := []string{}
	for _, o := range result.Recommendation.Recommendations {
		ids = append(ids, o.SourceID)
	}
	assert.Equal(t, []string{"g2", "g1"}, ids)
	assert.Empty(t, result.FallbackReason)
	assert.Contains(t, result.Answer, "换成番茄牛腩饭")
}

// Live run 2026-10-18: delivery merchants have no recorded price, the model honestly said it
// could not confirm the fees, and its every pick was rejected. Without a price nothing is shown
// that could mislead; "not orderable" still rejects.
func TestUnknownPriceDoesNotRejectAnOtherwiseOrderablePick(t *testing.T) {
	unpriced := DietRecommendationCandidate{Source: "public_food_library", SourceID: "m", MerchantName: "米村拌饭"}
	priced := unpriced
	priced.Price = 22
	unsure := &mealOrderingCheck{ReadyToOrder: true, MandatoryCostsIncluded: false}
	assert.False(t, mealOrderingCheckFails(unsure, unpriced))
	assert.True(t, mealOrderingCheckFails(unsure, priced))
	assert.True(t, mealOrderingCheckFails(&mealOrderingCheck{ReadyToOrder: false, MandatoryCostsIncluded: true}, unpriced))
	assert.False(t, mealOrderingCheckFails(nil, priced))
}

// When the model cannot finish but this turn already found fitting options, the user gets
// those (labelled), not "please retry"; options that were just on the card do not count.
func TestModelFailureShowsThisTurnsFreshOptions(t *testing.T) {
	good := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 540, 30, 70, 13, 15, "盖饭")
	}
	svc := newCampusDietAgentTestService(&mockStatsRepo{}, "http://127.0.0.1:0")
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.MealContextLoaded, state.SearchAttempted = true, true
	state.Constraints = CampusDietRecommendationConstraints{Scene: "takeout", MealType: "lunch"}
	for _, c := range []DietRecommendationCandidate{good("g1", "黄焖鸡米饭"), good("g2", "番茄牛腩饭")} {
		c.IsCampusFood, c.CanteenName, c.MerchantName = false, "", "米村拌饭"
		state.Candidates[c.SourceID] = c
		state.LastSearch = append(state.LastSearch, c)
	}
	result := svc.campusDietAgentFallback(context.Background(), state, "invalid_model_selection")
	require.NotEmpty(t, result.Recommendation.Recommendations, result.Answer)
	assert.Contains(t, result.Answer, "AI 解读")

	refine := newCampusDietAgentTestState("refine", nil)
	refine.School = domain.DietRecommendationSchool{}
	refine.MealContextLoaded, refine.SearchAttempted = true, true
	refine.Constraints, refine.Candidates, refine.LastSearch = state.Constraints, state.Candidates, state.LastSearch
	refine.ActiveSourceIDs = []string{"g1", "g2"}
	again := svc.campusDietAgentFallback(context.Background(), refine, "invalid_model_selection")
	assert.Empty(t, again.Recommendation.Recommendations, "the card the user is reacting to is not shown again as an adjustment")
}

// Live run 2026-10-18: after a partial replacement the reply still described a dish that was
// no longer on the cards. The reply now follows the cards.
func TestPartialReplacementReplyFollowsTheCards(t *testing.T) {
	dish := func(id, title string, kcal, protein, carbs, fat float64) DietRecommendationCandidate {
		return comboDish(id, title, kcal, protein, carbs, fat, 15, "盖饭")
	}
	pool := []DietRecommendationCandidate{
		dish("g1", "黄焖鸡米饭", 540, 30, 70, 13), dish("g2", "番茄牛腩饭", 550, 30, 72, 13),
		dish("bad", "炸鸡全家桶套饭", 1900, 60, 150, 110),
	}
	state := newComboTestState()
	state.Constraints.CompleteMeal = false
	for _, c := range pool {
		state.Candidates[c.SourceID] = c
	}
	state.LastSearch = pool
	final := campusDietAgentFinal{
		Answer:     "来份炸鸡全家桶套饭，再配黄焖鸡米饭，吃得爽。",
		Selections: []campusDietAgentFinalSelection{{SourceID: "bad", Reason: "够过瘾"}, {SourceID: "g1", Reason: "下饭"}},
	}
	result, err := buildCampusDietAgentResult(state, final, true, "")
	require.NoError(t, err)
	assert.Equal(t, "model_selection_partially_replaced", result.FallbackReason)
	assert.NotContains(t, result.Answer, "炸鸡全家桶", "the dropped pick is not described")
	assert.Contains(t, result.Answer, "黄焖鸡米饭：下饭", "the kept pick keeps the model's reason")
	assert.Contains(t, result.Answer, "番茄牛腩饭")
}

func TestFallbackPutsTheAskedTasteFirst(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Question = "能不能来点辣的"
	plain, spicy := DietRecommendationCandidate{Title: "鲜肉小笼包"}, DietRecommendationCandidate{Title: "香辣鸡腿饭"}
	assert.Greater(t, mealTasteMatch(state.Question, spicy), mealTasteMatch(state.Question, plain))
	assert.Zero(t, mealTasteMatch("不要辣的", spicy), "not asking for it is not asking for it")
}
