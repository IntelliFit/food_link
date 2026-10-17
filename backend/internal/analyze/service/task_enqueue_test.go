package service

import (
	"context"
	"errors"
	"os"
	"testing"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if err := testdb.Stop(); err != nil && code == 0 {
		code = 1
	}
	os.Exit(code)
}

type outcomeTaskPublisher struct {
	beforeReturn func(context.Context, taskqueue.TaskMessage)
	err          error
	taskID       string
}

func (p *outcomeTaskPublisher) PublishTask(ctx context.Context, message taskqueue.TaskMessage) error {
	p.taskID = message.TaskID
	if p.beforeReturn != nil {
		p.beforeReturn(ctx, message)
	}
	return p.err
}

func TestEnqueueFailurePreservesAcceptedTaskAndCredits(t *testing.T) {
	_, tasks, precision, users := setupTaskServiceTestDB(t)
	for _, sourceType := range []string{"food", "food_text"} {
		for _, test := range []struct {
			name        string
			transition  string
			publishErr  error
			wantStatus  string
			wantFailure bool
		}{
			{"认领后回执超时", "processing", context.DeadlineExceeded, "processing", false},
			{"完成后回执超时", "done", context.DeadlineExceeded, "done", false},
			{"待认领回执超时", "", context.DeadlineExceeded, "pending", false},
			{"未知发布错误", "", errors.New("broker reply lost"), "pending", false},
			{"明确拒绝", "", taskqueue.ErrClosed, "failed", true},
			{"明确拒绝但其他投递已认领", "processing", taskqueue.ErrClosed, "processing", false},
			{"明确拒绝但其他投递已完成", "done", taskqueue.ErrClosed, "done", false},
			{"取消不覆盖", "cancelled", context.DeadlineExceeded, "cancelled", true},
			{"普通失败不覆盖", "failed", context.DeadlineExceeded, "failed", true},
		} {
			t.Run(sourceType+"/"+test.name, func(t *testing.T) {
				guard := &mockTaskCreditGuard{earnedUnits: 2}
				publisher := &outcomeTaskPublisher{err: test.publishErr}
				publisher.beforeReturn = func(ctx context.Context, message taskqueue.TaskMessage) {
					switch test.transition {
					case "processing", "done":
						claim, err := tasks.ClaimTaskByID(ctx, repo.ClaimTaskOptions{TaskID: message.TaskID, TaskTypes: []string{sourceType}, WorkerID: "simulated-worker"})
						require.NoError(t, err)
						require.Equal(t, repo.ClaimOutcomeClaimed, claim.Outcome)
						if test.transition == "done" {
							completed, err := tasks.CompleteTaskAttempt(ctx, message.TaskID, *claim.Task.AttemptID, map[string]any{"receipt": "worker-result"})
							require.NoError(t, err)
							require.True(t, completed)
						}
					case "cancelled", "failed":
						require.NoError(t, tasks.UpdateTaskStatus(ctx, message.TaskID, test.transition, nil))
					}
				}
				svc := NewTaskService(tasks, precision, users)
				svc.ConfigureTaskPublisher(publisher)
				svc.ConfigureCreditGuard(guard)
				var taskID string
				var err error
				if sourceType == "food" {
					taskID, err = svc.SubmitAnalyzeTask(context.Background(), "u1", SubmitTaskInput{ImageURL: "https://example.com/food.jpg"})
				} else {
					taskID, err = svc.SubmitTextTask(context.Background(), "u1", SubmitTaskInput{Text: "米饭100克"})
				}
				if test.wantFailure {
					require.Error(t, err)
					require.Empty(t, taskID)
					require.Len(t, guard.refundCalls, 1, "明确终态保留原退款机制")
				} else {
					require.NoError(t, err)
					require.Equal(t, publisher.taskID, taskID, "回执不确定继续返回同一已落库任务")
					require.Empty(t, guard.refundCalls, "已接收或待恢复任务不能错误退款")
				}
				require.Len(t, guard.consumeCalls, 1)
				stored, err := tasks.GetTaskByID(context.Background(), publisher.taskID)
				require.NoError(t, err)
				require.Equal(t, test.wantStatus, stored.Status)
				if stored.Status == "done" {
					require.Equal(t, "worker-result", stored.Result["receipt"])
				}
			})
		}
	}
	// The producer CAS must never overwrite a terminal task independently of
	// error classification or a worker's attempt ownership.
	cancelled := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "cancelled"}
	require.NoError(t, tasks.CreateTask(context.Background(), cancelled))
	changed, err := tasks.FailPendingTask(context.Background(), cancelled.ID, "enqueue failed")
	require.NoError(t, err)
	require.False(t, changed)
}
