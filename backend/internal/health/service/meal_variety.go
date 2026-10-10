package service

import (
	"math"
	"strings"
	"time"
)

// Variety is a menu-selection heuristic, not a claim about nutritional quality.
// A repeated dish is avoided only when a feasible alternative is in the same
// fixed health band. Nothing here changes intake, targets or hard constraints.
func mealRecentDishMatch(c DietRecommendationCandidate, foods []mealFoodFrequency) bool {
	title := normalizeMealVarietyName(c.Title)
	for _, f := range foods {
		name := normalizeMealVarietyName(f.Name)
		if f.RecentCount <= 0 || name == "" {
			continue
		}
		if title == name {
			return true
		}
		// A component such as rice or egg is not evidence that the whole dish
		// was eaten. Only a sufficiently specific named dish can match inside
		// a combination; descriptions are never treated as intake evidence.
		if len([]rune(name)) < 4 || mealCandidateFamily(DietRecommendationCandidate{Title: f.Name}) == "" {
			continue
		}
		if strings.Contains(title, name) {
			return true
		}
		for _, item := range c.Items {
			if normalizeMealVarietyName(item.Name) == name {
				return true
			}
		}
	}
	return false
}

func normalizeMealVarietyName(name string) string {
	name = normalizeDietDecisionToken(name)
	return strings.NewReplacer("（早餐）", "", "(早餐)", "", "（午餐）", "", "(午餐)", "", "（晚餐）", "", "(晚餐)", "").Replace(name)
}

func mealFamilyParts(c DietRecommendationCandidate) (string, string) {
	return mealFamilyStringParts(mealCandidateFamily(c))
}

func mealFamilyStringParts(family string) (string, string) {
	parts := strings.Split(family, ":")
	if len(parts) != 2 {
		return "", ""
	}
	staple, protein := parts[0], parts[1]
	if staple == "other" {
		staple = ""
	}
	if protein == "mixed" {
		protein = ""
	}
	return staple, protein
}

func mealFamilyOverlap(a, b DietRecommendationCandidate) float64 {
	as, ap := mealFamilyParts(a)
	bs, bp := mealFamilyParts(b)
	score := 0.0
	if as != "" && as == bs {
		score += 6
	}
	if ap != "" && ap == bp {
		score += 4
	}
	return score
}

func mealRecentFamilyPenalty(c DietRecommendationCandidate, foods []mealFoodFrequency) float64 {
	stapleCount, proteinCount := 0.0, 0.0
	staple, protein := mealFamilyParts(c)
	for _, f := range foods {
		if f.RecentCount <= 0 {
			continue
		}
		fs, fp := mealFamilyParts(DietRecommendationCandidate{Title: f.Name})
		// Max, rather than sum, avoids multiplying a single recorded meal
		// merely because it contains several similarly named ingredients.
		if staple != "" && staple == fs {
			stapleCount = math.Max(stapleCount, float64(f.RecentCount))
		}
		if protein != "" && protein == fp {
			proteinCount = math.Max(proteinCount, float64(f.RecentCount))
		}
	}
	return math.Min(6, stapleCount*2) + math.Min(4, proteinCount*2)
}

func applyMealVarietyContext(state *campusDietAgentRunState, pool []groundedMeal) []groundedMeal {
	out := append([]groundedMeal(nil), pool...)
	now := mealDecisionNow(state).In(chinaTZ)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ).AddDate(0, 0, -2)
	for i := range out {
		m := &out[i]
		m.recentRepeat = mealRecentDishMatch(m.candidate, state.PersonalContext.FoodFrequency)
		m.varietyPenalty = mealRecentFamilyPenalty(m.candidate, state.PersonalContext.FoodFrequency)
		staple, protein := mealFamilyParts(m.candidate)
		shownStaples, shownProteins := map[string]bool{}, map[string]bool{}
		key, fingerprint := mealDecisionHash(m.candidate.Source, m.candidate.SourceID), mealDecisionHash(mealFingerprint(m.candidate))
		for _, memory := range state.PreviewMemory {
			day, err := time.ParseInLocation("2006-01-02", memory.MealDate, chinaTZ)
			if err != nil || day.Before(start) || day.After(now) || memory.ShownAt == nil || memory.ShownAt.After(now) || memory.ContextKey == state.PreviewContextKey {
				continue
			}
			if memory.OptionKey == key || memory.Fingerprint == fingerprint {
				m.recentRepeat = true
			}
			fs, fp := mealFamilyStringParts(memory.Family)
			period := memory.MealDate + ":" + memory.MealType
			if staple != "" && staple == fs {
				shownStaples[period] = true
			}
			if protein != "" && protein == fp {
				shownProteins[period] = true
			}
		}
		// Viewing a similar dish also calls for variety, but is never intake.
		// Use the larger signal instead of counting the same meal twice.
		shownPenalty := math.Min(6, float64(len(shownStaples))*2) + math.Min(4, float64(len(shownProteins))*2)
		m.varietyPenalty = math.Max(m.varietyPenalty, shownPenalty)
		m.score -= m.varietyPenalty
	}
	return out
}

// Both the rule picker and model validator use exactly this round pool. The
// health anchor is fixed before removing recent dishes, so variety cannot chain
// its way down to increasingly worse meals. Explicitly selected dishes/facts
// bypass this recommendation-only policy at their existing entry points.
func mealSelectionRound(eligible, chosen []groundedMeal) []groundedMeal {
	seen := map[string]bool{}
	historyChosen := false
	for _, m := range chosen {
		seen[mealFingerprint(m.candidate)] = true
		historyChosen = historyChosen || m.candidate.Source == "food_record"
	}
	pool, history := []groundedMeal{}, []groundedMeal{}
	maxHealth := math.Inf(-1)
	for _, m := range eligible {
		if !m.evaluation.Feasible || seen[mealFingerprint(m.candidate)] {
			continue
		}
		if m.candidate.Source == "food_record" {
			if !historyChosen {
				history = append(history, m)
			}
			continue
		}
		pool = append(pool, m)
	}
	if len(pool) == 0 {
		pool = history
	}
	for _, m := range pool {
		maxHealth = math.Max(maxHealth, m.evaluation.Scores.HealthFit)
	}
	band := []groundedMeal{}
	hasFresh := false
	for _, m := range pool {
		if m.evaluation.Scores.HealthFit >= maxHealth-mealHealthShortlistTolerance {
			band = append(band, m)
			hasFresh = hasFresh || !m.recentRepeat
		}
	}
	varied := []groundedMeal{}
	minOverlap := math.Inf(1)
	for _, m := range band {
		if hasFresh && m.recentRepeat {
			continue
		}
		overlap := m.varietyPenalty
		for _, prior := range chosen {
			overlap += mealFamilyOverlap(m.candidate, prior.candidate)
		}
		if overlap < minOverlap {
			minOverlap, varied = overlap, nil
		}
		if overlap == minOverlap {
			varied = append(varied, m)
		}
	}
	return varied
}
