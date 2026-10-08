package repo

import (
	"context"
	"encoding/json"
	"food_link/backend/internal/health/domain"
)

// Read the actual collection metadata instead of reconstructing meal periods,
// portion counts or pricing modes from nutrient estimates. No schema changes.
func (r *StatsRepo) enrichDietMenuEvidence(ctx context.Context, candidates []domain.DietRecommendationCandidate) error {
	if len(candidates) == 0 {
		return nil
	}
	ids := make([]string, 0, len(candidates))
	for _, c := range candidates {
		ids = append(ids, c.SourceID)
	}
	var rows []struct {
		ID                    string
		MealPeriodsJSON       string
		AvailableWeekdaysJSON string
		AvailabilityNote      string
		AvailabilityStatus    string
		PriceType             string
		PriceText             string
		PortionDescription    string
	}
	if err := r.db.WithContext(ctx).Table("public_food_library p").
		Joins("LEFT JOIN campus_food_catalog_items c ON c.id = p.id").
		Select(`p.id, COALESCE(c.meal_periods::text,'[]') AS meal_periods_json,
			COALESCE(c.available_weekdays::text,'[]') AS available_weekdays_json, COALESCE(c.availability_note,'') AS availability_note,
			CASE WHEN p.availability_status IN ('temporarily_unavailable','discontinued') THEN p.availability_status ELSE COALESCE(c.availability_status,p.availability_status,'unknown') END AS availability_status,
			COALESCE(c.price_type,p.price_type,'unknown') AS price_type, COALESCE(c.price_text,'') AS price_text,
			COALESCE(NULLIF(c.portion_description,''),p.portion_description,'') AS portion_description`).
		Where("p.id IN ? AND p.status = 'published'", ids).Scan(&rows).Error; err != nil {
		return err
	}
	byID := map[string]int{}
	for i, c := range candidates {
		byID[c.SourceID] = i
	}
	for _, row := range rows {
		i, ok := byID[row.ID]
		if !ok {
			continue
		}
		c := &candidates[i]
		if err := json.Unmarshal([]byte(row.MealPeriodsJSON), &c.MealPeriods); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(row.AvailableWeekdaysJSON), &c.AvailableWeekdays); err != nil {
			return err
		}
		c.AvailabilityNote = row.AvailabilityNote
		c.AvailabilityStatus, c.PriceType, c.PriceText, c.PortionDescription = row.AvailabilityStatus, row.PriceType, row.PriceText, row.PortionDescription
	}
	return nil
}
