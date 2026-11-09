package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 2026-11-04 is a Wednesday.
func mealStateAt(t *testing.T, clock string) *campusDietAgentRunState {
	t.Helper()
	at, err := time.ParseInLocation("2006-01-02 15:04", "2026-11-04 "+clock, chinaTZ)
	require.NoError(t, err)
	state := newCampusDietAgentTestState("initial", nil)
	state.AsOf = at
	state.MealContext.Date = "2026-11-04"
	return state
}

func TestMealEatingWindowFollowsTheClock(t *testing.T) {
	h := func(hour, minute int) int { return hour*60 + minute }
	cases := []struct {
		clock, meal string
		tomorrow    bool
		from, to    int
	}{
		{"15:30", "dinner", false, h(17, 0), h(19, 30)},       // planned ahead
		{"18:00", "dinner", false, h(18, 10), h(19, 30)},      // under way
		{"23:49", "dinner", false, h(23, 59), h(25, 29)},      // eaten late, right now
		{"01:00", "evening_snack", false, h(1, 10), h(2, 40)}, // after midnight
		{"14:00", "lunch", false, h(14, 10), h(15, 40)},       // a late lunch
		{"16:00", "lunch", true, h(11, 0), h(13, 30)},         // lunch is over: tomorrow's
		{"12:00", "breakfast", true, h(7, 0), h(9, 30)},       // breakfast is over: tomorrow's
		{"02:00", "breakfast", false, h(7, 0), h(9, 30)},      // this morning's
		{"21:30", "evening_snack", false, h(21, 40), h(23, 30)},
	}
	for _, c := range cases {
		state := mealStateAt(t, c.clock)
		day, from, to := mealEatingWindow(state, c.meal)
		assert.Equal(t, c.tomorrow, day.Day() == 5, c.clock+" "+c.meal)
		assert.Equal(t, []int{c.from, c.to}, []int{from, to}, c.clock+" "+c.meal)
	}
	state := mealStateAt(t, "23:00")
	state.Question = "明天中午吃什么"
	day, from, _ := mealEatingWindow(state, "lunch")
	assert.Equal(t, 5, day.Day())
	assert.Equal(t, h(11, 0), from)
	state = mealStateAt(t, "23:00")
	state.MealForTomorrow = true
	day, from, _ = mealEatingWindow(state, "breakfast")
	assert.Equal(t, 5, day.Day())
	assert.Equal(t, h(7, 0), from)
}

// The screenshot of 2026-11-03 23:49: the home card offered a 勺园食堂 dinner.
func TestCanteenDishesNeedTheCanteenOpenWhenTheUserWouldEat(t *testing.T) {
	canteen := campusDietAgentTestCandidate("canteen", "金汤小米煮三鲜", 420, 25)
	merchant := campusDietAgentTestCandidate("merchant", "番茄牛腩饭", 520, 28)
	merchant.IsCampusFood, merchant.CanteenName, merchant.WindowName, merchant.MerchantName = false, "", "", "牛腩小馆"
	history := DietRecommendationCandidate{Source: "food_record", SourceID: "r1", Title: "鸡肉饭"}
	at := func(clock, meal string) *campusDietAgentRunState {
		state := mealStateAt(t, clock)
		state.IsHomePreview = true
		state.Constraints.MealType, state.MealContext.MealType = meal, meal
		return state
	}

	night := at("23:49", "dinner")
	assert.Equal(t, "venue_closed_at_meal_time", groundedMealExclusion(night, canteen))
	assert.Empty(t, groundedMealExclusion(night, merchant))
	assert.Empty(t, groundedMealExclusion(night, history))
	assert.Empty(t, groundedMealExclusion(at("12:10", "lunch"), canteen))
	assert.Empty(t, groundedMealExclusion(at("15:30", "dinner"), canteen), "dinner planned ahead")
	assert.Equal(t, "venue_closed_at_meal_time", groundedMealExclusion(at("14:00", "lunch"), canteen), "closed between meals")

	// A canteen's own hours replace the default ones, late-night service included.
	canteen.OpeningHours = "早6:30-10:30|午10:30-13:00|晚16:30-19:00|夜宵19:00-22:00"
	assert.Empty(t, groundedMealExclusion(at("21:30", "evening_snack"), canteen))
	assert.Empty(t, groundedMealExclusion(at("20:30", "dinner"), canteen), "a late dinner at the late-night window")
	assert.Equal(t, "venue_closed_at_meal_time", groundedMealExclusion(at("23:49", "evening_snack"), canteen))
	assert.Equal(t, "venue_closed_at_meal_time", groundedMealExclusion(at("13:00", "lunch"), canteen), "lunch ends at 13:00 here")

	// A canteen the user named stays, with a note; a merchant at night gets one too.
	named := at("23:49", "dinner")
	named.Constraints.CanteenName = "紫荆园"
	rows := []DietRecommendationCandidate{canteen, merchant}
	mealAnnotateServiceHours(named, rows)
	assert.Empty(t, groundedMealExclusion(named, rows[0]))
	assert.Contains(t, rows[0].ServiceNote, "这个时段不供餐")
	assert.Contains(t, rows[1].ServiceNote, "夜里先确认还开着")
	rows = []DietRecommendationCandidate{merchant}
	mealAnnotateServiceHours(at("12:10", "lunch"), rows)
	assert.Empty(t, rows[0].ServiceNote)
}

func TestUnverifiedSupplyAndVenueLowerConfidence(t *testing.T) {
	c := campusDietAgentTestCandidate("dish", "水煮肉片", 590, 30)
	c.AvailabilityStatus = "available"
	_, known := mealEvidenceIssues(c, "lunch")
	c.AvailabilityStatus = "unknown"
	issues, unknown := mealEvidenceIssues(c, "lunch")
	assert.Contains(t, issues, "是否在售待核实，去之前先确认")
	assert.Equal(t, known+2, unknown)
	c.CanteenName = "统一价目表（具体食堂待核）"
	issues, placeholder := mealEvidenceIssues(c, "lunch")
	assert.Contains(t, issues, "具体食堂待核实")
	assert.Greater(t, placeholder, unknown)
}

func TestLateNightIsALightSnack(t *testing.T) {
	at := func(clock string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", "2026-11-04 "+clock, chinaTZ)
		return v
	}
	assert.Equal(t, "evening_snack", inferCampusDietMealType("推荐点吃的", at("22:00")))
	assert.Equal(t, "evening_snack", inferCampusDietMealType("推荐点吃的", at("01:30")))
	assert.Equal(t, "evening_snack", inferCampusDietMealType("夜宵吃什么", at("19:00")))
	assert.Equal(t, "dinner", inferCampusDietMealType("推荐点吃的", at("19:00")))
	assert.Equal(t, "breakfast", inferCampusDietMealType("推荐点吃的", at("07:30")))
	assert.Less(t, dietDecisionMealRatio("evening_snack"), dietDecisionMealRatio("breakfast"))
	assert.True(t, mealDaypartAllowed("evening_snack", DietRecommendationCandidate{Source: "public_food_library", MealPeriods: []string{"dinner", "evening_snack"}}))
	assert.False(t, mealDaypartAllowed("evening_snack", DietRecommendationCandidate{Source: "public_food_library", MealPeriods: []string{"lunch"}}))
}

func TestNightHomeCardOffersTomorrowsBreakfastOrALightSnack(t *testing.T) {
	recordAt := func(clock string, kcal float64) domain.FoodRecord {
		v, _ := time.ParseInLocation("2006-01-02 15:04", "2026-11-04 "+clock, chinaTZ)
		return domain.FoodRecord{ID: clock, UserID: "user-1", RecordTime: &v, MealType: "lunch", TotalCalories: kcal, Items: []map[string]any{{"name": "米饭", "weight": 200.0}}}
	}
	choose := func(clock, requested string, records ...domain.FoodRecord) (*campusDietAgentRunState, *DietRecommendationResult) {
		svc := NewStatsService(&mockStatsRepo{records: records}, nil)
		state := mealStateAt(t, clock)
		state.MealContext = campusDietAgentMealContext{}
		state.IsHomePreview, state.Question = true, "下一餐吃什么"
		state.Constraints.MealType = requested
		note, err := svc.choosePreviewMealTime(context.Background(), state)
		require.NoError(t, err)
		require.NoError(t, svc.loadMealHarnessContext(context.Background(), state))
		result := &DietRecommendationResult{}
		labelPreviewMeal(state, result, note)
		return state, result
	}

	// Already 235 kcal over at 23:49: tomorrow's breakfast, planned on a fresh day.
	full, result := choose("23:49", "dinner", recordAt("12:00", 1300), recordAt("19:00", 1300))
	assert.True(t, full.MealForTomorrow)
	assert.Equal(t, "breakfast", full.MealContext.MealType)
	assert.Equal(t, "2026-11-05", full.MealContext.Date)
	assert.Zero(t, full.MealContext.Current.Calories)
	assert.Equal(t, full.MealContext.CalorieTarget, full.MealContext.Remaining.Calories)
	assert.Equal(t, "明早", result.MealLabel)
	assert.Equal(t, "2026-11-05", result.MealDate)
	assert.Contains(t, result.DataNotes, "今天记录的热量已经够了，这里先推荐明天早餐。")

	// Far short at 22:00: a light late snack today.
	hungry, result := choose("22:00", "dinner", recordAt("12:00", 600))
	assert.False(t, hungry.MealForTomorrow)
	assert.Equal(t, "evening_snack", hungry.MealContext.MealType)
	assert.Equal(t, "夜宵", result.MealLabel)

	// After midnight the next meal is this morning's breakfast; at 20:00 a breakfast is tomorrow's.
	early, result := choose("02:00", "dinner")
	assert.False(t, early.MealForTomorrow)
	assert.Equal(t, "早餐", result.MealLabel)
	_, result = choose("20:00", "breakfast")
	assert.Equal(t, "明早", result.MealLabel)
	// In the day nothing changes.
	day, result := choose("11:00", "lunch")
	assert.False(t, day.MealForTomorrow)
	assert.Equal(t, "午餐", result.MealLabel)
	assert.Empty(t, result.DataNotes)
}

// Replay 2026-11-05: "芥兰炒饭（早餐）" was offered at 15:11 because only an explicitly
// requested meal was compared with the label in the name.
func TestMealLabelInTheNameFollowsTheClockMeal(t *testing.T) {
	state := mealStateAt(t, "15:11")
	state.MealContext.MealType = "dinner"
	c := campusDietAgentTestCandidate("rice", "芥兰炒饭（早餐）", 413, 15)
	c.OpeningHours = "07:00-22:00"
	assert.Equal(t, "meal_period_mismatch_or_unconfirmed", groundedMealExclusion(state, c))
	c.Title = "番茄牛腩饭（晚餐）"
	assert.Empty(t, groundedMealExclusion(state, c))
	night := mealStateAt(t, "21:30")
	night.MealContext.MealType = "evening_snack"
	assert.Empty(t, groundedMealExclusion(night, c), "a late dinner fits a late snack")
}
