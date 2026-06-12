package worker

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/pkg/logger"
)

func (r *Runner) info(ctx context.Context, msg string, attrs ...slog.Attr) {
	logger.Info(ctx, msg, attrs...)
}

func (r *Runner) warn(ctx context.Context, msg string, attrs ...slog.Attr) {
	logger.Warn(ctx, msg, attrs...)
}

func (r *Runner) errorLog(ctx context.Context, msg string, err error, attrs ...slog.Attr) {
	logger.Error(ctx, msg, err, attrs...)
}

func taskAttrs(taskID, taskType, userID string) []slog.Attr {
	attrs := []slog.Attr{
		slog.String("task_id", taskID),
		logger.AnalysisTaskID(taskID),
	}
	if taskType = strings.TrimSpace(taskType); taskType != "" {
		attrs = append(attrs, logger.TaskType(taskType))
	}
	if userID = strings.TrimSpace(userID); userID != "" {
		attrs = append(attrs, logger.UserID(userID))
	}
	return attrs
}
