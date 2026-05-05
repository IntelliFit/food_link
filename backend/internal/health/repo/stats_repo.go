package repo

import (
	"context"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type StatsRepo struct {
	db *gorm.DB
}

func NewStatsRepo(db *gorm.DB) *StatsRepo {
	return &StatsRepo{db: db}
}

func (r *StatsRepo) GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error) {
	var rows []domain.FoodRecord
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, startUTC, endUTC).
		Order("record_time asc").
		Find(&rows).Error
	return rows, err
}

func (r *StatsRepo) GetDistinctRecordDays(ctx context.Context, userID string, startUTC, endUTC time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT DATE(record_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'))
		FROM user_food_records
		WHERE user_id = ? AND record_time >= ? AND record_time < ?
	`, userID, startUTC, endUTC).Scan(&count).Error
	return count, err
}

func (r *StatsRepo) SaveInsight(ctx context.Context, insight *domain.StatsInsight) error {
	if insight.ID == "" {
		insight.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(insight).Error
}

func (r *StatsRepo) GetLatestInsight(ctx context.Context, userID string, dateRange string) (*domain.StatsInsight, error) {
	var row domain.StatsInsight
	if err := r.db.WithContext(ctx).Where("user_id = ? AND date_range = ?", userID, dateRange).Order("created_at desc").First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}
