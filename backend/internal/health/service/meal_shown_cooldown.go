package service

import (
	"food_link/backend/internal/health/domain"
)

// The home card kept offering the same dish: live data 2026-11-12..25 has one dish shown to
// one user on 12 of 14 days (98 times) and 皮蛋瘦肉粥 on 7 days for another. A dish already
// shown on an earlier day was only scored lower, and only skipped when a fresh one sat within
// 5 health points of it. A dish shown in the last mealShownCooldownDays days now rests, as
// long as enough other options remain; a dish the user chose is theirs to keep seeing.

const (
	mealShownCooldownDays = 3
	// mealShownCooldownKeep is how many options must remain for the rest to apply.
	mealShownCooldownKeep = 3
)

// mealDropRecentlyShown removes home-card options that were shown on one of the previous
// mealShownCooldownDays days and not chosen. The same card seen again today is unchanged.
func mealDropRecentlyShown(state *campusDietAgentRunState, eligible []groundedMeal) []groundedMeal {
	if state == nil || !state.IsHomePreview || len(state.PreviewMemory) == 0 {
		return eligible
	}
	now := mealDecisionNow(state).In(chinaTZ)
	today, from := now.Format("2006-01-02"), now.AddDate(0, 0, -mealShownCooldownDays).Format("2006-01-02")
	if state.MealContext.Date != "" && state.MealContext.Date < today {
		today = state.MealContext.Date
	}
	shown, chosen := map[string]bool{}, map[string]bool{}
	for _, m := range state.PreviewMemory {
		if m.SelectedAt != nil {
			chosen[m.OptionKey], chosen[m.Fingerprint] = true, true
		}
		if m.ShownAt == nil || m.MealDate >= today || m.MealDate < from {
			continue
		}
		shown[m.OptionKey], shown[m.Fingerprint] = true, true
	}
	if len(shown) == 0 {
		return eligible
	}
	kept := make([]groundedMeal, 0, len(eligible))
	for _, meal := range eligible {
		key, fingerprint := mealMemoryKeys(meal.candidate)
		if (shown[key] || shown[fingerprint]) && !chosen[key] && !chosen[fingerprint] {
			continue
		}
		kept = append(kept, meal)
	}
	distinct := map[string]bool{}
	for _, meal := range kept {
		distinct[mealFingerprint(meal.candidate)] = true
	}
	if len(distinct) < mealShownCooldownKeep {
		return eligible
	}
	return kept
}

// mealMemoryKeys are the two keys the shown-meal memory stores for an option.
func mealMemoryKeys(c domain.DietRecommendationCandidate) (optionKey, fingerprint string) {
	return mealDecisionHash(c.Source, c.SourceID), mealDecisionHash(mealFingerprint(c))
}
