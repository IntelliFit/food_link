package repo

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"

	"gorm.io/gorm"
)

type FoodNutritionRepo struct {
	db *gorm.DB
}

func NewFoodNutritionRepo(db *gorm.DB) *FoodNutritionRepo {
	return &FoodNutritionRepo{db: db}
}

func (r *FoodNutritionRepo) Search(ctx context.Context, query string, limit int) ([]domain.FoodNutrition, error) {
	if limit <= 0 {
		limit = 5
	}
	pattern := fmt.Sprintf("%%%s%%", strings.ToLower(query))
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
		Where("LOWER(alias_name) LIKE ?", pattern).
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
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if !unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
