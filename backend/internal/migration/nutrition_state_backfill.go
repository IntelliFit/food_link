package migration

import (
	"context"
	"fmt"
	"strings"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type NutritionStateBackfillRow struct {
	ID            string                                  `json:"id"`
	CanonicalName string                                  `json:"canonical_name"`
	Source        string                                  `json:"source"`
	BeforeState   string                                  `json:"before_state"`
	BeforeBasis   string                                  `json:"before_basis"`
	After         foodrecorddomain.NutritionStateMetadata `json:"after"`
}

type NutritionStateBackfillPlan struct {
	Version string                      `json:"version"`
	Scanned int                         `json:"scanned"`
	Skipped int                         `json:"skipped"`
	Rows    []NutritionStateBackfillRow `json:"rows"`
}

func PlanNutritionStateBackfill(ctx context.Context, db *gorm.DB) (*NutritionStateBackfillPlan, error) {
	var foods []migrationdo.FoodNutritionDO
	if err := db.WithContext(ctx).Select("id,canonical_name,source,food_state,weight_basis,preparation_method").Where("is_active = ? AND (food_state='' OR weight_basis='')", true).Order("id").Find(&foods).Error; err != nil {
		return nil, err
	}
	plan := &NutritionStateBackfillPlan{Version: foodrecorddomain.NutritionStateEvidenceVersion, Scanned: len(foods), Rows: []NutritionStateBackfillRow{}}
	for _, food := range foods {
		source := ""
		if food.Source != nil {
			source = *food.Source
		}
		after, ok := foodrecorddomain.InferAuthoritativeNutritionState(food.CanonicalName, source)
		if !ok || (food.FoodState != "" && food.FoodState != after.FoodState) || (food.WeightBasis != "" && food.WeightBasis != after.WeightBasis) || (food.PreparationMethod != "" && food.PreparationMethod != after.PreparationMethod) {
			plan.Skipped++
			continue
		}
		plan.Rows = append(plan.Rows, NutritionStateBackfillRow{ID: food.ID, CanonicalName: food.CanonicalName, Source: source, BeforeState: food.FoodState, BeforeBasis: food.WeightBasis, After: after})
	}
	return plan, nil
}

// ApplyNutritionStateBackfill fills explicit source evidence only. No names,
// nutrition values, aliases, visibility or quality tiers are rewritten.
func ApplyNutritionStateBackfill(ctx context.Context, db *gorm.DB, plan *NutritionStateBackfillPlan) (int, error) {
	if plan == nil || plan.Version != foodrecorddomain.NutritionStateEvidenceVersion {
		return 0, fmt.Errorf("营养状态补全计划版本无效")
	}
	updated := 0
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range plan.Rows {
			var current migrationdo.FoodNutritionDO
			if err := tx.Where("id = ?", row.ID).First(&current).Error; err != nil {
				return err
			}
			if current.FoodState == row.After.FoodState && current.WeightBasis == row.After.WeightBasis {
				continue
			}
			if current.CanonicalName != row.CanonicalName || current.Source == nil || *current.Source != row.Source || current.FoodState != row.BeforeState || current.WeightBasis != row.BeforeBasis {
				return fmt.Errorf("营养条目在计划生成后已变化: %s", row.ID)
			}
			inferred, ok := foodrecorddomain.InferAuthoritativeNutritionState(current.CanonicalName, *current.Source)
			if !ok || inferred.FoodState != row.After.FoodState || inferred.WeightBasis != row.After.WeightBasis || inferred.PreparationMethod != row.After.PreparationMethod {
				return fmt.Errorf("营养状态计划缺少一致来源证据: %s", row.ID)
			}
			evidence := datatypes.JSONMap{}
			for k, v := range current.QualityEvidence {
				evidence[k] = v
			}
			evidence["nutrition_state_backfill"] = map[string]any{"version": plan.Version, "description": row.CanonicalName, "before_state": row.BeforeState, "before_basis": row.BeforeBasis, "applied_at": time.Now().UTC().Format(time.RFC3339)}
			tags := append([]string(nil), current.StateTags...)
			for _, tag := range inferred.StateTags {
				found := false
				for _, old := range tags {
					if old == tag {
						found = true
						break
					}
				}
				if !found {
					tags = append(tags, tag)
				}
			}
			if tags == nil {
				tags = []string{}
			}
			patch := map[string]any{"food_state": inferred.FoodState, "weight_basis": inferred.WeightBasis, "quality_evidence": evidence, "state_tags": datatypes.JSONSlice[string](tags), "updated_at": time.Now().UTC()}
			if strings.TrimSpace(current.PreparationMethod) == "" {
				patch["preparation_method"] = inferred.PreparationMethod
			}
			result := tx.Model(&migrationdo.FoodNutritionDO{}).Where("id=? AND food_state=? AND weight_basis=? AND updated_at=?", row.ID, row.BeforeState, row.BeforeBasis, current.UpdatedAt).Updates(patch)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("营养状态补全遇到并发更新: %s", row.ID)
			}
			updated++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return updated, nil
}
