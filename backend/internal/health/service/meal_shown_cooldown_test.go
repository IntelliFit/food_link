package service

import (
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Live data 2026-11-12..25: one dish was shown to one user on 12 of 14 days, 98 times.
func TestHomeCardRestsADishShownOnEarlierDays(t *testing.T) {
	state := mealStateAt(t, "12:10") // 2026-11-04
	state.IsHomePreview = true
	meal := func(id, title string) groundedMeal {
		c := campusDietAgentTestCandidate(id, title, 500, 30)
		return groundedMeal{candidate: c, evaluation: dietDecisionEvaluation{Candidate: c, Feasible: true}}
	}
	noodles, rice, soup, bun := meal("a", "苏式红汤面"), meal("b", "番茄牛腩饭"), meal("c", "砂锅米线"), meal("d", "鲜肉包")
	shownAt := time.Now()
	memory := func(m groundedMeal, date string, selected bool) domain.MealRecommendationMemory {
		key, fingerprint := mealMemoryKeys(m.candidate)
		row := domain.MealRecommendationMemory{OptionKey: key, Fingerprint: fingerprint, MealDate: date, MealType: "lunch", ShownAt: &shownAt, ContextKey: "earlier"}
		if selected {
			row.SelectedAt = &shownAt
		}
		return row
	}
	all := []groundedMeal{noodles, rice, soup, bun}
	ids := func(rows []groundedMeal) []string {
		out := []string{}
		for _, r := range rows {
			out = append(out, r.candidate.SourceID)
		}
		return out
	}

	// Shown yesterday: it rests today.
	state.PreviewMemory = []domain.MealRecommendationMemory{memory(noodles, "2026-11-03", false)}
	assert.Equal(t, []string{"b", "c", "d"}, ids(mealDropRecentlyShown(state, all)))
	// Shown four days ago, or earlier today on the same card: it stays.
	state.PreviewMemory = []domain.MealRecommendationMemory{memory(noodles, "2026-10-31", false), memory(rice, "2026-11-04", false)}
	assert.Len(t, mealDropRecentlyShown(state, all), 4)
	// The user chose it: it may come back.
	state.PreviewMemory = []domain.MealRecommendationMemory{memory(noodles, "2026-11-03", true)}
	assert.Len(t, mealDropRecentlyShown(state, all), 4)
	// Too few other options: nothing is dropped.
	state.PreviewMemory = []domain.MealRecommendationMemory{memory(noodles, "2026-11-03", false), memory(rice, "2026-11-02", false)}
	require.Len(t, mealDropRecentlyShown(state, all), 4, "only two options would remain")
	// The chat is not a card: its options are not rested.
	chat := mealStateAt(t, "12:10")
	chat.PreviewMemory = []domain.MealRecommendationMemory{memory(noodles, "2026-11-03", false)}
	assert.Len(t, mealDropRecentlyShown(chat, all), 4)
}
