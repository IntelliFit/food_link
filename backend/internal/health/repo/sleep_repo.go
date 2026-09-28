package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/health/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SleepRepo struct{ db *gorm.DB }

func NewSleepRepo(db *gorm.DB) *SleepRepo { return &SleepRepo{db: db} }

func (r *SleepRepo) Get(ctx context.Context, userID, date string) (*domain.SleepRecord, error) {
	var row migrationdo.SleepRecordDO
	err := r.db.WithContext(ctx).Where("user_id = ? AND recorded_on = ?", userID, date).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &domain.SleepRecord{ID: row.ID, Date: row.RecordedOn.Format("2006-01-02"), Bedtime: row.Bedtime, WakeTime: row.WakeTime, Quality: row.Quality, Note: row.Note, Source: row.Source, DurationMinutes: int(row.WakeTime.Sub(row.Bedtime).Minutes())}, nil
}

func (r *SleepRepo) Save(ctx context.Context, userID string, record domain.SleepRecord) (*domain.SleepRecord, error) {
	date, _ := time.Parse("2006-01-02", record.Date)
	row := migrationdo.SleepRecordDO{ID: uuid.NewString(), UserID: userID, RecordedOn: date, Bedtime: record.Bedtime, WakeTime: record.WakeTime, Quality: record.Quality, Note: record.Note, Source: "manual"}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "recorded_on"}}, DoUpdates: clause.AssignmentColumns([]string{"bedtime", "wake_time", "quality", "note", "source", "updated_at"})}, clause.Returning{}).Create(&row).Error
	if err != nil {
		return nil, err
	}
	record.ID, record.Source = row.ID, row.Source
	record.DurationMinutes = int(record.WakeTime.Sub(record.Bedtime).Minutes())
	return &record, nil
}

func (r *SleepRepo) Delete(ctx context.Context, userID, date string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND recorded_on = ?", userID, date).Delete(&migrationdo.SleepRecordDO{}).Error
}
