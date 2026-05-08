package repo

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FoodNutritionRepo struct {
	db *gorm.DB
}

func NewFoodNutritionRepo(db *gorm.DB) *FoodNutritionRepo {
	return &FoodNutritionRepo{db: db}
}

type ResolveResult struct {
	Food        *domain.FoodNutrition
	Status      string
	MatchSource string
	Score       float64
}

func (r *FoodNutritionRepo) ResolveFood(ctx context.Context, name string) (*ResolveResult, error) {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return &ResolveResult{Status: "unresolved", Score: 0}, nil
	}
	lower := strings.ToLower(raw)
	normalized := normalizeFoodName(raw)

	var alias domain.FoodNutritionAlias
	err := r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		First(&alias).Error
	if err == nil && alias.FoodID != "" {
		var food domain.FoodNutrition
		if foodErr := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, alias.FoodID).First(&food).Error; foodErr == nil {
			return &ResolveResult{Food: &food, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
		} else if foodErr != gorm.ErrRecordNotFound {
			return nil, foodErr
		}
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	var food domain.FoodNutrition
	err = r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(canonical_name) = ? OR normalized_name = ?)", true, lower, normalized).
		First(&food).Error
	if err == nil {
		return &ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	candidates, err := r.Search(ctx, raw, 1)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 0 {
		return &ResolveResult{Food: &candidates[0], Status: "fuzzy", MatchSource: "fuzzy", Score: 0.72}, nil
	}
	return &ResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *FoodNutritionRepo) Search(ctx context.Context, query string, limit int) ([]domain.FoodNutrition, error) {
	if limit <= 0 {
		limit = 5
	}
	pattern := fmt.Sprintf("%%%s%%", strings.ToLower(query))
	normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(query))
	var foods []domain.FoodNutrition
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND LOWER(canonical_name) LIKE ?", true, pattern).
		Limit(limit).
		Find(&foods).Error
	if err != nil {
		return nil, err
	}

	var aliases []domain.FoodNutritionAlias
	err = r.db.WithContext(ctx).
		Where("LOWER(alias_name) LIKE ? OR normalized_alias LIKE ?", pattern, normalizedPattern).
		Limit(limit).
		Find(&aliases).Error
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	for _, f := range foods {
		seen[f.ID] = true
	}

	if len(aliases) > 0 {
		foodIDs := make([]string, 0, len(aliases))
		for _, a := range aliases {
			if !seen[a.FoodID] {
				foodIDs = append(foodIDs, a.FoodID)
			}
		}
		if len(foodIDs) > 0 {
			var extra []domain.FoodNutrition
			err = r.db.WithContext(ctx).
				Where("is_active = ? AND id IN ?", true, foodIDs).
				Find(&extra).Error
			if err != nil {
				return nil, err
			}
			for _, f := range extra {
				if !seen[f.ID] {
					foods = append(foods, f)
					seen[f.ID] = true
				}
			}
		}
	}

	if len(foods) > limit {
		foods = foods[:limit]
	}
	return foods, nil
}

func (r *FoodNutritionRepo) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows []domain.FoodUnresolvedLog
	err := r.db.WithContext(ctx).
		Order("hit_count DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *FoodNutritionRepo) LogUnresolved(ctx context.Context, rawName string) error {
	if rawName == "" {
		return nil
	}
	normalized := normalizeUnresolvedName(rawName)
	var existing domain.FoodUnresolvedLog
	err := r.db.WithContext(ctx).
		Where("normalized_name = ?", normalized).
		First(&existing).Error
	if err == nil {
		return r.db.WithContext(ctx).
			Model(&domain.FoodUnresolvedLog{}).
			Where("id = ?", existing.ID).
			Update("hit_count", gorm.Expr("hit_count + 1")).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	row := domain.FoodUnresolvedLog{
		RawName:        strings.TrimSpace(rawName),
		NormalizedName: normalized,
		HitCount:       1,
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

func normalizeUnresolvedName(raw string) string {
	return normalizeFoodName(raw)
}

func normalizeFoodName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (r *FoodNutritionRepo) UpsertDeepSeekNutrition(ctx context.Context, rawName string, unit map[string]any) (string, error) {
	raw := strings.TrimSpace(rawName)
	normalized := normalizeFoodName(raw)
	if raw == "" || normalized == "" || len(unit) == 0 {
		return "", nil
	}
	var existing domain.FoodNutrition
	err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&existing).Error
	if err == nil {
		return "", nil
	}
	if err != gorm.ErrRecordNotFound {
		return "", err
	}
	food := &domain.FoodNutrition{
		CanonicalName:         raw,
		NormalizedName:        normalized,
		KcalPer100g:           number(unit["calories"]),
		ProteinPer100g:        number(unit["protein"]),
		CarbsPer100g:          number(unit["carbs"]),
		FatPer100g:            number(unit["fat"]),
		FiberPer100g:          number(unit["fiber"]),
		SugarPer100g:          number(unit["sugar"]),
		SaturatedFatPer100g:   number(unit["saturatedFat"]),
		CholesterolMgPer100g:  number(unit["cholesterolMg"]),
		SodiumMgPer100g:       number(unit["sodiumMg"]),
		PotassiumMgPer100g:    number(unit["potassiumMg"]),
		CalciumMgPer100g:      number(unit["calciumMg"]),
		IronMgPer100g:         number(unit["ironMg"]),
		MagnesiumMgPer100g:    number(unit["magnesiumMg"]),
		ZincMgPer100g:         number(unit["zincMg"]),
		VitaminARaeMcgPer100g: number(unit["vitaminARaeMcg"]),
		VitaminCMgPer100g:     number(unit["vitaminCMg"]),
		VitaminDMcgPer100g:    number(unit["vitaminDMcg"]),
		VitaminEMgPer100g:     number(unit["vitaminEMg"]),
		VitaminKMcgPer100g:    number(unit["vitaminKMcg"]),
		ThiaminMgPer100g:      number(unit["thiaminMg"]),
		RiboflavinMgPer100g:   number(unit["riboflavinMg"]),
		NiacinMgPer100g:       number(unit["niacinMg"]),
		VitaminB6MgPer100g:    number(unit["vitaminB6Mg"]),
		FolateMcgPer100g:      number(unit["folateMcg"]),
		VitaminB12McgPer100g:  number(unit["vitaminB12Mcg"]),
		Source:                "deepseek_auto",
		IsActive:              true,
	}
	if err := r.db.WithContext(ctx).Create(food).Error; err != nil {
		return "", err
	}
	if food.ID == "" {
		var created domain.FoodNutrition
		if err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&created).Error; err == nil {
			food.ID = created.ID
		}
	}
	if food.ID != "" {
		alias := &domain.FoodNutritionAlias{
			FoodID:          food.ID,
			AliasName:       raw,
			NormalizedAlias: normalized,
		}
		_ = r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(alias).Error
	}
	return food.ID, nil
}

func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	default:
		return 0
	}
}
