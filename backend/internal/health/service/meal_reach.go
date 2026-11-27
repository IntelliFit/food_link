package service

import (
	"math"
	"regexp"
)

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

const (
	// mealNearbyKM is close enough to count as "just here" when judging a detour.
	mealNearbyKM = 1.5
	// mealDetourKM is too far to offer while about-as-good options are nearby.
	mealDetourKM = 2.5
)

// "远一点也行", "打车去": the user accepts a longer trip.
var mealAcceptsFarVenues = regexp.MustCompile(`远(?:一)?点(?:也|都)?(?:行|可以|没关系|无所谓)|不怕远|远的也|可以远|打车|开车|骑车|骑行`)

// mealDropDetours removes options more than mealDetourKM away when at least two different
// options within mealNearbyKM are about as good (within mealModelPickTolerance health
// points). Real-model replay 2026-11-26: the chat picked porridge 4.8, 4.0 and 3.0 km away
// although two shops within 1.5 km sold much the same. Delivery, a place the user named and
// a user who accepts a longer trip are left alone. The second result names what was removed.
func mealDropDetours(state *campusDietAgentRunState, pool []groundedMeal) ([]groundedMeal, map[string]bool) {
	if state == nil || state.Constraints.Scene == "takeout" || state.Constraints.CanteenName != "" || len(state.ExplicitSchools) > 0 || mealAcceptsFarVenues.MatchString(state.Question) {
		return pool, nil
	}
	detours := map[string]bool{}
	for _, far := range pool {
		km := far.candidate.DistanceKM
		if far.candidate.Source == "food_record" || km == nil || *km <= mealDetourKM || !far.evaluation.Feasible {
			continue
		}
		near := map[string]bool{}
		for _, m := range pool {
			d := m.candidate.DistanceKM
			if m.candidate.Source != "food_record" && m.evaluation.Feasible && d != nil && *d <= mealNearbyKM &&
				m.evaluation.Scores.HealthFit >= far.evaluation.Scores.HealthFit-mealModelPickTolerance {
				near[mealFingerprint(m.candidate)] = true
			}
		}
		if len(near) >= 2 {
			detours[far.candidate.SourceID] = true
		}
	}
	if len(detours) == 0 {
		return pool, nil
	}
	kept := make([]groundedMeal, 0, len(pool))
	for _, m := range pool {
		if !detours[m.candidate.SourceID] {
			kept = append(kept, m)
		}
	}
	return kept, detours
}
