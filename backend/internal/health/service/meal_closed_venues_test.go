package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Review 2026-11-25. Home card, 11-24 20:50 near 清华: every 清华 canteen was left out without a
// word (no hours collected, so the default 20:00 dinner end applied) and 中国农业大学 canteens
// were offered instead. Chat, 03:58 and 00:43: the search found 272 and 286 dishes, all in
// closed canteens, and the answer asked for a location or a school.

func campusDietAgentTestLocation() *domain.DietLocation {
	return &domain.DietLocation{Latitude: 40.0, Longitude: 116.326, AccuracyM: 30, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
}

func closedTestDish(id, school, schoolID, canteen, hours string, km float64) DietRecommendationCandidate {
	c := campusDietAgentTestCandidate(id, "菜-"+id, 480, 28)
	c.SchoolName, c.SchoolID, c.CanteenName, c.OpeningHours = school, schoolID, canteen, hours
	if km > 0 {
		c.DistanceKM = &km
	}
	return c
}

func closedTestState(t *testing.T, clock, meal string) *campusDietAgentRunState {
	state := mealStateAt(t, clock)
	state.IsHomePreview = true
	state.Constraints.MealType, state.MealContext.MealType = meal, meal
	return state
}

func TestClosedCanteensAreSummarisedBySchool(t *testing.T) {
	state := closedTestState(t, "20:50", "dinner")
	own1 := closedTestDish("thu-1", "清华大学", "school-tsinghua", "清芬园", "", 0.7)
	own2 := closedTestDish("thu-2", "清华大学", "school-tsinghua", "紫荆园", "", 1.3)
	open := closedTestDish("cau-1", "中国农业大学", "school-cau", "和园一食堂", "晚17:00-19:00|夜宵19:00-22:00", 3.0)
	known := closedTestDish("pku-1", "北京大学", "school-pku", "家园食堂", "午11:00-13:00|晚17:00-19:00", 1.8)
	merchant := closedTestDish("shop", "", "", "", "", 0.4)
	merchant.IsCampusFood, merchant.MerchantName = false, "牛腩小馆"

	closed := mealClosedVenueSummary(state, []DietRecommendationCandidate{own1, own2, open, known, merchant})
	assert.Equal(t, 3, closed.Dishes)
	require.Len(t, closed.Schools, 2)
	assert.Equal(t, "清华大学", closed.Schools[0].Name, "the user's own school comes first")
	assert.True(t, closed.Schools[0].Own)
	assert.True(t, closed.Schools[0].HoursUnknown)
	assert.Equal(t, 2, closed.Schools[0].Dishes)
	assert.InDelta(t, 0.7, *closed.Schools[0].DistanceKM, 0.001)
	assert.Equal(t, "北京大学", closed.Schools[1].Name)
	assert.False(t, closed.Schools[1].HoursUnknown, "these hours were collected")

	// Nothing closed at lunch time.
	assert.Zero(t, mealClosedVenueSummary(closedTestState(t, "12:10", "lunch"), []DietRecommendationCandidate{own1, known, merchant}).Dishes)
}

func TestCardSaysWhyTheNearestCanteensAreMissing(t *testing.T) {
	state := closedTestState(t, "20:50", "dinner")
	own := closedTestDish("thu-1", "清华大学", "school-tsinghua", "清芬园", "", 0.7)
	open := closedTestDish("cau-1", "中国农业大学", "school-cau", "和园一食堂", "晚17:00-19:00|夜宵19:00-22:00", 3.0)
	closed := mealClosedVenueSummary(state, []DietRecommendationCandidate{own, open})
	notice := mealClosedNotice(state, closed, []DietRecommendationCandidate{open})
	assert.Equal(t, "清华大学的食堂没收录营业时间，按一般食堂 20:00 停晚餐算，这次先不推荐。", notice)

	// Collected hours are stated as a fact, not as an assumption.
	own.OpeningHours = "午11:00-13:00|晚17:00-19:00"
	closed = mealClosedVenueSummary(state, []DietRecommendationCandidate{own, open})
	assert.Equal(t, "清华大学的食堂这个时段不供餐，这次先不推荐。", mealClosedNotice(state, closed, []DietRecommendationCandidate{open}))

	// Another school's closed canteen matters only when it is nearer than what was offered.
	state.School = domain.DietRecommendationSchool{}
	other := closedTestDish("pku-1", "北京大学", "school-pku", "家园食堂", "", 4.5)
	closed = mealClosedVenueSummary(state, []DietRecommendationCandidate{other, open})
	assert.Empty(t, mealClosedNotice(state, closed, []DietRecommendationCandidate{open}))
	near := closedTestDish("pku-2", "北京大学", "school-pku", "家园食堂", "", 0.6)
	closed = mealClosedVenueSummary(state, []DietRecommendationCandidate{near, open})
	assert.Contains(t, mealClosedNotice(state, closed, []DietRecommendationCandidate{open}), "北京大学的食堂没收录营业时间")
	// Nothing closed, nothing to say.
	assert.Empty(t, mealClosedNotice(state, mealClosedVenues{}, []DietRecommendationCandidate{open}))

	// Each meal names its own usual end.
	assert.Contains(t, mealClosedNotice(closedTestState(t, "14:20", "lunch"), mealClosedVenues{Dishes: 1, Schools: []mealClosedSchool{{Name: "清华大学", Own: true, HoursUnknown: true, Dishes: 1}}}, nil), "13:30 停午餐")
	assert.Contains(t, mealClosedNotice(closedTestState(t, "23:10", "evening_snack"), mealClosedVenues{Dishes: 1, Schools: []mealClosedSchool{{Name: "清华大学", Own: true, HoursUnknown: true, Dishes: 1}}}, nil), "不供夜宵")
}

func TestNightChatSaysCanteensAreClosedInsteadOfAskingForALocation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeCampusDietAgentTestFinal(t, w, map[string]any{"needs_clarification": true, "answer": "当前未指定具体学校且无定位，无法检索到符合完整一餐要求的菜品。", "selections": []any{}})
	}))
	defer server.Close()
	candidates := campusDietAgentTestCandidates(4)
	repo := &mockStatsRepo{candidates: candidates}
	state := newCampusDietAgentTestState("initial", nil)
	at, err := time.ParseInLocation("2006-01-02 15:04", "2026-11-23 03:58", chinaTZ)
	require.NoError(t, err)
	state.AsOf, state.Question = at, "今天吃什么"

	result := newCampusDietAgentTestService(repo, server.URL).runCampusDietAgent(context.Background(), state)
	assert.Empty(t, result.Recommendation.Recommendations)
	assert.Contains(t, result.Answer, "现在 03:58")
	assert.Contains(t, result.Answer, "清华大学的食堂")
	assert.Contains(t, result.Answer, "不供餐")
	assert.Contains(t, result.Answer, "早餐吃什么", "says what can be asked next")
	assert.NotContains(t, result.Answer, "未指定具体学校")
	assert.NotContains(t, result.Answer, "无定位")
	assert.Equal(t, result.Answer, result.Recommendation.Summary)
	assert.Equal(t, 4, state.ClosedVenues.Dishes)
}

func TestClosedAnswerPointsToTheNextMeal(t *testing.T) {
	closed := mealClosedVenues{Dishes: 3, Schools: []mealClosedSchool{{Name: "清华大学", Own: true, HoursUnknown: true, Dishes: 3}}}
	answer := func(clock, meal string, located bool) string {
		state := mealStateAt(t, clock)
		state.Constraints.MealType, state.MealContext.MealType = meal, meal
		state.SearchAttempted, state.ClosedVenues = true, closed
		if located {
			state.Location = campusDietAgentTestLocation()
		}
		return mealClosedNowAnswer(state)
	}
	night := answer("00:43", "evening_snack", false)
	assert.Contains(t, night, "现在 00:43，清华大学的食堂还没收录营业时间，按一般食堂这个点不供餐。")
	assert.Contains(t, night, "使用当前位置")
	assert.Contains(t, night, "「早餐吃什么」")
	assert.Contains(t, answer("14:20", "lunch", false), "「晚餐吃什么」")
	assert.Contains(t, answer("21:30", "evening_snack", false), "「早餐吃什么」")
	located := answer("00:43", "evening_snack", true)
	assert.NotContains(t, located, "使用当前位置", "the location is already known")
	assert.Contains(t, located, "附近也没有收录到这个点能吃的店")

	// With collected hours the closure is a fact.
	known := mealStateAt(t, "00:43")
	known.SearchAttempted = true
	known.ClosedVenues = mealClosedVenues{Dishes: 2, Schools: []mealClosedSchool{{Name: "中国农业大学", Dishes: 2}}}
	assert.Contains(t, mealClosedNowAnswer(known), "现在 00:43，中国农业大学的食堂这个点不供餐。")
	// A feasible choice, or no closed dish, leaves the ordinary answers in place.
	open := mealStateAt(t, "12:10")
	open.SearchAttempted = true
	assert.Empty(t, mealClosedNowAnswer(open))
}

func TestChatOptionsCarryTheNoticeAboutTheUsersOwnCanteens(t *testing.T) {
	at, err := time.ParseInLocation("2006-01-02 15:04", "2026-11-24 20:50", chinaTZ)
	require.NoError(t, err)
	own := closedTestDish("thu-1", "清华大学", "school-tsinghua", "清芬园", "", 0.7)
	shop := closedTestDish("shop-1", "", "", "", "", 0.9)
	shop.Title, shop.IsCampusFood, shop.MerchantName, shop.Address, shop.Carbs = "皮蛋瘦肉粥", false, "嘉和一品(清华店)", "成府路 1 号", 60
	shop.Items = []domain.DietRecommendationFoodItem{{Name: "皮蛋瘦肉粥", Amount: "1份", Source: "public_food_library", SourceID: "shop-1"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "这家离你最近，粥也清淡。", "selections": []map[string]any{{"source_id": "shop-1"}}})
	}))
	defer server.Close()
	state := newCampusDietAgentTestState("initial", nil)
	state.AsOf, state.Question = at, "晚上吃什么"
	state.Location = campusDietAgentTestLocation() // the Agent checks the location against the real clock
	result := newCampusDietAgentTestService(&mockStatsRepo{candidates: []domain.DietRecommendationCandidate{own, shop}}, server.URL).runCampusDietAgent(context.Background(), state)
	require.NotEmpty(t, result.Recommendation.Recommendations, result.Answer)
	assert.Equal(t, "shop-1", result.Recommendation.Recommendations[0].SourceID)
	assert.Equal(t, "清华大学的食堂没收录营业时间，按一般食堂 20:00 停晚餐算，这次先不推荐。", result.Recommendation.VenueNotice)
}
