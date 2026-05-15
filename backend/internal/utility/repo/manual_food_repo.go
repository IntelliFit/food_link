package repo

import (
	"context"

	"food_link/backend/internal/utility/domain"

	"gorm.io/gorm"
)

type ManualFoodRepo struct {
	db *gorm.DB
}

func NewManualFoodRepo(db *gorm.DB) *ManualFoodRepo {
	return &ManualFoodRepo{db: db}
}

func (r *ManualFoodRepo) List(ctx context.Context, category string, limit int) ([]domain.ManualFood, error) {
	var items []domain.ManualFood
	q := r.db.WithContext(ctx)
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("name asc").Find(&items).Error
	return items, err
}

func (r *ManualFoodRepo) Search(ctx context.Context, keyword string, limit int) ([]domain.ManualFood, error) {
	var items []domain.ManualFood
	q := r.db.WithContext(ctx).Where("LOWER(name) LIKE LOWER(?)", "%"+keyword+"%")
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("name asc").Find(&items).Error
	return items, err
}
