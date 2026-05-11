package repo

import (
	"context"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type BodyMetricsRepo struct {
	db *gorm.DB
}

func NewBodyMetricsRepo(db *gorm.DB) *BodyMetricsRepo {
	return &BodyMetricsRepo{db: db}
}

// Weight records

func (r *BodyMetricsRepo) CreateWeightRecord(ctx context.Context, record *domain.BodyWeightRecord) error {
	if record.ID == "" {
		record.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *BodyMetricsRepo) ListWeightRecords(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWeightRecord, error) {
	var rows []domain.BodyWeightRecord
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if startDate != "" {
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Order("recorded_on asc, created_at asc").Find(&rows).Error
	return rows, err
}

func (r *BodyMetricsRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	var row domain.BodyWeightRecord
	if err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("recorded_on desc, created_at desc").First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *BodyMetricsRepo) CountWeightRecordsByClientID(ctx context.Context, userID, clientID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.BodyWeightRecord{}).Where("user_id = ? AND client_record_id = ?", userID, clientID).Count(&count).Error
	return count, err
}

func (r *BodyMetricsRepo) CountWeightRecordsByDateValue(ctx context.Context, userID string, recordedOn string, weightKg float64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.BodyWeightRecord{}).Where("user_id = ? AND recorded_on = ? AND weight_kg = ?", userID, recordedOn, weightKg).Count(&count).Error
	return count, err
}

// Water logs

func (r *BodyMetricsRepo) CreateWaterLog(ctx context.Context, log *domain.BodyWaterLog) error {
	if log.ID == "" {
		log.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *BodyMetricsRepo) ReduceWaterLogsByDateSource(ctx context.Context, userID string, recordedOn string, sourceType string, amountMl int) (int, error) {
	if amountMl <= 0 {
		return 0, nil
	}
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return 0, err
	}
	reduced := 0
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []domain.BodyWaterLog
		if err := tx.
			Where("user_id = ? AND DATE(recorded_on) = ? AND source_type = ?", userID, recordedOn, sourceType).
			Order("created_at desc, id desc").
			Find(&rows).Error; err != nil {
			return err
		}
		remaining := amountMl
		for _, row := range rows {
			if remaining <= 0 {
				break
			}
			if row.AmountMl <= 0 {
				continue
			}
			if row.AmountMl <= remaining {
				if err := tx.Where("id = ? AND user_id = ?", row.ID, userID).Delete(&domain.BodyWaterLog{}).Error; err != nil {
					return err
				}
				reduced += row.AmountMl
				remaining -= row.AmountMl
				continue
			}
			nextAmount := row.AmountMl - remaining
			if err := tx.Model(&domain.BodyWaterLog{}).
				Where("id = ? AND user_id = ?", row.ID, userID).
				Update("amount_ml", nextAmount).Error; err != nil {
				return err
			}
			reduced += remaining
			remaining = 0
		}
		return nil
	})
	return reduced, err
}

func (r *BodyMetricsRepo) GetWaterLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWaterLog, error) {
	var rows []domain.BodyWaterLog
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if startDate != "" {
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Order("recorded_on asc, created_at asc").Find(&rows).Error
	return rows, err
}

func (r *BodyMetricsRepo) GetWaterLogsByExactDate(ctx context.Context, userID string, recordedOn string) ([]domain.BodyWaterLog, error) {
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return nil, err
	}
	var rows []domain.BodyWaterLog
	err := r.db.WithContext(ctx).Where("user_id = ? AND DATE(recorded_on) = ?", userID, recordedOn).Find(&rows).Error
	return rows, err
}

func (r *BodyMetricsRepo) DeleteWaterLogsByDate(ctx context.Context, userID string, recordedOn string) (int64, error) {
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return 0, err
	}
	result := r.db.WithContext(ctx).Where("user_id = ? AND DATE(recorded_on) = ?", userID, recordedOn).Delete(&domain.BodyWaterLog{})
	return result.RowsAffected, result.Error
}

func (r *BodyMetricsRepo) GetWaterLogDates(ctx context.Context, userID string, startDate, endDate string) ([]string, error) {
	var dates []string
	q := r.db.WithContext(ctx).Model(&domain.BodyWaterLog{}).Distinct("recorded_on").Where("user_id = ?", userID)
	if startDate != "" {
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Pluck("recorded_on", &dates).Error
	return dates, err
}

// Settings

func (r *BodyMetricsRepo) GetBodyMetricSettings(ctx context.Context, userID string) (*domain.BodyMetricSettings, error) {
	var row domain.BodyMetricSettings
	if err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *BodyMetricsRepo) UpsertBodyMetricSettings(ctx context.Context, settings *domain.BodyMetricSettings) error {
	return r.db.WithContext(ctx).Save(settings).Error
}

func (r *BodyMetricsRepo) SumWaterByDate(ctx context.Context, userID string, recordedOn string) (int64, error) {
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return 0, err
	}
	var total int64
	err := r.db.WithContext(ctx).Model(&domain.BodyWaterLog{}).Where("user_id = ? AND DATE(recorded_on) = ?", userID, recordedOn).Select("COALESCE(SUM(amount_ml), 0)").Scan(&total).Error
	return total, err
}

func (r *BodyMetricsRepo) GetUserProfile(ctx context.Context, userID string) (*domain.BodyMetricUserProfile, error) {
	var row domain.BodyMetricUserProfile
	if err := r.db.WithContext(ctx).Where("id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *BodyMetricsRepo) UpdateUserProfileMetrics(ctx context.Context, userID string, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Updates(updates).Error
}
