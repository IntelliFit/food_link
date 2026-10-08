package service

import (
	"context"
	"fmt"
	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestMealReleaseRoutingSeparatesPreferencesFromIntake(t *testing.T) {
	previous := DietRecommendationResult{HarnessVersion: mealHarnessVersion, SearchScope: "nearby"}
	repo := &mockStatsRepo{petChatMessages: []domain.PetChatMessage{{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": previous}}}}
	svc := NewStatsService(repo, nil)
	for _, q := range []string{"附近有什么适合我的晚餐？这餐不吃花生，也不吃虾，预算25元以内。", "今天不吃鸡肉，预算20元以内。", "这一餐想吃面，不要米饭", "那预算提高到20元，午餐帮我重新选，其他要求不变。"} {
		t.Run(q, func(t *testing.T) {
			require.False(t, dietRecordQuestion(q))
			require.True(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: q, SessionID: "s"}))
		})
	}
	for _, q := range []string{"昨天午餐吃了什么？", "今天摄入了多少蛋白质", "你能读取刚刚那一餐的饮食记录吗？", "不要推荐食堂，只核对我今天午餐吃的记录", "今天记录里没有鸡肉吗？"} {
		t.Run(q, func(t *testing.T) {
			require.True(t, dietRecordQuestion(q))
			require.False(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: q, SessionID: "s"}))
		})
	}
	require.True(t, svc.shouldUseCampusDietAgent(context.Background(), "u", PetChatInput{Question: "附近有什么适合我的晚餐？这餐不吃花生，也不吃虾，预算25元以内。"}))
}

func TestMealReleaseBudgetNaturalRefinement(t *testing.T) {
	require.Equal(t, 2, mealExplicitOptionCount("预算提高到30元，换两份选择，还是在北大"))
	require.Equal(t, 2, mealExplicitOptionCount("换 2 个"))
	require.Equal(t, 3, mealExplicitOptionCount("换三种选择"))
	require.Zero(t, mealExplicitOptionCount("这套餐有两个鸡蛋吗"))
	previous := &DietRecommendationResult{HarnessVersion: mealHarnessVersion}
	require.Equal(t, "explain", campusDietAgentIntent("为什么这次适合我？请确认没有把花生的限制也取消。", previous))
	require.Equal(t, "refine", campusDietAgentIntent("请确认没有把花生的限制也取消，预算提高到30元，重新推荐。", previous))
	for q, want := range map[string]float64{"我的预算只有2元，希望一餐能吃饱": 2, "那预算提高到20元，午餐帮我重新选": 20, "预算改成18.5元": 18.5, "预算就只有 12 元": 12, "预算降低到8元": 8, "预算还是25元": 25, "不超过￥30": 30} {
		got := campusDietAgentExplicitPriceLimit(q)
		require.NotNil(t, got, q)
		require.Equal(t, want, *got, q)
	}
	require.Nil(t, campusDietAgentExplicitPriceLimit("豆皮5元、水饺4元，为什么只要9元"))
	c := resolveCampusDietAgentConstraints(nil, nil, "午餐预算只有2元，不吃花生，要完整一餐")
	require.NotNil(t, c.MaxPrice)
	require.Equal(t, 2.0, *c.MaxPrice)
	applyCampusDietAgentQuestionConstraints(&c, "预算提高到20元，其他要求不变")
	require.Equal(t, 20.0, *c.MaxPrice)
	require.Contains(t, c.AvoidFoods, "花生")
}

func TestMealReleasePriceUnitAndDaypartEvidence(t *testing.T) {
	c := campusDietAgentTestCandidate("dumpling", "鲜椒酱肉煎饺", 489, 20)
	c.Price = 2
	c.PriceUnit = ""
	require.False(t, mealKnownServing(c))
	require.NotEmpty(t, mealOrderingRisk(c))
	require.False(t, mealHasEvidenceStructure(c))
	for _, unit := range []string{"元/个", "元/两", "元/100g", "kg", "", "元"} {
		c.PriceUnit = unit
		require.False(t, mealKnownServing(c), unit)
	}
	for _, unit := range []string{"元/份", "份", "元/碗", "每份", "元/餐"} {
		c.PriceUnit = unit
		require.True(t, mealKnownServing(c), unit)
	}
	state := newCampusDietAgentTestState("initial", nil)
	state.Constraints.MealType = "lunch"
	c = campusDietAgentTestCandidate("rice", "芥兰炒饭（早餐）", 413, 15)
	c.Price = 0.7
	c.PriceUnit = "元/份"
	require.False(t, groundedMealAllowed(state, c))
	state.Constraints.MealType = "breakfast"
	require.True(t, groundedMealAllowed(state, c))
	c.Title = "芥兰炒饭"
	state.Constraints.MealType = "lunch"
	require.True(t, groundedMealAllowed(state, c), "不设置武断低价门槛")
}

type mealReleaseWindowRepo struct {
	*mockStatsRepo
	filters []domain.CampusDietSearchFilter
	menus   []DietRecommendationCandidate
	missing bool
}

func (r *mealReleaseWindowRepo) SearchCampusDietCandidates(_ context.Context, f domain.CampusDietSearchFilter) ([]DietRecommendationCandidate, int64, error) {
	r.filters = append(r.filters, f)
	total := int64(len(r.menus))
	if r.missing {
		total++
	}
	rows := make([]DietRecommendationCandidate, 0, f.Limit)
	for _, c := range r.menus {
		if c.SourceID > f.AfterID {
			rows = append(rows, c)
			if len(rows) == f.Limit {
				break
			}
		}
	}
	return rows, total, nil
}

func TestMealReleaseFullCatalogSearchesOtherWindows(t *testing.T) {
	// The first 100-row page has no eligible meal. A valid other-window meal
	// must still be found on the second page without dropping hard constraints.
	menus := make([]DietRecommendationCandidate, 0, 180)
	for i := 0; i < 177; i++ {
		c := campusDietAgentTestCandidate(fmt.Sprintf("menu-%03d", i), "火锅豆皮", 120, 8)
		c.Price, c.WindowName = 4, "火锅窗口"
		menus = append(menus, c)
	}
	noodles := campusDietAgentTestCandidate("menu-177", "牛肉面", 480, 23)
	noodles.Price = 18
	noodles.WindowName = "面食窗口"
	peanut := noodles
	peanut.SourceID, peanut.Title = "menu-178", "花生拌面"
	expensive := noodles
	expensive.SourceID, expensive.Price = "menu-179", 35
	menus = append(menus, noodles, peanut, expensive)
	repo := &mealReleaseWindowRepo{mockStatsRepo: &mockStatsRepo{}, menus: menus}
	state := newCampusDietAgentTestState("initial", nil)
	budget := 25.0
	state.Constraints = CampusDietRecommendationConstraints{Scene: "campus", CompleteMeal: true, MaxPrice: &budget, AvoidFoods: []string{"火锅", "花生"}, CanteenName: "紫荆园"}
	svc := NewStatsService(repo, nil)
	result, err := svc.executeCampusDietSearchTool(context.Background(), state, `{"sort_by":"lowest_price"}`, "search_campus_foods")
	require.NoError(t, err)
	require.Len(t, repo.filters, 2)
	for _, f := range repo.filters {
		require.True(t, f.ScanCatalog)
		require.Equal(t, 100, f.Limit)
		require.Equal(t, state.School.ID, f.SchoolID)
		require.Equal(t, "紫荆园", f.CanteenName)
		require.Equal(t, &budget, f.MaxPrice)
		require.True(t, f.CampusOnly)
	}
	require.Empty(t, repo.filters[0].AfterID)
	require.Equal(t, "menu-099", repo.filters[1].AfterID)
	require.Equal(t, false, result["supplementary_window_search"])
	require.Equal(t, int64(180), result["total_matches"])
	require.Len(t, state.CatalogCoverage, 1)
	require.Equal(t, "complete", state.CatalogCoverage[0].Status)
	require.Equal(t, 180, state.CatalogCoverage[0].Retrieved)
	require.Len(t, state.LastSearch, 1)
	require.Equal(t, noodles.SourceID, state.LastSearch[0].SourceID)
	require.Equal(t, "面食窗口", state.LastSearch[0].WindowName)
	require.Equal(t, []string{"火锅", "花生"}, state.Constraints.AvoidFoods)

	t.Run("incomplete catalog fails closed", func(t *testing.T) {
		repo.missing = true
		incomplete := newCampusDietAgentTestState("initial", nil)
		incomplete.Constraints = state.Constraints
		_, err := svc.executeCampusDietSearchTool(context.Background(), incomplete, `{"sort_by":"lowest_price"}`, "search_campus_foods")
		require.ErrorContains(t, err, "目录扫描未完整：已读取180/181条")
		require.Empty(t, incomplete.LastSearch)
		require.Len(t, incomplete.CatalogCoverage, 1)
		require.Equal(t, "partial_catalog_changed", incomplete.CatalogCoverage[0].Status)
	})
}

func TestMealReleaseProseDoesNotGuaranteeAllergenSafety(t *testing.T) {
	state := newCampusDietAgentTestState("explain", nil)
	answer := mealEvidenceText(state, "花生限制仍保留。推荐的饺子不含上述忌口食材且符合预算。根据你近期未摄入鱼类的情况调整。")
	require.Contains(t, answer, "花生限制仍保留")
	require.NotContains(t, answer, "不含上述")
	require.NotContains(t, answer, "近期未摄入")
	require.Contains(t, answer, "近期记录中未见")
}
