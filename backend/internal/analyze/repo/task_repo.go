package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TaskRepo struct {
	db *gorm.DB
}

func NewTaskRepo(db *gorm.DB) *TaskRepo {
	return &TaskRepo{db: db}
}

func (r *TaskRepo) CreateTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" {
		task.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *TaskRepo) GetTaskByID(ctx context.Context, taskID string) (*domain.AnalysisTask, error) {
	var task domain.AnalysisTask
	err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &task, err
}

func (r *TaskRepo) ListTasksByUser(ctx context.Context, userID, taskType, status string, limit int) ([]domain.AnalysisTask, error) {
	if limit <= 0 {
		limit = 50
	}
	q := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Limit(limit)
	if taskType != "" {
		q = q.Where("task_type = ?", taskType)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var tasks []domain.AnalysisTask
	err := q.Find(&tasks).Error
	return tasks, err
}

func (r *TaskRepo) CountTasksByUser(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *TaskRepo) CountTasksByStatus(ctx context.Context, userID string) (map[string]int64, error) {
	var rows []struct {
		Status string `gorm:"column:status"`
		Count  int64  `gorm:"column:count"`
	}
	err := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Select("status, COUNT(*) as count").
		Where("user_id = ?", userID).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64)
	for _, r := range rows {
		out[r.Status] = r.Count
	}
	return out, nil
}

func (r *TaskRepo) UpdateTaskResult(ctx context.Context, taskID string, result map[string]any) error {
	var task domain.AnalysisTask
	if err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		return err
	}
	task.Result = result
	now := time.Now()
	task.UpdatedAt = &now
	return r.db.WithContext(ctx).Save(&task).Error
}

func (r *TaskRepo) UpdateTaskStatus(ctx context.Context, taskID string, status string, errorMsg *string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if errorMsg != nil {
		updates["error_message"] = *errorMsg
	}
	return r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("id = ?", taskID).Updates(updates).Error
}

func (r *TaskRepo) DeleteTask(ctx context.Context, taskID, userID string) error {
	return r.db.WithContext(ctx).Where("id = ? AND user_id = ?", taskID, userID).Delete(&domain.AnalysisTask{}).Error
}

func (r *TaskRepo) MarkTimedOutTasks(ctx context.Context, timeoutMinutes int) (int64, error) {
	if timeoutMinutes <= 0 {
		timeoutMinutes = 5
	}
	cutoff := time.Now().Add(-time.Duration(timeoutMinutes) * time.Minute)
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("status IN ? AND created_at < ?", []string{"pending", "processing"}, cutoff).
		Updates(map[string]any{"status": "timed_out", "updated_at": time.Now()})
	return res.RowsAffected, res.Error
}
