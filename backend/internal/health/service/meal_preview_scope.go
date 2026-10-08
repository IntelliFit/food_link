package service

import (
	"context"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"strings"
)

// A named place is an explicit search scope, not a student identity or GPS fix.
// Reuse the published-menu directory without saving anything into the profile.
func (s *StatsService) resolvePreviewSchools(ctx context.Context, state *campusDietAgentRunState, names []string) error {
	if len(names) > 3 {
		return commonerrors.ErrBadRequest
	}
	seen := map[string]bool{}
	for _, name := range names {
		if strings.TrimSpace(name) == "" || len([]rune(name)) > 60 {
			return commonerrors.ErrBadRequest
		}
		school, err := s.repo.ResolveDietRecommendationSchool(ctx, name)
		if err != nil {
			return err
		}
		if school == nil {
			return commonerrors.ErrBadRequest
		}
		if !seen[school.ID] {
			state.ExplicitSchools = append(state.ExplicitSchools, *school)
			seen[school.ID] = true
		}
	}
	if len(state.ExplicitSchools) > 0 {
		// An explicit destination overrides incidental GPS/profile context.
		state.School = domain.DietRecommendationSchool{}
		state.CampusID, state.CampusName, state.Location = "", "", nil
	}
	return nil
}

type MealCatalogCoverage struct {
	Scope     string                          `json:"scope,omitempty"`
	RadiusKM  float64                         `json:"radius_km,omitempty"`
	School    domain.DietRecommendationSchool `json:"school"`
	Total     int64                           `json:"total_matches"`
	Retrieved int                             `json:"retrieved"`
	Status    string                          `json:"status"`
}
