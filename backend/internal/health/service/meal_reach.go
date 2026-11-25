package service

import "math"

// How far a venue is decides whether a recommendation is usable. 2026-11-24 20:50 near 清华
// the home card offered 中国农业大学 canteens 3–5 km away: distance cost 2 points per km, and
// a far dish with a higher health fit set the comparison band alone, so nearer options never
// competed with it. Distances are straight-line estimates, so these are engineering
// tolerances, not travel times.

const (
	// mealWalkableKM is an ordinary walk to a meal; within it distance hardly matters.
	mealWalkableKM = 1.2
	// mealReachDiscountPerKM lowers the health fit used for comparing options, per km
	// beyond the walk, up to mealReachDiscountMax.
	mealReachDiscountPerKM = 3.0
	mealReachDiscountMax   = 8.0
)

// mealDistancePenalty is what a venue's distance costs in the selection score: 2 points per
// km on foot as before, then steeply (3 km = 15, 5 km = 24, the most).
func mealDistancePenalty(km float64) float64 {
	walk := mealWalkableKM * 2
	switch {
	case km <= 0:
		return 0
	case km <= mealWalkableKM:
		return km * 2
	case km <= 3:
		return walk + (km-mealWalkableKM)*7
	}
	return math.Min(24, walk+(3-mealWalkableKM)*7+(km-3)*4.5)
}

// mealReachDiscount is how many health-fit points a venue beyond walking range gives up when
// options are compared: a dish 3 km away must be clearly better, not marginally better, to
// keep nearer dishes out of the comparison. A venue without a distance is not discounted.
func mealReachDiscount(km *float64) float64 {
	if km == nil || *km <= mealWalkableKM {
		return 0
	}
	return math.Min(mealReachDiscountMax, roundDietNumber((*km-mealWalkableKM)*mealReachDiscountPerKM))
}

// mealReachFit is the health fit used to compare options that are different distances away.
// The health fit shown to the user and the engine's evaluation are unchanged.
func mealReachFit(m groundedMeal) float64 {
	return m.evaluation.Scores.HealthFit - mealReachDiscount(m.candidate.DistanceKM)
}

// mealOwnSchoolBonus prefers the canteens of the school in the user's profile when scores
// are close: they know the place and can pay there. Without a location the profile school
// is the whole search scope, as before.
func mealOwnSchoolBonus(state *campusDietAgentRunState, c DietRecommendationCandidate) float64 {
	if state == nil || state.School.ID == "" || c.SchoolID != state.School.ID {
		return 0
	}
	if state.Location == nil {
		return 10
	}
	return 5
}
