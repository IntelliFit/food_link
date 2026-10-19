package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The previous answer as the conversation stored it: meals with their parts.
func comboPreviousAnswer(report mealComboReport) *DietRecommendationResult {
	result := &DietRecommendationResult{}
	for _, combo := range report.Combos {
		result.Recommendations = append(result.Recommendations, DietRecommendationOption{
			Title: combo.Plan.Title, Source: combo.Plan.Source, SourceID: combo.Plan.SourceID, MealComponents: combo.Components,
		})
	}
	return result
}

func TestAnotherBatchOffersDifferentMealsAndDishesThanTheLastAnswer(t *testing.T) {
	pool := comboRotationPool()
	first := searchMealCombos(newComboTestState(), pool, 3)
	require.Len(t, first.Combos, 3)
	previous := comboPreviousAnswer(first)

	state := newComboTestState()
	state.Intent = "more"
	state.ActiveResult = previous
	state.ActiveSourceIDs = recommendationSourceIDsFromResult(previous)
	state.ExcludedSourceIDs = state.ActiveSourceIDs
	second := searchMealCombos(state, pool, 3)
	require.Len(t, second.Combos, 3)

	seenMeals, seenDishes := map[string]bool{}, map[string]bool{}
	for _, combo := range first.Combos {
		seenMeals[combo.Plan.SourceID] = true
		for id := range comboDishIDs(combo) {
			seenDishes[id] = true
		}
	}
	for _, combo := range second.Combos {
		assert.False(t, seenMeals[combo.Plan.SourceID], "the same meal is not offered again: %s", combo.Plan.Title)
		for id := range comboDishIDs(combo) {
			assert.False(t, seenDishes[id], "dish %s was in the last answer although other dishes are equally good", id)
		}
	}
}

func TestChangingTheRequirementDoesNotRepeatTheLastMeals(t *testing.T) {
	pool := comboRotationPool()
	first := searchMealCombos(newComboTestState(), pool, 2)
	require.Len(t, first.Combos, 2)
	previous := comboPreviousAnswer(first)

	state := newComboTestState()
	state.Intent = "refine"
	state.ActiveResult = previous
	state.ActiveSourceIDs = recommendationSourceIDsFromResult(previous)
	budget := 30.0
	state.Constraints.MaxPrice = &budget
	second := searchMealCombos(state, pool, 2)
	require.NotEmpty(t, second.Combos)
	for _, combo := range second.Combos {
		assert.LessOrEqual(t, combo.Plan.Price, budget)
		for _, old := range first.Combos {
			assert.NotEqual(t, old.Plan.SourceID, combo.Plan.SourceID)
		}
	}
}

// A follow-up about where to buy an offered meal expands it into its parts, each
// with its own window and price, even when the parts are sold at different counters.
func TestLocationQuestionAboutAnAssembledMealNamesEachCounter(t *testing.T) {
	pool := comboZijingPool()
	first := searchMealCombos(newComboTestState(), pool, 6)
	var chosen *mealCombo
	for i := range first.Combos {
		if first.Combos[i].CrossWindow {
			chosen = &first.Combos[i]
			break
		}
	}
	require.NotNil(t, chosen, "the fixture sells its rice, dishes and vegetables at different counters")
	previous := comboPreviousAnswer(mealComboReport{Combos: []mealCombo{*chosen}})

	state := newComboTestState()
	state.Intent = "location"
	state.ActiveResult = previous
	state.ActiveSourceIDs = recommendationSourceIDsFromResult(previous)
	svc := NewStatsService(&mockStatsRepo{candidates: pool}, nil)
	_, err := svc.executeCampusDietDetailsTool(context.Background(), state, `{"source_ids":["`+chosen.Plan.SourceID+`"]}`, false)
	require.NoError(t, err)
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{}, true, "")
	require.NoError(t, err)
	for _, part := range chosen.Components {
		assert.Contains(t, result.Answer, part.Title+"：")
		assert.Contains(t, result.Answer, part.WindowName)
	}
}
