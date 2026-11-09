package service

import (
	"context"
	"fmt"
	"testing"

	"food_link/backend/internal/nutritionagg"
)

func planBenchPool(n int) []groundedMeal {
	titles := []string{"番茄炒蛋盖饭", "宫保鸡丁饭", "牛肉面", "鸡腿饭", "鱼香肉丝饭", "红烧牛腩饭", "鸡蛋灌饼", "豆浆油条套餐", "小笼包套餐", "黄焖鸡米饭"}
	pool := []groundedMeal{}
	for i := 0; i < n; i++ {
		t := titles[i%len(titles)]
		c := DietRecommendationCandidate{Source: "public_food_library", SourceID: fmt.Sprintf("id-%03d", i), Title: fmt.Sprintf("%s%d", t, i), CanteenName: fmt.Sprintf("第%d食堂", i%6), SchoolID: "s1",
			Calories: 500 + float64(i%9)*40, Protein: 18 + float64(i%7)*3, Carbs: 60 + float64(i%5)*8, Fat: 12 + float64(i%4)*3,
			Items: []DietRecommendationFoodItem{{Name: t}, {Name: "米饭"}}, NutritionBasis: "公共食物库"}
		if i%4 != 0 {
			c.Nutrients = nutritionagg.Vector{
				"fiber":    {Value: float64(2 + i%6), Unit: "g", Status: []string{"recorded", "estimated"}[i%2], KnownItems: 2 - i%2, TotalItems: 2},
				"sodiumMg": {Value: float64(400 + i*13%900), Unit: "mg", Status: "recorded", KnownItems: 2, TotalItems: 2},
			}
		}
		pool = append(pool, groundedMeal{candidate: c})
	}
	return pool
}

func planBenchRules(s *campusDietAgentRunState) {
	s.MealContext.DecisionBasis = &DietDecisionBasis{NutrientState: &DietNutrientState{
		Rules:   []DietNutrientRule{{Key: "fiber", Unit: "g", Target: 25}, {Key: "sodiumMg", Unit: "mg", Limit: 2000}, {Key: "unknownKey", Unit: "g", Target: 3}},
		Current: nutritionagg.Vector{"fiber": {Value: 4, Unit: "g", Status: "recorded", KnownItems: 1, TotalItems: 1}},
	}}
}

func planBenchState() *campusDietAgentRunState {
	s := &campusDietAgentRunState{UserID: "u", IsHomePreview: true, Question: "下一餐吃什么", Intent: "initial", EngineVersion: dietDecisionEngineVersion}
	s.MealContext = campusDietAgentMealContext{MealType: "breakfast", Date: "2026-11-09", Targets: DietRecommendationMacro{Calories: 2000, Protein: 100, Carbs: 250, Fat: 60}, Remaining: DietRecommendationMacro{Calories: 2000, Protein: 100, Carbs: 250, Fat: 60}}
	return s
}

// A breakfast home preview scores a remaining-day plan for every candidate; on
// 2026-11-09 this took 10-26s on the trial backend (5.4s here) before the
// per-beam rechecks, regex rebuilds and struct copies were removed (0.24s).
func BenchmarkHomePreviewDayPlans(b *testing.B) {
	pool := planBenchPool(98)
	for i := 0; i < b.N; i++ {
		s := planBenchState()
		planBenchRules(s)
		s.PlanningCatalog = prepareMealPlanningCatalog(context.Background(), s, pool)
		for _, m := range pool {
			_ = buildConditionalMealDayPlan(context.Background(), s, m.candidate, pool)
		}
	}
}
