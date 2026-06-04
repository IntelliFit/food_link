package repo

import (
	"context"
	"encoding/json"
	"strings"

	"food_link/backend/internal/foodrecord/domain"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type PackagedFoodRepo struct {
	db *gorm.DB
}

func NewPackagedFoodRepo(db *gorm.DB) *PackagedFoodRepo {
	return &PackagedFoodRepo{db: db}
}

type ListPackagedFoodsInput struct {
	Query        string
	ReviewStatus string
	Active       string
	ImageState   string
	Limit        int
	Offset       int
}

type PackagedFoodPatch map[string]any

type ListPackagedFoodsResult struct {
	Items []domain.PackagedFood
	Total int64
}

func (r *PackagedFoodRepo) List(ctx context.Context, input ListPackagedFoodsInput) (*ListPackagedFoodsResult, error) {
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

	query := r.db.WithContext(ctx).Model(&domain.PackagedFood{})
	query = applyListFilters(query, input)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []domain.PackagedFood
	if err := query.
		Order("updated_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&items).Error; err != nil {
		return nil, err
	}
	return &ListPackagedFoodsResult{Items: items, Total: total}, nil
}

func (r *PackagedFoodRepo) Get(ctx context.Context, id string) (*domain.PackagedFood, error) {
	var item domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *PackagedFoodRepo) Update(ctx context.Context, id string, patch PackagedFoodPatch) (*domain.PackagedFood, error) {
	if err := r.db.WithContext(ctx).
		Model(&domain.PackagedFood{}).
		Where("id = ?", id).
		Updates(map[string]any(patch)).Error; err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func applyListFilters(query *gorm.DB, input ListPackagedFoodsInput) *gorm.DB {
	if q := strings.TrimSpace(input.Query); q != "" {
		like := "%" + q + "%"
		query = query.Where(
			`brand ILIKE ? OR product_name ILIKE ? OR display_name ILIKE ? OR search_text ILIKE ? OR barcode ILIKE ? OR ocr_raw_text ILIKE ?`,
			like, like, like, like, like, like,
		)
	}

	switch strings.TrimSpace(input.ReviewStatus) {
	case "", "all":
	case "blank":
		query = query.Where("COALESCE(review_status, '') = ''")
	default:
		query = query.Where("review_status = ?", strings.TrimSpace(input.ReviewStatus))
	}

	switch strings.TrimSpace(input.Active) {
	case "true":
		query = query.Where("is_active = ?", true)
	case "false":
		query = query.Where("is_active = ?", false)
	}

	switch strings.TrimSpace(input.ImageState) {
	case "with_images":
		query = query.Where("jsonb_array_length(COALESCE(source_image_urls, '[]'::jsonb)) > 0")
	case "missing_images":
		query = query.Where("jsonb_array_length(COALESCE(source_image_urls, '[]'::jsonb)) = 0")
	}
	return query
}

func JSONValue(value any, fallback any) (datatypes.JSON, error) {
	if value == nil {
		value = fallback
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(encoded), nil
}
