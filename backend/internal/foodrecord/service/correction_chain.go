package service

import (
	"context"
	"log/slog"
	"strings"

	analyzedomain "food_link/backend/internal/analyze/domain"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
)

// 纠错链最多回溯的轮数；正常使用不超过几轮，上限只防异常数据造成长循环。
const maxCorrectionChainDepth = 10

var errCorrectionOfRecordedMeal = &commonerrors.AppError{
	Code:       10002,
	Message:    "这餐纠错前的结果已经记录过，纠错结果没有重复记录。请在记录详情中修改这餐。",
	HTTPStatus: 409,
}

// rejectCorrectionOfRecordedMeal blocks a second intake record for the same meal:
// a correction task has a new task ID, so the per-task uniqueness check alone
// cannot see that an earlier round of the same meal was already recorded.
// Only the current user's records are consulted.
func (s *FoodRecordService) rejectCorrectionOfRecordedMeal(ctx context.Context, userID string, task *analyzedomain.AnalysisTask) error {
	visited := map[string]bool{task.ID: true}
	pending := correctionParentIDs(task)
	for depth := 0; len(pending) > 0 && depth < maxCorrectionChainDepth; depth++ {
		id := pending[0]
		pending = pending[1:]
		if visited[id] {
			continue
		}
		visited[id] = true
		existing, err := s.recordRepo.GetByUserSourceTaskID(ctx, userID, id)
		if err != nil {
			return err
		}
		if existing != nil {
			logger.Warn(ctx, "拒绝为已记录的餐重复记录纠错结果",
				slog.String("user_id", userID), slog.String("task_id", task.ID), slog.String("recorded_task_id", id))
			return errCorrectionOfRecordedMeal
		}
		parent, err := s.taskRepo.GetByID(ctx, id)
		if err != nil {
			return err
		}
		if parent != nil && parent.UserID == userID {
			pending = append(pending, correctionParentIDs(parent)...)
		}
	}
	return nil
}

func correctionParentIDs(task *analyzedomain.AnalysisTask) []string {
	if task == nil {
		return nil
	}
	var ids []string
	for _, key := range []string{"correction_source_task_id", "correction_root_task_id"} {
		if id := strings.TrimSpace(stringFromAny(task.Payload[key])); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}
