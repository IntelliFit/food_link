package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"

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

func (r *CatalogRepo) ListPublishedItemsMissingNutrition(ctx context.Context, limit int) ([]domain.CatalogItem, error) {
	if limit <= 0 {
		limit = 100
	}
	var items []domain.CatalogItem
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select("c.*").
		Joins("LEFT JOIN public_food_library AS p ON p.id = c.id").
		Where("c.status = ?", "published").
		Where("p.id IS NULL OR p.status <> ? OR p.analysis_task_id IS NULL OR COALESCE(p.total_calories, 0) <= 0", "published").
		Order("c.published_at ASC NULLS FIRST, c.id ASC").
		Limit(limit).
		Scan(&items).Error
	return items, err
}

func (r *CatalogRepo) HidePublicItemForNutritionBackfill(ctx context.Context, itemID string) error {
	return r.db.WithContext(ctx).Table("public_food_library").
		Where("id = ?", strings.TrimSpace(itemID)).
		Where("analysis_task_id IS NULL OR COALESCE(total_calories, 0) <= 0").
		Update("status", "analysis_pending").Error
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

func (r *CatalogRepo) MarkAnalysisPending(ctx context.Context, item *domain.CatalogItem, adminID string, startedAt time.Time) error {
	if item == nil {
		return errors.New("catalog item is nil")
	}
	updates := map[string]any{
		"status": "analysis_pending", "analysis_task_id": nil, "analysis_error": "",
		"analysis_started_at": startedAt, "analysis_completed_at": nil, "updated_at": startedAt,
	}
	if adminID = strings.TrimSpace(adminID); adminID != "" {
		updates["published_by_admin_id"] = adminID
	}
	return r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND status <> ?", item.ID, "deleted").
		Updates(updates).Error
}

func (r *CatalogRepo) LinkAnalysisTask(ctx context.Context, itemID, taskID string) error {
	return r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND status <> ?", strings.TrimSpace(itemID), "deleted").
		Updates(map[string]any{"analysis_task_id": strings.TrimSpace(taskID), "updated_at": time.Now()}).Error
}

func (r *CatalogRepo) MarkAnalysisFailed(ctx context.Context, itemID, message string, failedAt time.Time) error {
	return r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND status <> ?", strings.TrimSpace(itemID), "deleted").
		Updates(map[string]any{
			"status": "analysis_failed", "analysis_error": strings.TrimSpace(message),
			"analysis_completed_at": failedAt, "updated_at": failedAt,
		}).Error
}

type publishedCatalogItem struct {
	ID                 string           `gorm:"column:id;primaryKey"`
	UserID             *string          `gorm:"column:user_id"`
	ImagePath          *string          `gorm:"column:image_path"`
	ImagePaths         []string         `gorm:"column:image_paths;serializer:json"`
	AnalysisTaskID     *string          `gorm:"column:analysis_task_id"`
	TotalCalories      float64          `gorm:"column:total_calories"`
	TotalProtein       float64          `gorm:"column:total_protein"`
	TotalCarbs         float64          `gorm:"column:total_carbs"`
	TotalFat           float64          `gorm:"column:total_fat"`
	Items              []map[string]any `gorm:"column:items;serializer:json"`
	Description        string           `gorm:"column:description"`
	Insight            string           `gorm:"column:insight"`
	FoodName           string           `gorm:"column:food_name"`
	MerchantName       string           `gorm:"column:merchant_name"`
	MerchantAddress    string           `gorm:"column:merchant_address"`
	DetailAddress      string           `gorm:"column:detail_address"`
	Status             string           `gorm:"column:status"`
	Type               string           `gorm:"column:type"`
	PublishedAt        *time.Time       `gorm:"column:published_at"`
	CreatedAt          *time.Time       `gorm:"column:created_at"`
	UpdatedAt          *time.Time       `gorm:"column:updated_at"`
	IsCampusFood       bool             `gorm:"column:is_campus_food"`
	SchoolID           *string          `gorm:"column:school_id"`
	CampusID           *string          `gorm:"column:campus_id"`
	CanteenID          *string          `gorm:"column:canteen_id"`
	WindowID           *string          `gorm:"column:window_id"`
	SchoolName         string           `gorm:"column:school_name"`
	CampusName         string           `gorm:"column:campus_name"`
	CanteenName        string           `gorm:"column:canteen_name"`
	Floor              string           `gorm:"column:floor"`
	WindowName         string           `gorm:"column:window_name"`
	Price              *float64         `gorm:"column:price"`
	PriceType          string           `gorm:"column:price_type"`
	PriceMin           *float64         `gorm:"column:price_min"`
	PriceMax           *float64         `gorm:"column:price_max"`
	PriceUnit          string           `gorm:"column:price_unit"`
	PriceCollectedAt   *time.Time       `gorm:"column:price_collected_at"`
	PortionDescription string           `gorm:"column:portion_description"`
	CampusLocationText string           `gorm:"column:campus_location_text"`
}

func (publishedCatalogItem) TableName() string { return "public_food_library" }

func (r *CatalogRepo) CompleteAnalyzedItem(ctx context.Context, itemID, taskID string, result map[string]any, completedAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var item domain.CatalogItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND status <> ?", strings.TrimSpace(itemID), "deleted").First(&item).Error; err != nil {
			return err
		}
		if item.Status != "analysis_pending" {
			return fmt.Errorf("catalog item %s is not waiting for analysis", item.ID)
		}
		if item.AnalysisTaskID != nil && strings.TrimSpace(*item.AnalysisTaskID) != "" && strings.TrimSpace(*item.AnalysisTaskID) != strings.TrimSpace(taskID) {
			return fmt.Errorf("catalog item %s analysis task has been superseded", item.ID)
		}
		imagePaths := append([]string(nil), item.ImagePaths...)
		var imagePath *string
		if len(imagePaths) > 0 {
			first := imagePaths[0]
			imagePath = &first
		}
		location := strings.Join(nonEmptyCatalogValues(item.OrganizationName, item.AreaName, item.CanteenName, item.Floor, item.WindowName), " · ")
		nutrition := publicfoodrepo.NutritionSnapshotFromResult(result)
		if len(nutrition.Items) == 0 || (nutrition.TotalCalories <= 0 && nutrition.TotalProtein <= 0 && nutrition.TotalCarbs <= 0 && nutrition.TotalFat <= 0) {
			return errors.New("校园菜品 AI 分析未返回有效营养结果")
		}
		description := nutrition.Description
		if description == "" {
			description = item.Description
		}
		publication := publishedCatalogItem{
			ID: item.ID, UserID: item.ContributorUserID, ImagePath: imagePath, ImagePaths: imagePaths,
			AnalysisTaskID: &taskID, TotalCalories: nutrition.TotalCalories, TotalProtein: nutrition.TotalProtein,
			TotalCarbs: nutrition.TotalCarbs, TotalFat: nutrition.TotalFat, Items: nutrition.Items,
			Description: description, Insight: nutrition.Insight, FoodName: item.Name, MerchantName: item.CanteenName,
			MerchantAddress: location, DetailAddress: location, Status: "published", Type: "campus",
			PublishedAt: &completedAt, CreatedAt: &completedAt, UpdatedAt: &completedAt, IsCampusFood: true,
			SchoolID: item.SchoolID, CampusID: item.CampusID, CanteenID: item.CanteenID, WindowID: item.WindowID,
			SchoolName: item.OrganizationName, CampusName: item.AreaName, CanteenName: item.CanteenName,
			Floor: item.Floor, WindowName: item.WindowName, Price: item.Price, PriceType: publicPriceType(item.PriceType),
			PriceMin: item.PriceMin, PriceMax: item.PriceMax, PriceUnit: item.PriceUnit,
			PriceCollectedAt: item.CapturedAt, PortionDescription: item.PortionDescription, CampusLocationText: location,
		}
		columns := []string{
			"user_id", "image_path", "image_paths", "analysis_task_id", "total_calories", "total_protein", "total_carbs", "total_fat", "items",
			"description", "insight", "food_name", "merchant_name", "merchant_address", "detail_address", "status", "type", "published_at", "updated_at",
			"is_campus_food", "school_id", "campus_id", "canteen_id", "window_id", "school_name", "campus_name", "canteen_name", "floor", "window_name",
			"price", "price_type", "price_min", "price_max", "price_unit", "price_collected_at", "portion_description", "campus_location_text",
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns(columns),
		}).Create(&publication).Error; err != nil {
			return err
		}
		return tx.Model(&domain.CatalogItem{}).Where("id = ? AND status <> ?", item.ID, "deleted").Updates(map[string]any{
			"status": "published", "analysis_task_id": taskID, "analysis_error": "", "analysis_completed_at": completedAt,
			"published_at": completedAt, "updated_at": completedAt,
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
