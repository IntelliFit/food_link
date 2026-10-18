package repo

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/analyze/domain"
)

// FailPendingTask handles a definite producer rejection without taking a task
// back from a worker that has already claimed or completed it.
func (r *TaskRepo) FailPendingTask(ctx context.Context, taskID, message string) (bool, error) {
	if strings.TrimSpace(taskID) == "" {
		return false, nil
	}
	result := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status = ?", taskID, "pending").
		Updates(map[string]any{"status": "failed", "error_message": message, "lease_until": nil, "updated_at": time.Now()})
	return result.RowsAffected > 0, result.Error
}
