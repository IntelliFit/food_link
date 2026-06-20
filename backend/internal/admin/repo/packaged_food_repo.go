package repo

import (
	"context"
	"encoding/json"
	"strings"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
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

	q := strings.TrimSpace(input.Query)
	query := r.db.WithContext(ctx).Model(&domain.PackagedFood{})
	query = applyListFilters(query, input)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []domain.PackagedFood
	order := "updated_at DESC"
	if q != "" {
		order = `
			CASE
				WHEN LOWER(COALESCE(display_name, product_name)) = LOWER(?) THEN 0
				WHEN LOWER(product_name) = LOWER(?) OR LOWER(brand) = LOWER(?) OR LOWER(COALESCE(search_text, '')) = LOWER(?) THEN 1
				WHEN LOWER(COALESCE(display_name, product_name)) LIKE LOWER(?) || '%' THEN 2
				WHEN LOWER(product_name) LIKE LOWER(?) || '%' OR LOWER(brand) LIKE LOWER(?) || '%' OR LOWER(COALESCE(search_text, '')) LIKE LOWER(?) || '%' THEN 3
				WHEN LOWER(COALESCE(display_name, product_name)) LIKE '%' || LOWER(?) || '%' THEN 4
				WHEN LOWER(product_name) LIKE '%' || LOWER(?) || '%' OR LOWER(brand) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(search_text, '')) LIKE '%' || LOWER(?) || '%' THEN 5
				ELSE 6
				END ASC,
			updated_at DESC NULLS LAST,
			product_name ASC
		`
		if err := query.
			Order(gorm.Expr(order, q, q, q, q, q, q, q, q, q, q, q, q)).
			Offset(offset).
			Limit(limit).
			Find(&items).Error; err != nil {
			return nil, err
		}
		return &ListPackagedFoodsResult{Items: items, Total: total}, nil
	}
	if err := query.
		Order(order).
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

func (r *PackagedFoodRepo) Create(ctx context.Context, item *domain.PackagedFood) (*domain.PackagedFood, error) {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.New().String()
	}
	if err := r.db.WithContext(ctx).Create(item).Error; err != nil {
		return nil, err
	}
	return item, nil
}

func (r *PackagedFoodRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Model(&domain.PackagedFood{}).
		Where("id = ?", id).
		Update("is_active", false).Error
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
			`brand ILIKE ? OR product_name ILIKE ? OR display_name ILIKE ? OR search_text ILIKE ? OR product_family_key ILIKE ? OR flavor_text ILIKE ? OR spec_text ILIKE ? OR barcode ILIKE ? OR package_category ILIKE ? OR ocr_raw_text ILIKE ?`,
			like, like, like, like, like, like, like, like, like, like,
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
