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
)

type FeedRecord struct {
	FeedType       string           `gorm:"column:feed_type" json:"feed_type"`
	ID             string           `gorm:"column:id" json:"id"`
	UserID         string           `gorm:"column:user_id" json:"user_id"`
	MealType       string           `gorm:"column:meal_type" json:"meal_type"`
	RecordTime     *time.Time       `gorm:"column:record_time" json:"record_time"`
	CreatedAt      *time.Time       `gorm:"column:created_at" json:"created_at"`
	TotalCalories  float64          `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein   float64          `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs     float64          `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat       float64          `gorm:"column:total_fat" json:"total_fat"`
	ImagePath      *string          `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths     []string         `gorm:"column:image_paths;serializer:json" json:"image_paths,omitempty"`
	Description    *string          `gorm:"column:description" json:"description,omitempty"`
	Items          []map[string]any `gorm:"column:items;serializer:json" json:"items"`
	DietGoal       *string          `gorm:"column:diet_goal" json:"diet_goal,omitempty"`
	HiddenFromFeed bool             `gorm:"column:hidden_from_feed" json:"hidden_from_feed"`
	ExerciseType   *string          `gorm:"column:exercise_type" json:"exercise_type,omitempty"`
	ExerciseDesc   *string          `gorm:"column:exercise_desc" json:"exercise_desc,omitempty"`
	CaloriesBurned *float64         `gorm:"column:calories_burned" json:"calories_burned,omitempty"`
	DurationMin    *int             `gorm:"column:duration_min" json:"duration_min,omitempty"`
	AIReasoning    *string          `gorm:"column:ai_reasoning" json:"ai_reasoning,omitempty"`
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

func (r *FeedRepo) ListPublicFeed(ctx context.Context, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	var publicUserIDs []string
	err := r.db.WithContext(ctx).Table("weapp_user").
		Select("id").Where("public_records = ?", true).Pluck("id", &publicUserIDs).Error
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
	contentType = normalizeTargetType(contentType)
	if contentType == "" {
		contentType = "all"
	}
	var rows []FeedRecord
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
	sortFeedRecords(rows, sortBy)
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (r *FeedRepo) listFoodFeedByAuthors(ctx context.Context, authorIDs []string, mealType, dietGoal, date, sortBy string, limit int) ([]FeedRecord, error) {
	q := r.db.WithContext(ctx).Table("user_food_records").
		Select("'food_record' AS feed_type, id, user_id, meal_type, record_time, created_at, total_calories, total_protein, total_carbs, total_fat, image_path, image_paths, description, items, diet_goal, hidden_from_feed").
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
		Select("'exercise_log' AS feed_type, id, user_id, '' AS meal_type, COALESCE(recorded_at, created_at, recorded_on::timestamptz) AS record_time, created_at, COALESCE(calories_burned, 0) AS total_calories, 0 AS total_protein, 0 AS total_carbs, 0 AS total_fat, image_url AS image_path, exercise_desc AS description, hidden_from_feed, exercise_type, exercise_desc, calories_burned, duration_min, ai_reasoning").
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

func (r *FeedRepo) GetFeedRecordByID(ctx context.Context, recordID string) (*FeedRecord, error) {
	return r.GetFeedTargetByID(ctx, FeedTargetFoodRecord, recordID)
}

func (r *FeedRepo) GetFeedTargetByID(ctx context.Context, targetType, targetID string) (*FeedRecord, error) {
	targetType = normalizeTargetType(targetType)
	if targetType == FeedTargetExerciseLog {
		var row FeedRecord
		err := r.db.WithContext(ctx).Table("user_exercise_logs").
			Select("'exercise_log' AS feed_type, id, user_id, '' AS meal_type, COALESCE(recorded_at, created_at, recorded_on::timestamptz) AS record_time, created_at, COALESCE(calories_burned, 0) AS total_calories, 0 AS total_protein, 0 AS total_carbs, 0 AS total_fat, image_url AS image_path, exercise_desc AS description, hidden_from_feed, exercise_type, exercise_desc, calories_burned, duration_min, ai_reasoning").
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
		Select("'food_record' AS feed_type, id, user_id, meal_type, record_time, created_at, total_calories, total_protein, total_carbs, total_fat, image_path, image_paths, description, items, diet_goal, hidden_from_feed").
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
	targetType = normalizeTargetType(targetType)
	tableName := "user_food_records"
	if targetType == FeedTargetExerciseLog {
		tableName = "user_exercise_logs"
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
	targetType = normalizeTargetType(targetType)
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
	targetType = normalizeTargetType(targetType)
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
	comment.TargetType = normalizeTargetType(comment.TargetType)
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
	target := FeedTarget{TargetType: normalizeTargetType(targetType), TargetID: targetID}
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
	q = applyTargetFilter(q, []FeedTarget{{TargetType: normalizeTargetType(targetType), TargetID: targetID}}, true)
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
	targetType = normalizeTargetType(targetType)
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
	var rows []UserProfile
	err := r.db.WithContext(ctx).Where("id IN ?", userIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]*UserProfile)
	for i := range rows {
		result[rows[i].ID] = &rows[i]
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

func normalizeTargetType(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case "", "all":
		return value
	case FeedTargetExerciseLog:
		return FeedTargetExerciseLog
	default:
		return FeedTargetFoodRecord
	}
}

func FeedTargetKey(targetType, targetID string) string {
	return normalizeTargetType(targetType) + ":" + targetID
}

func normalizeTargets(targets []FeedTarget) []FeedTarget {
	out := make([]FeedTarget, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target.TargetType = normalizeTargetType(target.TargetType)
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
	for _, target := range targets {
		if target.TargetType == FeedTargetExerciseLog {
			exerciseIDs = append(exerciseIDs, target.TargetID)
		} else {
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
	return q.Where(strings.Join(clauses, " OR "), args...)
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
