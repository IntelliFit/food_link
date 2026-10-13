package service

import (
	"context"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/require"
)

var mealVenueScreenshotQuestions = []string{
	"你就不能只推荐AI原点社区的吗 我现在已经决定去这里吃了",
	"我现在在清华大学桃李食堂 你给我推荐一下这个食堂有什么好吃的？",
	"我不在AI原点社区的食堂，我在清华大学桃李食堂",
	"其他的呢",
}

func TestMealVenueTransitionScreenshotConstraints(t *testing.T) {
	var active *DietRecommendationResult
	var history []domain.PetChatMessage
	for i, q := range mealVenueScreenshotQuestions {
		c := resolveCampusDietAgentConstraints(history, active, q)
		want := "清华大学桃李食堂"
		if i == 0 {
			want = "AI原点社区"
		}
		require.Equal(t, want, c.CanteenName, q)
		require.True(t, c.CompleteMeal)
		active = &DietRecommendationResult{AgentConstraints: &c}
		history = append(history, domain.PetChatMessage{Role: "user", Content: q})
	}
	c := resolveCampusDietAgentConstraints(history, active, "推荐其他食堂")
	require.Empty(t, c.CanteenName)
	require.Contains(t, c.ExcludedCanteens, "清华大学桃李食堂")
	active.AgentConstraints = &c
	c = resolveCampusDietAgentConstraints(nil, active, "还是去清华大学桃李食堂，我现在在清华大学桃李食堂")
	require.Equal(t, "清华大学桃李食堂", c.CanteenName)
	require.Empty(t, c.ExcludedCanteens)
}

func TestMealVenueTransitionLegacyTextStillQueriesAndTopicSwitchStops(t *testing.T) {
	r := &mockStatsRepo{}
	svc := NewStatsService(r, nil)
	for _, q := range mealVenueScreenshotQuestions {
		require.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: q, SessionID: "s"}), q)
		r.petChatMessages = append(r.petChatMessages,
			domain.PetChatMessage{Role: "user", Content: q},
			domain.PetChatMessage{Role: "assistant", MessageType: "analysis", Content: "系统中只有荞麦面和燕麦粥"})
	}
	for _, q := range []string{"我想洗澡，热水还是冷水？", "不一定是饮食，其他的通用建议也可以"} {
		require.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: q, SessionID: "s"}), q)
	}
	r.petChatMessages = append(r.petChatMessages, domain.PetChatMessage{Role: "user", Content: "我想洗澡，热水还是冷水？"})
	require.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "其他的呢", SessionID: "s"}))
}

func TestMealVenueTransitionNegationAndScopeGuard(t *testing.T) {
	for _, q := range []string{"不要推荐其他食堂", "不是让你推荐其他食堂", "不用换个食堂"} {
		require.False(t, mealRequestsOtherVenue(q), q)
	}
	for _, q := range []string{"推荐其他食堂", "其他食堂呢", "换个食堂"} {
		require.True(t, mealRequestsOtherVenue(q), q)
	}
	require.Empty(t, mealExplicitVenue("我住在AI原点社区附近"))
	require.Empty(t, mealExplicitVenue("不要只推荐AI原点社区食堂"))
	state := newCampusDietAgentTestState("refine", nil)
	state.Question = mealVenueScreenshotQuestions[2]
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, state.Question)
	_, err := applyMealRequirementUpdates(state, `{"updates":[{"field":"canteen_name","action":"set","value":"AI原点社区","evidence":"我不在AI原点社区的食堂"}]}`)
	require.NoError(t, err)
	require.Equal(t, "清华大学桃李食堂", state.Constraints.CanteenName)
	c := campusDietAgentTestCandidate("a", "牛肉饭", 550, 30)
	c.CanteenName = "桃李园"
	require.True(t, mealMatchesVenue(state, c))
	c.SchoolName = "另一所大学"
	require.False(t, mealMatchesVenue(state, c))
	c.SchoolName = "清华大学"
	applyMealVenueConstraints(&state.Constraints, "推荐其他食堂")
	require.False(t, mealMatchesVenue(state, c))
	c.CanteenName = "紫荆园"
	require.True(t, mealMatchesVenue(state, c))
}

func TestMealVenueTransitionLiveDiscoveredSideIsNotMeal(t *testing.T) {
	c := campusDietAgentTestCandidate("corn-side", "玉米粒炒肉末", 450, 25)
	require.False(t, mealHasEvidenceStructure(c), "a carb-containing side is not an included staple serving")
	c.Title = "玉米炒鸡丁"
	c.Items[0].Name = c.Title
	require.False(t, mealHasEvidenceStructure(c))
	c.Title = "玉米 + 蒸鸡肉"
	c.Items[0].Name = c.Title
	require.True(t, mealHasEvidenceStructure(c), "separate verified servings remain composable")
}

func TestMealVenueTransitionOtherDishesRejectDuplicateCatalogIDs(t *testing.T) {
	active := &DietRecommendationResult{Recommendations: []DietRecommendationOption{{SourceID: "old", Title: "牛肉饼"}}}
	state := newCampusDietAgentTestState("more", active)
	c := campusDietAgentTestCandidate("duplicate", "牛肉饼", 350, 20)
	require.True(t, mealIsMoreRepeat(state, c))
	require.Empty(t, mealFeasibleChoices(state, []DietRecommendationCandidate{c}))
	state.Intent = "facts"
	require.False(t, mealIsMoreRepeat(state, c), "factual questions may refer to previous dishes")
	state.Intent, state.ActiveResult = "initial", nil
	require.False(t, mealIsMoreRepeat(state, c), "an explicit new destination can serve the same dish")
}
