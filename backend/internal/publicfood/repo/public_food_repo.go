package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PublicFoodRepo struct {
	db *gorm.DB
}

func NewPublicFoodRepo(db *gorm.DB) *PublicFoodRepo {
	return &PublicFoodRepo{db: db}
}

type ListFilter struct {
	City               string
	SuitableForFatLoss *bool
	MerchantName       string
	MinCalories        *float64
	MaxCalories        *float64
	SortBy             string
	Limit              int
	Offset             int
	Type               string
	IsCampusFood       *bool
	SchoolID           string
	CampusID           string
	CanteenID          string
	WindowID           string
	SchoolName         string
	CanteenName        string
	IsCampusHighlight  *bool
	ViewerUserID       string
}

type CampusDirectoryRef struct {
	SchoolID    string
	SchoolName  string
	CampusID    string
	CampusName  string
	CanteenID   string
	CanteenName string
	WindowID    string
	WindowName  string
	Floor       string
}

func (r *PublicFoodRepo) CreateItem(ctx context.Context, item *domain.PublicFoodItem) error {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	db := r.db.WithContext(ctx)
	if strings.TrimSpace(item.PriceType) == "" {
		db = db.Omit("price_type")
	}
	return db.Create(item).Error
}

func (r *PublicFoodRepo) UpdateStatus(ctx context.Context, itemID, status string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if status == "published" {
		updates["published_at"] = time.Now()
	}
	return r.db.WithContext(ctx).Model(&domain.PublicFoodItem{}).Where("id = ?", itemID).Updates(updates).Error
}

func (r *PublicFoodRepo) LinkAnalysisTask(ctx context.Context, itemID, taskID string) error {
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ?", itemID).
		Updates(map[string]any{
			"analysis_task_id": taskID,
			"updated_at":       time.Now(),
		}).Error
}

func (r *PublicFoodRepo) UpdateNutritionFromAnalysis(ctx context.Context, itemID string, result map[string]any) error {
	snapshot := NutritionSnapshotFromResult(result)
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ?", itemID).
		Updates(map[string]any{
			"total_calories": snapshot.TotalCalories,
			"total_protein":  snapshot.TotalProtein,
			"total_carbs":    snapshot.TotalCarbs,
			"total_fat":      snapshot.TotalFat,
			"items":          datatypes.JSONSlice[map[string]any](snapshot.Items),
			"description":    snapshot.Description,
			"insight":        snapshot.Insight,
			"updated_at":     time.Now(),
		}).Error
}

type NutritionSnapshot struct {
	TotalCalories float64
	TotalProtein  float64
	TotalCarbs    float64
	TotalFat      float64
	Items         []map[string]any
	Description   string
	Insight       string
}

func NutritionSnapshotFromResult(result map[string]any) NutritionSnapshot {
	calories, protein, carbs, fat := nutritionTotalsFromResult(result)
	return NutritionSnapshot{
		TotalCalories: calories, TotalProtein: protein, TotalCarbs: carbs, TotalFat: fat,
		Items: mapSliceFromAny(result["items"]), Description: stringFromAny(result["description"]), Insight: stringFromAny(result["insight"]),
	}
}

func (r *PublicFoodRepo) ListPublished(ctx context.Context, f ListFilter) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	q := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*, COALESCE(rt.status, t.status, '') AS analysis_status, COALESCE(rt.error_message, t.error_message, '') AS analysis_error, s.logo_url AS school_logo_url").
		Joins("LEFT JOIN analysis_tasks t ON t.id = p.analysis_task_id").
		Joins("LEFT JOIN analysis_tasks rt ON CAST(rt.id AS TEXT) = (t.result ->> 'redirectTaskId')").
		Joins("LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'").
		Where("p.status = ?", "published")
	q = visiblePublicFoodToViewer(q, "p.user_id", f.ViewerUserID)
	if f.City != "" {
		q = q.Where("p.city = ?", f.City)
	}
	if f.SuitableForFatLoss != nil {
		q = q.Where("p.suitable_for_fat_loss = ?", *f.SuitableForFatLoss)
	}
	if f.MerchantName != "" {
		q = q.Where("p.merchant_name ILIKE ?", "%"+f.MerchantName+"%")
	}
	if f.MinCalories != nil {
		q = q.Where("p.total_calories >= ?", *f.MinCalories)
	}
	if f.MaxCalories != nil {
		q = q.Where("p.total_calories <= ?", *f.MaxCalories)
	}
	if f.SchoolID != "" {
		q = q.Where("p.school_id = ?", f.SchoolID)
	}
	if f.CampusID != "" {
		q = q.Where("p.campus_id = ?", f.CampusID)
	}
	if f.CanteenID != "" {
		q = q.Where("p.canteen_id = ?", f.CanteenID)
	}
	if f.WindowID != "" {
		q = q.Where("p.window_id = ?", f.WindowID)
	}
	itemType := normalizePublicFoodTypeFilter(f.Type)
	if itemType != "" {
		q = applyStrictPublicFoodTypeWhere(q, "p", itemType)
	} else if f.IsCampusFood != nil {
		q = applyLegacyPublicFoodTypeWhere(q, "p", publicFoodTypeFromCampusFlag(*f.IsCampusFood))
	}
	if f.SchoolName != "" {
		q = q.Where("p.school_name = ?", f.SchoolName)
	}
	if f.CanteenName != "" {
		q = q.Where("p.canteen_name = ?", f.CanteenName)
	}
	if f.IsCampusHighlight != nil {
		q = q.Where("p.is_campus_highlight = ?", *f.IsCampusHighlight)
	}
	switch f.SortBy {
	case "hot":
		q = q.Order("p.like_count desc")
	case "rating":
		q = q.Order("p.avg_rating desc")
	case "high_protein":
		q = q.Order("p.total_protein desc NULLS LAST")
	case "low_calorie":
		q = q.Order("CASE WHEN COALESCE(p.total_calories, 0) <= 0 THEN 1 ELSE 0 END asc, p.total_calories asc NULLS LAST")
	case "value":
		q = q.Order("COALESCE(p.price, 999999) asc NULLS LAST, p.total_protein desc NULLS LAST")
	default:
		q = q.Order("p.published_at desc NULLS LAST, p.created_at desc")
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	err := q.Limit(f.Limit).Offset(f.Offset).Scan(&rows).Error
	return rows, err
}

func publicFoodTypeFromCampusFlag(isCampus bool) string {
	if isCampus {
		return "campus"
	}
	return "common"
}

func normalizePublicFoodTypeFilter(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "common":
		return "common"
	case "campus":
		return "campus"
	default:
		return ""
	}
}

func applyStrictPublicFoodTypeWhere(q *gorm.DB, alias string, itemType string) *gorm.DB {
	prefix := ""
	if strings.TrimSpace(alias) != "" {
		prefix = strings.TrimSpace(alias) + "."
	}
	switch itemType {
	case "campus", "common":
		return q.Where(prefix+"type = ?", itemType)
	default:
		return q
	}
}

func applyLegacyPublicFoodTypeWhere(q *gorm.DB, alias string, itemType string) *gorm.DB {
	prefix := ""
	if strings.TrimSpace(alias) != "" {
		prefix = strings.TrimSpace(alias) + "."
	}
	switch itemType {
	case "campus":
		return q.Where("("+prefix+"type = ? OR "+prefix+"is_campus_food = ?)", "campus", true)
	case "common":
		return q.Where("("+prefix+"type = ? OR COALESCE("+prefix+"is_campus_food, false) = ?)", "common", false)
	default:
		return q
	}
}

func visiblePublicFoodToViewer(q *gorm.DB, authorExpr string, viewerUserID string) *gorm.DB {
	viewerUserID = strings.TrimSpace(viewerUserID)
	if viewerUserID == "" || strings.TrimSpace(authorExpr) == "" {
		return q
	}
	return q.Where(`
		NOT EXISTS (
			SELECT 1 FROM user_blocks ub
			WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = `+authorExpr+`)
			   OR (ub.blocker_user_id = `+authorExpr+` AND ub.blocked_user_id = ?)
		)
	`, viewerUserID, viewerUserID)
}

// ListCampusHighlights 查询精选校园内容，用于圈子默认流混入
func (r *PublicFoodRepo) ListCampusHighlights(ctx context.Context, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 20 {
		limit = 3
	}
	err := r.db.WithContext(ctx).
		Where("is_campus_highlight = ? AND status = ?", true, "published").
		Order("published_at desc NULLS LAST, created_at desc").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListSimilarCampusFoods(ctx context.Context, item domain.PublicFoodItem, limit int, viewerUserID string) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 20 {
		limit = 6
	}
	q := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*").
		Where("id <> ? AND status = ?", item.ID, "published")
	q = visiblePublicFoodToViewer(q, "p.user_id", viewerUserID)
	q = applyLegacyPublicFoodTypeWhere(q, "p", "campus")
	if item.SchoolID != nil && strings.TrimSpace(*item.SchoolID) != "" {
		q = q.Where("p.school_id = ?", strings.TrimSpace(*item.SchoolID))
	} else if strings.TrimSpace(item.SchoolName) != "" {
		q = q.Where("p.school_name = ?", item.SchoolName)
	}
	if item.CanteenID != nil && strings.TrimSpace(*item.CanteenID) != "" {
		q = q.Where("p.canteen_id = ?", strings.TrimSpace(*item.CanteenID))
	} else if strings.TrimSpace(item.CanteenName) != "" {
		q = q.Where("p.canteen_name = ?", item.CanteenName)
	}
	err := q.
		Order(gorm.Expr("CASE WHEN COALESCE(window_name, '') = ? AND COALESCE(window_name, '') <> '' THEN 0 ELSE 1 END", item.WindowName)).
		Order(gorm.Expr("CASE WHEN COALESCE(floor, '') = ? AND COALESCE(floor, '') <> '' THEN 0 ELSE 1 END", item.Floor)).
		Order("(COALESCE(collection_count, 0) + COALESCE(like_count, 0)) DESC").
		Order("p.published_at DESC").
		Order("p.created_at DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListRelatedCampusFeeds(ctx context.Context, item domain.PublicFoodItem, limit int, viewerUserID string) ([]domain.CampusRelatedFeedItem, error) {
	var rows []domain.CampusRelatedFeedItem
	if limit <= 0 || limit > 20 {
		limit = 6
	}
	q := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.id, p.user_id, p.food_name, p.image_path, p.image_paths, p.school_name, p.canteen_name, p.campus_location_text AS campus_location, p.total_calories, p.total_protein, p.price, p.price_unit, p.like_count, p.comment_count, p.collection_count, p.published_at, s.logo_url AS school_logo_url").
		Joins("LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'").
		Where("p.id <> ? AND p.status = ? AND p.is_campus_highlight = ?", item.ID, "published", true)
	q = visiblePublicFoodToViewer(q, "p.user_id", viewerUserID)
	q = applyLegacyPublicFoodTypeWhere(q, "p", "campus")
	if item.SchoolID != nil && strings.TrimSpace(*item.SchoolID) != "" {
		q = q.Where("p.school_id = ?", strings.TrimSpace(*item.SchoolID))
	} else if strings.TrimSpace(item.SchoolName) != "" {
		q = q.Where("p.school_name = ?", item.SchoolName)
	}
	if item.CanteenID != nil && strings.TrimSpace(*item.CanteenID) != "" {
		q = q.Where("p.canteen_id = ?", strings.TrimSpace(*item.CanteenID))
	} else if strings.TrimSpace(item.CanteenName) != "" {
		q = q.Where("p.canteen_name = ?", item.CanteenName)
	}
	err := q.
		Order("p.published_at DESC").
		Order("p.created_at DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListMine(ctx context.Context, userID string, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND status NOT IN ?", userID, []string{"user_deleted", "deleted"}).
		Order("created_at desc").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) ListCollected(ctx context.Context, userID string, limit int, viewerUserID string) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*").
		Joins("JOIN public_food_library_collections c ON c.library_item_id = p.id").
		Where("c.user_id = ? AND p.status = ?", userID, "published").
		Scopes(func(q *gorm.DB) *gorm.DB {
			return visiblePublicFoodToViewer(q, "p.user_id", viewerUserID)
		}).
		Order("c.created_at desc").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *PublicFoodRepo) GetItem(ctx context.Context, itemID string) (*domain.PublicFoodItem, error) {
	var row domain.PublicFoodItem
	err := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*, COALESCE(rt.status, t.status, '') AS analysis_status, COALESCE(rt.error_message, t.error_message, '') AS analysis_error, s.logo_url AS school_logo_url").
		Joins("LEFT JOIN analysis_tasks t ON t.id = p.analysis_task_id").
		Joins("LEFT JOIN analysis_tasks rt ON CAST(rt.id AS TEXT) = (t.result ->> 'redirectTaskId')").
		Joins("LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'").
		Where("p.id = ?", itemID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *PublicFoodRepo) GetCampusDirectoryRef(ctx context.Context, schoolID, campusID, canteenID, windowID string) (*CampusDirectoryRef, error) {
	schoolID = strings.TrimSpace(schoolID)
	campusID = strings.TrimSpace(campusID)
	canteenID = strings.TrimSpace(canteenID)
	windowID = strings.TrimSpace(windowID)
	if schoolID == "" && campusID == "" && canteenID == "" && windowID == "" {
		return nil, nil
	}
	ref := &CampusDirectoryRef{}
	if schoolID != "" {
		var row struct {
			ID   string
			Name string
		}
		err := r.db.WithContext(ctx).Table("schools").Select("id, name").Where("id = ? AND status = ?", schoolID, "active").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		ref.SchoolID = row.ID
		ref.SchoolName = row.Name
	}
	if campusID != "" {
		var row struct {
			ID       string
			SchoolID string
			Name     string
		}
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
		ref.CampusID = row.ID
		ref.CampusName = row.Name
		if ref.SchoolID == "" {
			ref.SchoolID = row.SchoolID
		}
	}
	if canteenID != "" {
		var row struct {
			ID       string
			SchoolID string
			CampusID *string
			Name     string
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
		ref.CanteenID = row.ID
		ref.CanteenName = row.Name
		if ref.SchoolID == "" {
			ref.SchoolID = row.SchoolID
		}
		if ref.CampusID == "" && row.CampusID != nil {
			ref.CampusID = *row.CampusID
		}
	}
	if windowID != "" {
		var row struct {
			ID        string
			SchoolID  string
			CampusID  *string
			CanteenID string
			Name      string
			Floor     *string
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
		ref.WindowID = row.ID
		ref.WindowName = row.Name
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

func (r *PublicFoodRepo) GetFoodRecord(ctx context.Context, recordID string) (map[string]any, error) {
	var row map[string]any
	err := r.db.WithContext(ctx).Table("user_food_records").Where("id = ?", recordID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return row, err
}

func (r *PublicFoodRepo) GetTaskImagePaths(ctx context.Context, taskID string) ([]string, error) {
	var task analyzedomain.AnalysisTask
	err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return task.ImagePaths, err
}

func (r *PublicFoodRepo) CreateCampusAnalysisTask(ctx context.Context, userID, itemID string, imageURL *string, imagePaths []string, payload map[string]any) (*analyzedomain.AnalysisTask, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["public_food_item_id"] = itemID
	payload["source_type"] = "campus_public_food"
	task := analyzedomain.AnalysisTask{
		ID:         uuid.New().String(),
		UserID:     userID,
		TaskType:   "food",
		Status:     "pending",
		ImageURL:   imageURL,
		ImagePaths: imagePaths,
		Payload:    payload,
	}
	if err := r.db.WithContext(ctx).Create(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *PublicFoodRepo) CreateModerationTask(ctx context.Context, userID, itemID, text string) (*analyzedomain.AnalysisTask, error) {
	task := analyzedomain.AnalysisTask{
		ID:        uuid.New().String(),
		UserID:    userID,
		TaskType:  "public_food_library_text",
		Status:    "pending",
		TextInput: &text,
		Payload:   map[string]any{"item_id": itemID},
	}
	if err := r.db.WithContext(ctx).Create(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *PublicFoodRepo) Like(ctx context.Context, userID, itemID string) error {
	row := domain.PublicFoodLike{ID: uuid.New().String(), UserID: userID, LibraryItemID: itemID}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *PublicFoodRepo) Unlike(ctx context.Context, userID, itemID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND library_item_id = ?", userID, itemID).Delete(&domain.PublicFoodLike{}).Error
}

func (r *PublicFoodRepo) Collect(ctx context.Context, userID, itemID string) error {
	row := domain.PublicFoodCollection{ID: uuid.New().String(), UserID: userID, LibraryItemID: itemID}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *PublicFoodRepo) Uncollect(ctx context.Context, userID, itemID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND library_item_id = ?", userID, itemID).Delete(&domain.PublicFoodCollection{}).Error
}

func (r *PublicFoodRepo) UpdateItem(ctx context.Context, itemID, userID string, updates map[string]any) error {
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ? AND user_id = ?", itemID, userID).
		Updates(updates).Error
}

func (r *PublicFoodRepo) SoftDeleteOwned(ctx context.Context, itemID, userID, status string) error {
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ? AND user_id = ?", itemID, userID).
		Updates(map[string]any{
			"status":     status,
			"updated_at": time.Now(),
		}).Error
}

func (r *PublicFoodRepo) ListComments(ctx context.Context, itemID string, limit int, viewerUserID string) ([]domain.PublicFoodComment, error) {
	var rows []publicFoodCommentRow
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := r.db.WithContext(ctx).
		Table("public_food_library_comments AS c").
		Select("c.id, c.user_id, c.library_item_id, c.parent_comment_id, c.reply_to_user_id, c.content, c.rating, c.created_at, COALESCE(u.nickname, '用户') AS nickname, COALESCE(u.avatar, '') AS avatar, COALESCE(ru.nickname, '') AS reply_to_nickname").
		Joins("LEFT JOIN weapp_user u ON u.id = c.user_id").
		Joins("LEFT JOIN weapp_user ru ON ru.id = c.reply_to_user_id").
		Where("c.library_item_id = ?", itemID)
	q = visiblePublicFoodToViewer(q, "c.user_id", viewerUserID)
	if strings.TrimSpace(viewerUserID) != "" {
		q = q.Where(`
			(c.reply_to_user_id IS NULL OR NOT EXISTS (
				SELECT 1 FROM user_blocks ub
				WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = c.reply_to_user_id)
				   OR (ub.blocker_user_id = c.reply_to_user_id AND ub.blocked_user_id = ?)
			))
		`, viewerUserID, viewerUserID)
	}
	err := q.
		Order("CASE WHEN c.parent_comment_id IS NULL THEN 0 ELSE 1 END asc").
		Order("c.created_at desc").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return buildPublicFoodCommentTree(mapPublicFoodCommentRows(rows)), nil
}

func (r *PublicFoodRepo) GetComment(ctx context.Context, itemID, commentID string) (*domain.PublicFoodComment, error) {
	var row publicFoodCommentRow
	err := r.db.WithContext(ctx).
		Table("public_food_library_comments AS c").
		Select("c.id, c.user_id, c.library_item_id, c.parent_comment_id, c.reply_to_user_id, c.content, c.rating, c.created_at, COALESCE(u.nickname, '用户') AS nickname, COALESCE(u.avatar, '') AS avatar, COALESCE(ru.nickname, '') AS reply_to_nickname").
		Joins("LEFT JOIN weapp_user u ON u.id = c.user_id").
		Joins("LEFT JOIN weapp_user ru ON ru.id = c.reply_to_user_id").
		Where("c.library_item_id = ? AND c.id = ?", itemID, commentID).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == "" {
		return nil, nil
	}
	comment := row.toDomain()
	return &comment, nil
}

type publicFoodCommentRow struct {
	ID              string
	UserID          string
	LibraryItemID   string
	ParentCommentID *string
	ReplyToUserID   *string
	Content         string
	Rating          *int
	CreatedAt       *time.Time
	Nickname        string
	Avatar          string
	ReplyToNickname string
}

func (row publicFoodCommentRow) toDomain() domain.PublicFoodComment {
	return domain.PublicFoodComment{
		ID:              row.ID,
		UserID:          row.UserID,
		LibraryItemID:   row.LibraryItemID,
		ParentCommentID: row.ParentCommentID,
		ReplyToUserID:   row.ReplyToUserID,
		Content:         row.Content,
		Rating:          row.Rating,
		CreatedAt:       row.CreatedAt,
		Nickname:        row.Nickname,
		Avatar:          row.Avatar,
		ReplyToNickname: row.ReplyToNickname,
	}
}

func mapPublicFoodCommentRows(rows []publicFoodCommentRow) []domain.PublicFoodComment {
	out := make([]domain.PublicFoodComment, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out
}

func buildPublicFoodCommentTree(comments []domain.PublicFoodComment) []domain.PublicFoodComment {
	roots := make([]domain.PublicFoodComment, 0, len(comments))
	rootIndex := make(map[string]int, len(comments))
	orphanReplies := make([]domain.PublicFoodComment, 0)
	for _, comment := range comments {
		if comment.ParentCommentID == nil || *comment.ParentCommentID == "" {
			comment.Replies = []domain.PublicFoodComment{}
			rootIndex[comment.ID] = len(roots)
			roots = append(roots, comment)
			continue
		}
		parentID := *comment.ParentCommentID
		if idx, ok := rootIndex[parentID]; ok {
			roots[idx].Replies = append(roots[idx].Replies, comment)
			continue
		}
		orphanReplies = append(orphanReplies, comment)
	}
	for _, reply := range orphanReplies {
		parentID := ""
		if reply.ParentCommentID != nil {
			parentID = *reply.ParentCommentID
		}
		if idx, ok := rootIndex[parentID]; ok {
			roots[idx].Replies = append(roots[idx].Replies, reply)
		}
	}
	for i := range roots {
		replies := roots[i].Replies
		for left, right := 0, len(replies)-1; left < right; left, right = left+1, right-1 {
			replies[left], replies[right] = replies[right], replies[left]
		}
		roots[i].Replies = replies
	}
	return roots
}

func (r *PublicFoodRepo) CreateComment(ctx context.Context, comment *domain.PublicFoodComment) error {
	if comment.ID == "" {
		comment.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *PublicFoodRepo) DeleteOwnComment(ctx context.Context, itemID, commentID, userID string) (int64, error) {
	tx := r.db.WithContext(ctx).Begin()
	if tx.Error != nil {
		return 0, tx.Error
	}
	result := tx.
		Where("library_item_id = ? AND id = ? AND user_id = ?", itemID, commentID, userID).
		Delete(&domain.PublicFoodComment{})
	if result.Error != nil {
		_ = tx.Rollback()
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		_ = tx.Rollback()
		return 0, nil
	}
	if err := tx.Where("library_item_id = ? AND parent_comment_id = ?", itemID, commentID).Delete(&domain.PublicFoodComment{}).Error; err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	if err := tx.Commit().Error; err != nil {
		return 0, err
	}
	return result.RowsAffected, nil
}

func (r *PublicFoodRepo) RefreshCommentStats(ctx context.Context, itemID string) error {
	type stats struct {
		Count int
		Avg   float64
	}
	var s stats
	if err := r.db.WithContext(ctx).Table("public_food_library_comments").
		Select("COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg").
		Where("library_item_id = ?", itemID).
		Scan(&s).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&domain.PublicFoodItem{}).Where("id = ?", itemID).Updates(map[string]any{
		"comment_count": s.Count,
		"avg_rating":    s.Avg,
	}).Error
}

func (r *PublicFoodRepo) CreateFeedback(ctx context.Context, feedback *domain.PublicFoodFeedback) error {
	if feedback.ID == "" {
		feedback.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(feedback).Error
}

func (r *PublicFoodRepo) LikeStatus(ctx context.Context, itemIDs []string, userID string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	var rows []domain.PublicFoodLike
	err := r.db.WithContext(ctx).Where("user_id = ? AND library_item_id IN ?", userID, itemIDs).Find(&rows).Error
	for _, row := range rows {
		out[row.LibraryItemID] = true
	}
	return out, err
}

func (r *PublicFoodRepo) CollectionStatus(ctx context.Context, itemIDs []string, userID string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	var rows []domain.PublicFoodCollection
	err := r.db.WithContext(ctx).Where("user_id = ? AND library_item_id IN ?", userID, itemIDs).Find(&rows).Error
	for _, row := range rows {
		out[row.LibraryItemID] = true
	}
	return out, err
}

func (r *PublicFoodRepo) Authors(ctx context.Context, userIDs []string) (map[string]domain.Author, error) {
	out := map[string]domain.Author{}
	if len(userIDs) == 0 {
		return out, nil
	}
	var users []authrepo.User
	err := r.db.WithContext(ctx).Where("id IN ?", uniqueNonEmpty(userIDs)).Find(&users).Error
	for _, u := range users {
		name := strings.TrimSpace(u.Nickname)
		if name == "" {
			name = "用户"
		}
		out[u.ID] = domain.Author{ID: u.ID, Nickname: name, Avatar: u.Avatar}
	}
	return out, err
}

func uniqueNonEmpty(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func extractFloat(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch v := values[key].(type) {
		case float64:
			return v
		case float32:
			return float64(v)
		case int:
			return float64(v)
		case int64:
			return float64(v)
		case json.Number:
			n, _ := v.Float64()
			return n
		case string:
			n, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
			return n
		}
	}
	return 0
}

func nutritionTotalsFromResult(result map[string]any) (float64, float64, float64, float64) {
	calories := extractFloat(result, "total_calories", "totalCalories")
	protein := extractFloat(result, "total_protein", "totalProtein")
	carbs := extractFloat(result, "total_carbs", "totalCarbs")
	fat := extractFloat(result, "total_fat", "totalFat")
	if calories > 0 || protein > 0 || carbs > 0 || fat > 0 {
		return calories, protein, carbs, fat
	}
	for _, item := range mapSliceFromAny(result["items"]) {
		nutrients := mapFromAny(item["nutrients"])
		calories += extractFloatWithFallback(nutrients, item, "calories", "calorie", "total_calories", "totalCalories")
		protein += extractFloatWithFallback(nutrients, item, "protein", "total_protein", "totalProtein")
		carbs += extractFloatWithFallback(nutrients, item, "carbs", "carbohydrates", "total_carbs", "totalCarbs")
		fat += extractFloatWithFallback(nutrients, item, "fat", "total_fat", "totalFat")
	}
	return calories, protein, carbs, fat
}

func extractFloatWithFallback(primary map[string]any, fallback map[string]any, keys ...string) float64 {
	if value := extractFloat(primary, keys...); value != 0 {
		return value
	}
	return extractFloat(fallback, keys...)
}

func mapSliceFromAny(value any) []map[string]any {
	switch v := value.(type) {
	case []map[string]any:
		return v
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if m := mapFromAny(item); len(m) > 0 {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func mapFromAny(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		return v
	default:
		return nil
	}
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
