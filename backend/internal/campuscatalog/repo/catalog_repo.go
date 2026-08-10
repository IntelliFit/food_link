package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"

	"gorm.io/datatypes"
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

func (r *CatalogRepo) ListItems(ctx context.Context, filter domain.CatalogItemFilter) ([]domain.CatalogItem, int64, error) {
	base := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS i").
		Where("i.status <> ?", "deleted")
	if filter.BatchID != "" {
		base = base.Where("i.batch_id = ?", filter.BatchID)
	}
	if filter.SchoolID != "" {
		base = base.Where("i.school_id = ?", filter.SchoolID)
	}
	if filter.CampusID != "" {
		base = base.Where("i.campus_id = ?", filter.CampusID)
	}
	if filter.CanteenID != "" {
		base = base.Where("i.canteen_id = ?", filter.CanteenID)
	}
	if filter.WindowID != "" {
		base = base.Where("i.window_id = ?", filter.WindowID)
	}
	if filter.Status != "" && filter.Status != "all" {
		base = base.Where("i.status = ?", filter.Status)
	}
	if filter.Query != "" {
		like := "%" + filter.Query + "%"
		base = base.Where("i.name ILIKE ? OR i.raw_text ILIKE ? OR i.window_name ILIKE ?", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []domain.CatalogItem
	if err := base.
		Select(`i.*,
			p.total_calories AS total_calories,
			p.total_protein AS total_protein,
			p.total_carbs AS total_carbs,
			p.total_fat AS total_fat,
			COALESCE(p.status, '') AS client_status`).
		Joins("LEFT JOIN public_food_library AS p ON p.id = i.id").
		Order("i.created_at DESC, i.id ASC").
		Limit(filter.Limit).
		Offset(filter.Offset).
		Scan(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *CatalogRepo) GetAnalysisProgress(ctx context.Context) (*domain.AnalysisProgress, error) {
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	if err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items").
		Select("status, COUNT(*) AS count").
		Where("status <> ?", "deleted").
		Group("status").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]int64{
		"draft": 0, "changes_pending": 0, "analysis_pending": 0,
		"analysis_failed": 0, "published": 0,
	}
	var total int64
	for _, row := range rows {
		counts[row.Status] = row.Count
		total += row.Count
	}
	analyzable := counts["published"] + counts["changes_pending"] + counts["analysis_pending"] + counts["analysis_failed"]
	percent := 0.0
	if analyzable > 0 {
		percent = float64(counts["published"]) * 100 / float64(analyzable)
	}
	return &domain.AnalysisProgress{
		Total: total, AnalyzableTotal: analyzable, Completed: counts["published"],
		CompletedPercent: percent, StatusCounts: counts,
	}, nil
}

func (r *CatalogRepo) SoftDeleteItem(ctx context.Context, itemID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Table("campus_food_catalog_items").
			Where("id = ? AND status <> ?", strings.TrimSpace(itemID), "deleted").
			Updates(map[string]any{"status": "deleted", "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Table("public_food_library").
			Where("id = ?", strings.TrimSpace(itemID)).
			Updates(map[string]any{"status": "deleted", "updated_at": now}).Error
	})
}

func (r *CatalogRepo) ListPublishedItemsMissingNutrition(ctx context.Context, limit int) ([]domain.CatalogItem, error) {
	if limit <= 0 {
		limit = 100
	}
	micronutrientMissingSQL := `p.items IS NULL OR jsonb_typeof(p.items::jsonb) <> 'array' OR jsonb_array_length(p.items::jsonb) = 0 OR
		EXISTS (SELECT 1 FROM jsonb_array_elements(p.items::jsonb) AS nutrient_item
			WHERE COALESCE(nutrient_item->>'micronutrient_analysis', '') <> 'ai_precise_v1')`
	if r.db.Dialector.Name() == "sqlite" {
		micronutrientMissingSQL = `p.items IS NULL OR json_valid(p.items) = 0 OR json_array_length(p.items) = 0 OR
			EXISTS (SELECT 1 FROM json_each(p.items) AS nutrient_item
				WHERE COALESCE(json_extract(nutrient_item.value, '$.micronutrient_analysis'), '') <> 'ai_precise_v1')`
	}
	var items []domain.CatalogItem
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select("c.*").
		Joins("LEFT JOIN public_food_library AS p ON p.id = c.id").
		Where("c.status = ?", "published").
		Where("p.id IS NULL OR p.status <> ? OR p.analysis_task_id IS NULL OR COALESCE(p.total_calories, 0) <= 0 OR ("+micronutrientMissingSQL+")", "published").
		Order("c.published_at ASC NULLS FIRST, c.id ASC").
		Limit(limit).
		Scan(&items).Error
	return items, err
}

func (r *CatalogRepo) HidePublicItemForNutritionBackfill(ctx context.Context, itemID string) error {
	return r.db.WithContext(ctx).Table("public_food_library").
		Where("id = ?", strings.TrimSpace(itemID)).
		Where("analysis_task_id IS NULL OR COALESCE(total_calories, 0) <= 0").
		Update("status", "pending").Error
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
	if item == nil {
		return errors.New("catalog item is nil")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		catalogUpdate := tx.Model(&domain.CatalogItem{}).
			Where("id = ? AND status <> ?", item.ID, "deleted").
			Select(
				"entry_type", "name", "description", "window_id", "floor", "window_name", "window_layout",
				"meal_periods", "available_weekdays", "availability_note", "service_mode",
				"price_type", "price", "price_min", "price_max", "price_unit", "price_text", "price_options",
				"portion_description", "image_paths", "image_kind", "source_filename", "raw_text", "notes",
				"missing_fields", "completeness_status", "status", "updated_at",
			).
			Updates(item)
		if catalogUpdate.Error != nil {
			return catalogUpdate.Error
		}
		if catalogUpdate.RowsAffected == 0 {
			return fmt.Errorf("catalog item %s was not updated", item.ID)
		}
		if item.Status != "published" {
			return nil
		}

		imagePaths := append([]string{}, item.ImagePaths...)
		var imagePath *string
		if len(imagePaths) > 0 {
			first := imagePaths[0]
			imagePath = &first
		}
		location := strings.Join(nonEmptyCatalogValues(item.OrganizationName, item.AreaName, item.CanteenName, item.Floor, item.WindowName), " · ")
		publication := publishedCatalogItem{
			ID: item.ID, ImagePath: imagePath, ImagePaths: imagePaths, Description: item.Description,
			FoodName: item.Name, MerchantName: item.CanteenName, MerchantAddress: location, DetailAddress: location,
			UpdatedAt: item.UpdatedAt, SchoolID: item.SchoolID, CampusID: item.CampusID, CanteenID: item.CanteenID,
			WindowID: item.WindowID, SchoolName: item.OrganizationName, CampusName: item.AreaName,
			CanteenName: item.CanteenName, Floor: item.Floor, WindowName: item.WindowName,
			Price: item.Price, PriceType: publicPriceType(item.PriceType), PriceMin: item.PriceMin, PriceMax: item.PriceMax,
			PriceUnit: item.PriceUnit, PriceCollectedAt: item.CapturedAt, PortionDescription: item.PortionDescription,
			CampusLocationText: location,
		}
		publicColumns := []string{
			"image_path", "image_paths", "food_name", "merchant_name", "merchant_address", "detail_address", "updated_at",
			"school_id", "campus_id", "canteen_id", "window_id", "school_name", "campus_name", "canteen_name", "floor", "window_name",
			"price", "price_type", "price_min", "price_max", "price_unit", "price_collected_at", "portion_description", "campus_location_text",
		}
		// An empty catalog description is common for AI-published rows. Preserve
		// the analyzed public description on price/location-only edits, while an
		// explicitly supplied description still replaces it.
		if strings.TrimSpace(item.Description) != "" {
			publicColumns = append(publicColumns, "description")
		}
		publicUpdate := tx.Model(&publishedCatalogItem{}).
			Where("id = ? AND status = ?", item.ID, "published").
			Select(publicColumns).
			Updates(&publication)
		if publicUpdate.Error != nil {
			return publicUpdate.Error
		}
		if publicUpdate.RowsAffected == 0 {
			return fmt.Errorf("published campus item %s was not found", item.ID)
		}
		return nil
	})
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

func (r *CatalogRepo) ListCurrentTerminalAnalysisCandidates(ctx context.Context, limit int) ([]domain.CurrentAnalysisCandidate, error) {
	if limit <= 0 {
		limit = 100
	}
	type candidateRow struct {
		ItemID     string            `gorm:"column:item_id"`
		TaskID     string            `gorm:"column:task_id"`
		TaskType   string            `gorm:"column:task_type"`
		TaskStatus string            `gorm:"column:task_status"`
		TaskResult datatypes.JSONMap `gorm:"column:task_result"`
		TaskError  string            `gorm:"column:task_error"`
	}
	var rows []candidateRow
	internalTaskSQL := `COALESCE(t.payload::jsonb->>'internal_benchmark', 'false') = 'true'`
	if r.db.Dialector.Name() == "sqlite" {
		internalTaskSQL = `COALESCE(json_extract(t.payload, '$.internal_benchmark'), 0) = 1`
	}
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select(`c.id AS item_id, t.id AS task_id, t.task_type, t.status AS task_status,
			t.result AS task_result, COALESCE(t.error_message, '') AS task_error`).
		Joins("JOIN analysis_tasks AS t ON t.id = c.analysis_task_id").
		Where("c.status = ?", "analysis_pending").
		Where("t.task_type IN ?", []string{"food", "food_text"}).
		Where("t.status IN ?", []string{"done", "failed", "cancelled", "timed_out"}).
		Where(internalTaskSQL).
		Order("c.updated_at ASC, c.id ASC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make([]domain.CurrentAnalysisCandidate, 0, len(rows))
	for _, row := range rows {
		item, findErr := r.FindItemByID(ctx, row.ItemID)
		if findErr != nil {
			return nil, findErr
		}
		if item == nil {
			continue
		}
		result = append(result, domain.CurrentAnalysisCandidate{
			Item: *item, TaskID: row.TaskID, TaskType: row.TaskType, TaskStatus: row.TaskStatus,
			TaskResult: map[string]any(row.TaskResult), TaskError: row.TaskError,
		})
	}
	return result, nil
}

func (r *CatalogRepo) MarkCurrentTerminalAnalysisFailed(ctx context.Context, itemID, taskID, message string, failedAt time.Time) (bool, error) {
	result := r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND analysis_task_id = ? AND status = ?", strings.TrimSpace(itemID), strings.TrimSpace(taskID), "analysis_pending").
		Updates(map[string]any{
			"status": "analysis_failed", "analysis_error": strings.TrimSpace(message),
			"analysis_completed_at": failedAt, "updated_at": failedAt,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *CatalogRepo) CountOrphanPendingAnalysisCandidates(ctx context.Context, staleBefore time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Joins("LEFT JOIN analysis_tasks AS t ON t.id = c.analysis_task_id").
		Where("c.status = ? AND t.id IS NULL", "analysis_pending").
		Where("COALESCE(c.updated_at, c.analysis_started_at, c.created_at) <= ?", staleBefore).
		Count(&count).Error
	return count, err
}

func (r *CatalogRepo) ListOrphanAnalysisCandidates(ctx context.Context, staleBefore time.Time, limit int) ([]domain.CatalogItem, error) {
	if limit <= 0 {
		limit = 20
	}
	var items []domain.CatalogItem
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select("c.*").
		Joins("LEFT JOIN analysis_tasks AS t ON t.id = c.analysis_task_id").
		Where("c.status IN ? AND t.id IS NULL", []string{"analysis_pending", "analysis_failed"}).
		Where("COALESCE(c.updated_at, c.analysis_started_at, c.created_at) <= ?", staleBefore).
		Order("c.updated_at ASC, c.id ASC").
		Limit(limit).
		Scan(&items).Error
	return items, err
}

func (r *CatalogRepo) ClaimOrphanAnalysis(ctx context.Context, itemID string, expectedTaskID *string, staleBefore time.Time, message string, claimedAt time.Time) (bool, error) {
	query := r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND status IN ?", strings.TrimSpace(itemID), []string{"analysis_pending", "analysis_failed"}).
		Where("COALESCE(updated_at, analysis_started_at, created_at) <= ?", staleBefore)
	if expectedTaskID == nil || strings.TrimSpace(*expectedTaskID) == "" {
		query = query.Where("analysis_task_id IS NULL")
	} else {
		query = query.Where("analysis_task_id = ?", strings.TrimSpace(*expectedTaskID))
	}
	result := query.Updates(map[string]any{
		"status": "analysis_failed", "analysis_task_id": nil,
		"analysis_error": strings.TrimSpace(message), "analysis_completed_at": claimedAt, "updated_at": claimedAt,
	})
	return result.RowsAffected == 1, result.Error
}

func (r *CatalogRepo) ListFailedAnalysisRetryCandidates(ctx context.Context, limit int) ([]domain.CatalogItem, error) {
	if limit <= 0 {
		limit = 20
	}
	notRetriedSQL := `NOT (COALESCE(t.payload::jsonb, '{}'::jsonb) ? 'retry_source_task_id')`
	internalTaskSQL := `COALESCE(t.payload::jsonb->>'internal_benchmark', 'false') = 'true'`
	if r.db.Dialector.Name() == "sqlite" {
		notRetriedSQL = `json_extract(t.payload, '$.retry_source_task_id') IS NULL`
		internalTaskSQL = `COALESCE(json_extract(t.payload, '$.internal_benchmark'), 0) = 1`
	}
	var items []domain.CatalogItem
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select("c.*").
		Joins("JOIN analysis_tasks AS t ON t.id = c.analysis_task_id").
		Where("c.status = ?", "analysis_failed").
		Where("t.task_type IN ?", []string{"food", "food_text"}).
		Where("t.status IN ?", []string{"failed", "timed_out", "done", "cancelled"}).
		Where(internalTaskSQL).
		Where(notRetriedSQL).
		Order("c.analysis_completed_at ASC NULLS FIRST, c.updated_at ASC, c.id ASC").
		Limit(limit).
		Scan(&items).Error
	return items, err
}

func (r *CatalogRepo) ActivatePreparedAnalysisRetry(ctx context.Context, itemID, sourceTaskID, retryTaskID string, startedAt time.Time) (bool, error) {
	activated := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		catalogResult := tx.Model(&domain.CatalogItem{}).
			Where("id = ? AND analysis_task_id = ? AND status = ?", strings.TrimSpace(itemID), strings.TrimSpace(sourceTaskID), "analysis_failed").
			Updates(map[string]any{
				"status": "analysis_pending", "analysis_task_id": strings.TrimSpace(retryTaskID),
				"analysis_started_at": startedAt, "analysis_completed_at": nil, "updated_at": startedAt,
			})
		if catalogResult.Error != nil {
			return catalogResult.Error
		}
		if catalogResult.RowsAffected != 1 {
			return nil
		}
		taskResult := tx.Table("analysis_tasks").
			Where("id = ? AND status = ?", strings.TrimSpace(retryTaskID), "cancelled").
			Updates(map[string]any{"status": "pending", "updated_at": startedAt})
		if taskResult.Error != nil {
			return taskResult.Error
		}
		if taskResult.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		activated = true
		return nil
	})
	return activated, err
}

func (r *CatalogRepo) ListLegacyTerminalAnalysisCandidates(ctx context.Context, limit int) ([]domain.LegacyAnalysisCandidate, error) {
	if limit <= 0 {
		limit = 20
	}
	type candidateRow struct {
		ItemID     string            `gorm:"column:item_id"`
		TaskID     string            `gorm:"column:task_id"`
		TaskType   string            `gorm:"column:task_type"`
		TaskStatus string            `gorm:"column:task_status"`
		TaskResult datatypes.JSONMap `gorm:"column:task_result"`
		TaskError  string            `gorm:"column:task_error"`
	}
	var rows []candidateRow
	err := r.db.WithContext(ctx).
		Table("campus_food_catalog_items AS c").
		Select(`c.id AS item_id, t.id AS task_id, t.task_type, t.status AS task_status,
			t.result AS task_result, COALESCE(t.error_message, '') AS task_error`).
		Joins("JOIN analysis_tasks AS t ON t.id = c.analysis_task_id").
		Where("c.status IN ?", []string{"analysis_pending", "analysis_failed"}).
		Where("t.task_type IN ?", []string{"precision_plan", "precision_aggregate"}).
		Where("t.status IN ?", []string{"done", "failed", "cancelled", "timed_out"}).
		Order("CASE WHEN c.status = 'analysis_pending' THEN 0 ELSE 1 END, c.updated_at ASC, c.id ASC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make([]domain.LegacyAnalysisCandidate, 0, len(rows))
	for _, row := range rows {
		item, findErr := r.FindItemByID(ctx, row.ItemID)
		if findErr != nil {
			return nil, findErr
		}
		if item == nil {
			continue
		}
		result = append(result, domain.LegacyAnalysisCandidate{
			Item: *item, TaskID: row.TaskID, TaskType: row.TaskType, TaskStatus: row.TaskStatus,
			TaskResult: map[string]any(row.TaskResult), TaskError: row.TaskError,
		})
	}
	return result, nil
}

func (r *CatalogRepo) ClaimLegacyAnalysisRetry(ctx context.Context, itemID, taskID, message string, claimedAt time.Time) (bool, error) {
	updates := map[string]any{
		"status": "analysis_failed", "analysis_task_id": nil,
		"analysis_error": strings.TrimSpace(message), "analysis_completed_at": claimedAt, "updated_at": claimedAt,
	}
	result := r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND analysis_task_id = ? AND status IN ?", strings.TrimSpace(itemID), strings.TrimSpace(taskID), []string{"analysis_pending", "analysis_failed"}).
		Updates(updates)
	return result.RowsAffected == 1, result.Error
}

// TryAnalysisMaintenanceLeadership holds one PostgreSQL session advisory lock
// for the complete maintenance loop, so a multi-pod deployment has only one
// catalog reconciler and one global retry rate limit.
func (r *CatalogRepo) TryAnalysisMaintenanceLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	if fn == nil {
		return false, errors.New("campus analysis maintenance function is required")
	}
	if r.db.Dialector.Name() != "postgres" {
		return true, fn(ctx)
	}
	const lockKey = "food-link:campus-analysis-maintenance"
	acquired := false
	err := r.db.WithContext(ctx).Connection(func(connection *gorm.DB) error {
		if err := connection.Raw("SELECT pg_try_advisory_lock(hashtextextended(?, 0))", lockKey).Scan(&acquired).Error; err != nil {
			return err
		}
		if !acquired {
			return nil
		}
		defer func() {
			unlockDB := connection.Session(&gorm.Session{NewDB: true}).WithContext(context.Background())
			_ = unlockDB.Exec("SELECT pg_advisory_unlock(hashtextextended(?, 0))", lockKey).Error
		}()
		return fn(ctx)
	})
	return acquired, err
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
		// Keep text-only campus dishes compatible with the public library's
		// NOT NULL image_paths column. A nil slice is serialized as SQL NULL,
		// while an allocated empty slice is stored as the intended JSON [].
		imagePaths := append([]string{}, item.ImagePaths...)
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
		if !hasPreciseMicronutrientMarkers(nutrition.Items) {
			return errors.New("校园菜品 AI 分析尚未完成微量营养精确分析")
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

func hasPreciseMicronutrientMarkers(items []map[string]any) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		if strings.TrimSpace(fmt.Sprint(item["micronutrient_analysis"])) != "ai_precise_v1" {
			return false
		}
	}
	return true
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
