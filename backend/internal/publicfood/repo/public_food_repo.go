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
	SchoolName         string
	CanteenName        string
	IsCampusHighlight  *bool
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
	totalCalories, totalProtein, totalCarbs, totalFat := nutritionTotalsFromResult(result)
	return r.db.WithContext(ctx).
		Model(&domain.PublicFoodItem{}).
		Where("id = ?", itemID).
		Updates(map[string]any{
			"total_calories": totalCalories,
			"total_protein":  totalProtein,
			"total_carbs":    totalCarbs,
			"total_fat":      totalFat,
			"items":          datatypes.JSONSlice[map[string]any](mapSliceFromAny(result["items"])),
			"description":    stringFromAny(result["description"]),
			"insight":        stringFromAny(result["insight"]),
			"updated_at":     time.Now(),
		}).Error
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

func (r *PublicFoodRepo) ListSimilarCampusFoods(ctx context.Context, item domain.PublicFoodItem, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 20 {
		limit = 6
	}
	q := r.db.WithContext(ctx).
		Where("id <> ? AND status = ?", item.ID, "published")
	q = applyLegacyPublicFoodTypeWhere(q, "p", "campus")
	if strings.TrimSpace(item.SchoolName) != "" {
		q = q.Where("p.school_name = ?", item.SchoolName)
	}
	if strings.TrimSpace(item.CanteenName) != "" {
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

func (r *PublicFoodRepo) ListRelatedCampusFeeds(ctx context.Context, item domain.PublicFoodItem, limit int) ([]domain.CampusRelatedFeedItem, error) {
	var rows []domain.CampusRelatedFeedItem
	if limit <= 0 || limit > 20 {
		limit = 6
	}
	q := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.id, p.food_name, p.image_path, p.image_paths, p.school_name, p.canteen_name, p.campus_location_text AS campus_location, p.total_calories, p.total_protein, p.price, p.price_unit, p.like_count, p.comment_count, p.collection_count, p.published_at, s.logo_url AS school_logo_url").
		Joins("LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'").
		Where("p.id <> ? AND p.status = ? AND p.is_campus_highlight = ?", item.ID, "published", true)
	q = applyLegacyPublicFoodTypeWhere(q, "p", "campus")
	if strings.TrimSpace(item.SchoolName) != "" {
		q = q.Where("p.school_name = ?", item.SchoolName)
	}
	if strings.TrimSpace(item.CanteenName) != "" {
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

func (r *PublicFoodRepo) ListCollected(ctx context.Context, userID string, limit int) ([]domain.PublicFoodItem, error) {
	var rows []domain.PublicFoodItem
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*").
		Joins("JOIN public_food_library_collections c ON c.library_item_id = p.id").
		Where("c.user_id = ? AND p.status = ?", userID, "published").
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

func (r *PublicFoodRepo) ListComments(ctx context.Context, itemID string, limit int) ([]domain.PublicFoodComment, error) {
	var rows []publicFoodCommentRow
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	err := r.db.WithContext(ctx).
		Table("public_food_library_comments AS c").
		Select("c.id, c.user_id, c.library_item_id, c.content, c.rating, c.created_at, COALESCE(u.nickname, '用户') AS nickname, COALESCE(u.avatar, '') AS avatar").
		Joins("LEFT JOIN weapp_user u ON u.id = c.user_id").
		Where("c.library_item_id = ?", itemID).
		Order("c.created_at desc").
		Limit(limit).
		Scan(&rows).Error
	return mapPublicFoodCommentRows(rows), err
}

func (r *PublicFoodRepo) GetComment(ctx context.Context, itemID, commentID string) (*domain.PublicFoodComment, error) {
	var row publicFoodCommentRow
	err := r.db.WithContext(ctx).
		Table("public_food_library_comments AS c").
		Select("c.id, c.user_id, c.library_item_id, c.content, c.rating, c.created_at, COALESCE(u.nickname, '用户') AS nickname, COALESCE(u.avatar, '') AS avatar").
		Joins("LEFT JOIN weapp_user u ON u.id = c.user_id").
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
	ID            string
	UserID        string
	LibraryItemID string
	Content       string
	Rating        *int
	CreatedAt     *time.Time
	Nickname      string
	Avatar        string
}

func (row publicFoodCommentRow) toDomain() domain.PublicFoodComment {
	return domain.PublicFoodComment{
		ID:            row.ID,
		UserID:        row.UserID,
		LibraryItemID: row.LibraryItemID,
		Content:       row.Content,
		Rating:        row.Rating,
		CreatedAt:     row.CreatedAt,
		Nickname:      row.Nickname,
		Avatar:        row.Avatar,
	}
}

func mapPublicFoodCommentRows(rows []publicFoodCommentRow) []domain.PublicFoodComment {
	out := make([]domain.PublicFoodComment, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out
}

func (r *PublicFoodRepo) CreateComment(ctx context.Context, comment *domain.PublicFoodComment) error {
	if comment.ID == "" {
		comment.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *PublicFoodRepo) DeleteOwnComment(ctx context.Context, itemID, commentID, userID string) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("library_item_id = ? AND id = ? AND user_id = ?", itemID, commentID, userID).
		Delete(&domain.PublicFoodComment{})
	return result.RowsAffected, result.Error
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
