package service

// Counts describe entries retrieved for this request, not all physical shops or
// verified delivery offers. Each rejected entry has one primary exclusion.
type MealCandidateFunnel struct {
	SourceKind  string                `json:"source_kind"`
	Retrieved   int                   `json:"retrieved"`
	Eligible    int                   `json:"eligible"`
	Shortlisted int                   `json:"shortlisted"`
	Selected    int                   `json:"selected"`
	Excluded    map[string]int        `json:"excluded_by_primary_reason"`
	Samples     []MealExclusionSample `json:"exclusion_samples,omitempty"`
}

type MealExclusionSample struct {
	SourceID string `json:"source_id"`
	Title    string `json:"title"`
	Reason   string `json:"reason"`
}

func mealCandidateSourceKind(c DietRecommendationCandidate) string {
	if c.Source == "food_record" {
		return "history"
	}
	if c.IsCampusFood {
		return "campus"
	}
	return "off_campus"
}

func mealCandidateFunnel(state *campusDietAgentRunState, pool, eligible, chosen []groundedMeal, excluded map[string]bool) []MealCandidateFunnel {
	rows := []MealCandidateFunnel{}
	for _, kind := range []string{"campus", "off_campus", "history"} {
		rows = append(rows, MealCandidateFunnel{SourceKind: kind, Excluded: map[string]int{}})
	}
	indices := map[string]int{"campus": 0, "off_campus": 1, "history": 2}
	allowed := map[string]bool{}
	for _, m := range eligible {
		allowed[m.candidate.Source+":"+m.candidate.SourceID] = true
		rows[indices[mealCandidateSourceKind(m.candidate)]].Eligible++
	}
	if state.EngineVersion == dietDecisionEngineVersion {
		for _, m := range mealArbitrationShortlist(eligible, 36) {
			rows[indices[mealCandidateSourceKind(m.candidate)]].Shortlisted++
		}
	}
	for _, m := range chosen {
		rows[indices[mealCandidateSourceKind(m.candidate)]].Selected++
	}
	for _, m := range pool {
		c := m.candidate
		r := &rows[indices[mealCandidateSourceKind(c)]]
		r.Retrieved++
		if allowed[c.Source+":"+c.SourceID] {
			continue
		}
		reason := groundedMealExclusion(state, c)
		if reason == "" {
			switch {
			case !mealHasEvidenceStructure(c):
				reason = "complete_meal_or_ordering_evidence_missing"
			case excluded[mealFingerprint(c)]:
				reason = "explicitly_excluded"
			case m.date == state.MealContext.Date:
				reason = "already_recorded_today"
			default:
				if _, skipped := mealPreviewMemoryEffect(state, c); skipped {
					reason = "skipped_this_meal"
				} else {
					reason = "other_request_constraint"
				}
			}
		}
		r.Excluded[reason]++
		// A bounded sample is enough to investigate each category; do not
		// return entire rejected menus or sensitive history in normal HTTP.
		if state.ReadOnlyReplay && c.Source != "food_record" && r.Excluded[reason] <= 3 {
			r.Samples = append(r.Samples, MealExclusionSample{SourceID: c.SourceID, Title: c.Title, Reason: reason})
		}
	}
	return rows
}
