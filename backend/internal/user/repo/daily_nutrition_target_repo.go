package repo

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"food_link/backend/internal/user/domain"
)

type DailyNutritionTargetRepo struct {
	db *gorm.DB
}

func NewDailyNutritionTargetRepo(db *gorm.DB) *DailyNutritionTargetRepo {
	return &DailyNutritionTargetRepo{db: db}
}

func (r *DailyNutritionTargetRepo) FindByDate(ctx context.Context, userID, date string) (*domain.DailyNutritionTarget, error) {
	targetDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, err
	}
	var row domain.DailyNutritionTarget
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND target_date = ?", userID, targetDate).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *DailyNutritionTargetRepo) Upsert(ctx context.Context, target *domain.DailyNutritionTarget) (*domain.DailyNutritionTarget, error) {
	if target.ID == "" {
		target.ID = uuid.New().String()
	}
	now := time.Now()
	if target.CreatedAt == nil {
		target.CreatedAt = &now
	}
	target.UpdatedAt = &now
	if target.Source == "" {
		target.Source = "user_manual"
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "target_date"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"calorie_target",
			"protein_target",
			"carbs_target",
			"fat_target",
			"source",
			"updated_at",
		}),
	}).Create(target).Error
	if err != nil {
		return nil, err
	}
	return r.FindByDate(ctx, target.UserID, target.TargetDate.Format("2006-01-02"))
}
