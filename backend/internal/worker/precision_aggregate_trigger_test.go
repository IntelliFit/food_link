package worker

import (
	"context"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"

	"github.com/stretchr/testify/require"
)

type precisionTriggerFixture struct {
	runner    *Runner
	tasks     *analyzerepo.TaskRepo
	precision *analyzerepo.PrecisionRepo
	publisher *recordingWorkerPublicFoodQueue
	aggregate *analyzedomain.AnalysisTask
	children  []*analyzedomain.AnalysisTask
	estimates []*analyzedomain.PrecisionItemEstimate
}

func newPrecisionTriggerFixture(t *testing.T, childCount int) *precisionTriggerFixture {
	t.Helper()
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	f := &precisionTriggerFixture{
		tasks:     analyzerepo.NewTaskRepo(db),
		precision: analyzerepo.NewPrecisionRepo(db),
		publisher: &recordingWorkerPublicFoodQueue{},
	}
	f.runner = &Runner{tasks: f.tasks, precision: f.precision, queue: f.publisher}
	session := &analyzedomain.PrecisionSession{ID: "session-trigger", UserID: "user-1", SourceType: "image", Status: "estimating", RoundIndex: 1}
	require.NoError(t, f.precision.CreateSession(ctx, session))
	f.aggregate = &analyzedomain.AnalysisTask{
		ID: newPrecisionAggregateTaskID(), UserID: "user-1", TaskType: "precision_aggregate", Status: "pending",
		Payload: map[string]any{"precision_session_id": session.ID, "round_index": 1},
	}
	require.NoError(t, f.tasks.CreateTask(ctx, f.aggregate))
	for index := 0; index < childCount; index++ {
		child := &analyzedomain.AnalysisTask{
			UserID: "user-1", TaskType: "precision_item_estimate", Status: "processing",
			Payload: map[string]any{"precision_session_id": session.ID, "round_index": 1, "precision_aggregate_task_id": f.aggregate.ID},
		}
		require.NoError(t, f.tasks.CreateTask(ctx, child))
		sourceTaskID := child.ID
		estimate := &analyzedomain.PrecisionItemEstimate{SessionID: session.ID, RoundIndex: 1, ItemIndex: index, ItemKey: "group", ItemName: "item", Status: "processing", SourceTaskID: &sourceTaskID}
		require.NoError(t, f.precision.CreateItemEstimate(ctx, estimate))
		f.children = append(f.children, child)
		f.estimates = append(f.estimates, estimate)
	}
	return f
}

func (f *precisionTriggerFixture) finish(t *testing.T, index int, status string) {
	t.Helper()
	require.NoError(t, f.precision.UpdateItemEstimate(context.Background(), f.estimates[index].ID, map[string]any{"status": status}))
}

func TestPrecisionAggregateWaitsUntilEveryChildFinishes(t *testing.T) {
	f := newPrecisionTriggerFixture(t, 2)
	ctx := context.Background()

	f.finish(t, 0, "done")
	f.runner.enqueuePrecisionAggregateWhenReady(ctx, f.children[0])
	require.Empty(t, f.publisher.messages, "a sibling is still running")

	f.finish(t, 1, "failed")
	f.runner.enqueuePrecisionAggregateWhenReady(ctx, f.children[1])
	require.Len(t, f.publisher.messages, 1)
	require.Equal(t, f.aggregate.ID, f.publisher.messages[0].TaskID)
	require.Equal(t, "precision_aggregate", f.publisher.messages[0].TaskType)
}

func TestPrecisionAggregateIsNotRepublishedOnceClaimed(t *testing.T) {
	f := newPrecisionTriggerFixture(t, 1)
	ctx := context.Background()
	f.finish(t, 0, "done")
	require.NoError(t, f.tasks.UpdateTaskStatus(ctx, f.aggregate.ID, "processing", nil))

	f.runner.enqueuePrecisionAggregateWhenReady(ctx, f.children[0])
	require.Empty(t, f.publisher.messages)
}

func TestPrecisionAggregateTriggerIgnoresChildrenFromOlderPlans(t *testing.T) {
	f := newPrecisionTriggerFixture(t, 1)
	f.finish(t, 0, "done")
	legacy := *f.children[0]
	legacy.Payload = map[string]any{"precision_session_id": "session-trigger", "round_index": 1}

	f.runner.enqueuePrecisionAggregateWhenReady(context.Background(), &legacy)
	require.Empty(t, f.publisher.messages, "older plans already published their aggregate")
}

func TestPrecisionAggregateTriggerRunsWithCancelledChildContext(t *testing.T) {
	f := newPrecisionTriggerFixture(t, 1)
	f.finish(t, 0, "failed")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	f.runner.enqueuePrecisionAggregateWhenReady(ctx, f.children[0])
	require.Len(t, f.publisher.messages, 1)
}
