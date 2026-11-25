package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 2026-11-24 20:50 near 清华: the home card offered 中国农业大学 canteens about 3–5 km away.
// Distance cost 2 points per km (3 km = 6 points), and a far dish with a higher health fit
// set the comparison band alone, so nearer options never competed.

func reachMeal(id string, km, fit, score float64) groundedMeal {
	c := campusDietAgentTestCandidate(id, "菜-"+id, 500, 30)
	c.DistanceKM = &km
	return groundedMeal{candidate: c, score: score, evaluation: dietDecisionEvaluation{Candidate: c, Feasible: true, Scores: DietDecisionScorecard{HealthFit: fit, Version: dietDecisionEngineVersion}}}
}

func TestDistanceCostsLittleOnFootAndMuchBeyond(t *testing.T) {
	assert.Zero(t, mealDistancePenalty(0))
	assert.InDelta(t, 1.4, mealDistancePenalty(0.7), 0.01, "a short walk costs as before")
	assert.Greater(t, mealDistancePenalty(3), 14.0, "3 km used to cost 6")
	assert.Greater(t, mealDistancePenalty(5), mealDistancePenalty(3))
	assert.LessOrEqual(t, mealDistancePenalty(40), 24.0)
	for km := 0.1; km < 10; km += 0.1 {
		assert.GreaterOrEqual(t, mealDistancePenalty(km+0.1), mealDistancePenalty(km), "never cheaper when farther")
	}

	assert.Zero(t, mealReachDiscount(nil), "a venue without a distance is not discounted")
	near, far, veryFar := 0.9, 3.0, 9.0
	assert.Zero(t, mealReachDiscount(&near))
	assert.InDelta(t, 5.4, mealReachDiscount(&far), 0.01)
	assert.Equal(t, 8.0, mealReachDiscount(&veryFar))
}

func TestANearOptionCompetesWithASlightlyBetterFarOne(t *testing.T) {
	far := reachMeal("far", 3.0, 80, 80-mealDistancePenalty(3.0))
	near := reachMeal("near", 0.7, 73, 73-mealDistancePenalty(0.7))
	round := mealSelectionRound([]groundedMeal{far, near}, nil)
	require.Len(t, round, 2, "7 points better but 3 km away does not shut the near one out")
	chosen := selectHealthBoundedMeals([]groundedMeal{far, near}, 1)
	require.Len(t, chosen, 1)
	assert.Equal(t, "near", chosen[0].candidate.SourceID)

	// Clearly better food is still worth the trip.
	muchBetter := reachMeal("far", 3.0, 92, 92-mealDistancePenalty(3.0))
	round = mealSelectionRound([]groundedMeal{muchBetter, near}, nil)
	require.Len(t, round, 1)
	assert.Equal(t, "far", round[0].candidate.SourceID)

	// The chat's wider band uses the same reach-adjusted fit.
	ids := mealNearBestIDs([]groundedMeal{reachMeal("far", 3.0, 84, 0), reachMeal("near", 0.7, 70, 0)})
	assert.True(t, ids["near"], "84 at 3 km compares as 78.6, so 70 is within 10")
	kept, rejected, _ := acceptNearBestPicks([]groundedMeal{reachMeal("far", 3.0, 84, 0), reachMeal("near", 0.7, 70, 0)}, []string{"near"}, 3)
	assert.Len(t, kept, 1)
	assert.Empty(t, rejected)
}

func TestOwnSchoolIsPreferredWhenScoresAreClose(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	own := campusDietAgentTestCandidate("own", "本校菜", 500, 30)
	other := campusDietAgentTestCandidate("other", "外校菜", 500, 30)
	other.SchoolID, other.SchoolName = "school-cau", "中国农业大学"
	assert.Equal(t, 10.0, mealOwnSchoolBonus(state, own), "without a location the profile school is the search scope")
	assert.Zero(t, mealOwnSchoolBonus(state, other))
	state.Location = campusDietAgentTestLocation()
	assert.Equal(t, 5.0, mealOwnSchoolBonus(state, own))
	assert.Zero(t, mealOwnSchoolBonus(state, other))
	state.School.ID = ""
	assert.Zero(t, mealOwnSchoolBonus(state, own), "no profile school, no preference")
}

// Real-model replay 2026-11-26 of the 11-24 20:50 case: the chat still picked porridge 4.8,
// 4.0 and 3.0 km away although two shops within 1.5 km sold much the same.
func TestFarOptionsAreADetourWhenNearOnesAreAboutAsGood(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	far := reachMeal("far", 4.8, 76, 0)
	near1, near2 := reachMeal("near1", 0.9, 70, 0), reachMeal("near2", 1.5, 74, 0)
	kept, detours := mealDropDetours(state, []groundedMeal{far, near1, near2})
	assert.True(t, detours["far"])
	require.Len(t, kept, 2)

	// One near option is not a choice yet; a far one that is clearly better stays.
	_, detours = mealDropDetours(state, []groundedMeal{far, near1})
	assert.Empty(t, detours)
	_, detours = mealDropDetours(state, []groundedMeal{reachMeal("far", 4.8, 90, 0), near1, near2})
	assert.Empty(t, detours, "more than 10 points better is worth the trip")
	// 2 km is not a detour, and delivery or a place the user named is their own choice.
	_, detours = mealDropDetours(state, []groundedMeal{reachMeal("mid", 2.0, 76, 0), near1, near2})
	assert.Empty(t, detours)
	takeout := newCampusDietAgentTestState("initial", nil)
	takeout.Constraints.Scene = "takeout"
	_, detours = mealDropDetours(takeout, []groundedMeal{far, near1, near2})
	assert.Empty(t, detours)
	named := newCampusDietAgentTestState("initial", nil)
	named.Constraints.CanteenName = "和园一食堂"
	_, detours = mealDropDetours(named, []groundedMeal{far, near1, near2})
	assert.Empty(t, detours)
	asked := newCampusDietAgentTestState("initial", nil)
	asked.Question = "远一点也行，推荐点好的"
	_, detours = mealDropDetours(asked, []groundedMeal{far, near1, near2})
	assert.Empty(t, detours)
}
