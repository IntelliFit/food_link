package repo

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"

	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/foodrecord/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var legacyVolumePortion = regexp.MustCompile(`(?i)^\s*[0-9]+(?:\.[0-9]+)?\s*(?:ml|毫升)\s*$`)

// RestoreLegacyVolumeItem accepts only an explicitly volume-labelled library
// selection. A name such as "milk", an arbitrary gram payload, or a missing
// source is insufficient. Nutrition comes from the visible source row, never
// from the old client's already-scaled totals.
func (r *FoodRecordRepo) RestoreLegacyVolumeItem(ctx context.Context, userID string, item *domain.FoodItem) (bool, error) {
	if item == nil || item.Measurement != nil || item.ManualSource == nil || item.ManualSourceID == nil ||
		item.ManualPortionLabel == nil || !legacyVolumePortion.MatchString(*item.ManualPortionLabel) ||
		item.Weight <= 0 || math.IsNaN(item.Weight) || math.IsInf(item.Weight, 0) {
		return false, nil
	}
	if _, err := uuid.Parse(*item.ManualSourceID); err != nil {
		return false, nil
	}
	var m *foodmeasure.Measurement
	switch *item.ManualSource {
	case "packaged_food":
		var row domain.PackagedFood
		err := r.db.WithContext(ctx).Where("id = ? AND is_active = TRUE AND COALESCE(NULLIF(review_status, ''), 'active') = 'active'", *item.ManualSourceID).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if row.NutritionBasisUnit == nil {
			return false, nil
		}
		unit, known := foodmeasure.PackagedPer100Unit(*row.NutritionBasisUnit)
		if !known || unit != foodmeasure.Milliliter {
			return false, nil
		}
		m = &foodmeasure.Measurement{Unit: unit, BasisUnit: unit, BasisAmount: 100, NutrientsPerBasis: row.PackagedLabelNutrients()}
	case "custom":
		var row struct{ Measurement json.RawMessage }
		err := r.db.WithContext(ctx).Table("user_custom_foods").Select("measurement").
			Where("id = ? AND status = ? AND (user_id = ? OR public_status = ?)", *item.ManualSourceID, "active", userID, "published").Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if len(row.Measurement) == 0 || string(row.Measurement) == "null" {
			return false, nil
		}
		m = &foodmeasure.Measurement{}
		if err := json.Unmarshal(row.Measurement, m); err != nil {
			return false, err
		}
		if m.Unit != foodmeasure.Milliliter {
			return false, nil
		}
	default:
		return false, nil
	}
	m.Amount = item.Weight // This field is the quantity only in the guarded legacy ml contract.
	if err := m.Validate(); err != nil {
		return false, err
	}
	item.Measurement = m
	if err := domain.ApplyFoodItemMeasurement(item); err != nil {
		return false, err
	}
	return true, nil
}

// SourceRequiresNativeMeasurement detects old clients consuming a new shared
// food while dropping its unit. Legacy gram-only rows continue to work.
func (r *FoodRecordRepo) SourceRequiresNativeMeasurement(ctx context.Context, userID string, item domain.FoodItem) (bool, error) {
	if item.Measurement != nil || item.ManualSource == nil || item.ManualSourceID == nil {
		return false, nil
	}
	if _, err := uuid.Parse(*item.ManualSourceID); err != nil {
		return false, nil // Historical local-only custom IDs have no library row.
	}
	var err error
	switch *item.ManualSource {
	case "custom":
		var row struct{ Measurement json.RawMessage }
		err = r.db.WithContext(ctx).Table("user_custom_foods").Select("measurement").
			Where("id = ? AND status = ? AND (user_id = ? OR public_status = ?)", *item.ManualSourceID, "active", userID, "published").Take(&row).Error
		if err == nil && len(row.Measurement) > 0 && string(row.Measurement) != "null" {
			var measurement foodmeasure.Measurement
			if err := json.Unmarshal(row.Measurement, &measurement); err != nil {
				return false, err
			}
			return measurement.Unit != foodmeasure.Gram, nil
		}
	case "packaged_food":
		var row struct{ NutritionBasisUnit *string }
		err = r.db.WithContext(ctx).Table("packaged_food_library").Select("nutrition_basis_unit").
			Where("id = ?", *item.ManualSourceID).Take(&row).Error
		if err == nil && row.NutritionBasisUnit != nil {
			return strings.Contains(strings.ToLower(*row.NutritionBasisUnit), "ml"), nil
		}
	default:
		return false, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	// Before the additive migration, no newly typed custom rows can exist.
	var state interface{ SQLState() string }
	if errors.As(err, &state) && (state.SQLState() == "42P01" || state.SQLState() == "42703") {
		return false, nil
	}
	return false, err
}
