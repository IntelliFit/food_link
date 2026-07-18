package repo

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func normalizeFoodNutritionName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// FoodNutritionRepo provides admin CRUD for food_nutrition_library.
type FoodNutritionRepo struct {
	db *gorm.DB
}

func NewFoodNutritionRepo(db *gorm.DB) *FoodNutritionRepo {
	return &FoodNutritionRepo{db: db}
}

type ListFoodNutritionInput struct {
	Query  string
	Active string
	Limit  int
	Offset int
}

type FoodNutritionPatch map[string]any

type ListFoodNutritionResult struct {
	Items []domain.FoodNutrition
	Total int64
}

func (r *FoodNutritionRepo) List(ctx context.Context, input ListFoodNutritionInput) (*ListFoodNutritionResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	q := strings.TrimSpace(input.Query)
	active := strings.TrimSpace(input.Active)
	activeFilter := ""
	switch active {
	case "true":
		activeFilter = "AND f.is_active = TRUE"
	case "false":
		activeFilter = "AND f.is_active = FALSE"
	}

	// 没有搜索词时保持原来的简单列表
	if q == "" {
		query := r.db.WithContext(ctx).Model(&domain.FoodNutrition{})
		switch active {
		case "true":
			query = query.Where("is_active = ?", true)
		case "false":
			query = query.Where("is_active = ?", false)
		}
		var total int64
		if err := query.Count(&total).Error; err != nil {
			return nil, err
		}
		var items []domain.FoodNutrition
		if err := query.Order("updated_at DESC NULLS LAST, created_at DESC NULLS LAST").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
			return nil, err
		}
		return &ListFoodNutritionResult{Items: items, Total: total}, nil
	}

	like := "%" + strings.ToLower(q) + "%"
	activeFilterInner := strings.ReplaceAll(activeFilter, "f.", "f2.")

	var total int64
	countSQL := fmt.Sprintf(`
		SELECT COUNT(DISTINCT f.id)
		FROM food_nutrition_library f
		LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
		WHERE (LOWER(f.canonical_name) LIKE ? OR LOWER(a.alias_name) LIKE ?)
		%s
	`, activeFilter)
	if err := r.db.WithContext(ctx).Raw(countSQL, like, like).Scan(&total).Error; err != nil {
		return nil, err
	}

	listSQL := fmt.Sprintf(`
		SELECT f.*
		FROM food_nutrition_library f
		WHERE f.id IN (
			SELECT f2.id
			FROM food_nutrition_library f2
			LEFT JOIN food_nutrition_aliases a2 ON a2.food_id = f2.id
			WHERE (LOWER(f2.canonical_name) LIKE ? OR LOWER(a2.alias_name) LIKE ?)
			%s
		)
		ORDER BY
			CASE
				WHEN LOWER(f.canonical_name) = LOWER(?) THEN 0
				WHEN EXISTS (SELECT 1 FROM food_nutrition_aliases a3 WHERE a3.food_id = f.id AND LOWER(a3.alias_name) = LOWER(?)) THEN 1
				WHEN LOWER(f.canonical_name) LIKE LOWER(?) || '%%' THEN 2
				WHEN EXISTS (SELECT 1 FROM food_nutrition_aliases a4 WHERE a4.food_id = f.id AND LOWER(a4.alias_name) LIKE LOWER(?) || '%%') THEN 3
				WHEN LOWER(f.canonical_name) LIKE '%%' || LOWER(?) || '%%' THEN 4
				WHEN EXISTS (SELECT 1 FROM food_nutrition_aliases a5 WHERE a5.food_id = f.id AND LOWER(a5.alias_name) LIKE '%%' || LOWER(?) || '%%') THEN 5
				ELSE 6
			END ASC,
			CASE WHEN f.canonical_name ~ '[一-龥]' THEN 0 ELSE 1 END ASC,
			CASE WHEN f.source LIKE 'usda%%' THEN 2 ELSE 0 END ASC,
			LENGTH(f.canonical_name) ASC,
			f.canonical_name ASC
		LIMIT ? OFFSET ?
	`, activeFilterInner)

	var items []domain.FoodNutrition
	if err := r.db.WithContext(ctx).Raw(listSQL, like, like, q, q, q, q, q, q, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return &ListFoodNutritionResult{Items: items, Total: total}, nil
}

func (r *FoodNutritionRepo) Get(ctx context.Context, id string) (*domain.FoodNutrition, error) {
	var item domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *FoodNutritionRepo) Create(ctx context.Context, item *domain.FoodNutrition) (*domain.FoodNutrition, error) {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.New().String()
	}
	item.CanonicalName = strings.TrimSpace(item.CanonicalName)
	item.NormalizedName = normalizeFoodNutritionName(item.CanonicalName)
	if domain.IsAIGeneratedNutritionSource(item.Source) && strings.TrimSpace(item.QualityTier) != domain.NutritionQualityReviewedEstimate {
		item.QualityTier = domain.NutritionQualityPlausible
		item.IsActive = false
	}
	if strings.TrimSpace(item.QualityTier) == "" {
		item.QualityTier = domain.NutritionQualityLegacyCurated
	}
	if item.QualityEvidence == nil {
		item.QualityEvidence = datatypes.JSONMap{"approval_source": "admin_create"}
	}
	if item.QualityReviewedAt == nil {
		now := time.Now()
		item.QualityReviewedAt = &now
	}
	if err := r.db.WithContext(ctx).Create(item).Error; err != nil {
		return nil, err
	}
	if item.CanonicalName != "" {
		_ = r.ensureAlias(ctx, item.ID, item.CanonicalName)
	}
	return item, nil
}

func (r *FoodNutritionRepo) Update(ctx context.Context, id string, patch FoodNutritionPatch) (*domain.FoodNutrition, error) {
	current, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	active := current.IsActive
	source := current.Source
	tier := domain.EffectiveNutritionQualityTier(*current)
	evidence := current.QualityEvidence
	if value, ok := patch["is_active"].(bool); ok {
		active = value
	}
	if value, ok := patch["source"].(string); ok {
		source = strings.TrimSpace(value)
	}
	if value, ok := patch["quality_tier"].(string); ok {
		tier = strings.TrimSpace(value)
	}
	if value, ok := patch["quality_evidence"].(datatypes.JSONMap); ok {
		evidence = value
	}
	if active {
		switch tier {
		case domain.NutritionQualityAuthoritative, domain.NutritionQualityLegacyCurated:
			if domain.IsAIGeneratedNutritionSource(source) {
				return nil, fmt.Errorf("AI 来源不能直接激活为 %s", tier)
			}
		case domain.NutritionQualityReviewedEstimate:
			if len(evidence) == 0 {
				return nil, fmt.Errorf("reviewed_estimate 缺少审核证据")
			}
		default:
			return nil, fmt.Errorf("可信等级 %s 不能设为 active", tier)
		}
	}
	if err := r.db.WithContext(ctx).
		Model(&domain.FoodNutrition{}).
		Where("id = ?", id).
		Updates(map[string]any(patch)).Error; err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *FoodNutritionRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Model(&domain.FoodNutrition{}).
		Where("id = ?", id).
		Update("is_active", false).Error
}

func (r *FoodNutritionRepo) ensureAlias(ctx context.Context, foodID, rawName string) error {
	raw := strings.TrimSpace(rawName)
	if raw == "" {
		return nil
	}
	normalized := normalizeFoodNutritionName(raw)
	var existing domain.FoodNutritionAlias
	if err := r.db.WithContext(ctx).
		Model(&domain.FoodNutritionAlias{}).
		Where("food_id = ? AND normalized_alias = ?", foodID, normalized).
		First(&existing).Error; err == nil {
		return r.db.WithContext(ctx).Model(&domain.FoodNutritionAlias{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"match_status":      domain.NutritionAliasApprovedExact,
				"approval_evidence": datatypes.JSONMap{"approval_source": "admin_canonical_name"},
				"reviewed_at":       time.Now(),
			}).Error
	} else if err != gorm.ErrRecordNotFound {
		return err
	}
	return r.db.WithContext(ctx).
		Table("food_nutrition_aliases").
		Create(map[string]any{
			"id":                uuid.New().String(),
			"food_id":           foodID,
			"alias_name":        raw,
			"normalized_alias":  normalized,
			"match_status":      domain.NutritionAliasApprovedExact,
			"approval_evidence": datatypes.JSONMap{"approval_source": "admin_canonical_name"},
			"reviewed_at":       time.Now(),
		}).Error
}
