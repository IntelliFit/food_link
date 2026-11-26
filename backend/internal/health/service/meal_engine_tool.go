package service

import "math"

// The decision engine is the judge of nutrition; the model decides when to consult it and
// how to weigh its answer against what the user said. compare_campus_foods is that question:
// for each option it says whether it may be chosen, how far it is from the best one seen this
// turn, what the day still lacks after it, and how far the data can be trusted. Before, the
// tool returned a few scores, so the model guessed which options were acceptable and the
// server rejected the guess afterwards.

// mealEngineAnswer is the engine's answer about one option.
func mealEngineAnswer(state *campusDietAgentRunState, c DietRecommendationCandidate, e dietDecisionEvaluation, nearBestFloor float64) map[string]any {
	reachFit := roundDietNumber(e.Scores.HealthFit - mealReachDiscount(c.DistanceKM))
	row := map[string]any{
		"reach_fit":   reachFit,
		"near_best":   e.Feasible && reachFit >= nearBestFloor,
		"how_to_read": "near_best=true可以选；gap_to_best是离本轮最优差多少分（已含超出步行范围的距离折扣）；constraint_violations非空不能选；after_this_meal是吃完这份后今天还差多少。",
	}
	if !math.IsInf(nearBestFloor, 0) {
		row["gap_to_best"] = roundDietNumber(math.Max(0, nearBestFloor+mealModelPickTolerance-reachFit))
	}
	if c.DistanceKM != nil {
		row["distance_km"] = *c.DistanceKM
	}
	if c.NutritionBasis != "unavailable" {
		remaining := state.MealContext.Remaining
		row["after_this_meal"] = map[string]any{
			"calories_left": roundDietNumber(remaining.Calories - c.Calories),
			"protein_left":  roundDietNumber(remaining.Protein - c.Protein),
			"carbs_left":    roundDietNumber(remaining.Carbs - c.Carbs),
			"fat_left":      roundDietNumber(remaining.Fat - c.Fat),
		}
	}
	if effects := mealToolNutrientEffects(e.Scores.NutrientEffects); len(effects) > 0 {
		row["nutrient_effects"] = effects
	}
	issues, penalty := mealEvidenceIssues(c, state.MealContext.MealType)
	row["evidence_issues"], row["evidence_penalty"] = issues, penalty
	return row
}

// mergeMealEngineScores adds the scores the tool always returned to the engine's answer.
func mergeMealEngineScores(row, scores map[string]any) {
	for key, value := range scores {
		row[key] = value
	}
}
