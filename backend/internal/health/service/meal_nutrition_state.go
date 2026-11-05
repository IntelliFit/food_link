package service

import (
	"context"
	"fmt"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"
)

// mealNutritionStateFacts hands the meal Agent the same daily nutrition state the
// analysis page and the pet show, cut to what choosing a meal needs: today's gaps,
// what the next plate should add and avoid, and the week's patterns. Without it the
// Agent saw only today's macros and would not know the week was salty.
func (s *StatsService) mealNutritionStateFacts(ctx context.Context, state *campusDietAgentRunState) map[string]any {
	if s == nil || state == nil || state.ReadOnlyReplay || state.UserID == "" {
		return nil
	}
	nutrition, err := s.GetDailyNutritionState(ctx, state.UserID, "")
	if err != nil {
		logger.Warn(ctx, "餐食Agent读取营养状态失败", logger.UserID(state.UserID), logger.Err(err))
		return nil
	}
	return mealNutritionFacts(nutrition, state.MealForTomorrow)
}

func mealNutritionFacts(nutrition *domain.DailyNutritionState, forTomorrow bool) map[string]any {
	if nutrition == nil {
		return nil
	}
	week := []string{}
	for _, habit := range nutrition.Week.Habits {
		week = append(week, fmt.Sprintf("%s %d/%d 天", habit.Label, habit.Hit, habit.Of))
	}
	for _, count := range nutrition.Week.Counts {
		week = append(week, fmt.Sprintf("%s %s/%s %s", count.Label, formatCampusDietNumber(count.Value), formatCampusDietNumber(count.Target), count.Unit))
	}
	facts := map[string]any{
		"headline": nutrition.Headline,
		"week":     week,
		"note":     "这是饮食引擎算好的营养状态，和分析页、宠物看到的是同一份。选菜时优先补 next_meal.fills、避开 next_meal.limits；说理由时可以引用这些事实，不要编造数字。",
	}
	if !forTomorrow {
		gaps := []string{}
		for i, gap := range nutrition.Gaps {
			if i == 3 {
				break
			}
			gaps = append(gaps, gap.Text)
		}
		facts["today_gaps"] = gaps
		if nutrition.NextMeal != nil {
			facts["next_meal"] = map[string]any{"meal": nutrition.NextMeal.Label, "fills": nutrition.NextMeal.Fills, "limits": nutrition.NextMeal.Limits, "advice": nutrition.NextMeal.Advice}
		}
	}
	return facts
}
