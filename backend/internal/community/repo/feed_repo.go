package repo

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/community/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	FeedTargetFoodRecord  = "food_record"
	FeedTargetExerciseLog = "exercise_log"
	FeedTargetCirclePost  = "circle_post"
	FeedTargetCampusFood  = "campus_food"
)

type FeedRecord struct {
	FeedType         string           `gorm:"column:feed_type" json:"feed_type"`
	ID               string           `gorm:"column:id" json:"id"`
	UserID           string           `gorm:"column:user_id" json:"user_id"`
	MealType         string           `gorm:"column:meal_type" json:"meal_type"`
	RecordTime       *time.Time       `gorm:"column:record_time" json:"record_time"`
	CreatedAt        *time.Time       `gorm:"column:created_at" json:"created_at"`
	TotalCalories    float64          `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein     float64          `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs       float64          `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat         float64          `gorm:"column:total_fat" json:"total_fat"`
	Fiber            *float64         `gorm:"column:fiber" json:"fiber,omitempty"`
	Sugar            *float64         `gorm:"column:sugar" json:"sugar,omitempty"`
	SodiumMg         *float64         `gorm:"column:sodium_mg" json:"sodium_mg,omitempty"`
	TotalWeightGrams *float64         `gorm:"column:total_weight_grams" json:"total_weight_grams,omitempty"`
	ImagePath        *string          `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths       []string         `gorm:"column:image_paths;serializer:json" json:"image_paths,omitempty"`
	Description      *string          `gorm:"column:description" json:"description,omitempty"`
	Title            *string          `gorm:"column:title" json:"title,omitempty"`
	Body             *string          `gorm:"column:body" json:"body,omitempty"`
	Items            []map[string]any `gorm:"column:items;serializer:json" json:"items"`
	DietGoal         *string          `gorm:"column:diet_goal" json:"diet_goal,omitempty"`
	HiddenFromFeed   bool             `gorm:"column:hidden_from_feed" json:"hidden_from_feed"`
	EntryType        *string          `gorm:"column:entry_type" json:"entry_type,omitempty"`
	RecipeID         *string          `gorm:"column:recipe_id" json:"recipe_id,omitempty"`
	ExerciseType     *string          `gorm:"column:exercise_type" json:"exercise_type,omitempty"`
	ExerciseDesc     *string          `gorm:"column:exercise_desc" json:"exercise_desc,omitempty"`
	CaloriesBurned   *float64         `gorm:"column:calories_burned" json:"calories_burned,omitempty"`
	DurationMin      *int             `gorm:"column:duration_min" json:"duration_min,omitempty"`
	AIReasoning      *string          `gorm:"column:ai_reasoning" json:"ai_reasoning,omitempty"`
	ExerciseItems    []map[string]any `gorm:"column:exercise_items;serializer:json" json:"exercise_items,omitempty"`
	// Campus food fields (for public_food_library entries appearing in feed)
	Price             float64 `gorm:"column:price" json:"price,omitempty"`
	PriceUnit         string  `gorm:"column:price_unit" json:"price_unit,omitempty"`
	SchoolName        string  `gorm:"column:school_name" json:"school_name,omitempty"`
	CanteenName       string  `gorm:"column:canteen_name" json:"canteen_name,omitempty"`
	CampusLocation    string  `gorm:"column:campus_location_text" json:"campus_location,omitempty"`
	IsCampusFood      bool    `gorm:"column:is_campus_food" json:"is_campus_food"`
	IsCampusHighlight bool    `gorm:"column:is_campus_highlight" json:"is_campus_highlight"`
	LikeCount         int     `gorm:"column:like_count" json:"like_count,omitempty"`
	CommentCount      int     `gorm:"column:comment_count" json:"comment_count,omitempty"`
	CollectionCount   int     `gorm:"column:collection_count" json:"collection_count,omitempty"`
}

func (FeedRecord) TableName() string { return "user_food_records" }

type UserFriend struct {
	UserID   string `gorm:"column:user_id"`
	FriendID string `gorm:"column:friend_id"`
}

func (UserFriend) TableName() string { return "user_friends" }

type UserProfile struct {
	ID            string `gorm:"column:id"`
	Nickname      string `gorm:"column:nickname"`
	Avatar        string `gorm:"column:avatar"`
	PublicRecords *bool  `gorm:"column:public_records"`
	PetLevel      *int   `gorm:"-"`
}

type NutrientFoodRow struct {
	ID        string  `gorm:"column:id"`
	Name      string  `gorm:"column:name"`
	ImagePath *string `gorm:"column:image_path"`
	Value     float64 `gorm:"column:value"`
}

func (UserProfile) TableName() string { return "weapp_user" }

type LikeInfo struct {
	Count int
	Liked bool
}

type FeedTarget struct {
	TargetType string
	TargetID   string
}

type FeedRepo struct {
	db *gorm.DB
}

func NewFeedRepo(db *gorm.DB) *FeedRepo {
	return &FeedRepo{db: db}
}

func (r *FeedRepo) exerciseItemsSelect() string {
	emptyItems := exerciseItemsEmptyLiteral(r.db)
	return fmt.Sprintf("COALESCE(exercise_items, %s) AS exercise_items", emptyItems)
}

func exerciseItemsEmptyLiteral(db *gorm.DB) string {
	if db != nil && db.Dialector != nil && db.Dialector.Name() == "postgres" {
		return "'[]'::jsonb"
	}
	return "'[]'"
}

func (r *FeedRepo) ListPublicFeed(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	var publicUserIDs []string
	q := r.db.WithContext(ctx).Table("weapp_user").
		Select("id").Where("COALESCE(public_records, TRUE) = TRUE")
	if len(authorIDs) > 0 {
		q = q.Where("id IN ?", authorIDs)
	}
	err := q.Pluck("id", &publicUserIDs).Error
	if err != nil {
		return nil, err
	}
	if len(publicUserIDs) == 0 {
		return nil, nil
	}

	return r.listFeedByAuthors(ctx, publicUserIDs, contentType, mealType, dietGoal, date, sortBy, limit)
}

func (r *FeedRepo) ListFriendFeed(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	if len(authorIDs) == 0 {
		return nil, nil
	}
	return r.listFeedByAuthors(ctx, authorIDs, contentType, mealType, dietGoal, date, sortBy, limit)
}

func (r *FeedRepo) listFeedByAuthors(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	contentType = NormalizeTargetType(contentType)
	if contentType == "" {
		contentType = "all"
	}
	var rows []FeedRecord
	if contentType == "campus_food" {
		campusRows, err := r.listCampusFeed(ctx, limit)
		if err != nil {
			return nil, err
		}
		return campusRows, nil
	}
	if contentType == "all" || contentType == FeedTargetFoodRecord {
		foodRows, err := r.listFoodFeedByAuthors(ctx, authorIDs, mealType, dietGoal, date, sortBy, limit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, foodRows...)
	}
	if contentType == "all" || contentType == FeedTargetExerciseLog {
		exerciseRows, err := r.listExerciseFeedByAuthors(ctx, authorIDs, date, sortBy, limit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, exerciseRows...)
	}
	if contentType == "all" || contentType == FeedTargetCirclePost {
		circleRows, err := r.listCirclePostsByAuthors(ctx, authorIDs, date, sortBy, limit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, circleRows...)
	}
	// Mix in a small number of campus highlights for the default feed
	if contentType == "all" && sortBy != "latest" {
		campusRows, err := r.listCampusFeed(ctx, 3)
		if err == nil && len(campusRows) > 0 {
			rows = append(rows, campusRows...)
		}
	}
	sortFeedRecords(rows, sortBy)
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (r *FeedRepo) listFoodFeedByAuthors(ctx context.Context, authorIDs []string, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	q := r.db.WithContext(ctx).Table("user_food_records").
		Select("'food_record' AS feed_type, id, user_id, meal_type, record_time, created_at, total_calories, total_protein, total_carbs, total_fat, image_path, image_paths, description, items, diet_goal, entry_type, recipe_id, hidden_from_feed").
		Where("user_id IN ? AND hidden_from_feed = ?", authorIDs, false)
	if mealType != "" {
		q = q.Where("meal_type = ?", mealType)
	}
	if dietGoal != "" {
		q = q.Where("diet_goal = ?", dietGoal)
	}
	if date != "" {
		start, end, err := chinaDateWindow(date)
		if err != nil {
			return nil, err
		}
		q = q.Where("record_time >= ? AND record_time < ?", start, end)
	}

	var rows []FeedRecord
	orderColumn := "record_time DESC, id DESC"
	if sortBy == "latest" {
		orderColumn = "created_at DESC, id DESC"
	}
	err := q.Order(orderColumn).Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) listExerciseFeedByAuthors(ctx context.Context, authorIDs []string, date, sortBy string, limit int) ([]FeedRecord, error) {
	q := r.db.WithContext(ctx).Table("user_exercise_logs").
		Select("'exercise_log' AS feed_type, id, user_id, '' AS meal_type, COALESCE(recorded_at, created_at, recorded_on::timestamptz) AS record_time, created_at, COALESCE(calories_burned, 0) AS total_calories, 0 AS total_protein, 0 AS total_carbs, 0 AS total_fat, image_url AS image_path, exercise_desc AS description, hidden_from_feed, exercise_type, exercise_desc, calories_burned, duration_min, ai_reasoning, "+r.exerciseItemsSelect()).
		Where("user_id IN ? AND hidden_from_feed = ?", authorIDs, false)
	if date != "" {
		start, end, err := chinaDateWindow(date)
		if err != nil {
			return nil, err
		}
		q = q.Where("recorded_on >= ? AND recorded_on < ?", start, end)
	}
	var rows []FeedRecord
	orderColumn := "record_time DESC, id DESC"
	if sortBy == "latest" {
		orderColumn = "created_at DESC, id DESC"
	}
	err := q.Order(orderColumn).Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) listCirclePostsByAuthors(ctx context.Context, authorIDs []string, date, sortBy string, limit int) ([]FeedRecord, error) {
	q := r.db.WithContext(ctx).Table("user_circle_posts").
		Select("'circle_post' AS feed_type, id, user_id, '' AS meal_type, created_at AS record_time, created_at, COALESCE(total_calories, 0) AS total_calories, COALESCE(total_protein, 0) AS total_protein, COALESCE(total_carbs, 0) AS total_carbs, COALESCE(total_fat, 0) AS total_fat, fiber, sugar, sodium_mg, total_weight_grams, NULL::text AS image_path, image_paths, NULL::text AS description, title, body, '[]'::jsonb AS items, '' AS diet_goal, hidden_from_feed, NULL::text AS exercise_type, NULL::text AS exercise_desc, NULL::numeric AS calories_burned, NULL::int AS duration_min, NULL::text AS ai_reasoning").
		Where("user_id IN ? AND hidden_from_feed = ?", authorIDs, false)
	if date != "" {
		start, end, err := chinaDateWindow(date)
		if err != nil {
			return nil, err
		}
		q = q.Where("created_at >= ? AND created_at < ?", start, end)
	}
	var rows []FeedRecord
	orderColumn := "record_time DESC, id DESC"
	if sortBy == "latest" {
		orderColumn = "created_at DESC, id DESC"
	}
	err := q.Order(orderColumn).Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) listCampusFeed(ctx context.Context, limit int) ([]FeedRecord, error) {
	var rows []FeedRecord
	if limit <= 0 || limit > 20 {
		limit = 3
	}
	err := r.db.WithContext(ctx).Table("public_food_library").
		Select("'campus_food' AS feed_type, id, user_id, '' AS meal_type, COALESCE(published_at, created_at) AS record_time, created_at, COALESCE(total_calories, 0) AS total_calories, COALESCE(total_protein, 0) AS total_protein, COALESCE(total_carbs, 0) AS total_carbs, COALESCE(total_fat, 0) AS total_fat, image_path, image_paths, food_name AS description, items, '' AS diet_goal, false AS hidden_from_feed, NULL::text AS exercise_type, NULL::text AS exercise_desc, NULL::numeric AS calories_burned, NULL::int AS duration_min, NULL::text AS ai_reasoning, COALESCE(price, 0) AS price, COALESCE(price_unit, '') AS price_unit, COALESCE(school_name, '') AS school_name, COALESCE(canteen_name, '') AS canteen_name, COALESCE(campus_location_text, '') AS campus_location_text, is_campus_food, is_campus_highlight, COALESCE(like_count, 0) AS like_count, COALESCE(comment_count, 0) AS comment_count, COALESCE(collection_count, 0) AS collection_count").
		Where("is_campus_highlight = ? AND status = ?", true, "published").
		Order("published_at DESC NULLS LAST, created_at DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) GetFeedRecordByID(ctx context.Context, recordID string) (*FeedRecord, error) {
	return r.GetFeedTargetByID(ctx, FeedTargetFoodRecord, recordID)
}

func (r *FeedRepo) GetFeedTargetByID(ctx context.Context, targetType, targetID string) (*FeedRecord, error) {
	targetType = NormalizeTargetType(targetType)
	if targetType == FeedTargetCirclePost {
		var row FeedRecord
		err := r.db.WithContext(ctx).Table("user_circle_posts").
			Select("'circle_post' AS feed_type, id, user_id, '' AS meal_type, created_at AS record_time, created_at, COALESCE(total_calories, 0) AS total_calories, COALESCE(total_protein, 0) AS total_protein, COALESCE(total_carbs, 0) AS total_carbs, COALESCE(total_fat, 0) AS total_fat, fiber, sugar, sodium_mg, total_weight_grams, NULL::text AS image_path, image_paths, NULL::text AS description, title, body, '[]'::jsonb AS items, '' AS diet_goal, hidden_from_feed, NULL::text AS exercise_type, NULL::text AS exercise_desc, NULL::numeric AS calories_burned, NULL::int AS duration_min, NULL::text AS ai_reasoning").
			Where("id = ?", targetID).
			First(&row).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &row, nil
	}
	if targetType == FeedTargetExerciseLog {
		var row FeedRecord
		err := r.db.WithContext(ctx).Table("user_exercise_logs").
			Select("'exercise_log' AS feed_type, id, user_id, '' AS meal_type, COALESCE(recorded_at, created_at, recorded_on::timestamptz) AS record_time, created_at, COALESCE(calories_burned, 0) AS total_calories, 0 AS total_protein, 0 AS total_carbs, 0 AS total_fat, image_url AS image_path, exercise_desc AS description, hidden_from_feed, exercise_type, exercise_desc, calories_burned, duration_min, ai_reasoning, "+r.exerciseItemsSelect()).
			Where("id = ?", targetID).
			First(&row).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &row, nil
	}
	if targetType == FeedTargetCampusFood {
		var row FeedRecord
		err := r.db.WithContext(ctx).Table("public_food_library").
			Select("'campus_food' AS feed_type, id, user_id, '' AS meal_type, COALESCE(published_at, created_at) AS record_time, created_at, COALESCE(total_calories, 0) AS total_calories, COALESCE(total_protein, 0) AS total_protein, COALESCE(total_carbs, 0) AS total_carbs, COALESCE(total_fat, 0) AS total_fat, image_path, image_paths, food_name AS description, items, '' AS diet_goal, false AS hidden_from_feed, NULL::text AS exercise_type, NULL::text AS exercise_desc, NULL::numeric AS calories_burned, NULL::int AS duration_min, NULL::text AS ai_reasoning, COALESCE(price, 0) AS price, COALESCE(price_unit, '') AS price_unit, COALESCE(school_name, '') AS school_name, COALESCE(canteen_name, '') AS canteen_name, COALESCE(campus_location_text, '') AS campus_location_text, is_campus_food, is_campus_highlight, COALESCE(like_count, 0) AS like_count, COALESCE(comment_count, 0) AS comment_count, COALESCE(collection_count, 0) AS collection_count").
			Where("id = ?", targetID).
			First(&row).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &row, nil
	}
	var row FeedRecord
	if err := r.db.WithContext(ctx).Table("user_food_records").
		Select("'food_record' AS feed_type, id, user_id, meal_type, record_time, created_at, total_calories, total_protein, total_carbs, total_fat, image_path, image_paths, description, items, diet_goal, entry_type, recipe_id, hidden_from_feed").
		Where("id = ?", targetID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *FeedRepo) HideFeedRecord(ctx context.Context, userID, recordID string) error {
	return r.HideFeedTarget(ctx, userID, FeedTargetFoodRecord, recordID)
}

func (r *FeedRepo) HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error {
	targetType = NormalizeTargetType(targetType)
	tableName := "user_food_records"
	if targetType == FeedTargetExerciseLog {
		tableName = "user_exercise_logs"
	}
	if targetType == FeedTargetCirclePost {
		tableName = "user_circle_posts"
	}
	return r.db.WithContext(ctx).Model(&FeedRecord{}).
		Table(tableName).
		Where("id = ? AND user_id = ?", targetID, userID).
		Update("hidden_from_feed", true).Error
}

func (r *FeedRepo) AddLike(ctx context.Context, userID, recordID string) error {
	return r.AddLikeTarget(ctx, userID, FeedTargetFoodRecord, recordID)
}

func (r *FeedRepo) AddLikeTarget(ctx context.Context, userID, targetType, targetID string) error {
	targetType = NormalizeTargetType(targetType)
	var recordID *string
	if targetType == FeedTargetFoodRecord {
		recordID = &targetID
	}
	like := domain.FeedLike{
		ID:         uuid.New().String(),
		UserID:     userID,
		RecordID:   recordID,
		TargetType: targetType,
		TargetID:   targetID,
	}
	err := r.db.WithContext(ctx).Create(&like).Error
	if err != nil && isDuplicateError(err) {
		return nil
	}
	return err
}

func (r *FeedRepo) RemoveLike(ctx context.Context, userID, recordID string) error {
	return r.RemoveLikeTarget(ctx, userID, FeedTargetFoodRecord, recordID)
}

func (r *FeedRepo) RemoveLikeTarget(ctx context.Context, userID, targetType, targetID string) error {
	targetType = NormalizeTargetType(targetType)
	q := r.db.WithContext(ctx).Where("user_id = ? AND target_type = ? AND target_id = ?", userID, targetType, targetID)
	if targetType == FeedTargetFoodRecord {
		q = q.Or("user_id = ? AND record_id = ?", userID, targetID)
	}
	return q.
		Delete(&domain.FeedLike{}).Error
}

func (r *FeedRepo) GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*LikeInfo, error) {
	targets := make([]FeedTarget, 0, len(recordIDs))
	for _, rid := range recordIDs {
		targets = append(targets, FeedTarget{TargetType: FeedTargetFoodRecord, TargetID: rid})
	}
	targetMap, err := r.GetLikesForTargets(ctx, targets, currentUserID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]*LikeInfo, len(recordIDs))
	for _, rid := range recordIDs {
		result[rid] = targetMap[FeedTargetKey(FeedTargetFoodRecord, rid)]
	}
	return result, nil
}

func (r *FeedRepo) GetLikesForTargets(ctx context.Context, targets []FeedTarget, currentUserID string) (map[string]*LikeInfo, error) {
	targets = normalizeTargets(targets)
	if len(targets) == 0 {
		return map[string]*LikeInfo{}, nil
	}
	var likes []domain.FeedLike
	q := r.db.WithContext(ctx)
	q = applyTargetFilter(q, targets, true)
	err := q.Find(&likes).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string]*LikeInfo)
	for _, target := range targets {
		result[FeedTargetKey(target.TargetType, target.TargetID)] = &LikeInfo{Count: 0, Liked: false}
	}
	for _, like := range likes {
		targetType, targetID := like.TargetType, like.TargetID
		if targetType == "" && like.RecordID != nil {
			targetType, targetID = FeedTargetFoodRecord, *like.RecordID
		}
		info := result[FeedTargetKey(targetType, targetID)]
		if info == nil {
			continue
		}
		info.Count++
		if currentUserID != "" && like.UserID == currentUserID {
			info.Liked = true
		}
	}
	return result, nil
}

func (r *FeedRepo) AddComment(ctx context.Context, comment *domain.FeedComment) error {
	if comment.ID == "" {
		comment.ID = uuid.New().String()
	}
	comment.TargetType = NormalizeTargetType(comment.TargetType)
	if comment.TargetID == "" && comment.RecordID != nil {
		comment.TargetID = *comment.RecordID
	}
	if comment.TargetType == FeedTargetFoodRecord && comment.RecordID == nil && comment.TargetID != "" {
		comment.RecordID = &comment.TargetID
	}
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *FeedRepo) ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error) {
	return r.ListCommentsForTarget(ctx, FeedTargetFoodRecord, recordID, limit)
}

func (r *FeedRepo) ListCommentsForTarget(ctx context.Context, targetType, targetID string, limit int) ([]domain.FeedComment, error) {
	var rows []domain.FeedComment
	target := FeedTarget{TargetType: NormalizeTargetType(targetType), TargetID: targetID}
	q := r.db.WithContext(ctx)
	q = applyTargetFilter(q, []FeedTarget{target}, true).Order("created_at ASC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error) {
	targets := make([]FeedTarget, 0, len(recordIDs))
	for _, rid := range recordIDs {
		targets = append(targets, FeedTarget{TargetType: FeedTargetFoodRecord, TargetID: rid})
	}
	return r.ListCommentsByTargets(ctx, targets)
}

func (r *FeedRepo) ListCommentsByTargets(ctx context.Context, targets []FeedTarget) ([]domain.FeedComment, error) {
	targets = normalizeTargets(targets)
	if len(targets) == 0 {
		return nil, nil
	}
	var rows []domain.FeedComment
	q := r.db.WithContext(ctx)
	q = applyTargetFilter(q, targets, true).Order("created_at ASC")
	err := q.Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) GetCommentByID(ctx context.Context, commentID string) (*domain.FeedComment, error) {
	var row domain.FeedComment
	if err := r.db.WithContext(ctx).Where("id = ?", commentID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *FeedRepo) FindRecentDuplicate(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error) {
	return r.FindRecentDuplicateForTarget(ctx, userID, FeedTargetFoodRecord, recordID, content, parentCommentID, replyToUserID, window)
}

func (r *FeedRepo) FindRecentDuplicateForTarget(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error) {
	var rows []domain.FeedComment
	since := time.Now().UTC().Add(-window)
	q := r.db.WithContext(ctx).Where("user_id = ? AND content = ? AND created_at >= ?", userID, content, since)
	q = applyTargetFilter(q, []FeedTarget{{TargetType: NormalizeTargetType(targetType), TargetID: targetID}}, true)
	err := q.Order("created_at DESC").Limit(5).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if ptrEqual(rows[i].ParentCommentID, parentCommentID) && ptrEqual(rows[i].ReplyToUserID, replyToUserID) {
			return &rows[i], nil
		}
	}
	return nil, nil
}

func (r *FeedRepo) DeleteCommentCascade(ctx context.Context, targetType, targetID, commentID string) (int64, error) {
	targetType = NormalizeTargetType(targetType)
	var ids []string
	ids = append(ids, commentID)
	var children []domain.FeedComment
	if err := r.db.WithContext(ctx).Where("parent_comment_id = ?", commentID).Find(&children).Error; err != nil {
		return 0, err
	}
	for _, child := range children {
		ids = append(ids, child.ID)
	}
	q := r.db.WithContext(ctx)
	q = applyTargetFilter(q, []FeedTarget{{TargetType: targetType, TargetID: targetID}}, true)
	result := q.Where("id IN ?", ids).Delete(&domain.FeedComment{})
	return result.RowsAffected, result.Error
}

func (r *FeedRepo) GetFriendIDs(ctx context.Context, userID string) ([]string, error) {
	var rows1 []UserFriend
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&rows1).Error
	if err != nil {
		return nil, err
	}
	var rows2 []UserFriend
	err = r.db.WithContext(ctx).Where("friend_id = ?", userID).Find(&rows2).Error
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var friendIDs []string
	for _, row := range rows1 {
		if row.FriendID != "" && !seen[row.FriendID] {
			seen[row.FriendID] = true
			friendIDs = append(friendIDs, row.FriendID)
		}
	}
	for _, row := range rows2 {
		if row.UserID != "" && !seen[row.UserID] {
			seen[row.UserID] = true
			friendIDs = append(friendIDs, row.UserID)
		}
	}
	return friendIDs, nil
}

func (r *FeedRepo) IsFriend(ctx context.Context, userID, friendID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&UserFriend{}).
		Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", userID, friendID, friendID, userID).
		Count(&count).Error
	return count > 0, err
}

func (r *FeedRepo) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*UserProfile, error) {
	if len(userIDs) == 0 {
		return map[string]*UserProfile{}, nil
	}
	type userProfileRow struct {
		ID            string `gorm:"column:id"`
		Nickname      string `gorm:"column:nickname"`
		Avatar        string `gorm:"column:avatar"`
		PublicRecords *bool  `gorm:"column:public_records"`
		PetLevel      *int   `gorm:"column:pet_level"`
	}
	var rows []userProfileRow
	err := r.db.WithContext(ctx).
		Table("weapp_user AS users").
		Select("users.id, users.nickname, users.avatar, users.public_records, pets.level AS pet_level").
		Joins("LEFT JOIN user_pets AS pets ON pets.user_id = users.id").
		Where("users.id IN ?", userIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]*UserProfile)
	for i := range rows {
		row := rows[i]
		result[row.ID] = &UserProfile{
			ID:            row.ID,
			Nickname:      row.Nickname,
			Avatar:        row.Avatar,
			PublicRecords: row.PublicRecords,
			PetLevel:      row.PetLevel,
		}
	}
	return result, nil
}

func (r *FeedRepo) GetCheckinCounts(ctx context.Context, userIDs []string, weekStart, weekEnd time.Time) (map[string]int, error) {
	if len(userIDs) == 0 {
		return map[string]int{}, nil
	}
	type checkinRow struct {
		UserID string `gorm:"column:user_id"`
		Count  int    `gorm:"column:count"`
	}
	var rows []checkinRow
	err := r.db.WithContext(ctx).Table("user_food_records").
		Select("user_id, COUNT(*) as count").
		Where("user_id IN ? AND record_time >= ? AND record_time < ?", userIDs, weekStart, weekEnd).
		Group("user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]int)
	for _, row := range rows {
		result[row.UserID] = row.Count
	}
	return result, nil
}

var foodNutrientColumns = map[string]string{
	"protein":     "protein_per_100g",
	"fiber":       "fiber_per_100g",
	"calcium":     "calcium_mg_per_100g",
	"iron":        "iron_mg_per_100g",
	"potassium":   "potassium_mg_per_100g",
	"magnesium":   "magnesium_mg_per_100g",
	"zinc":        "zinc_mg_per_100g",
	"vitamin_a":   "vitamin_a_rae_mcg_per_100g",
	"vitamin_c":   "vitamin_c_mg_per_100g",
	"vitamin_d":   "vitamin_d_mcg_per_100g",
	"vitamin_e":   "vitamin_e_mg_per_100g",
	"vitamin_k":   "vitamin_k_mcg_per_100g",
	"vitamin_b12": "vitamin_b12_mcg_per_100g",
	"folate":      "folate_mcg_per_100g",
}

var everydayLeaderboardFoods = []string{
	"鸡蛋", "牛奶", "酸奶", "豆腐", "豆腐干", "黄豆", "黑豆", "毛豆",
	"金枪鱼", "鸡胸肉", "牛肉", "猪里脊", "猪里脊肉", "虾", "虾仁", "三文鱼",
	"燕麦", "糙米", "玉米", "土豆", "红薯", "全麦面包",
	"西兰花", "菠菜", "胡萝卜", "番茄", "黄瓜", "南瓜", "香菇", "海带", "紫菜",
	"苹果", "香蕉", "橙子", "蓝莓", "草莓", "梨", "猕猴桃", "牛油果",
	"花生", "核桃", "杏仁", "白芝麻", "黑芝麻", "奇亚籽", "虾皮", "猪肝", "鸭血",
}

func (r *FeedRepo) GetFoodNutrientRanking(ctx context.Context, nutrient string, limit int) ([]NutrientFoodRow, error) {
	nutrient = strings.TrimSpace(nutrient)
	column, ok := foodNutrientColumns[nutrient]
	if !ok {
		return nil, fmt.Errorf("不支持的营养素: %s", nutrient)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if nutrient == "protein" {
		return r.getProteinFoodRanking(ctx, column, limit)
	}
	var rows []NutrientFoodRow
	err := r.db.WithContext(ctx).Table("food_nutrition_library").
		Select(fmt.Sprintf("id, canonical_name AS name, image_path, %s AS value", column)).
		Where("is_active = ?", true).
		Where("kcal_per_100g > 0 AND canonical_name ~ ?", "[一-龥]").
		Where("canonical_name IN ?", everydayLeaderboardFoods).
		Where(column + " > 0").
		Order(column + " DESC, canonical_name ASC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *FeedRepo) getProteinFoodRanking(ctx context.Context, column string, limit int) ([]NutrientFoodRow, error) {
	const displayNameCase = `CASE
		WHEN canonical_name ~ '金枪鱼' THEN '金枪鱼'
		WHEN canonical_name ~ '鸡胸' THEN '鸡胸肉'
		WHEN canonical_name ~ '^牛肉' THEN '牛肉'
		WHEN canonical_name ~ '猪里脊' THEN '猪里脊肉'
		WHEN canonical_name ~ '虾仁' THEN '虾仁'
		WHEN canonical_name ~ '^虾($|[（(，,])' THEN '虾'
		WHEN canonical_name ~ '三文鱼' THEN '三文鱼'
		WHEN canonical_name ~ '^鸡肉' THEN '鸡肉'
		WHEN canonical_name ~ '^鸡蛋($|[（(，,])' THEN '鸡蛋'
		WHEN canonical_name ~ '^豆腐($|[（(，,])' THEN '豆腐'
		WHEN canonical_name ~ '^牛奶($|[（(，,])' THEN '牛奶'
	END`
	query := fmt.Sprintf(`
		WITH candidates AS (
			SELECT id, %s AS name, image_path, %s AS value
			FROM food_nutrition_library
			WHERE is_active = TRUE
				AND kcal_per_100g > 0
				AND %s > 0
		), ranked AS (
			SELECT id, name, image_path, value,
				ROW_NUMBER() OVER (PARTITION BY name ORDER BY value DESC, id ASC) AS family_rank
			FROM candidates
			WHERE name IS NOT NULL
		)
		SELECT id, name, image_path, value
		FROM ranked
		WHERE family_rank = 1
		ORDER BY value DESC, name ASC
		LIMIT ?`, displayNameCase, column, column)

	var rows []NutrientFoodRow
	err := r.db.WithContext(ctx).Raw(query, limit).Scan(&rows).Error
	return rows, err
}

func isDuplicateError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique") || strings.Contains(msg, "23505")
}

func ptrEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func NormalizeTargetType(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case "", "all":
		return value
	case FeedTargetExerciseLog:
		return FeedTargetExerciseLog
	case FeedTargetCirclePost:
		return FeedTargetCirclePost
	case FeedTargetCampusFood:
		return FeedTargetCampusFood
	default:
		return FeedTargetFoodRecord
	}
}

func FeedTargetKey(targetType, targetID string) string {
	return NormalizeTargetType(targetType) + ":" + targetID
}

func normalizeTargets(targets []FeedTarget) []FeedTarget {
	out := make([]FeedTarget, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target.TargetType = NormalizeTargetType(target.TargetType)
		target.TargetID = strings.TrimSpace(target.TargetID)
		if target.TargetType == "" || target.TargetID == "" {
			continue
		}
		key := FeedTargetKey(target.TargetType, target.TargetID)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, target)
	}
	return out
}

func applyTargetFilter(q *gorm.DB, targets []FeedTarget, includeLegacyRecordID bool) *gorm.DB {
	targets = normalizeTargets(targets)
	if len(targets) == 0 {
		return q.Where("1 = 0")
	}
	var foodIDs []string
	var exerciseIDs []string
	var circleIDs []string
	for _, target := range targets {
		switch target.TargetType {
		case FeedTargetExerciseLog:
			exerciseIDs = append(exerciseIDs, target.TargetID)
		case FeedTargetCirclePost:
			circleIDs = append(circleIDs, target.TargetID)
		default:
			foodIDs = append(foodIDs, target.TargetID)
		}
	}
	clauses := []string{}
	args := []any{}
	if len(foodIDs) > 0 {
		clauses = append(clauses, "(target_type = ? AND target_id IN ?)")
		args = append(args, FeedTargetFoodRecord, foodIDs)
		if includeLegacyRecordID {
			clauses = append(clauses, "record_id IN ?")
			args = append(args, foodIDs)
		}
	}
	if len(exerciseIDs) > 0 {
		clauses = append(clauses, "(target_type = ? AND target_id IN ?)")
		args = append(args, FeedTargetExerciseLog, exerciseIDs)
	}
	if len(circleIDs) > 0 {
		clauses = append(clauses, "(target_type = ? AND target_id IN ?)")
		args = append(args, FeedTargetCirclePost, circleIDs)
	}
	return q.Where(strings.Join(clauses, " OR "), args...)
}

func (r *FeedRepo) CreateCirclePost(ctx context.Context, post *domain.UserCirclePost) error {
	return r.db.WithContext(ctx).Create(post).Error
}

func (r *FeedRepo) GetCirclePostByID(ctx context.Context, postID string) (*domain.UserCirclePost, error) {
	var post domain.UserCirclePost
	if err := r.db.WithContext(ctx).Where("id = ?", postID).First(&post).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &post, nil
}

func (r *FeedRepo) UpdateCirclePost(ctx context.Context, userID, postID, title, body string, imagePaths []string, nutrition *domain.CirclePostNutrition) error {
	post := domain.UserCirclePost{
		Title:      nullIfEmpty(title),
		Body:       nullIfEmpty(body),
		ImagePaths: imagePaths,
	}
	selectCols := []string{"title", "body", "image_paths"}
	if nutrition != nil {
		post.TotalCalories = nutrition.TotalCalories
		post.TotalProtein = nutrition.TotalProtein
		post.TotalCarbs = nutrition.TotalCarbs
		post.TotalFat = nutrition.TotalFat
		post.Fiber = nutrition.Fiber
		post.Sugar = nutrition.Sugar
		post.SodiumMg = nutrition.SodiumMg
		post.TotalWeightGrams = nutrition.TotalWeightGrams
	}
	selectCols = append(selectCols,
		"total_calories", "total_protein", "total_carbs", "total_fat",
		"fiber", "sugar", "sodium_mg", "total_weight_grams",
	)
	return r.db.WithContext(ctx).Model(&domain.UserCirclePost{}).
		Select(selectCols).
		Where("id = ? AND user_id = ?", postID, userID).
		Updates(&post).Error
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (r *FeedRepo) DeleteCirclePost(ctx context.Context, userID, postID string) error {
	return r.db.WithContext(ctx).Where("id = ? AND user_id = ?", postID, userID).Delete(&domain.UserCirclePost{}).Error
}

func (r *FeedRepo) CreateFeedReport(ctx context.Context, report *domain.FeedReport) error {
	if report.ID == "" {
		report.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(report).Error
}

func (r *FeedRepo) FindFeedReport(ctx context.Context, reporterUserID, targetType, targetID string) (*domain.FeedReport, error) {
	var report domain.FeedReport
	if err := r.db.WithContext(ctx).Where("reporter_user_id = ? AND target_type = ? AND target_id = ?", reporterUserID, targetType, targetID).First(&report).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &report, nil
}

func (r *FeedRepo) DeleteCirclePostInteractions(ctx context.Context, postID string) error {
	return r.DeleteTargetInteractions(ctx, FeedTargetCirclePost, postID)
}

func (r *FeedRepo) DeleteTargetInteractions(ctx context.Context, targetType, targetID string) error {
	targetType = NormalizeTargetType(targetType)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		likeQ := tx.Where("target_type = ? AND target_id = ?", targetType, targetID)
		commentQ := tx.Where("target_type = ? AND target_id = ?", targetType, targetID)
		notificationQ := tx.Where("target_type = ? AND target_id = ?", targetType, targetID)
		if targetType == FeedTargetFoodRecord {
			likeQ = likeQ.Or("record_id = ?", targetID)
			commentQ = commentQ.Or("record_id = ?", targetID)
			notificationQ = notificationQ.Or("record_id = ?", targetID)
		}
		if err := likeQ.Delete(&domain.FeedLike{}).Error; err != nil {
			return err
		}
		if err := commentQ.Delete(&domain.FeedComment{}).Error; err != nil {
			return err
		}
		if err := notificationQ.Delete(&domain.FeedInteractionNotification{}).Error; err != nil {
			return err
		}
		return nil
	})
}

func sortFeedRecords(rows []FeedRecord, sortBy string) {
	sort.SliceStable(rows, func(i, j int) bool {
		ti := feedSortTime(rows[i], sortBy)
		tj := feedSortTime(rows[j], sortBy)
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return fmt.Sprintf("%s:%s", rows[i].FeedType, rows[i].ID) > fmt.Sprintf("%s:%s", rows[j].FeedType, rows[j].ID)
	})
}

func feedSortTime(row FeedRecord, sortBy string) time.Time {
	if sortBy == "latest" && row.CreatedAt != nil {
		return *row.CreatedAt
	}
	if row.RecordTime != nil {
		return *row.RecordTime
	}
	if row.CreatedAt != nil {
		return *row.CreatedAt
	}
	return time.Time{}
}

func chinaDateWindow(date string) (time.Time, time.Time, error) {
	loc := time.FixedZone("Asia/Shanghai", 8*60*60)
	parsed, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	start := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, loc)
	return start.UTC(), start.AddDate(0, 0, 1).UTC(), nil
}
