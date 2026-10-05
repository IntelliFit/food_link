package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
)

var errAwaitingContentSecurity = errors.New("识别结果等待内容审核回调")

func (r *Runner) ConfigureContentSecurity(checker *contentsecurity.Service) {
	r.contentSecurity = checker
}

func (r *Runner) requiresContentSecurity(task *domain.AnalysisTask) bool {
	if r.contentSecurity == nil || task == nil || boolFromAny(task.Payload["internal_benchmark"]) || boolFromAny(task.Payload["open_api"]) {
		return false
	}
	switch task.TaskType {
	case "food", "food_text", "precision_plan", "precision_item_estimate", "precision_aggregate":
		return true
	default:
		return false
	}
}

func analysisSecurityInput(task *domain.AnalysisTask) map[string]any {
	if doc, ok := task.Payload["content_security_input"].(map[string]any); ok {
		return doc
	}
	return analyzeservice.AnalysisSecurityDocument(task)
}

// Poll shared tickets while AI is running. Cancel the same request context upon
// rejection; callback delivery to another replica still stops this worker.
func (r *Runner) monitorContentSecurity(ctx context.Context, task *domain.AnalysisTask) (context.Context, func()) {
	if !r.requiresContentSecurity(task) {
		return ctx, func() {}
	}
	ctx, cancel := context.WithCancelCause(ctx)
	done := make(chan struct{})
	doc := analysisSecurityInput(task)
	go func() {
		defer close(done)
		for ctx.Err() == nil {
			err := r.contentSecurity.CheckDocument(ctx, task.UserID, 4, doc, r.storage)
			if err == nil {
				return
			}
			if errors.Is(err, contentsecurity.ErrRejected) {
				r.warn(ctx, "识别输入审核拒绝，取消模型请求", slog.String("task_id", task.ID))
				cancel(contentsecurity.ErrRejected)
				return
			}
			if !errors.Is(err, contentsecurity.ErrPending) {
				cancel(err)
				return
			}
			sleepContext(ctx, time.Second)
		}
	}()
	return ctx, func() { cancel(context.Canceled); <-done }
}

// The saved result is not exposed as done until every image has an explicit
// pass. A late callback resumes this result, not another model invocation.
func (r *Runner) completeContentSecurity(ctx context.Context, task *domain.AnalysisTask, result map[string]any) error {
	if !r.requiresContentSecurity(task) {
		return nil
	}
	doc := map[string]any{"input": analysisSecurityInput(task), "analysis_result": result}
	err := r.contentSecurity.CheckDocument(ctx, task.UserID, 4, doc, r.storage)
	if errors.Is(err, contentsecurity.ErrPending) {
		if err := r.contentSecurity.WatchDocument(ctx, task.UserID, 4, doc, r.storage, task.ID); err != nil {
			return err
		}
		result[contentsecurity.WaitingKey] = true
		delete(result, contentsecurity.ApprovalKey)
		ok, err := r.tasks.DeferContentSecurity(ctx, task.ID, stringPtrValue(task.AttemptID), result)
		if err != nil {
			return err
		}
		if !ok {
			return errTaskAttemptLost
		}
		task.Status = "pending"
		// Close the race where a callback arrived just before the pending write.
		resumeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if checkErr := r.contentSecurity.CheckDocument(resumeCtx, task.UserID, 4, doc, r.storage); !errors.Is(checkErr, contentsecurity.ErrPending) {
			if err := r.enqueueTask(resumeCtx, task); err != nil {
				r.warn(resumeCtx, "审核结果等待恢复调度", slog.String("task_id", task.ID))
			}
		}
		return errAwaitingContentSecurity
	}
	if err != nil {
		return err
	}
	approval, err := r.contentSecurity.Approval(task.UserID, task.ID, doc, r.storage)
	if err != nil {
		return err
	}
	delete(result, contentsecurity.WaitingKey)
	result[contentsecurity.ApprovalKey] = approval
	r.info(ctx, "识别内容审核通过，结果可直接记录", slog.String("task_id", task.ID))
	return nil
}
