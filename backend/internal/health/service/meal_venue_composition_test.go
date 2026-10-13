package service

import (
	"context"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/require"
)

func TestMealVenueScreenshotRequirementsAndFollowups(t *testing.T) {
	q := "请你给我推荐方圆3公里内的餐食"
	c := resolveCampusDietAgentConstraints(nil, nil, q)
	require.True(t, c.CompleteMeal)
	require.Equal(t, 3.0, c.RadiusKM)
	active := &DietRecommendationResult{AgentConstraints: &c}
	q = "你就不能只推荐AI原点社区的吗 我现在已经决定去这里吃了"
	svc := NewStatsService(&mockStatsRepo{}, nil)
	require.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: q}))
	require.Equal(t, "refine", campusDietAgentIntent(q, active))
	c = resolveCampusDietAgentConstraints(nil, active, q)
	require.Equal(t, "AI原点社区", c.CanteenName)
	require.Equal(t, "any", c.Scene)
	active.AgentConstraints = &c
	c = resolveCampusDietAgentConstraints(nil, active, "换一份，不吃鸡肉")
	require.Equal(t, "AI原点社区", c.CanteenName)
	require.Contains(t, c.AvoidFoods, "鸡肉")
	active.AgentConstraints = &c
	c = resolveCampusDietAgentConstraints(nil, active, "不限制热量，其他不变，不要推荐其他食堂")
	require.Equal(t, "AI原点社区", c.CanteenName)
	active.AgentConstraints = &c
	c = resolveCampusDietAgentConstraints(nil, active, "不限地点了，附近都可以")
	require.Empty(t, c.CanteenName)
	require.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "我想洗澡，热水还是冷水？"}))
	require.Empty(t, mealExplicitVenue("我住在AI原点社区附近"))
	require.Equal(t, "麦当劳", mealExplicitVenue("我决定去麦当劳吃饭了"))
	require.Equal(t, "refine", campusDietAgentIntent("为什么不能只推荐AI原点社区的餐食", active))
	require.True(t, campusDietAgentContextualQuestion("不限地点了，附近都可以"))
}

func TestMealVenueSingleSideRejectedEvenWithPairingDescription(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, "推荐附近的餐食")
	for _, title := range []string{"金针菇", "胎菊", "兰豆木耳炒山药"} {
		c := campusDietAgentTestCandidate(title, title, 148, 12)
		c.Description = "推荐搭配米饭和鸡肉一起吃"
		state.Candidates[c.SourceID] = c
		state.LastSearch = []DietRecommendationCandidate{c}
		_, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: c.SourceID}}}, true, "")
		require.Error(t, err, title)
	}
	meal := campusDietAgentTestCandidate("meal", "西红柿鸡蛋拌面", 575, 20)
	require.True(t, mealHasEvidenceStructure(meal), "a complete prepared main is still a valid meal")
	// Looking up an old side dish remains a factual query, not a new meal plan.
	state.Intent = "facts"
	_, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: "金针菇"}}}, true, "")
	require.NoError(t, err)
}

func venueCombinationFixtures() []DietRecommendationCandidate {
	rice := campusDietAgentTestCandidate("rice", "米饭", 230, 4)
	rice.Price, rice.Carbs, rice.WindowName = 2, 50, "主食窗口"
	meat := campusDietAgentTestCandidate("meat", "蒸鸡肉", 210, 30)
	meat.Price, meat.Carbs, meat.WindowName = 12, 0, "热菜窗口"
	veg := campusDietAgentTestCandidate("veg", "清炒青菜", 70, 2)
	veg.Price, veg.Carbs, veg.WindowName = 4, 8, "素菜窗口"
	rows := []DietRecommendationCandidate{rice, meat, veg}
	for i := range rows {
		rows[i].SchoolID, rows[i].SchoolName = "", "AI原点社区"
		rows[i].CanteenName, rows[i].Floor = "AI原点社区食堂", "B1（负一层）"
	}
	return rows
}

func TestMealVenueCompositionRequiresSameCanteenAndFloor(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	rows := venueCombinationFixtures()
	plan, err := registerMealPlan(state, rows)
	require.NoError(t, err)
	require.Equal(t, 18.0, plan.Price)
	require.Equal(t, 510.0, plan.Calories)
	require.Len(t, plan.Items, 3)
	require.Contains(t, plan.WindowName, "主食窗口")
	require.Contains(t, plan.WindowName, "热菜窗口")
	require.Equal(t, "B1", mealFloorKey("负一层"))
	rows[1].Floor = "2F"
	_, err = registerMealPlan(state, rows)
	require.Error(t, err)
	rows[1].Floor = ""
	_, err = registerMealPlan(state, rows)
	require.Error(t, err)
	rows[1].Floor = "B1"
	rows[1].CanteenName = "其他食堂"
	_, err = registerMealPlan(state, rows)
	require.Error(t, err)
}

func TestMealVenueSearchBuildsWholeMealsAndBlocksScopeEscape(t *testing.T) {
	rows := venueCombinationFixtures()
	other := campusDietAgentTestCandidate("other", "牛肉饭", 500, 35)
	r := &mockStatsRepo{candidates: append(rows, other)}
	svc := NewStatsService(r, nil)
	state := newCampusDietAgentTestState("refine", nil)
	state.Question = "只推荐AI原点社区的餐食"
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, state.Question)
	minProtein, budget := 25.0, 20.0
	state.Constraints.MinProtein, state.Constraints.MaxPrice = &minProtein, &budget
	state.MealContextLoaded = true
	_, err := svc.executeCampusDietSearchTool(context.Background(), state, `{"school_name":"清华大学","min_protein":40}`, "search_campus_foods")
	require.NoError(t, err)
	require.NotEmpty(t, r.campusSearchFilters)
	for _, f := range r.campusSearchFilters {
		require.Empty(t, f.SchoolID)
		require.Equal(t, "AI原点社区", f.CanteenName)
		require.Nil(t, f.MinProtein, "a meal minimum must not remove rice before composition")
	}
	choices := mealFeasibleChoices(state, state.LastSearch)
	require.NotEmpty(t, choices)
	for _, c := range choices {
		require.Equal(t, "meal_plan", c.Source)
		require.True(t, domain.MatchesDiningVenue("AI 原点社区食堂", c))
		require.GreaterOrEqual(t, c.Protein, minProtein)
		require.LessOrEqual(t, c.Price, budget)
	}
	state.Candidates[other.SourceID] = other // simulate a model selecting a stale, out-of-scope ID
	_, err = buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: other.SourceID}}}, true, "")
	require.Error(t, err)
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: choices[0].SourceID}}}, true, "")
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(result.Recommendation.Recommendations[0].MealComponents), 2)
	history := other
	history.Source, history.CanteenName = "food_record", "AI原点社区食堂"
	require.Empty(t, mealHarnessRank(state, []DietRecommendationCandidate{history}))
}

func TestMealVenueInsufficientCatalogKeepsDestination(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, "只在AI原点社区食堂吃")
	state.SearchAttempted = true
	state.LastSearch = venueCombinationFixtures()[:1]
	result := mealHarnessEmptyResult(state, "needs_clarification")
	require.Empty(t, result.Recommendation.Recommendations)
	require.Contains(t, result.Answer, "AI原点社区")
	require.Contains(t, result.Answer, "保留这个地点")
	require.NotContains(t, result.Answer, "愿意调整预算")
}
