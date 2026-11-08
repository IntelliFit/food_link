package service

import (
	"context"
	"math"
	"sort"

	"food_link/backend/internal/nutritionagg"
)

// A conditional plan is never inserted into food records or recommendation
// memory. Each alternative has its own future plan; alternatives are not eaten
// together. A bounded beam is explicit, not a claim of a global optimum.
type MealDayPlan struct {
	Status        string                  `json:"status"`
	Method        string                  `json:"method"`
	Steps         []MealDayPlanStep       `json:"steps"`
	Planned       DietRecommendationMacro `json:"planned_macros"`
	Recorded      DietRecommendationMacro `json:"recorded_macros"`
	ProjectedLoss float64                 `json:"projected_plan_loss"`
	Notes         []string                `json:"notes"`
}

type MealDayPlanStep struct {
	MealType  string                      `json:"meal_type"`
	Candidate DietRecommendationCandidate `json:"candidate"`
}

type mealPlanBeam struct {
	steps []MealDayPlanStep
	loss  float64
}

func prepareMealPlanningCatalog(ctx context.Context, state *campusDietAgentRunState, catalog []groundedMeal) map[string][]DietRecommendationCandidate {
	out := map[string][]DietRecommendationCandidate{}
	for _, period := range []string{"lunch", "dinner"} {
		future := *state
		future.Constraints = state.Constraints
		future.Constraints.MealType = period
		future.MealContext = state.MealContext
		future.MealContext.MealType = period
		feasible := []DietRecommendationCandidate{}
		for _, row := range catalog {
			if ctx.Err() != nil {
				return out
			}
			c := row.candidate
			if c.Source != "food_record" && mealHasEvidenceStructure(c) && groundedMealAllowed(&future, c) {
				feasible = append(feasible, c)
			}
		}
		dc := prepareDietDecisionComparison(dietDecisionContextFromCampusState(&future), feasible)
		pool := []groundedMeal{}
		for _, c := range feasible {
			e := evaluateDietDecisionCandidate(dc, c)
			if !e.Feasible {
				continue
			}
			_, p := mealEvidenceIssues(c, period)
			pool = append(pool, groundedMeal{candidate: c, evaluation: e, score: e.Scores.HealthFit - p})
		}
		for _, m := range mealArbitrationShortlist(pool, 36) {
			out[period] = append(out[period], m.candidate)
		}
	}
	return out
}

func mealPlanAggregate(steps []MealDayPlanStep) DietRecommendationCandidate {
	out := DietRecommendationCandidate{}
	vectors := []nutritionagg.Vector{}
	for _, step := range steps {
		c := step.Candidate
		out.Calories += c.Calories
		out.Protein += c.Protein
		out.Carbs += c.Carbs
		out.Fat += c.Fat
		vectors = append(vectors, c.Nutrients)
	}
	out.Nutrients = nutritionagg.Combine(vectors...)
	return out
}

func mealPlanLoss(state *campusDietAgentRunState, steps []MealDayPlanStep) float64 {
	// Only the macros and the rule nutrients are scored; combining every nutrient
	// for each of thousands of candidate plans dominated a home preview.
	c := DietRecommendationCandidate{}
	vectors := make([]nutritionagg.Vector, 0, len(steps))
	for _, step := range steps {
		c.Calories += step.Candidate.Calories
		c.Protein += step.Candidate.Protein
		c.Carbs += step.Candidate.Carbs
		c.Fat += step.Candidate.Fat
		vectors = append(vectors, step.Candidate.Nutrients)
	}
	share := 0.0
	for _, step := range steps {
		share += dietDecisionMealRatio(step.MealType)
	}
	t, r := state.MealContext.Targets, state.MealContext.Remaining
	macro := (2*v3IntervalLoss(c.Calories, math.Min(r.Calories, t.Calories*share), .75, 1.20) + v3IntervalLoss(c.Protein, math.Min(r.Protein, t.Protein*share), .75, 1.60) + v3IntervalLoss(c.Carbs, math.Min(r.Carbs, t.Carbs*share), .55, 1.35) + v3IntervalLoss(c.Fat, math.Min(r.Fat, t.Fat*share), .4, 1.3)) / 5
	micro, n := 0.0, 0
	if b := state.MealContext.DecisionBasis; b != nil && b.NutrientState != nil {
		for _, rule := range b.NutrientState.Rules {
			amount := nutritionagg.CombineKey(rule.Key, vectors...)
			if amount.TotalItems == 0 {
				continue
			}
			n++
			if !amount.Complete() || amount.Unit != rule.Unit {
				micro += 1
				continue
			}
			known := b.NutrientState.Current[rule.Key].Value
			if rule.Target > 0 {
				target := rule.Target * share
				if b.NutrientState.Current[rule.Key].Complete() {
					target = math.Min(target, math.Max(0, rule.Target-known))
				}
				if target > 0 {
					micro += math.Pow(math.Max(0, (target-amount.Value)/target), 2)
				}
			}
			if rule.Limit > 0 {
				limit := math.Min(rule.Limit*share, math.Max(1, rule.Limit-known))
				micro += math.Min(2, math.Pow(math.Max(0, (amount.Value-limit)/limit), 2))
			}
		}
	}
	if n > 0 {
		micro /= float64(n)
	}
	repeat := 0.0
	keys := make([][2]string, len(steps))
	for i, step := range steps {
		keys[i] = state.mealPlanKey(step.Candidate)
	}
	for i, a := range keys {
		for _, b := range keys[:i] {
			if a[0] == b[0] {
				repeat += .15
			}
			if a[1] != "" && a[1] == b[1] {
				repeat += .025
			}
		}
	}
	return .6*macro + .4*micro + repeat
}

// mealPlanKey returns the candidate's fingerprint and venue, cached per request.
func (s *campusDietAgentRunState) mealPlanKey(c DietRecommendationCandidate) [2]string {
	id := c.Source + "|" + c.SourceID + "|" + c.Title
	if key, ok := s.planKeys[id]; ok {
		return key
	}
	key := [2]string{mealFingerprint(c), mealSelectionVenue(c)}
	if s.planKeys == nil {
		s.planKeys = map[string][2]string{}
	}
	s.planKeys[id] = key
	return key
}

func buildConditionalMealDayPlan(ctx context.Context, state *campusDietAgentRunState, first DietRecommendationCandidate, catalog []groundedMeal) *MealDayPlan {
	plan := &MealDayPlan{Status: "conditional", Method: "remaining_day_beam_4", Recorded: state.MealContext.Current, Notes: []string{"假设选择并按库内份量吃完本选项，再比较后续餐次；不写入摄入或扣减真实余量。", "仅基于已记录小计；漏记、加餐和实际份量会改变计划，不能保证全天达标。", "已扫描菜单中的有界组合搜索，不是所有搭配的全局最优；后续供应仍待确认。"}}
	order := []string{"breakfast", "lunch", "dinner"}
	start := -1
	for i, m := range order {
		if m == state.MealContext.MealType {
			start = i
		}
	}
	if start < 0 || first.Source == "food_record" {
		plan.Status = "unavailable"
		return plan
	}
	beams := []mealPlanBeam{{steps: []MealDayPlanStep{{MealType: order[start], Candidate: first}}}}
	for _, period := range order[start+1:] {
		if ctx.Err() != nil {
			plan.Status = "partial_timeout"
			break
		}
		future := *state
		future.Constraints = state.Constraints
		future.Constraints.MealType = period
		future.MealContext = state.MealContext
		future.MealContext.MealType = period
		// Score every extension in one scratch slice and keep only indexes: copying
		// each candidate struct into thousands of short-lived plans was most of the
		// remaining cost. Only the kept beams get their own steps.
		type scored struct {
			beam, candidate int
			loss            float64
		}
		next := []scored{}
		scratch := []MealDayPlanStep{}
		futureCandidates := state.PlanningCatalog[period]
		if state.PlanningCatalog == nil {
			for _, row := range catalog {
				futureCandidates = append(futureCandidates, row.candidate)
			}
		}
		for bi, beam := range beams {
			for ci, c := range futureCandidates {
				// The prepared catalog was built with these same checks for this
				// future meal; repeating them per beam made a breakfast preview spend
				// seconds re-running regexes (2026-11-09).
				if state.PlanningCatalog == nil && (c.Source == "food_record" || !mealHasEvidenceStructure(c) || !groundedMealAllowed(&future, c)) {
					continue
				}
				// The prepared catalog already passed this same future context's
				// feasibility check. Do not repeat nutrient scoring for every beam.
				if state.PlanningCatalog == nil {
					e := evaluateDietDecisionCandidate(dietDecisionContextFromCampusState(&future), c)
					if !e.Feasible {
						continue
					}
				}
				scratch = append(append(scratch[:0], beam.steps...), MealDayPlanStep{MealType: period, Candidate: c})
				next = append(next, scored{beam: bi, candidate: ci, loss: mealPlanLoss(state, scratch)})
			}
		}
		if len(next) == 0 {
			plan.Status = "partial_no_future_candidate"
			break
		}
		sort.SliceStable(next, func(i, j int) bool {
			if next[i].loss == next[j].loss {
				return futureCandidates[next[i].candidate].SourceID < futureCandidates[next[j].candidate].SourceID
			}
			return next[i].loss < next[j].loss
		})
		if len(next) > 4 {
			next = next[:4]
		}
		kept := make([]mealPlanBeam, 0, len(next))
		for _, n := range next {
			steps := append(append([]MealDayPlanStep(nil), beams[n.beam].steps...), MealDayPlanStep{MealType: period, Candidate: futureCandidates[n.candidate]})
			kept = append(kept, mealPlanBeam{steps: steps, loss: n.loss})
		}
		beams = kept
	}
	plan.Steps = beams[0].steps
	plan.ProjectedLoss = mealPlanLoss(state, plan.Steps)
	c := mealPlanAggregate(plan.Steps)
	plan.Planned = DietRecommendationMacro{Calories: c.Calories, Protein: c.Protein, Carbs: c.Carbs, Fat: c.Fat}
	return plan
}
