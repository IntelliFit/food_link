package worker

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

const precisionAggregateTriggerTimeout = 10 * time.Second

// newPrecisionAggregateTaskID lets the plan hand the aggregate's ID to every
// child before any child is published.
func newPrecisionAggregateTaskID() string {
	return uuid.New().String()
}

// enqueuePrecisionAggregateWhenReady publishes the round's aggregate once every
// child estimate has finished, so the aggregate never holds a queue partition
// while it waits for its children. Several children may finish together and
// publish twice; the claim step drops the duplicate. Rounds planned before this
// change carry no aggregate ID and keep their already-published aggregate.
func (r *Runner) enqueuePrecisionAggregateWhenReady(ctx context.Context, child *domain.AnalysisTask) {
	if r == nil || r.precision == nil || r.tasks == nil || child == nil {
		return
	}
	aggregateID := stringFromMap(child.Payload, "precision_aggregate_task_id")
	sessionID := stringFromMap(child.Payload, "precision_session_id")
	if aggregateID == "" || sessionID == "" {
		return
	}
	roundIndex := intFromMap(child.Payload, "round_index")
	if roundIndex <= 0 {
		roundIndex = 1
	}
	// A failing child may carry a cancelled context; the trigger must still run.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), precisionAggregateTriggerTimeout)
	defer cancel()
	estimates, err := r.precision.ListItemEstimates(ctx, sessionID, roundIndex)
	if err != nil {
		r.warn(ctx, "精确模式汇总触发检查失败", slog.String("task_id", child.ID), slog.String("aggregate_task_id", aggregateID), logger.Err(err))
		return
	}
	if len(estimates) == 0 || !allPrecisionEstimatesFinished(estimates) {
		return
	}
	aggregate, err := r.tasks.GetTaskByID(ctx, aggregateID)
	if err != nil || aggregate == nil {
		r.warn(ctx, "精确模式汇总任务读取失败", slog.String("task_id", child.ID), slog.String("aggregate_task_id", aggregateID), logger.Err(err))
		return
	}
	if aggregate.Status != "pending" {
		return
	}
	if err := r.enqueueTask(ctx, aggregate); err != nil {
		// The recovery loop republishes pending tasks, so a lost trigger delays the
		// result instead of losing it.
		r.warn(ctx, "精确模式汇总任务发布失败，等待恢复循环补发", slog.String("aggregate_task_id", aggregateID), logger.Err(err))
		return
	}
	r.info(ctx, "精确模式子项全部完成，已发布汇总任务",
		slog.String("session_id", sessionID), slog.Int("round", roundIndex),
		slog.String("aggregate_task_id", aggregateID), slog.Int("children", len(estimates)))
}
