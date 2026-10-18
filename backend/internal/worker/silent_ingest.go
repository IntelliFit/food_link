package worker

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/internal/analyze/domain"
)

const (
	silentIngestTimeout       = 90 * time.Second
	silentIngestMaxConcurrent = 4
)

// The packaged-food ingest is a best-effort library refill that runs after the
// user already has the result, so it is bounded per process and skipped when busy.
var silentIngestSlots = make(chan struct{}, silentIngestMaxConcurrent)

// startSilentPackagedIngest runs the extra extraction model call in the
// background. Running it inline kept the Kafka message unacknowledged, which
// held the partition and delayed every later task queued behind it.
func (r *Runner) startSilentPackagedIngest(ctx context.Context, task *domain.AnalysisTask, result map[string]any) {
	if r == nil || r.nutrition == nil || task == nil || len(healthReportImageURLs(task)) < 2 {
		return
	}
	select {
	case silentIngestSlots <- struct{}{}:
	default:
		r.warn(ctx, "静默预包装补库已跳过：后台任务已满", slog.String("task_id", task.ID))
		return
	}
	bgCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), silentIngestTimeout)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				r.warn(bgCtx, "静默预包装补库 panic 已恢复", slog.String("task_id", task.ID), slog.Any("panic", recovered))
			}
			cancel()
			<-silentIngestSlots
		}()
		r.trySilentPackagedIngest(bgCtx, task, result)
	}()
}
