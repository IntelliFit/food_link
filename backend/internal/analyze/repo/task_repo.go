package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

func (r *TaskRepo) ClaimNextPendingTask(ctx context.Context, taskTypes []string) (*domain.AnalysisTask, error) {
	if len(taskTypes) == 0 {
		return nil, nil
	}
	var claimed *domain.AnalysisTask
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task domain.AnalysisTask
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND task_type IN ?", "pending", taskTypes).
			Order("created_at ASC").
			Limit(1).
			First(&task).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		now := time.Now()
		result := tx.Model(&domain.AnalysisTask{}).
			Where("id = ? AND status = ?", task.ID, "pending").
			Updates(map[string]any{
				"status":        "processing",
				"error_message": nil,
				"updated_at":    now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		task.Status = "processing"
		task.ErrorMessage = nil
		task.UpdatedAt = &now
		claimed = &task
		return nil
	})
	return claimed, err
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
	} else {
		q = applyAnalyzeHistoryTaskFilter(q)
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
	err := applyAnalyzeHistoryTaskFilter(
		r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("user_id = ?", userID),
	).Count(&count).Error
	return count, err
}

func (r *TaskRepo) RecordedTaskMap(ctx context.Context, userID string, taskIDs []string) (map[string]string, error) {
	out := map[string]string{}
	if len(taskIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		ID           string `gorm:"column:id"`
		SourceTaskID string `gorm:"column:source_task_id"`
	}
	err := r.db.WithContext(ctx).Table("user_food_records").
		Select("id, source_task_id").
		Where("user_id = ?", userID).
		Where("source_task_id IN ?", taskIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.SourceTaskID != "" {
			out[row.SourceTaskID] = row.ID
		}
	}
	return out, nil
}

func applyAnalyzeHistoryTaskFilter(q *gorm.DB) *gorm.DB {
	return q.Where(
		`task_type IN ? OR task_type LIKE ? OR task_type LIKE ? OR task_type LIKE ? OR task_type LIKE ?`,
		[]string{"food", "food_text", "precision_plan", "precision_aggregate"},
		"food_debug%",
		"food_text_debug%",
		"precision_plan_debug%",
		"precision_aggregate_debug%",
	)
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

func (r *TaskRepo) CompleteTask(ctx context.Context, taskID string, result map[string]any) (bool, error) {
	updates := map[string]any{
		"status":        "done",
		"result":        result,
		"error_message": nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) FailTask(ctx context.Context, taskID string, errorMsg string) (bool, error) {
	updates := map[string]any{
		"status":        "failed",
		"error_message": errorMsg,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
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
