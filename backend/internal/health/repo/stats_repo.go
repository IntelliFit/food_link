package repo

import (
	"context"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

func (r *StatsRepo) GetUserProfile(ctx context.Context, userID string) (*domain.StatsUserProfile, error) {
	var row domain.StatsUserProfile
	if err := r.db.WithContext(ctx).Where("id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) GetRecentFoodRecordDates(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]string, error) {
	var rows []struct {
		Date string `gorm:"column:date"`
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT TO_CHAR(DATE(record_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD') AS date
		FROM user_food_records
		WHERE user_id = ? AND record_time >= ? AND record_time < ?
		ORDER BY date DESC
	`, userID, startUTC, endUTC).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	dates := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Date != "" {
			dates = append(dates, row.Date)
		}
	}
	return dates, nil
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

func (r *StatsRepo) UpsertInsightCache(ctx context.Context, userID, rangeType, generatedDate, dataFingerprint, insightText string) error {
	row := map[string]any{
		"id":               uuid.New().String(),
		"user_id":          userID,
		"range_type":       rangeType,
		"generated_date":   generatedDate,
		"data_fingerprint": dataFingerprint,
		"insight_text":     insightText,
		"created_at":       time.Now().UTC(),
	}
	return r.db.WithContext(ctx).
		Table((&domain.StatsInsight{}).TableName()).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "user_id"},
				{Name: "range_type"},
				{Name: "generated_date"},
			},
			DoUpdates: clause.AssignmentColumns([]string{"data_fingerprint", "insight_text", "created_at"}),
		}).
		Create(row).Error
}

func (r *StatsRepo) GetCachedInsight(ctx context.Context, userID string, rangeType string, generatedDate string) (*domain.StatsInsight, error) {
	var row domain.StatsInsight
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ? AND generated_date = ?", userID, rangeType, generatedDate).
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) GetLatestCachedInsight(ctx context.Context, userID string, rangeType string) (*domain.StatsInsight, error) {
	var row domain.StatsInsight
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ?", userID, rangeType).
		Order("generated_date desc").
		Order("created_at desc").
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}
