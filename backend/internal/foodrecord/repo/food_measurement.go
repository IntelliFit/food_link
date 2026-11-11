package repo

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/foodrecord/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

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
