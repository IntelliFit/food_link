package repo

import (
	"context"
	"food_link/backend/internal/health/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

const mealMemoryTable = "meal_recommendation_memory"

func (r *StatsRepo) ListMealRecommendationMemory(ctx context.Context, userID string, since time.Time) ([]domain.MealRecommendationMemory, error) {
	var rows []domain.MealRecommendationMemory
	err := r.db.WithContext(ctx).Table(mealMemoryTable).Where("user_id = ? AND created_at >= ? AND (shown_at IS NOT NULL OR skipped_at IS NOT NULL OR selected_at IS NOT NULL)", userID, since).Order("created_at DESC").Limit(600).Find(&rows).Error
	return rows, err
}

func (r *StatsRepo) SaveMealRecommendationOptions(ctx context.Context, rows []domain.MealRecommendationMemory) error {
	if len(rows) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Keep a bounded, per-user feedback window; no coordinates or raw profile.
		if err := tx.Table(mealMemoryTable).Where("user_id = ? AND created_at < ?", rows[0].UserID, time.Now().UTC().AddDate(0, 0, -14)).Delete(&domain.MealRecommendationMemory{}).Error; err != nil {
			return err
		}
		return tx.Table(mealMemoryTable).Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
	})
}

func (r *StatsRepo) RecordMealRecommendationFeedback(ctx context.Context, userID, runID string, keys []string, action string, now time.Time) error {
	column := map[string]string{"shown": "shown_at", "skip": "skipped_at", "selected": "selected_at"}[action]
	if column == "" || len(keys) == 0 || len(keys) > 3 {
		return gorm.ErrRecordNotFound
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := func() *gorm.DB {
			return tx.Table(mealMemoryTable).Where("user_id = ? AND run_id = ? AND option_key IN ? AND created_at >= ?", userID, runID, keys, now.Add(-48*time.Hour))
		}
		var count int64
		if err := query().Count(&count).Error; err != nil {
			return err
		}
		if count != int64(len(keys)) {
			return gorm.ErrRecordNotFound
		}
		// Idempotent even when two devices report the same impression concurrently.
		return query().Where(column+" IS NULL").Update(column, now).Error
	})
}
