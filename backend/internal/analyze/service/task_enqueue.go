package service

import (
	"context"
	stderrors "errors"
	"fmt"
	"log/slog"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/logger"
)

// A timeout cannot tell whether the broker accepted the message. Preserve the
// durable task and its credit reservation until its state can be reconciled.
func (s *TaskService) reconcileEnqueueFailure(task *domain.AnalysisTask, publishErr error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	definiteRejection := stderrors.Is(publishErr, taskqueue.ErrClosed)
	if definiteRejection {
		if _, err := s.tasks.FailPendingTask(ctx, task.ID, "analysis task enqueue failed"); err != nil {
			logger.Error(ctx, "记录明确拒绝入队状态失败，保留任务等待恢复", err, slog.String("task_id", task.ID))
			return nil
		}
	}
	fresh, lookupErr := s.tasks.GetTaskByID(ctx, task.ID)
	if lookupErr != nil {
		logger.Error(ctx, "入队异常后回读任务失败，保留任务等待恢复", lookupErr, slog.String("task_id", task.ID), slog.Bool("publish.definite_rejection", definiteRejection))
		return nil
	}
	if fresh != nil {
		task.Status = fresh.Status
		switch fresh.Status {
		case "processing", "done":
			logger.Warn(ctx, "发布回执异常但任务已被处理，保留任务状态", slog.String("task_id", task.ID), slog.String("task_type", task.TaskType), slog.String("status", fresh.Status), logger.Err(publishErr))
			return nil
		case "pending":
			logger.Warn(ctx, "分析任务发布结果待确认，保留原任务等待恢复", slog.String("task_id", task.ID), slog.String("task_type", task.TaskType), logger.Err(publishErr))
			return nil
		}
	}
	logger.Error(ctx, "分析任务未入队且已停止，按终态退还预扣积分", publishErr, slog.String("task_id", task.ID), slog.String("task_type", task.TaskType), slog.String("status", task.Status))
	return fmt.Errorf("enqueue analysis task: %w", publishErr)
}
