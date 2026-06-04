package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/foodmedia"

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
	ID           string     `gorm:"column:id"`
	UserID       string     `gorm:"column:user_id"`
	Status       string     `gorm:"column:status"`
	FoodName     *string    `gorm:"column:food_name"`
	ExpireDate   *time.Time `gorm:"column:expire_date"`
	StorageType  *string    `gorm:"column:storage_type"`
	QuantityNote *string    `gorm:"column:quantity_note"`
	Note         *string    `gorm:"column:note"`
}

func (ExpiryItem) TableName() string { return "food_expiry_items" }

type ExerciseLog struct {
	CaloriesBurned int        `gorm:"column:calories_burned"`
	RecordedOn     *time.Time `gorm:"column:recorded_on"`
}

func (ExerciseLog) TableName() string { return "user_exercise_logs" }

type WeightRecord struct {
	WeightKg   float64    `gorm:"column:weight_kg"`
	RecordedOn *time.Time `gorm:"column:recorded_on"`
}

func (WeightRecord) TableName() string { return "user_weight_records" }

type DailyNutritionTarget struct {
	UserID        string     `gorm:"column:user_id"`
	TargetDate    *time.Time `gorm:"column:target_date"`
	CalorieTarget float64    `gorm:"column:calorie_target"`
	ProteinTarget float64    `gorm:"column:protein_target"`
	CarbsTarget   float64    `gorm:"column:carbs_target"`
	FatTarget     float64    `gorm:"column:fat_target"`
}

func (DailyNutritionTarget) TableName() string { return "user_daily_nutrition_targets" }

type HomeRepo struct {
	db *gorm.DB
}

func NewHomeRepo(db *gorm.DB) *HomeRepo {
	return &HomeRepo{db: db}
}

func (r *HomeRepo) GetDailyNutritionTarget(ctx context.Context, userID, date string) (*DailyNutritionTarget, error) {
	targetDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, err
	}
	var row DailyNutritionTarget
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND target_date = ?", userID, targetDate).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if isUndefinedTableError(err) {
		return nil, nil
	}
	return &row, err
}

func isUndefinedTableError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "SQLSTATE 42P01") ||
		strings.Contains(message, `relation "user_daily_nutrition_targets" does not exist`) ||
		strings.Contains(message, "no such table: user_daily_nutrition_targets")
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

func (r *HomeRepo) CountFoodRecordDaysByDateRange(ctx context.Context, userID, startDate, endDate string) (int64, error) {
	start, _, err := chinaDateWindow(startDate)
	if err != nil {
		return 0, err
	}
	_, end, err := chinaDateWindow(endDate)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Table("user_food_records").
		Select("COUNT(DISTINCT DATE(record_time))").
		Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, start, end).
		Scan(&count).Error
	return count, err
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

func (r *HomeRepo) ListExerciseBurnedByDateRange(ctx context.Context, userID, startDate, endDate string) (map[string]int, error) {
	var rows []ExerciseLog
	if err := r.db.WithContext(ctx).
		Table("user_exercise_logs").
		Select("calories_burned, recorded_on").
		Where("user_id = ? AND recorded_on >= ? AND recorded_on <= ?", userID, startDate, endDate).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := map[string]int{}
	for _, row := range rows {
		if row.RecordedOn == nil {
			continue
		}
		date := row.RecordedOn.In(ChinaTZ()).Format("2006-01-02")
		out[date] += row.CaloriesBurned
	}
	return out, nil
}

func (r *HomeRepo) ListWeightRecordsByDateRange(ctx context.Context, userID, startDate, endDate string) ([]WeightRecord, error) {
	start, _, err := chinaDateWindow(startDate)
	if err != nil {
		return nil, err
	}
	_, end, err := chinaDateWindow(endDate)
	if err != nil {
		return nil, err
	}
	var rows []WeightRecord
	err = r.db.WithContext(ctx).Table("user_weight_records").
		Select("weight_kg, recorded_on").
		Where("user_id = ? AND recorded_on >= ? AND recorded_on < ?", userID, start, end).
		Order("recorded_on asc, created_at asc").
		Find(&rows).Error
	return rows, err
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

// LookupManualSourceImagePaths 从饮食记录 items 中的 manual_source 回查食物库图片（记录级 image_path 为空时使用）。
func (r *HomeRepo) LookupManualSourceImagePaths(ctx context.Context, items []map[string]any) []string {
	if r == nil || r.db == nil {
		return nil
	}
	return foodmedia.LookupManualSourceImagePaths(ctx, r.db, items)
}
