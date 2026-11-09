package service

import (
	"regexp"
	"time"

	"food_link/backend/internal/health/domain"
)

// A canteen serves at meal times only. Recommending one means the user can still get there
// while it is open, so each canteen dish is checked against the canteen's own collected
// hours, or ordinary campus meal times when it has none. Merchants have no collected hours;
// at night their cards say so instead of being dropped.

// mealUsualEatingTimes is when people usually eat each meal (minutes after midnight).
var mealUsualEatingTimes = map[string][2]int{
	"breakfast":     {7 * 60, 9*60 + 30},
	"lunch":         {11 * 60, 13*60 + 30},
	"dinner":        {17 * 60, 19*60 + 30},
	"evening_snack": {21 * 60, 23*60 + 30},
}

// mealDefaultCanteenHours stand in for a canteen without usable hours: the ordinary
// campus meal times, with no late-night service.
var mealDefaultCanteenHours = []domain.OpeningWindow{
	{Meal: "breakfast", Start: 6*60 + 30, End: 9*60 + 30},
	{Meal: "lunch", Start: 10*60 + 30, End: 13*60 + 30},
	{Meal: "dinner", Start: 16*60 + 30, End: 20 * 60},
}

const (
	// mealOpenMinimumMinutes is how long a venue must stay open while the user eats.
	mealOpenMinimumMinutes = 20
	// mealWalkMinutes is the time to get to a nearby venue.
	mealWalkMinutes = 10
	// mealLateMinutes is how long a meal eaten now, past its usual time, takes.
	mealLateMinutes = 90
)

var mealAsksAboutTomorrow = regexp.MustCompile(`明天|明早|明晚|明日`)

// mealEatingWindow is when the user would eat the meal being chosen: the meal's usual time
// when it is still ahead, from now when it is under way or eaten late (a late lunch up to
// two hours after lunchtime, dinner and a late snack until 04:00), and otherwise the next
// day's usual time: a breakfast already past, or a meal planned for tomorrow. Minutes
// count from midnight of day.
func mealEatingWindow(state *campusDietAgentRunState, mealType string) (day time.Time, from, to int) {
	now := mealDecisionNow(state).In(chinaTZ)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	if mealType == "" {
		mealType = state.MealContext.MealType
	}
	usual, ok := mealUsualEatingTimes[mealType]
	if !ok {
		mealType = inferCampusDietMealType("", now)
		usual = mealUsualEatingTimes[mealType]
	}
	if state.MealForTomorrow || state.MealContext.Date > today.Format("2006-01-02") || mealAsksAboutTomorrow.MatchString(state.Question) {
		return today.AddDate(0, 0, 1), usual[0], usual[1]
	}
	minute := now.Hour()*60 + now.Minute()
	soon := minute + mealWalkMinutes
	late := mealType == "dinner" || mealType == "evening_snack"
	switch {
	case late && minute < 4*60:
		return today, soon, soon + mealLateMinutes
	case soon <= usual[0]:
		return today, usual[0], usual[1]
	case soon+mealOpenMinimumMinutes <= usual[1]:
		return today, soon, usual[1]
	case late || mealType == "lunch" && minute-usual[1] <= 2*60:
		return today, soon, soon + mealLateMinutes
	}
	return today.AddDate(0, 0, 1), usual[0], usual[1]
}

// mealVenueClosedAtMealTime is true for a canteen dish when the canteen is not open long
// enough while the user would eat. History meals have no venue to check.
func mealVenueClosedAtMealTime(state *campusDietAgentRunState, mealType string, c DietRecommendationCandidate) bool {
	if c.Source == "food_record" || !domain.IsCanteenVenue(c) {
		return false
	}
	if mealType == "" {
		mealType = state.MealContext.MealType
	}
	windows := domain.ParseOpeningHours(c.OpeningHours)
	if len(windows) == 0 {
		windows = mealDefaultCanteenHours
	}
	_, from, to := mealEatingWindow(state, mealType)
	return mealOpenMinutes(windows, mealType, from, to) < mealOpenMinimumMinutes
}

// mealOpenMinutes is how many minutes of [from, to) the windows serving mealType cover. A
// window may run past midnight and the eating time may too, so both days are compared.
func mealOpenMinutes(windows []domain.OpeningWindow, mealType string, from, to int) int {
	total := 0
	for _, w := range windows {
		if !mealWindowServes(w.Meal, mealType) {
			continue
		}
		for _, shift := range []int{-24 * 60, 0, 24 * 60} {
			total += max(0, min(to, w.End+shift)-max(from, w.Start+shift))
		}
	}
	return total
}

// A window without a meal serves every meal; a late dinner can be eaten at a late-night
// window and the other way round.
func mealWindowServes(window, mealType string) bool {
	evening := func(meal string) bool { return meal == "dinner" || meal == "evening_snack" }
	return window == "" || mealType == "" || window == mealType || evening(window) && evening(mealType)
}

// mealMealDay is the calendar day of the meal being chosen, for weekday-only menus.
func mealMealDay(state *campusDietAgentRunState, mealType string) time.Time {
	day, _, _ := mealEatingWindow(state, mealType)
	return day.Add(12 * time.Hour)
}

// Venue names the collectors marked as unconfirmed ("统一价目表（具体食堂待核）").
var mealUnconfirmedVenue = regexp.MustCompile(`待核|待确认|合述|参考|价目表|指南|报道`)

// mealAnnotateServiceHours notes on each catalog dish what the hours mean for this meal: a
// canteen the user named that is not serving then (kept, because the user asked for it), or
// a merchant at night, whose hours were never collected.
func mealAnnotateServiceHours(state *campusDietAgentRunState, rows []DietRecommendationCandidate) {
	mealType := defaultIfEmpty(state.Constraints.MealType, state.MealContext.MealType)
	_, from, _ := mealEatingWindow(state, mealType)
	night := from%(24*60) >= 21*60+30 || from%(24*60) < 6*60
	for i := range rows {
		c := &rows[i]
		c.ServiceNote = ""
		switch {
		case c.Source == "food_record":
		case domain.IsCanteenVenue(*c):
			if state.Constraints.CanteenName != "" && mealVenueClosedAtMealTime(state, mealType, *c) {
				c.ServiceNote = "按收录的营业时间，这个时段不供餐，去之前先确认"
			}
		case night:
			c.ServiceNote = "营业时间未收录，夜里先确认还开着"
		}
	}
}
