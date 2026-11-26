package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The model could already ask the engine to compare dishes, but the answer was a few scores:
// nothing on whether an option may be chosen, how far it is from the best one seen, or what
// the day still lacks after it. So the model guessed, and the server rejected the guess.
func TestAskingTheEngineSaysWhatCanBeChosenAndWhy(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.MealContextLoaded = true
	state.MealContext.MealType = "lunch"
	state.MealContext.Remaining.Calories, state.MealContext.Remaining.Protein = 900, 60
	near, far := campusDietAgentTestCandidate("near", "番茄牛腩饭", 520, 30), campusDietAgentTestCandidate("far", "牛肉面", 520, 30)
	nearKM, farKM := 0.6, 3.0
	near.DistanceKM, far.DistanceKM = &nearKM, &farKM
	far.ServiceNote = "营业时间未收录，夜里先确认还开着"
	state.Candidates = map[string]DietRecommendationCandidate{"near": near, "far": far}

	rows := campusDietAgentComparisons([]DietRecommendationCandidate{near, far}, state)
	require.Len(t, rows, 2)
	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[row["source_id"].(string)] = row
	}
	n, f := byID["near"], byID["far"]
	assert.Equal(t, true, n["near_best"])
	assert.Equal(t, 0.0, n["gap_to_best"], "the best option seen is at no distance from itself")
	assert.Equal(t, 0.6, n["distance_km"])
	// Same food 3 km away compares 5.4 points lower: still choosable, and the gap is stated.
	assert.InDelta(t, 5.4, f["gap_to_best"].(float64), 0.01)
	assert.InDelta(t, n["health_fit_score"].(float64)-5.4, f["reach_fit"].(float64), 0.01)
	assert.Equal(t, true, f["near_best"])
	assert.Contains(t, f["evidence_issues"], "营业时间未收录，夜里先确认还开着")
	// What the day still lacks after this meal is arithmetic the model need not guess.
	after := n["after_this_meal"].(map[string]any)
	assert.Equal(t, 380.0, after["calories_left"])
	assert.Equal(t, 30.0, after["protein_left"])
	assert.NotEmpty(t, n["how_to_read"])
}
