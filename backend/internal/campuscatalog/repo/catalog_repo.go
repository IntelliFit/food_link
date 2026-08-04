package repo

import (
	"context"
	"errors"

	"food_link/backend/internal/campuscatalog/domain"

	"gorm.io/gorm"
)

type CatalogRepo struct {
	db *gorm.DB
}

func NewCatalogRepo(db *gorm.DB) *CatalogRepo {
	return &CatalogRepo{db: db}
}

func (r *CatalogRepo) FindBatchByClientKey(ctx context.Context, clientBatchKey string) (*domain.CollectionBatch, error) {
	var batch domain.CollectionBatch
	err := r.db.WithContext(ctx).
		Where("client_batch_key = ?", clientBatchKey).
		First(&batch).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &batch, nil
}

func (r *CatalogRepo) CreateBatchWithItems(ctx context.Context, batch *domain.CollectionBatch, items []domain.CatalogItem) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(batch).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		return tx.Create(&items).Error
	})
}

func (r *CatalogRepo) ListBatches(ctx context.Context, limit, offset int) ([]domain.CollectionBatch, int64, error) {
	base := r.db.WithContext(ctx).Model(&domain.CollectionBatch{})
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var batches []domain.CollectionBatch
	if err := r.db.WithContext(ctx).
		Table("campus_food_collection_batches AS b").
		Select("b.*, COUNT(i.id) AS item_count").
		Joins("LEFT JOIN campus_food_catalog_items i ON i.batch_id = b.id AND i.status <> ?", "deleted").
		Group("b.id").
		Order("b.created_at DESC").
		Limit(limit).
		Offset(offset).
		Scan(&batches).Error; err != nil {
		return nil, 0, err
	}
	return batches, total, nil
}

func (r *CatalogRepo) ListItemsByBatch(ctx context.Context, batchID string) ([]domain.CatalogItem, error) {
	var items []domain.CatalogItem
	if err := r.db.WithContext(ctx).
		Where("batch_id = ? AND status <> ?", batchID, "deleted").
		Order("created_at ASC, id ASC").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *CatalogRepo) FindItemByID(ctx context.Context, itemID string) (*domain.CatalogItem, error) {
	var item domain.CatalogItem
	err := r.db.WithContext(ctx).
		Where("id = ? AND status <> ?", itemID, "deleted").
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *CatalogRepo) UpdateItem(ctx context.Context, item *domain.CatalogItem) error {
	return r.db.WithContext(ctx).
		Model(&domain.CatalogItem{}).
		Where("id = ? AND status <> ?", item.ID, "deleted").
		Select(
			"entry_type", "name", "description", "window_id", "floor", "window_name", "window_layout",
			"meal_periods", "available_weekdays", "availability_note", "service_mode",
			"price_type", "price", "price_min", "price_max", "price_unit", "price_text", "price_options",
			"portion_description", "image_paths", "image_kind", "source_filename", "raw_text", "notes",
			"missing_fields", "completeness_status", "updated_at",
		).
		Updates(item).Error
}
