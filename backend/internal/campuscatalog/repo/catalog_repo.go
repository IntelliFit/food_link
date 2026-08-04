package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
			"missing_fields", "completeness_status", "status", "updated_at",
		).
		Updates(item).Error
}

type publishedCatalogItem struct {
	ID                 string     `gorm:"column:id;primaryKey"`
	UserID             *string    `gorm:"column:user_id"`
	ImagePath          *string    `gorm:"column:image_path"`
	ImagePaths         []string   `gorm:"column:image_paths;serializer:json"`
	Description        string     `gorm:"column:description"`
	FoodName           string     `gorm:"column:food_name"`
	MerchantName       string     `gorm:"column:merchant_name"`
	MerchantAddress    string     `gorm:"column:merchant_address"`
	DetailAddress      string     `gorm:"column:detail_address"`
	Status             string     `gorm:"column:status"`
	Type               string     `gorm:"column:type"`
	PublishedAt        *time.Time `gorm:"column:published_at"`
	CreatedAt          *time.Time `gorm:"column:created_at"`
	UpdatedAt          *time.Time `gorm:"column:updated_at"`
	IsCampusFood       bool       `gorm:"column:is_campus_food"`
	SchoolID           *string    `gorm:"column:school_id"`
	CampusID           *string    `gorm:"column:campus_id"`
	CanteenID          *string    `gorm:"column:canteen_id"`
	WindowID           *string    `gorm:"column:window_id"`
	SchoolName         string     `gorm:"column:school_name"`
	CampusName         string     `gorm:"column:campus_name"`
	CanteenName        string     `gorm:"column:canteen_name"`
	Floor              string     `gorm:"column:floor"`
	WindowName         string     `gorm:"column:window_name"`
	Price              *float64   `gorm:"column:price"`
	PriceType          string     `gorm:"column:price_type"`
	PriceMin           *float64   `gorm:"column:price_min"`
	PriceMax           *float64   `gorm:"column:price_max"`
	PriceUnit          string     `gorm:"column:price_unit"`
	PriceCollectedAt   *time.Time `gorm:"column:price_collected_at"`
	PortionDescription string     `gorm:"column:portion_description"`
	CampusLocationText string     `gorm:"column:campus_location_text"`
}

func (publishedCatalogItem) TableName() string { return "public_food_library" }

func (r *CatalogRepo) PublishItem(ctx context.Context, item *domain.CatalogItem, adminID string, publishedAt time.Time) error {
	if item == nil {
		return errors.New("catalog item is nil")
	}
	imagePaths := append([]string(nil), item.ImagePaths...)
	var imagePath *string
	if len(imagePaths) > 0 {
		first := imagePaths[0]
		imagePath = &first
	}
	location := strings.Join(nonEmptyCatalogValues(item.OrganizationName, item.AreaName, item.CanteenName, item.Floor, item.WindowName), " · ")
	publication := publishedCatalogItem{
		ID: item.ID, UserID: item.ContributorUserID, ImagePath: imagePath, ImagePaths: imagePaths,
		Description: item.Description, FoodName: item.Name, MerchantName: item.CanteenName,
		MerchantAddress: location, DetailAddress: location, Status: "published", Type: "campus",
		PublishedAt: &publishedAt, CreatedAt: &publishedAt, UpdatedAt: &publishedAt, IsCampusFood: true,
		SchoolID: item.SchoolID, CampusID: item.CampusID, CanteenID: item.CanteenID, WindowID: item.WindowID,
		SchoolName: item.OrganizationName, CampusName: item.AreaName, CanteenName: item.CanteenName,
		Floor: item.Floor, WindowName: item.WindowName, Price: item.Price, PriceType: publicPriceType(item.PriceType),
		PriceMin: item.PriceMin, PriceMax: item.PriceMax, PriceUnit: item.PriceUnit,
		PriceCollectedAt: item.CapturedAt, PortionDescription: item.PortionDescription, CampusLocationText: location,
	}
	columns := []string{
		"user_id", "image_path", "image_paths", "description", "food_name", "merchant_name",
		"merchant_address", "detail_address", "status", "type", "published_at", "updated_at",
		"is_campus_food", "school_id", "campus_id", "canteen_id", "window_id", "school_name",
		"campus_name", "canteen_name", "floor", "window_name", "price", "price_type", "price_min",
		"price_max", "price_unit", "price_collected_at", "portion_description", "campus_location_text",
	}
	adminID = strings.TrimSpace(adminID)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns(columns),
		}).Create(&publication).Error; err != nil {
			return err
		}
		return tx.Model(&domain.CatalogItem{}).
			Where("id = ? AND status <> ?", item.ID, "deleted").
			Updates(map[string]any{
				"status": "published", "published_at": publishedAt,
				"published_by_admin_id": adminID, "updated_at": publishedAt,
			}).Error
	})
}

func publicPriceType(value string) string {
	switch strings.TrimSpace(value) {
	case "fixed", "range", "combo":
		return strings.TrimSpace(value)
	case "by_weight":
		return "weight"
	default:
		return "unknown"
	}
}

func nonEmptyCatalogValues(values ...string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	return out
}
