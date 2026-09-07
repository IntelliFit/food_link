package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *CatalogRepo) CreateCommunityBatchWithItems(ctx context.Context, batch *domain.CollectionBatch, items []domain.CatalogItem, revisions []domain.Revision) error {
	if batch == nil || len(items) == 0 || len(items) != len(revisions) {
		return errors.New("campus community batch is incomplete")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(batch).Error; err != nil {
			return err
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}
		if err := tx.Create(&revisions).Error; err != nil {
			return err
		}
		for index := range items {
			if err := syncCommunityProjection(tx, &items[index]); err != nil {
				return err
			}
		}
		return nil
	})
}

// ApplyRevision atomically advances a catalog item, appends its immutable
// audit event, and refreshes the public read projection. The version predicate
// is the final concurrency guard even when callers read the item beforehand.
func (r *CatalogRepo) ApplyRevision(ctx context.Context, item *domain.CatalogItem, revision *domain.Revision) error {
	if item == nil || revision == nil {
		return errors.New("campus food revision is incomplete")
	}
	if item.Version != revision.ResultVersion || revision.ResultVersion != revision.BaseVersion+1 {
		return errors.New("campus food revision versions are inconsistent")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"entry_type": item.EntryType, "name": item.Name, "description": item.Description,
			"school_id": item.SchoolID, "campus_id": item.CampusID, "canteen_id": item.CanteenID, "window_id": item.WindowID,
			"organization_name": item.OrganizationName, "area_name": item.AreaName, "canteen_name": item.CanteenName,
			"floor": item.Floor, "window_name": item.WindowName, "window_layout": item.WindowLayout,
			"meal_periods": datatypes.JSONSlice[string](append([]string{}, item.MealPeriods...)), "available_weekdays": datatypes.JSONSlice[string](append([]string{}, item.AvailableWeekdays...)), "availability_note": item.AvailabilityNote,
			"service_mode": item.ServiceMode,
			"price_type":   item.PriceType, "price": item.Price, "price_min": item.PriceMin, "price_max": item.PriceMax,
			"price_unit": item.PriceUnit, "price_text": item.PriceText, "price_options": datatypes.JSONMap(item.PriceOptions),
			"portion_description": item.PortionDescription, "image_paths": datatypes.JSONSlice[string](append([]string{}, item.ImagePaths...)),
			"image_kind": item.ImageKind, "source_filename": item.SourceFilename, "raw_text": item.RawText, "notes": item.Notes,
			"missing_fields": datatypes.JSONSlice[string](append([]string{}, item.MissingFields...)), "completeness_status": item.CompletenessStatus,
			"status": item.Status, "analysis_task_id": item.AnalysisTaskID, "analysis_error": item.AnalysisError,
			"last_contributor_user_id": item.LastContributorID, "version": item.Version,
			"nutrition_source_version": item.NutritionVersion, "nutrition_status": item.NutritionStatus,
			"availability_status": item.AvailabilityStatus, "last_verified_at": item.LastVerifiedAt,
			"captured_at": item.CapturedAt, "updated_at": item.UpdatedAt,
		}
		result := tx.Model(&domain.CatalogItem{}).
			Where("id = ? AND version = ? AND status <> ?", item.ID, revision.BaseVersion, "deleted").
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return domain.ErrVersionConflict
		}
		if err := tx.Create(revision).Error; err != nil {
			return err
		}
		if item.Status == "published" || item.PublishedAt != nil {
			return syncCommunityProjection(tx, item)
		}
		return nil
	})
}

func syncCommunityProjection(tx *gorm.DB, item *domain.CatalogItem) error {
	imagePaths := append([]string{}, item.ImagePaths...)
	var imagePath *string
	if len(imagePaths) > 0 {
		imagePath = &imagePaths[0]
	}
	venue, err := resolvePublicationVenue(tx, item)
	if err != nil {
		return err
	}
	now := time.Now()
	publishedAt := item.PublishedAt
	if publishedAt == nil {
		publishedAt = &now
	}
	location := strings.Join(nonEmptyCatalogValues(item.OrganizationName, item.AreaName, item.CanteenName, item.Floor, item.WindowName), " · ")
	publication := publishedCatalogItem{
		ID: item.ID, UserID: item.ContributorUserID, ImagePath: imagePath, ImagePaths: imagePaths,
		FoodName: item.Name, Description: item.Description, MerchantName: item.CanteenName,
		MerchantAddress: location, DetailAddress: location, Status: "published", Type: venue.Type,
		PublishedAt: publishedAt, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, IsCampusFood: venue.IsCampusFood,
		SchoolID: venue.SchoolID, CampusID: venue.CampusID, CanteenID: venue.CanteenID, WindowID: venue.WindowID,
		SchoolName: venue.SchoolName, CampusName: venue.CampusName, CanteenName: venue.CanteenName,
		Floor: venue.Floor, WindowName: venue.WindowName, Price: item.Price, PriceType: publicPriceType(item.PriceType),
		PriceMin: item.PriceMin, PriceMax: item.PriceMax, PriceUnit: item.PriceUnit,
		PriceCollectedAt: item.CapturedAt, PortionDescription: item.PortionDescription, CampusLocationText: venue.CampusLocationText,
		ContentVersion: item.Version, NutritionVersion: item.NutritionVersion, NutritionStatus: item.NutritionStatus,
		AvailabilityStatus: item.AvailabilityStatus, LastVerifiedAt: item.LastVerifiedAt,
	}
	columns := []string{
		"user_id", "image_path", "image_paths", "food_name", "description", "merchant_name", "merchant_address", "detail_address",
		"status", "type", "published_at", "updated_at", "is_campus_food", "school_id", "campus_id", "canteen_id", "window_id",
		"school_name", "campus_name", "canteen_name", "floor", "window_name", "price", "price_type", "price_min", "price_max",
		"price_unit", "price_collected_at", "portion_description", "campus_location_text", "content_version",
		"nutrition_source_version", "nutrition_status", "availability_status", "last_verified_at",
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns(columns),
	}).Create(&publication).Error
}

func (r *CatalogRepo) ListRevisions(ctx context.Context, itemID string, limit, offset int) ([]domain.Revision, int64, error) {
	itemID = strings.TrimSpace(itemID)
	base := r.db.WithContext(ctx).Model(&domain.Revision{}).Where("catalog_item_id = ?", itemID)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var revisions []domain.Revision
	if err := base.Order("result_version DESC").Limit(limit).Offset(offset).Find(&revisions).Error; err != nil {
		return nil, 0, err
	}
	return revisions, total, nil
}

func (r *CatalogRepo) FindRevisionByID(ctx context.Context, itemID, revisionID string) (*domain.Revision, error) {
	var revision domain.Revision
	err := r.db.WithContext(ctx).
		Where("id = ? AND catalog_item_id = ?", strings.TrimSpace(revisionID), strings.TrimSpace(itemID)).
		First(&revision).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &revision, err
}

func (r *CatalogRepo) GetCampusDirectoryRef(ctx context.Context, schoolID, campusID, canteenID, windowID string) (*domain.DirectoryRef, error) {
	schoolID = strings.TrimSpace(schoolID)
	campusID = strings.TrimSpace(campusID)
	canteenID = strings.TrimSpace(canteenID)
	windowID = strings.TrimSpace(windowID)
	if schoolID == "" && campusID == "" && canteenID == "" && windowID == "" {
		return nil, nil
	}
	ref := &domain.DirectoryRef{}
	if schoolID != "" {
		var row struct{ ID, Name string }
		err := r.db.WithContext(ctx).Table("schools").Select("id, name").Where("id = ? AND status = ?", schoolID, "active").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		ref.SchoolID, ref.SchoolName = row.ID, row.Name
	}
	if campusID != "" {
		var row struct{ ID, SchoolID, Name string }
		err := r.db.WithContext(ctx).Table("school_campuses").Select("id, school_id, name").Where("id = ? AND status = ?", campusID, "active").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if ref.SchoolID != "" && row.SchoolID != ref.SchoolID {
			return nil, nil
		}
		ref.CampusID, ref.CampusName = row.ID, row.Name
		if ref.SchoolID == "" {
			ref.SchoolID = row.SchoolID
		}
	}
	if canteenID != "" {
		var row struct {
			ID, SchoolID, Name string
			CampusID           *string
		}
		err := r.db.WithContext(ctx).Table("school_canteens").Select("id, school_id, campus_id, name").Where("id = ? AND status = ?", canteenID, "active").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if ref.SchoolID != "" && row.SchoolID != ref.SchoolID {
			return nil, nil
		}
		if ref.CampusID != "" && (row.CampusID == nil || *row.CampusID != ref.CampusID) {
			return nil, nil
		}
		ref.CanteenID, ref.CanteenName = row.ID, row.Name
		if ref.SchoolID == "" {
			ref.SchoolID = row.SchoolID
		}
		if ref.CampusID == "" && row.CampusID != nil {
			ref.CampusID = *row.CampusID
		}
	}
	if windowID != "" {
		var row struct {
			ID, SchoolID, CanteenID, Name string
			CampusID                      *string
			Floor                         *string
		}
		err := r.db.WithContext(ctx).Table("canteen_windows").Select("id, school_id, campus_id, canteen_id, name, floor").Where("id = ? AND status = ?", windowID, "active").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if ref.SchoolID != "" && row.SchoolID != ref.SchoolID {
			return nil, nil
		}
		if ref.CampusID != "" && (row.CampusID == nil || *row.CampusID != ref.CampusID) {
			return nil, nil
		}
		if ref.CanteenID != "" && row.CanteenID != ref.CanteenID {
			return nil, nil
		}
		ref.WindowID, ref.WindowName = row.ID, row.Name
		if row.Floor != nil {
			ref.Floor = *row.Floor
		}
		if ref.SchoolID == "" {
			ref.SchoolID = row.SchoolID
		}
		if ref.CampusID == "" && row.CampusID != nil {
			ref.CampusID = *row.CampusID
		}
		if ref.CanteenID == "" {
			ref.CanteenID = row.CanteenID
		}
	}
	return ref, nil
}

func (r *CatalogRepo) HasActiveCollectorScope(ctx context.Context, userID, schoolID, campusID, canteenID string, now time.Time) (bool, error) {
	var count int64
	query := r.db.WithContext(ctx).Model(&domain.CollectorScope{}).
		Where("user_id = ? AND school_id = ? AND status = ?", strings.TrimSpace(userID), strings.TrimSpace(schoolID), "active").
		Where("expires_at IS NULL OR expires_at > ?", now)
	if campusID != "" {
		query = query.Where("campus_id IS NULL OR campus_id = ?", strings.TrimSpace(campusID))
	}
	if canteenID != "" {
		query = query.Where("canteen_id IS NULL OR canteen_id = ?", strings.TrimSpace(canteenID))
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *CatalogRepo) LinkCommunityAnalysisTask(ctx context.Context, itemID string, targetVersion int64, taskID string, linkedAt time.Time) (bool, error) {
	result := r.db.WithContext(ctx).Model(&domain.CatalogItem{}).
		Where("id = ? AND version = ? AND status = ? AND nutrition_status IN ?", strings.TrimSpace(itemID), targetVersion, "published", []string{"pending", "stale", "failed"}).
		Updates(map[string]any{
			"analysis_task_id": strings.TrimSpace(taskID), "analysis_error": "",
			"nutrition_status": func() string {
				if targetVersion > 1 {
					return "stale"
				}
				return "pending"
			}(),
			"analysis_started_at": linkedAt, "analysis_completed_at": nil, "updated_at": linkedAt,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *CatalogRepo) MarkCommunityAnalysisFailed(ctx context.Context, itemID string, targetVersion int64, message string, failedAt time.Time) error {
	itemID = strings.TrimSpace(itemID)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&domain.CatalogItem{}).
			Where("id = ? AND version = ? AND status IN ?", itemID, targetVersion, []string{"published", "analysis_pending"}).
			Updates(map[string]any{
				"status":           gorm.Expr("CASE WHEN published_at IS NOT NULL THEN ? ELSE ? END", "published", "analysis_failed"),
				"nutrition_status": "failed", "analysis_error": strings.TrimSpace(message),
				"analysis_completed_at": failedAt, "updated_at": failedAt,
			})
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		return tx.Model(&publishedCatalogItem{}).
			Where("id = ? AND content_version = ?", itemID, targetVersion).
			Updates(map[string]any{"nutrition_status": "failed", "updated_at": failedAt}).Error
	})
}

func (r *CatalogRepo) FindCollectorApplication(ctx context.Context, userID, schoolID, campusID, canteenID string, statuses []string) (*domain.CollectorApplication, error) {
	query := r.db.WithContext(ctx).Model(&domain.CollectorApplication{}).
		Where("user_id = ? AND school_id = ?", strings.TrimSpace(userID), strings.TrimSpace(schoolID))
	if strings.TrimSpace(campusID) == "" {
		query = query.Where("campus_id IS NULL")
	} else {
		query = query.Where("campus_id = ?", strings.TrimSpace(campusID))
	}
	if strings.TrimSpace(canteenID) == "" {
		query = query.Where("canteen_id IS NULL")
	} else {
		query = query.Where("canteen_id = ?", strings.TrimSpace(canteenID))
	}
	if len(statuses) > 0 {
		query = query.Where("status IN ?", statuses)
	}
	var application domain.CollectorApplication
	err := query.Order("created_at DESC").First(&application).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &application, err
}

func (r *CatalogRepo) CreateCollectorApplication(ctx context.Context, application *domain.CollectorApplication) error {
	return r.db.WithContext(ctx).Create(application).Error
}

func (r *CatalogRepo) ListCollectorApplications(ctx context.Context, userID, status string, limit, offset int) ([]domain.CollectorApplication, int64, error) {
	base := r.db.WithContext(ctx).Model(&domain.CollectorApplication{}).
		Joins("LEFT JOIN weapp_user collector_user ON collector_user.id = campus_collector_applications.user_id").
		Joins("LEFT JOIN schools collector_school ON collector_school.id = campus_collector_applications.school_id").
		Joins("LEFT JOIN school_campuses collector_campus ON collector_campus.id = campus_collector_applications.campus_id").
		Joins("LEFT JOIN school_canteens collector_canteen ON collector_canteen.id = campus_collector_applications.canteen_id")
	if strings.TrimSpace(userID) != "" {
		base = base.Where("campus_collector_applications.user_id = ?", strings.TrimSpace(userID))
	}
	if strings.TrimSpace(status) != "" && status != "all" {
		base = base.Where("campus_collector_applications.status = ?", strings.TrimSpace(status))
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var applications []domain.CollectorApplication
	if err := base.Select(`campus_collector_applications.*,
		COALESCE(collector_user.nickname, '') AS user_nickname,
		COALESCE(collector_user.telephone, '') AS user_telephone,
		COALESCE(collector_school.name, '') AS school_name,
		COALESCE(collector_campus.name, '') AS campus_name,
		COALESCE(collector_canteen.name, '') AS canteen_name`).
		Order("campus_collector_applications.created_at DESC, campus_collector_applications.id DESC").Limit(limit).Offset(offset).Find(&applications).Error; err != nil {
		return nil, 0, err
	}
	return applications, total, nil
}

func (r *CatalogRepo) ListCollectorScopes(ctx context.Context, userID string, activeOnly bool) ([]domain.CollectorScope, error) {
	query := r.db.WithContext(ctx).Model(&domain.CollectorScope{}).
		Joins("LEFT JOIN schools scope_school ON scope_school.id = campus_collector_scopes.school_id").
		Joins("LEFT JOIN school_campuses scope_campus ON scope_campus.id = campus_collector_scopes.campus_id").
		Joins("LEFT JOIN school_canteens scope_canteen ON scope_canteen.id = campus_collector_scopes.canteen_id").
		Where("campus_collector_scopes.user_id = ?", strings.TrimSpace(userID))
	if activeOnly {
		query = query.Where("campus_collector_scopes.status = ? AND (campus_collector_scopes.expires_at IS NULL OR campus_collector_scopes.expires_at > ?)", "active", time.Now())
	}
	var scopes []domain.CollectorScope
	err := query.Select(`campus_collector_scopes.*,
		COALESCE(scope_school.name, '') AS school_name,
		COALESCE(scope_campus.name, '') AS campus_name,
		COALESCE(scope_canteen.name, '') AS canteen_name`).
		Order("campus_collector_scopes.created_at DESC").Find(&scopes).Error
	return scopes, err
}

func (r *CatalogRepo) ReviewCollectorApplication(ctx context.Context, applicationID, adminID, status, note string, expiresAt *time.Time, reviewedAt time.Time) (*domain.CollectorApplication, *domain.CollectorScope, error) {
	var application domain.CollectorApplication
	var scope *domain.CollectorScope
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&application, "id = ?", strings.TrimSpace(applicationID)).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrCollectorApplicationAbsent
		} else if err != nil {
			return err
		}
		if application.Status != "pending" {
			return domain.ErrVersionConflict
		}
		updates := map[string]any{
			"status": status, "review_note": strings.TrimSpace(note), "reviewed_by": strings.TrimSpace(adminID),
			"reviewed_at": reviewedAt, "updated_at": reviewedAt,
		}
		if err := tx.Model(&application).Updates(updates).Error; err != nil {
			return err
		}
		application.Status, application.ReviewNote, application.ReviewedBy, application.ReviewedAt = status, strings.TrimSpace(note), stringPointerRepo(adminID), &reviewedAt
		if status != "approved" {
			return nil
		}
		if err := tx.Model(&domain.CollectorScope{}).
			Where("status = ? AND expires_at IS NOT NULL AND expires_at <= ?", "active", reviewedAt).
			Updates(map[string]any{"status": "expired", "updated_at": reviewedAt}).Error; err != nil {
			return err
		}
		query := tx.Model(&domain.CollectorScope{}).
			Where("user_id = ? AND school_id = ? AND status = ?", application.UserID, application.SchoolID, "active")
		if application.CampusID == nil {
			query = query.Where("campus_id IS NULL")
		} else {
			query = query.Where("campus_id = ?", *application.CampusID)
		}
		if application.CanteenID == nil {
			query = query.Where("canteen_id IS NULL")
		} else {
			query = query.Where("canteen_id = ?", *application.CanteenID)
		}
		var existing domain.CollectorScope
		findErr := query.First(&existing).Error
		if findErr == nil {
			scope = &existing
			return nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}
		created := domain.CollectorScope{
			ID: uuid.NewString(), UserID: application.UserID, ApplicationID: &application.ID,
			SchoolID: application.SchoolID, CampusID: application.CampusID, CanteenID: application.CanteenID,
			Status: "active", GrantedByAdminID: strings.TrimSpace(adminID), ExpiresAt: expiresAt,
			CreatedAt: &reviewedAt, UpdatedAt: &reviewedAt,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		scope = &created
		return nil
	})
	return &application, scope, err
}

func stringPointerRepo(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
