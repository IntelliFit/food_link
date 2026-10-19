package service

import (
	"math"
	"strings"
)

// The model chooses among options it can explain to the user (taste, distance, price, what
// the user just said). Its choice stands when it is near-best, not only when it equals the
// engine's own pick: within mealModelPickTolerance health points of the best feasible option.
// The engine's own selection keeps the tighter mealHealthShortlistTolerance.
const mealModelPickTolerance = 10.0

// acceptNearBestPicks keeps the model's picks that are feasible, near-best, not a repeat of
// a recently shown dish while fresh near-best options exist, not the same dish twice, and not
// a third option of one kind when another kind is near-best too. The rest are rejected and
// are replaced by the engine one by one, never the whole answer.
func acceptNearBestPicks(pool []groundedMeal, ids []string, limit int) (kept []groundedMeal, rejected []string, why map[string]string) {
	why = map[string]string{}
	byID := map[string]groundedMeal{}
	best := math.Inf(-1)
	for _, m := range pool {
		if !m.evaluation.Feasible {
			continue
		}
		byID[m.candidate.SourceID] = m
		best = math.Max(best, m.evaluation.Scores.HealthFit)
	}
	floor := best - mealModelPickTolerance
	freshInBand, kinds := false, map[string]bool{}
	for _, m := range byID {
		if m.evaluation.Scores.HealthFit >= floor {
			freshInBand = freshInBand || !m.recentRepeat
			kinds[mealStapleKind(m.candidate)] = true
		}
	}
	seen, perKind := map[string]bool{}, map[string]int{}
	for _, id := range ids {
		m, ok := byID[id]
		kind := mealStapleKind(m.candidate)
		reason := ""
		switch {
		case !ok:
			reason = "不满足本餐条件"
		case len(kept) >= limit:
			reason = "超出要给的数量"
		case m.evaluation.Scores.HealthFit < floor:
			reason = "营养上明显不如其他可选的"
		case m.recentRepeat && freshInBand:
			reason = "最近刚推荐过，有新的同样合适的选择"
		case seen[mealFingerprint(m.candidate)]:
			reason = "和已选的是同一道菜"
		case perKind[kind] >= 2 && len(kinds) > 1:
			reason = "同一类主食已经选了两份"
		}
		if reason != "" {
			rejected = append(rejected, id)
			why[id] = reason
			continue
		}
		seen[mealFingerprint(m.candidate)] = true
		perKind[kind]++
		kept = append(kept, m)
	}
	return kept, rejected, why
}

// mealStapleKind is the kind of meal (noodles, rice, dumplings …) without its protein.
func mealStapleKind(c DietRecommendationCandidate) string {
	family := mealCandidateFamily(c)
	if kind, _, found := strings.Cut(family, ":"); found {
		return kind
	}
	return family
}

// fillModelPicks completes the kept picks with the engine's choices, in the engine's order.
func fillModelPicks(kept, engine []groundedMeal, limit int) []groundedMeal {
	out := append([]groundedMeal(nil), kept...)
	for _, m := range engine {
		if len(out) >= limit {
			break
		}
		duplicate := false
		for _, have := range out {
			duplicate = duplicate || have.candidate.SourceID == m.candidate.SourceID || mealFingerprint(have.candidate) == mealFingerprint(m.candidate) ||
				have.candidate.Source == "food_record" && m.candidate.Source == "food_record" // at most one past meal
		}
		if !duplicate {
			out = append(out, m)
		}
	}
	return out
}

// mealNearBestFloor is the health fit a search result needs to be marked near_best for the
// model: the best feasible option this run has seen, minus mealModelPickTolerance.
func mealNearBestFloor(decision dietDecisionContext, states ...*campusDietAgentRunState) float64 {
	if len(states) == 0 || states[0] == nil {
		return math.Inf(1)
	}
	state := states[0]
	pool := make([]DietRecommendationCandidate, 0, len(state.Candidates))
	for _, c := range state.Candidates {
		pool = append(pool, c)
	}
	best := math.Inf(-1)
	for _, c := range mealFeasibleChoices(state, pool) {
		if e := evaluateDietDecisionCandidate(decision, c); e.Feasible {
			best = math.Max(best, e.Scores.HealthFit)
		}
	}
	return best - mealModelPickTolerance
}

// mealPickRepairRequest tells the model which picks fall outside what this meal accepts and
// why, and which near-best options it may use instead, so it can fix its own answer.
func mealPickRepairRequest(state *campusDietAgentRunState, pool []groundedMeal, kept []groundedMeal, rejected []string, why map[string]string) string {
	best := math.Inf(-1)
	for _, m := range pool {
		if m.evaluation.Feasible {
			best = math.Max(best, m.evaluation.Scores.HealthFit)
		}
	}
	taken := map[string]bool{}
	for _, m := range kept {
		taken[mealFingerprint(m.candidate)] = true
	}
	for _, id := range rejected {
		taken[id] = true
	}
	parts := []string{}
	for _, id := range rejected {
		name := id
		if c, ok := state.Candidates[id]; ok {
			name = c.Title
		}
		parts = append(parts, "「"+name+"」"+why[id])
	}
	alternatives := []string{}
	for _, m := range pool {
		c := m.candidate
		if len(alternatives) >= 8 || !m.evaluation.Feasible || m.evaluation.Scores.HealthFit < best-mealModelPickTolerance || taken[c.SourceID] || taken[mealFingerprint(c)] {
			continue
		}
		alternatives = append(alternatives, c.SourceID+"「"+c.Title+"」"+mealVenueCore(c))
	}
	request := "这些选择需要换掉：" + strings.Join(parts, "；") + "。保留其余选择，"
	if len(alternatives) > 0 {
		request += "从这些同样合适的选项里替换（source_id「菜名」地点）：" + strings.Join(alternatives, "，") + "，"
	}
	return request + "并更新answer，让说明和最终选项一致。"
}

// mealNearBestIDs are the feasible options within mealModelPickTolerance of the best.
func mealNearBestIDs(pool []groundedMeal) map[string]bool {
	best := math.Inf(-1)
	for _, m := range pool {
		if m.evaluation.Feasible {
			best = math.Max(best, m.evaluation.Scores.HealthFit)
		}
	}
	ids := map[string]bool{}
	for _, m := range pool {
		if m.evaluation.Feasible && m.evaluation.Scores.HealthFit >= best-mealModelPickTolerance {
			ids[m.candidate.SourceID] = true
		}
	}
	return ids
}
