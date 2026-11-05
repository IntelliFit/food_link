package service

import (
	"context"
	"math"
)

// The mini program asks the home card for the next main meal by the clock, so late at night
// it still asks for dinner. Nobody goes out for dinner at midnight: with the day's energy
// already covered the card offers tomorrow's breakfast, otherwise a light late snack from
// places still open. Before 04:00 the next meal is breakfast, and a breakfast or lunch long
// past means tomorrow's. The note, if any, says why the card shows another meal.
func (s *StatsService) choosePreviewMealTime(ctx context.Context, state *campusDietAgentRunState) (string, error) {
	now := mealDecisionNow(state).In(chinaTZ)
	minute := now.Hour()*60 + now.Minute()
	requested := state.Constraints.MealType
	evening := requested == "" || requested == "dinner"
	note := ""
	switch {
	case evening && minute < 4*60:
		state.Constraints.MealType = "breakfast"
		return "", nil
	case evening && minute >= 21*60:
		if err := s.loadMealHarnessContext(ctx, state); err != nil {
			return "", err
		}
		if state.MealContext.Remaining.Calories >= mealLateSnackMinimumGap(state.MealContext) {
			state.Constraints.MealType, state.MealContext.MealType = "evening_snack", "evening_snack"
			return "已经很晚了，按夜宵推荐小份一些的；已按营业时间排除关门的食堂，商家营业时间未收录，去之前先确认。", nil
		}
		state.Constraints.MealType = "breakfast"
		note = "今天记录的热量已经够了，这里先推荐明天早餐。"
	case requested == "":
		return "", nil
	default:
		if day, _, _ := mealEatingWindow(state, requested); day.Format("2006-01-02") == now.Format("2006-01-02") {
			return "", nil
		}
	}
	state.MealForTomorrow, state.MealContextLoaded = true, false
	return note, nil
}

// mealLateSnackMinimumGap is how far short of the day's energy target a user must be for a
// late snack to be worth offering.
func mealLateSnackMinimumGap(meal campusDietAgentMealContext) float64 {
	return math.Max(150, 0.1*meal.CalorieTarget)
}

// labelPreviewMeal tells the client which meal the card is for, so it can say "明早吃这个"
// instead of the meal it asked for.
func labelPreviewMeal(state *campusDietAgentRunState, result *DietRecommendationResult, note string) {
	meal := state.MealContext.MealType
	result.MealType, result.MealDate = meal, state.MealContext.Date
	result.MealLabel = map[string]string{"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "evening_snack": "夜宵"}[meal]
	switch {
	case state.MealForTomorrow && meal == "breakfast":
		result.MealLabel = "明早"
	case state.MealForTomorrow:
		result.MealLabel = "明天" + result.MealLabel
	}
	if note != "" {
		result.DataNotes = append(result.DataNotes, note)
	}
}
