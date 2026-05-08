package repo

import (
	"context"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ExerciseRepo struct {
	db *gorm.DB
}

func NewExerciseRepo(db *gorm.DB) *ExerciseRepo {
	return &ExerciseRepo{db: db}
}

func (r *ExerciseRepo) CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error {
	if log.ID == "" {
		log.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *ExerciseRepo) ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error) {
	var rows []domain.ExerciseLog
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if startDate != "" {
		if _, _, err := chinaDateWindow(startDate); err != nil {
			return nil, err
		}
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		if _, _, err := chinaDateWindow(endDate); err != nil {
			return nil, err
		}
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Order("recorded_on desc, created_at desc").Find(&rows).Error
	return rows, err
}

func (r *ExerciseRepo) GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error) {
	var row domain.ExerciseLog
	if err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", logID, userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error) {
	result := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", logID, userID).Delete(&domain.ExerciseLog{})
	return result.RowsAffected, result.Error
}

func (r *ExerciseRepo) GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error) {
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return 0, err
	}
	var total int64
	err := r.db.WithContext(ctx).Model(&domain.ExerciseLog{}).Where("user_id = ? AND recorded_on = ?", userID, recordedOn).Select("COALESCE(SUM(calories_burned), 0)").Scan(&total).Error
	return total, err
}

func (r *ExerciseRepo) GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error) {
	var row domain.ExerciseUserProfile
	if err := r.db.WithContext(ctx).Where("id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	var row domain.BodyWeightRecord
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("recorded_on DESC").
		Order("created_at DESC").
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" {
		task.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(task).Error
}
