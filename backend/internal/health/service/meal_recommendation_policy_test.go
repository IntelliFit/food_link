package service

import (
	"context"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMealPolicyLocationOrStudentIdentityDoesNotGrantAccess(t *testing.T) {
	for _, question := range []string{"我在清华附近，晚餐吃什么", "我是清华学生，晚餐吃什么", "我能进清华大学校园"} {
		state := newCampusDietAgentTestState("initial", nil)
		state.Constraints = CampusDietRecommendationConstraints{}
		state.Question = question
		initializeMealAccess(state)
		assert.Empty(t, mealHarnessRank(state, []DietRecommendationCandidate{campusDietAgentTestCandidate("one", "牛肉饭", 500, 30)}))
		require.NotNil(t, state.Constraints.PendingSchool)
		assert.Contains(t, mealHarnessEmptyResult(state, "empty").Answer, "可以在清华大学食堂吃饭吗")
		assert.Empty(t, state.Constraints.AllowedSchoolIDs)
	}
}

func TestMealPolicyFoodNegationDoesNotDenyCampusAndPrefixRelease(t *testing.T) {
	state := newCampusDietAgentTestState("refine", nil)
	state.Question = "不吃虾，在食堂吃饭"
	initializeMealAccess(state)
	assert.False(t, state.Constraints.CampusAccessDenied)
	assert.NotEmpty(t, state.Constraints.AllowedSchoolIDs)
	state.Constraints.AvoidFoods = []string{"虾", "花生"}
	applyMealFoodConstraints(&state.Constraints, "虾今天可以吃了，但花生还是不吃，请确认限制")
	assert.Equal(t, []string{"花生"}, state.Constraints.AvoidFoods)
	pending := domain.DietRecommendationSchool{ID: "another-school", Name: "另一大学"}
	state.Constraints.PendingSchool = &pending
	state.Question = "可以"
	initializeMealAccess(state)
	assert.Equal(t, []string{"another-school"}, state.Constraints.AllowedSchoolIDs)
}

func TestMealPolicyConfirmationAppliesOnlyToSpecificCampus(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	pending := state.School
	state.Constraints = CampusDietRecommendationConstraints{PendingSchool: &pending}
	state.School = domain.DietRecommendationSchool{}
	state.Question = "可以"
	initializeMealAccess(state)
	assert.Equal(t, []string{"school-tsinghua"}, state.Constraints.AllowedSchoolIDs)
	assert.Nil(t, state.Constraints.PendingSchool)
	other := campusDietAgentTestCandidate("other", "牛肉饭", 500, 30)
	other.SchoolID, other.SchoolName = "another-school", "其他大学"
	assert.Empty(t, mealHarnessRank(state, []DietRecommendationCandidate{other}))
	state.Question = "不能进学校，只看校外商家"
	initializeMealAccess(state)
	assert.Empty(t, state.Constraints.AllowedSchoolIDs)
	assert.True(t, state.Constraints.CampusAccessDenied)
}

func TestMealPolicyNegationPartialReleaseAndNoModelScopeDrift(t *testing.T) {
	c := resolveCampusDietAgentConstraints(nil, nil, "不要学校食堂，只看外卖商家，不吃花生和虾，预算25元以内")
	assert.Equal(t, "takeout", c.Scene)
	assert.ElementsMatch(t, []string{"花生", "虾"}, c.AvoidFoods)
	applyCampusDietAgentQuestionConstraints(&c, "今天可以吃虾了，但仍然不吃花生，预算还是25元")
	assert.Equal(t, []string{"花生"}, c.AvoidFoods)
	applyCampusDietAgentQuestionConstraints(&c, "预算和忌口保持不变")
	assert.Equal(t, []string{"花生"}, c.AvoidFoods)
	applyCampusDietAgentQuestionConstraints(&c, "不要换菜，也不要只给通用建议")
	assert.Equal(t, []string{"花生"}, c.AvoidFoods)
	applyCampusDietAgentQuestionConstraints(&c, "确认一下，没查到的地址和菜品不要编")
	assert.Equal(t, []string{"花生"}, c.AvoidFoods)
	state := newCampusDietAgentTestState("refine", nil)
	state.Question = "换一批，清淡一点"
	state.Constraints.Scene = "any"
	_, err := mealHarnessPreferences(state, `{"scene":"takeout","radius_km":1,"avoid_foods":["牛肉","花生","油炸"]}`)
	require.NoError(t, err)
	assert.Equal(t, "any", state.Constraints.Scene)
	assert.Zero(t, state.Constraints.RadiusKM)
	assert.Empty(t, state.Constraints.AvoidFoods)
}

func TestMealPolicyRelocationClearsAccessButKeepsMealNeeds(t *testing.T) {
	state := newCampusDietAgentTestState("refine", nil)
	budget := 20.0
	state.Constraints.MaxPrice = &budget
	state.Constraints.AvoidFoods = []string{"花生"}
	state.Question = "我在外地了，前面的预算忌口不变"
	initializeMealAccess(state)
	assert.Empty(t, state.Constraints.AllowedSchoolIDs)
	assert.Equal(t, []string{"花生"}, state.Constraints.AvoidFoods)
	assert.Equal(t, 20.0, *state.Constraints.MaxPrice)
	c := resolveCampusDietAgentConstraints(nil, nil, "我今天在外地，不在常用学校。附近午餐吃什么？")
	assert.NotEqual(t, "takeout", c.Scene, "离开常用学校不是拒绝所有学校的食堂")
	state.Constraints = c
	state.Question = "我今天在外地，不在常用学校。附近午餐吃什么？"
	initializeMealAccess(state)
	assert.False(t, state.Constraints.CampusAccessDenied)
}

func TestMealPolicySearchHeuristicsDoNotBecomeUserHardLimits(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	svc := NewStatsService(&mockStatsRepo{}, nil)
	_, err := svc.executeCampusDietSearchTool(context.Background(), state, `{"min_protein":25,"max_calories":500,"max_price":10}`)
	require.NoError(t, err)
	assert.Nil(t, state.Constraints.MinProtein)
	assert.Nil(t, state.Constraints.MaxCalories)
	assert.Nil(t, state.Constraints.MaxPrice)
}

func TestMealPolicyHistoryEvidenceRetainedAndUnsupportedClaimsRemoved(t *testing.T) {
	state := newCampusDietAgentTestState("explain", nil)
	state.PersonalContext = mealPersonalContext{RecordedDays: 29, RecordCount: 175, FoodFrequency: []mealFoodFrequency{{Name: "荞麦面", Count: 45}, {Name: "鸡胸肉", Count: 44}}}
	assert.Contains(t, mealHistoryExplanation(state), "荞麦面 45 条")
	assert.Contains(t, mealHistoryExplanation(state), "不代表全部实际摄入")
	text := mealEvidenceText(state, "你想换一种口味。预算保持不变。仍然保留忌口。鱼肉完美契合你的胃部情况。今天午餐还基本空着。")
	assert.Contains(t, text, "仍然保留忌口")
	assert.NotContains(t, text, "完美契合")
	assert.NotContains(t, text, "空着")
}

func TestMealPolicyTwoYuanSideDishCannotBecomeFullLunch(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints.CompleteMeal = true
	c := campusDietAgentTestCandidate("tofu", "油豆皮", 380, 34)
	c.Price = 2
	state.Candidates[c.SourceID] = c
	state.LastSearch = []DietRecommendationCandidate{c}
	_, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: c.SourceID}}}, true, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "单菜")
}

func TestMealPolicyComposeMealBudgetAndSameVenueAndFollowup(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	state.Constraints.CompleteMeal = true
	budget := 20.0
	state.Constraints.MaxPrice = &budget
	minimum := 25.0
	state.Constraints.MinProtein = &minimum
	meat := campusDietAgentTestCandidate("meat", "蒸鸡肉", 210, 30)
	meat.Price, meat.Carbs = 12, 0
	rice := campusDietAgentTestCandidate("rice", "米饭", 230, 4)
	rice.Price, rice.Carbs = 2, 50
	state.Candidates[meat.SourceID], state.Candidates[rice.SourceID] = meat, rice
	output, err := composeMealTool(state, `{"source_ids":["meat","rice"]}`)
	require.NoError(t, err)
	id := output["meal_id"].(string)
	plan := state.Candidates[id]
	assert.Equal(t, 14.0, plan.Price)
	assert.Equal(t, 440.0, plan.Calories)
	assert.Len(t, plan.Items, 2)
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: id}}}, true, "")
	require.NoError(t, err)
	assert.Len(t, result.Recommendation.Recommendations[0].MealComponents, 2)
	followup := newCampusDietAgentTestState("location", &result.Recommendation)
	followup.MealContextLoaded = true
	svc := NewStatsService(&mockStatsRepo{candidates: []domain.DietRecommendationCandidate{meat, rice}}, nil)
	_, err = svc.executeCampusDietDetailsTool(context.Background(), followup, `{"source_ids":["`+id+`"]}`, false)
	require.NoError(t, err)
	assert.Equal(t, 14.0, followup.Candidates[id].Price)
	locationResult, err := buildCampusDietAgentResult(followup, campusDietAgentFinal{}, true, "")
	require.NoError(t, err)
	assert.Contains(t, locationResult.Answer, "米饭：")
	assert.Contains(t, locationResult.Answer, "蒸鸡肉：")
	budget = 13
	_, err = registerMealPlan(state, []DietRecommendationCandidate{meat, rice})
	require.Error(t, err)
	budget = 20
	rice.CanteenName = "另外食堂"
	_, err = registerMealPlan(state, []DietRecommendationCandidate{meat, rice})
	require.Error(t, err)
	rice.CanteenName = meat.CanteenName
	rice.PriceUnit = "元/两"
	_, err = registerMealPlan(state, []DietRecommendationCandidate{meat, rice})
	require.Error(t, err)
}

func TestMealPolicySeafoodIncludesFishRoeAndNoSafetyPromise(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContext.Allergies = []string{"海鲜"}
	c := campusDietAgentTestCandidate("fish-roe", "鱼子牛肉饭", 500, 30)
	assert.Empty(t, mealHarnessRank(state, []DietRecommendationCandidate{c}))
	assert.Empty(t, mealEvidenceText(state, "以上选项均避开了海鲜，满足你的忌口要求"))
	assert.Empty(t, mealEvidenceText(state, "已确认忌口为花生，虾可食用"))
	assert.Empty(t, mealEvidenceText(state, "结合你的胃炎病史，推荐这些易消化的一餐。任选其一即可满足训练后需求。"))
	state.MealContext.Allergies = []string{"spicy"}
	assert.Empty(t, mealHarnessRank(state, []DietRecommendationCandidate{campusDietAgentTestCandidate("spicy-duck", "麻辣鸭脯炒饭", 550, 30)}))
	assert.True(t, mealAvoidFoodMatches("鸡肉", "东江盐焗鸡饭"))
	assert.False(t, mealAvoidFoodMatches("鸡肉", "鸡蛋炒饭"))
	assert.Equal(t, "refine", campusDietAgentIntent("虾今天可以吃了，但花生还是不吃，请确认限制并重新推荐。", &DietRecommendationResult{}))
}

func TestMealPolicyEmptyFallbackStillConfirmsRetainedConstraints(t *testing.T) {
	state := newCampusDietAgentTestState("refine", nil)
	state.Question = "请确认花生的限制保持"
	state.Constraints.AvoidFoods = []string{"花生"}
	state.MealContext.Allergies = []string{"海鲜"}
	result := mealHarnessEmptyResult(state, "invalid_model_selection")
	assert.Contains(t, result.Answer, "仍保留本餐忌口：花生")
	assert.Contains(t, result.Answer, "海鲜")
}

func TestMealPolicyKeepingBudgetDoesNotReplaceNutritionGoal(t *testing.T) {
	c := CampusDietRecommendationConstraints{Goal: "muscle_gain"}
	applyCampusDietAgentQuestionConstraints(&c, "换一批，预算和忌口保持不变")
	assert.Equal(t, "muscle_gain", c.Goal)
	applyCampusDietAgentQuestionConstraints(&c, "接下来想维持体重")
	assert.Equal(t, "maintain", c.Goal)
}

func TestMealPolicyConfirmedCampusScopeDoesNotAskForAnotherNearbySchool(t *testing.T) {
	state := newCampusDietAgentTestState("refine", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Constraints.Scene = "campus"
	state.MealContextLoaded = true
	repo := &mockStatsRepo{}
	_, err := NewStatsService(repo, nil).executeCampusDietSearchTool(context.Background(), state, `{}`)
	require.NoError(t, err)
	require.NotEmpty(t, repo.campusSearchFilters)
	assert.Equal(t, "school-tsinghua", repo.campusSearchFilters[0].SchoolID)
}

func TestMealPolicySchoolIdentityDoesNotOverrideGPSAndUnknownDetailsNeverReachSQL(t *testing.T) {
	assert.Equal(t, "上海", mealExplicitPlaceText("我是清华大学学生，但我现在在上海"))
	assert.Equal(t, "清华大学食堂吃饭", mealExplicitPlaceText("我可以在清华大学食堂吃饭"))
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	repo := &mockStatsRepo{}
	_, err := NewStatsService(repo, nil).executeCampusDietDetailsTool(context.Background(), state, `{"source_ids":["meal:invented"]}`, false)
	require.Error(t, err)
	assert.Empty(t, repo.campusSearchFilters)
}

func TestMealPolicySyntheticMealIDsNeverEnterDatabaseExclusions(t *testing.T) {
	assert.Equal(t, []string{"food-one"}, mealOriginalSourceIDs([]string{"meal:abc", "food-one", "meal:def"}))
	for _, intent := range []string{"more", "refine"} {
		state := newCampusDietAgentTestState(intent, nil)
		state.MealContextLoaded = true
		state.ExcludedSourceIDs = []string{"meal:abc", "old-food"}
		state.ActiveSourceIDs = state.ExcludedSourceIDs
		repo := &mockStatsRepo{}
		svc := NewStatsService(repo, nil)
		_, err := svc.executeCampusDietSearchTool(context.Background(), state, `{}`)
		require.NoError(t, err)
		require.NotEmpty(t, repo.campusSearchFilters)
		for _, filter := range repo.campusSearchFilters {
			assert.NotContains(t, filter.ExcludeSourceIDs, "meal:abc")
		}
	}
}

func TestMealPolicyFallbackKeepsValidFullMealInsteadOfFailingOnSideDish(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	state.Constraints.CompleteMeal = true
	side := campusDietAgentTestCandidate("side", "油豆皮", 200, 20)
	meal := campusDietAgentTestCandidate("meal", "牛肉饭", 500, 30)
	state.LastSearch = []DietRecommendationCandidate{side, meal}
	state.Candidates[side.SourceID], state.Candidates[meal.SourceID] = side, meal
	svc := NewStatsService(&mockStatsRepo{}, nil)
	result := svc.campusDietAgentFallback(context.Background(), state, "invalid_model_selection")
	require.Len(t, result.Recommendation.Recommendations, 1)
	assert.Equal(t, "meal", result.Recommendation.Recommendations[0].SourceID)
	assert.False(t, result.AgentUsed)
}

func TestMealPolicyCompositionDoesNotPileTwoFullMealsTogether(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	a := campusDietAgentTestCandidate("noodles", "牛肉面", 600, 30)
	b := campusDietAgentTestCandidate("rice", "牛肉饭", 650, 35)
	a.Price, b.Price = 10, 10
	a.Carbs, b.Carbs = 50, 50
	a.PriceUnit, b.PriceUnit = "元/份", "元/份"
	require.True(t, mealHasStructure(a))
	require.True(t, mealHasStructure(b))
	_, err := registerMealPlan(state, []DietRecommendationCandidate{a, b})
	require.ErrorContains(t, err, "两份完整主餐")
}
