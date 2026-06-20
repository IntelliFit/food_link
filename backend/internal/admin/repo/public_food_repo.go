package repo

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PublicFoodRepo provides admin CRUD for public_food_library.
type PublicFoodRepo struct {
	db *gorm.DB
}

func NewPublicFoodRepo(db *gorm.DB) *PublicFoodRepo {
	return &PublicFoodRepo{db: db}
}

type ListPublicFoodInput struct {
	Query        string
	Status       string
	IsCampusFood string
	Type         string
	Limit        int
	Offset       int
}

type PublicFoodPatch map[string]any

type ListPublicFoodResult struct {
	Items []domain.PublicFoodItem
	Total int64
}

func (r *PublicFoodRepo) List(ctx context.Context, input ListPublicFoodInput) (*ListPublicFoodResult, error) {
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
	query := r.db.WithContext(ctx).Model(&domain.PublicFoodItem{})
	if q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where(
			"LOWER(food_name) LIKE ? OR LOWER(merchant_name) LIKE ? OR LOWER(description) LIKE ?",
			like, like, like,
		)
	}
	switch strings.TrimSpace(input.Status) {
	case "", "all":
	case "not_deleted":
		query = query.Where("status NOT IN ?", []string{"deleted", "user_deleted"})
	default:
		query = query.Where("status = ?", strings.TrimSpace(input.Status))
	}
	switch strings.TrimSpace(input.IsCampusFood) {
	case "true":
		query = query.Where("is_campus_food = ?", true)
	case "false":
		query = query.Where("is_campus_food = ?", false)
	}
	switch strings.TrimSpace(input.Type) {
	case "", "all":
	case "common", "campus":
		query = query.Where("type = ?", strings.TrimSpace(input.Type))
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []domain.PublicFoodItem
	order := "updated_at DESC NULLS LAST, created_at DESC NULLS LAST"
	if q != "" {
		order = `
			CASE
				WHEN LOWER(food_name) = LOWER(?) THEN 0
				WHEN LOWER(food_name) LIKE LOWER(?) || '%' THEN 1
				WHEN LOWER(food_name) LIKE '%' || LOWER(?) || '%' THEN 2
				ELSE 3
				END ASC,
			updated_at DESC NULLS LAST
		`
		if err := query.
			Order(gorm.Expr(order, q, q, q)).
			Offset(offset).
			Limit(limit).
			Find(&items).Error; err != nil {
			return nil, err
		}
		return &ListPublicFoodResult{Items: items, Total: total}, nil
	}
	if err := query.
		Order(order).
		Offset(offset).
		Limit(limit).
		Find(&items).Error; err != nil {
		return nil, err
	}
	return &ListPublicFoodResult{Items: items, Total: total}, nil
}

func (r *PublicFoodRepo) Get(ctx context.Context, id string) (*domain.PublicFoodItem, error) {
	var item domain.PublicFoodItem
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *PublicFoodRepo) Create(ctx context.Context, item *domain.PublicFoodItem) (*domain.PublicFoodItem, error) {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.New().String()
	}
	if strings.TrimSpace(item.Status) == "" {
		item.Status = "published"
	}
	if strings.TrimSpace(item.Type) == "" {
		item.Type = "common"
	}
	now := time.Now()
	item.CreatedAt = &now
	item.UpdatedAt = &now
	if err := r.db.WithContext(ctx).Create(item).Error; err != nil {
		return nil, err
	}
	return item, nil
}

func (r *PublicFoodRepo) Update(ctx context.Context, id string, patch PublicFoodPatch) (*domain.PublicFoodItem, error) {
	if err := r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ?", id).
		Updates(map[string]any(patch)).Error; err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *PublicFoodRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ?", id).
		Update("status", "deleted").Error
}
