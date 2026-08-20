package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	contributiondomain "food_link/backend/internal/foodcontribution/domain"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ContributionRepo struct{ db *gorm.DB }

func NewContributionRepo(db *gorm.DB) *ContributionRepo { return &ContributionRepo{db: db} }

type ListInput struct {
	Query  string
	Status string
	Limit  int
	Offset int
}

type ListResult struct {
	Items []contributiondomain.FoodNutritionContribution
	Total int64
}

func (r *ContributionRepo) Create(ctx context.Context, item *contributiondomain.FoodNutritionContribution) error {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.NewString()
	}
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *ContributionRepo) Mine(ctx context.Context, userID string) ([]contributiondomain.FoodNutritionContribution, error) {
	var items []contributiondomain.FoodNutritionContribution
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Find(&items).Error
	return items, err
}

func (r *ContributionRepo) Get(ctx context.Context, id string) (*contributiondomain.FoodNutritionContribution, error) {
	var item contributiondomain.FoodNutritionContribution
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, commonerrors.ErrNotFound
	}
	return &item, err
}

func (r *ContributionRepo) List(ctx context.Context, input ListInput) (*ListResult, error) {
	query := r.db.WithContext(ctx).Model(&contributiondomain.FoodNutritionContribution{})
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if keyword := strings.TrimSpace(input.Query); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("canonical_name ILIKE ? OR source_text ILIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	var items []contributiondomain.FoodNutritionContribution
	if err := query.Order("CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC").Limit(limit).Offset(input.Offset).Find(&items).Error; err != nil {
		return nil, err
	}
	return &ListResult{Items: items, Total: total}, nil
}

func (r *ContributionRepo) MarkRewarded(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&contributiondomain.FoodNutritionContribution{}).
		Where("id = ? AND rewarded_at IS NULL", id).Update("rewarded_at", time.Now()).Error
}

func (r *ContributionRepo) Review(ctx context.Context, id, action, targetFoodID, note, reviewerID string) (*contributiondomain.FoodNutritionContribution, error) {
	var result contributiondomain.FoodNutritionContribution
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&result).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return commonerrors.ErrNotFound
			}
			return err
		}
		if result.Status == "approved" && (action == "approve_new" || action == "merge_existing") {
			return nil
		}
		if result.Status != "pending" {
			return &commonerrors.AppError{Code: 10002, Message: "该贡献已完成审核", HTTPStatus: 409}
		}
		if action != "reject" && (result.KcalPer100g <= 0 || result.ProteinPer100g < 0 || result.CarbsPer100g < 0 || result.FatPer100g < 0) {
			return &commonerrors.AppError{Code: 10002, Message: "该贡献的营养数据无效，不能审核通过", HTTPStatus: 400}
		}
		now := time.Now()
		updates := map[string]any{
			"review_action": action,
			"review_note":   note,
			"reviewed_by":   nilIfEmpty(reviewerID),
			"reviewed_at":   now,
			"updated_at":    now,
		}
		if action == "reject" {
			updates["status"] = "rejected"
			if err := tx.Model(&result).Updates(updates).Error; err != nil {
				return err
			}
			if err := mirrorLegacyCustomFoodStatus(tx, result.LegacyCustomFoodID, "rejected"); err != nil {
				return err
			}
			return tx.Where("id = ?", id).First(&result).Error
		}

		foodID, err := r.publishNutrition(tx, result, action, targetFoodID, reviewerID, now)
		if err != nil {
			return err
		}
		updates["status"] = "approved"
		updates["target_food_id"] = foodID
		if err := tx.Model(&result).Updates(updates).Error; err != nil {
			return err
		}
		if err := mirrorLegacyCustomFoodStatus(tx, result.LegacyCustomFoodID, "published"); err != nil {
			return err
		}
		return tx.Where("id = ?", id).First(&result).Error
	})
	return &result, err
}

func (r *ContributionRepo) publishNutrition(tx *gorm.DB, contribution contributiondomain.FoodNutritionContribution, action, targetFoodID, reviewerID string, reviewedAt time.Time) (string, error) {
	if strings.TrimSpace(contribution.NormalizedName) == "" || contribution.KcalPer100g <= 0 || contribution.ProteinPer100g < 0 || contribution.CarbsPer100g < 0 || contribution.FatPer100g < 0 {
		return "", &commonerrors.AppError{Code: 10002, Message: "该贡献的名称或营养数据无效，不能审核通过", HTTPStatus: 400}
	}
	qualityEvidence := datatypes.JSONMap{
		"source":               "user_contribution",
		"contribution_id":      contribution.ID,
		"source_text":          contribution.SourceText,
		"evidence_image_paths": contribution.EvidenceImagePaths,
		"reviewed_by":          reviewerID,
	}
	values := map[string]any{
		"canonical_name":      contribution.CanonicalName,
		"normalized_name":     contribution.NormalizedName,
		"kcal_per_100g":       contribution.KcalPer100g,
		"protein_per_100g":    contribution.ProteinPer100g,
		"carbs_per_100g":      contribution.CarbsPer100g,
		"fat_per_100g":        contribution.FatPer100g,
		"source":              "user_contribution",
		"quality_tier":        foodrecorddomain.NutritionQualityReviewedEstimate,
		"quality_evidence":    qualityEvidence,
		"quality_reviewed_at": reviewedAt,
		"is_active":           true,
		"updated_at":          reviewedAt,
	}
	applyKnownExtraNutrients(values, contribution.ExtraNutrients)
	if len(contribution.EvidenceImagePaths) > 0 {
		values["image_path"] = contribution.EvidenceImagePaths[0]
		encoded, err := json.Marshal(contribution.EvidenceImagePaths)
		if err != nil {
			return "", fmt.Errorf("encode contribution evidence images: %w", err)
		}
		values["image_paths"] = datatypes.JSON(encoded)
	}

	if action == "merge_existing" {
		targetFoodID = strings.TrimSpace(targetFoodID)
		if targetFoodID == "" {
			return "", &commonerrors.AppError{Code: 10002, Message: "合并已有食物时必须选择目标食物", HTTPStatus: 400}
		}
		var target foodrecorddomain.FoodNutrition
		if err := tx.Where("id = ?", targetFoodID).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", commonerrors.ErrNotFound
			}
			return "", err
		}
		targetTier := foodrecorddomain.EffectiveNutritionQualityTier(target)
		if targetTier == foodrecorddomain.NutritionQualityAuthoritative {
			return "", &commonerrors.AppError{Code: 10002, Message: "权威来源食物不能用用户贡献直接覆盖，请审核为新食物或选择其他目标", HTTPStatus: 409}
		}
		if targetTier == foodrecorddomain.NutritionQualityLegacyCurated {
			qualityEvidence["previous_source"] = target.Source
			qualityEvidence["previous_quality_tier"] = targetTier
			qualityEvidence["previous_quality_evidence"] = target.QualityEvidence
			values["source"] = target.Source
			values["quality_tier"] = targetTier
			values["quality_evidence"] = qualityEvidence
		}
		// 合并只更新营养和审核依据，不把用户写法覆盖为标准展示名。
		delete(values, "canonical_name")
		delete(values, "normalized_name")
		if err := tx.Model(&foodrecorddomain.FoodNutrition{}).Where("id = ?", targetFoodID).Updates(values).Error; err != nil {
			return "", err
		}
		return targetFoodID, nil
	}

	var existing foodrecorddomain.FoodNutrition
	err := tx.Where("normalized_name = ?", contribution.NormalizedName).First(&existing).Error
	if err == nil {
		return "", &commonerrors.AppError{Code: 10002, Message: "标准库已有同名食物，请改用合并已有食物", HTTPStatus: 409}
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	foodID := uuid.NewString()
	values["id"] = foodID
	values["created_at"] = reviewedAt
	if err := tx.Table("food_nutrition_library").Create(values).Error; err != nil {
		return "", fmt.Errorf("create reviewed nutrition food: %w", err)
	}
	return foodID, nil
}

func mirrorLegacyCustomFoodStatus(tx *gorm.DB, legacyID *string, status string) error {
	if legacyID == nil || strings.TrimSpace(*legacyID) == "" {
		return nil
	}
	return tx.Table("user_custom_foods").Where("id = ?", strings.TrimSpace(*legacyID)).Updates(map[string]any{
		"public_status": status,
		"updated_at":    time.Now(),
	}).Error
}

func applyKnownExtraNutrients(values map[string]any, extra map[string]any) {
	fields := map[string][]string{
		"fiber_per_100g":             {"fiber_per_100g", "fiber"},
		"sugar_per_100g":             {"sugar_per_100g", "sugar"},
		"saturated_fat_per_100g":     {"saturated_fat_per_100g", "saturatedFat"},
		"cholesterol_mg_per_100g":    {"cholesterol_mg_per_100g", "cholesterolMg"},
		"sodium_mg_per_100g":         {"sodium_mg_per_100g", "sodium_mg", "sodiumMg"},
		"potassium_mg_per_100g":      {"potassium_mg_per_100g", "potassiumMg"},
		"calcium_mg_per_100g":        {"calcium_mg_per_100g", "calciumMg"},
		"iron_mg_per_100g":           {"iron_mg_per_100g", "ironMg"},
		"magnesium_mg_per_100g":      {"magnesium_mg_per_100g", "magnesiumMg"},
		"zinc_mg_per_100g":           {"zinc_mg_per_100g", "zincMg"},
		"vitamin_a_rae_mcg_per_100g": {"vitamin_a_rae_mcg_per_100g", "vitaminARaeMcg"},
		"vitamin_c_mg_per_100g":      {"vitamin_c_mg_per_100g", "vitaminCMg"},
		"vitamin_d_mcg_per_100g":     {"vitamin_d_mcg_per_100g", "vitaminDMcg"},
		"vitamin_e_mg_per_100g":      {"vitamin_e_mg_per_100g", "vitaminEMg"},
		"vitamin_k_mcg_per_100g":     {"vitamin_k_mcg_per_100g", "vitaminKMcg"},
		"thiamin_mg_per_100g":        {"thiamin_mg_per_100g", "thiaminMg"},
		"riboflavin_mg_per_100g":     {"riboflavin_mg_per_100g", "riboflavinMg"},
		"niacin_mg_per_100g":         {"niacin_mg_per_100g", "niacinMg"},
		"vitamin_b6_mg_per_100g":     {"vitamin_b6_mg_per_100g", "vitaminB6Mg"},
		"folate_mcg_per_100g":        {"folate_mcg_per_100g", "folateMcg"},
		"vitamin_b12_mcg_per_100g":   {"vitamin_b12_mcg_per_100g", "vitaminB12Mcg"},
	}
	for column, aliases := range fields {
		for _, alias := range aliases {
			if number, ok := nonNegativeContributionNumber(extra[alias]); ok {
				values[column] = number
				break
			}
		}
	}
}

func nonNegativeContributionNumber(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, number >= 0
}

func nilIfEmpty(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
