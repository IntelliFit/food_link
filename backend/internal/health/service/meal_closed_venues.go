package service

import (
	"fmt"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
)

// A canteen dish is left out when its canteen is not serving while the user would eat. That
// is correct, but leaving it out silently is not. 2026-11-24 20:50 near 清华 every 清华 canteen
// disappeared (no hours collected, so the default 20:00 dinner end applied) and farther
// 中国农业大学 canteens were offered without a word; at 03:58 and 00:43 the chat found 272 and
// 286 dishes, all in closed canteens, and asked for a location or a school instead. The
// summary below records what the hours ruled out, so the card and the chat can say so.

type mealClosedVenues struct {
	// Dishes is how many canteen dishes were left out because the canteen is not serving.
	Dishes int `json:"dishes"`
	// Schools lists them by school: the user's own first, then the nearest.
	Schools []mealClosedSchool `json:"schools,omitempty"`
}

type mealClosedSchool struct {
	Name string `json:"name"`
	// Own marks the school in the user's profile.
	Own bool `json:"own,omitempty"`
	// HoursUnknown is true when none of its closed canteens has collected hours: the
	// ordinary campus meal times were assumed.
	HoursUnknown bool     `json:"hours_unknown"`
	DistanceKM   *float64 `json:"distance_km,omitempty"`
	Dishes       int      `json:"dishes"`
}

// mealClosedVenueSummary groups the canteen dishes these hours rule out. Combined meals are
// built from single dishes and are not counted twice.
func mealClosedVenueSummary(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) mealClosedVenues {
	out := mealClosedVenues{}
	index := map[string]int{}
	for _, c := range candidates {
		if c.Source == "meal_plan" || groundedMealExclusion(state, c) != "venue_closed_at_meal_time" {
			continue
		}
		name := strings.TrimSpace(defaultIfEmpty(c.SchoolName, c.CanteenName))
		if name == "" {
			continue
		}
		i, ok := index[name]
		if !ok {
			i = len(out.Schools)
			index[name] = i
			out.Schools = append(out.Schools, mealClosedSchool{Name: name, Own: c.SchoolID != "" && c.SchoolID == state.School.ID, HoursUnknown: true})
		}
		school := &out.Schools[i]
		school.Dishes++
		out.Dishes++
		if len(domain.ParseOpeningHours(c.OpeningHours)) > 0 {
			school.HoursUnknown = false
		}
		if c.DistanceKM != nil && (school.DistanceKM == nil || *c.DistanceKM < *school.DistanceKM) {
			km := *c.DistanceKM
			school.DistanceKM = &km
		}
	}
	mealSortClosedSchools(out.Schools)
	return out
}

func mealSortClosedSchools(schools []mealClosedSchool) {
	sort.SliceStable(schools, func(i, j int) bool {
		a, b := schools[i], schools[j]
		if a.Own != b.Own {
			return a.Own
		}
		if (a.DistanceKM == nil) != (b.DistanceKM == nil) {
			return a.DistanceKM != nil
		}
		if a.DistanceKM != nil && *a.DistanceKM != *b.DistanceKM {
			return *a.DistanceKM < *b.DistanceKM
		}
		return a.Name < b.Name
	})
}

// add merges the closed dishes of a later search of the same turn.
func (v mealClosedVenues) add(more mealClosedVenues) mealClosedVenues {
	out := mealClosedVenues{Dishes: v.Dishes + more.Dishes, Schools: append([]mealClosedSchool(nil), v.Schools...)}
	for _, school := range more.Schools {
		merged := false
		for i := range out.Schools {
			have := &out.Schools[i]
			if have.Name != school.Name {
				continue
			}
			have.Dishes += school.Dishes
			have.Own = have.Own || school.Own
			have.HoursUnknown = have.HoursUnknown && school.HoursUnknown
			if school.DistanceKM != nil && (have.DistanceKM == nil || *school.DistanceKM < *have.DistanceKM) {
				have.DistanceKM = school.DistanceKM
			}
			merged = true
		}
		if !merged {
			out.Schools = append(out.Schools, school)
		}
	}
	mealSortClosedSchools(out.Schools)
	return out
}

// mealNoticeMargin is how much nearer a closed canteen must be than everything offered
// before the card mentions it.
const mealNoticeMarginKM = 0.5

// mealClosedNotice is the one sentence shown with the options when canteens the user would
// expect were left out: those of their own school, or ones nearer than everything offered.
func mealClosedNotice(state *campusDietAgentRunState, closed mealClosedVenues, offered []DietRecommendationCandidate) string {
	if closed.Dishes == 0 || len(closed.Schools) == 0 {
		return ""
	}
	school := closed.Schools[0]
	if !school.Own {
		if school.DistanceKM == nil {
			return ""
		}
		for _, c := range offered {
			if c.Source != "food_record" && c.DistanceKM != nil && *c.DistanceKM < *school.DistanceKM+mealNoticeMarginKM {
				return ""
			}
		}
	}
	if school.HoursUnknown {
		return school.Name + "的食堂没收录营业时间，按一般食堂" + mealDefaultHoursPhrase(mealClosedMealType(state)) + "算，这次先不推荐。"
	}
	return school.Name + "的食堂这个时段不供餐，这次先不推荐。"
}

func mealClosedMealType(state *campusDietAgentRunState) string {
	return defaultIfEmpty(state.Constraints.MealType, state.MealContext.MealType)
}

// mealDefaultHoursPhrase says what the assumed campus meal times mean for this meal.
func mealDefaultHoursPhrase(mealType string) string {
	for _, w := range mealDefaultCanteenHours {
		if w.Meal == mealType {
			return fmt.Sprintf(" %d:%02d 停%s", w.End/60, w.End%60, mealTypeLabel(mealType))
		}
	}
	return "不供夜宵"
}

func mealTypeLabel(mealType string) string {
	switch mealType {
	case "breakfast":
		return "早餐"
	case "lunch":
		return "午餐"
	case "dinner":
		return "晚餐"
	case "evening_snack":
		return "夜宵"
	}
	return "这餐"
}

// mealNextCanteenMeal is the next meal the ordinary campus hours serve after now.
func mealNextCanteenMeal(minute int) string {
	for _, w := range mealDefaultCanteenHours {
		if minute < w.Start {
			return mealTypeLabel(w.Meal)
		}
	}
	return mealTypeLabel(mealDefaultCanteenHours[0].Meal)
}

// mealClosedNowAnswer is the chat answer when the search found dishes but every one is in a
// canteen that is not serving then. It states that, not a missing location or school, and
// says what the user can do next. Empty when that is not the situation.
func mealClosedNowAnswer(state *campusDietAgentRunState) string {
	closed := state.ClosedVenues
	if !state.SearchAttempted || closed.Dishes == 0 || len(closed.Schools) == 0 || state.Constraints.CanteenName != "" || mealAnyFeasibleChoice(state) {
		return ""
	}
	now := mealDecisionNow(state).In(chinaTZ)
	minute := now.Hour()*60 + now.Minute()
	_, from, _ := mealEatingWindow(state, mealClosedMealType(state))
	when := "这一餐的时间，"
	if from-minute <= mealWalkMinutes+1 && from >= minute {
		when = fmt.Sprintf("现在 %02d:%02d，", now.Hour(), now.Minute())
	}
	who := "已收录的食堂"
	unknown := true
	for _, school := range closed.Schools {
		unknown = unknown && school.HoursUnknown
	}
	if closed.Schools[0].Own || len(closed.Schools) == 1 {
		who, unknown = closed.Schools[0].Name+"的食堂", closed.Schools[0].HoursUnknown
	}
	fact := who + "这个点不供餐。"
	if unknown {
		fact = who + "还没收录营业时间，按一般食堂这个点不供餐。"
	}
	next := "「" + mealNextCanteenMeal(minute) + "吃什么」"
	if state.Location == nil {
		return when + fact + "想现在吃，点下方「使用当前位置」，我看附近还开着的店；也可以直接问" + next + "。"
	}
	return when + fact + "附近也没有收录到这个点能吃的店。可以直接问" + next + "，我按那一餐来选。"
}

// mealNoteClosedVenues adds the closed canteen dishes of one search to the turn's summary;
// a dish returned by several searches is counted once.
func mealNoteClosedVenues(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) {
	if state.closedSeen == nil {
		state.closedSeen = map[string]bool{}
	}
	fresh := make([]DietRecommendationCandidate, 0, len(candidates))
	for _, c := range candidates {
		if !state.closedSeen[c.SourceID] {
			state.closedSeen[c.SourceID] = true
			fresh = append(fresh, c)
		}
	}
	state.ClosedVenues = state.ClosedVenues.add(mealClosedVenueSummary(state, fresh))
}
