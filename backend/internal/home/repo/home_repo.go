package repo

import (
	"context"
	"time"

	"gorm.io/gorm"
)

type FoodRecord struct {
	ID            string           `gorm:"column:id"`
	UserID        string           `gorm:"column:user_id"`
	MealType      string           `gorm:"column:meal_type"`
	RecordTime    *time.Time       `gorm:"column:record_time"`
	TotalCalories float64          `gorm:"column:total_calories"`
	TotalProtein  float64          `gorm:"column:total_protein"`
	TotalCarbs    float64          `gorm:"column:total_carbs"`
	TotalFat      float64          `gorm:"column:total_fat"`
	ImagePath     *string          `gorm:"column:image_path"`
	ImagePaths    []string         `gorm:"column:image_paths;serializer:json"`
	Description   *string          `gorm:"column:description"`
	Items         []map[string]any `gorm:"column:items;serializer:json"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type FeedComment struct {
	ID              string     `gorm:"column:id"`
	UserID          string     `gorm:"column:user_id"`
	RecordID        string     `gorm:"column:record_id"`
	ParentCommentID *string    `gorm:"column:parent_comment_id"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
}

func (FeedComment) TableName() string { return "feed_comments" }

type ExpiryItem struct {
	ID          string     `gorm:"column:id"`
	UserID      string     `gorm:"column:user_id"`
	Status      string     `gorm:"column:status"`
	Name        *string    `gorm:"column:name"`
	ExpireDate  *time.Time `gorm:"column:expire_date"`
	StorageType *string    `gorm:"column:storage_type"`
}

func (ExpiryItem) TableName() string { return "food_expiry_items" }

type ExerciseLog struct {
	CaloriesBurned int `gorm:"column:calories_burned"`
}

func (ExerciseLog) TableName() string { return "user_exercise_logs" }

type HomeRepo struct {
	db *gorm.DB
}

func NewHomeRepo(db *gorm.DB) *HomeRepo {
	return &HomeRepo{db: db}
}

func (r *HomeRepo) ListFoodRecordsByDate(ctx context.Context, userID, date string) ([]FoodRecord, error) {
	start, end, err := chinaDateWindow(date)
	if err != nil {
		return nil, err
	}
	var rows []FoodRecord
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, start, end).
		Order("record_time desc").
		Find(&rows).Error
	return rows, err
}

func (r *HomeRepo) GetFoodRecordByID(ctx context.Context, recordID string) (*FoodRecord, error) {
	var row FoodRecord
	if err := r.db.WithContext(ctx).Where("id = ?", recordID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *HomeRepo) ListExpiryItems(ctx context.Context, userID string) ([]ExpiryItem, error) {
	var rows []ExpiryItem
	err := r.db.WithContext(ctx).Where("user_id = ? AND status = ?", userID, "active").Find(&rows).Error
	return rows, err
}

func (r *HomeRepo) GetExerciseBurned(ctx context.Context, userID, date string) (int, error) {
	var rows []ExerciseLog
	if err := r.db.WithContext(ctx).Table("user_exercise_logs").Select("calories_burned").Where("user_id = ? AND recorded_on = ?", userID, date).Find(&rows).Error; err != nil {
		return 0, err
	}
	total := 0
	for _, row := range rows {
		total += row.CaloriesBurned
	}
	return total, nil
}

func (r *HomeRepo) ListRecordComments(ctx context.Context, recordID string) ([]FeedComment, error) {
	var rows []FeedComment
	err := r.db.WithContext(ctx).Where("record_id = ?", recordID).Order("created_at asc").Find(&rows).Error
	return rows, err
}

func (r *HomeRepo) DeleteCommentCascade(ctx context.Context, recordID, commentID string) (int64, error) {
	result := r.db.WithContext(ctx).Where("record_id = ? AND (id = ? OR parent_comment_id = ?)", recordID, commentID, commentID).Delete(&FeedComment{})
	return result.RowsAffected, result.Error
}
