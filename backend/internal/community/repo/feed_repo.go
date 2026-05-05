package repo

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/community/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type FeedRecord struct {
	ID             string           `gorm:"column:id" json:"id"`
	UserID         string           `gorm:"column:user_id" json:"user_id"`
	MealType       string           `gorm:"column:meal_type" json:"meal_type"`
	RecordTime     *time.Time       `gorm:"column:record_time" json:"record_time"`
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

type FeedRepo struct {
	db *gorm.DB
}

func NewFeedRepo(db *gorm.DB) *FeedRepo {
	return &FeedRepo{db: db}
}

func (r *FeedRepo) ListPublicFeed(ctx context.Context, mealType, dietGoal string, limit int) ([]FeedRecord, error) {
	var publicUserIDs []string
	err := r.db.WithContext(ctx).Table("weapp_user").
		Select("id").Where("public_records = ?", true).Pluck("id", &publicUserIDs).Error
	if err != nil {
		return nil, err
	}
	if len(publicUserIDs) == 0 {
		return nil, nil
	}

	q := r.db.WithContext(ctx).Where("user_id IN ? AND hidden_from_feed = ?", publicUserIDs, false)
	if mealType != "" {
		q = q.Where("meal_type = ?", mealType)
	}
	if dietGoal != "" {
		q = q.Where("diet_goal = ?", dietGoal)
	}

	var rows []FeedRecord
	err = q.Order("record_time DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) ListFriendFeed(ctx context.Context, authorIDs []string, mealType, dietGoal string, limit int) ([]FeedRecord, error) {
	if len(authorIDs) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).Where("user_id IN ? AND hidden_from_feed = ?", authorIDs, false)
	if mealType != "" {
		q = q.Where("meal_type = ?", mealType)
	}
	if dietGoal != "" {
		q = q.Where("diet_goal = ?", dietGoal)
	}
	var rows []FeedRecord
	err := q.Order("record_time DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) GetFeedRecordByID(ctx context.Context, recordID string) (*FeedRecord, error) {
	var row FeedRecord
	if err := r.db.WithContext(ctx).Where("id = ?", recordID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *FeedRepo) HideFeedRecord(ctx context.Context, userID, recordID string) error {
	return r.db.WithContext(ctx).Model(&FeedRecord{}).
		Where("id = ? AND user_id = ?", recordID, userID).
		Update("hidden_from_feed", true).Error
}

func (r *FeedRepo) AddLike(ctx context.Context, userID, recordID string) error {
	like := domain.FeedLike{
		ID:       uuid.New().String(),
		UserID:   userID,
		RecordID: recordID,
	}
	err := r.db.WithContext(ctx).Create(&like).Error
	if err != nil && isDuplicateError(err) {
		return nil
	}
	return err
}

func (r *FeedRepo) RemoveLike(ctx context.Context, userID, recordID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND record_id = ?", userID, recordID).
		Delete(&domain.FeedLike{}).Error
}

func (r *FeedRepo) GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*LikeInfo, error) {
	if len(recordIDs) == 0 {
		return map[string]*LikeInfo{}, nil
	}
	var likes []domain.FeedLike
	err := r.db.WithContext(ctx).Where("record_id IN ?", recordIDs).Find(&likes).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string]*LikeInfo)
	for _, rid := range recordIDs {
		result[rid] = &LikeInfo{Count: 0, Liked: false}
	}
	for _, like := range likes {
		info := result[like.RecordID]
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
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *FeedRepo) ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error) {
	var rows []domain.FeedComment
	q := r.db.WithContext(ctx).Where("record_id = ?", recordID).Order("created_at ASC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Find(&rows).Error
	return rows, err
}

func (r *FeedRepo) ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error) {
	if len(recordIDs) == 0 {
		return nil, nil
	}
	var rows []domain.FeedComment
	err := r.db.WithContext(ctx).Where("record_id IN ?", recordIDs).Order("created_at ASC").Find(&rows).Error
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
	var rows []domain.FeedComment
	since := time.Now().UTC().Add(-window)
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND record_id = ? AND content = ? AND created_at >= ?", userID, recordID, content, since).
		Order("created_at DESC").
		Limit(5).
		Find(&rows).Error
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
