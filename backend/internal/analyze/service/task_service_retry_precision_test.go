package service

import (
	"context"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskServiceRetryTaskRestartsFailedPrecisionAggregateAsFreshRootTask(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	publisher := &recordingTaskPublisher{}
	guard := &mockTaskCreditGuard{}
	svc.ConfigureTaskPublisher(publisher)
	svc.ConfigureCreditGuard(guard)

	ctx := context.Background()
	imageURL := "https://example.com/failed-precision-meal.jpg"
	source := &analyzedomain.AnalysisTask{
		UserID:     "user1",
		TaskType:   "precision_aggregate",
		Status:     "failed",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"execution_mode":       "strict_separate",
			"precision_session_id": "failed-session",
			"round_index":          1,
			"group_index":          0,
			"child_task_ids":       []any{"failed-child"},
			"items_to_estimate":    []any{map[string]any{"item_name": "白馒头"}},
			"split_strategy":       "separate",
			"item_key":             "group_0",
			"item_name":            "白馒头",
			"item_hint":            "原精准子任务提示",
			"planner_modelName":    "gemini-3.5-flash",
			"precision_options": map[string]any{
				"separate": true,
			},
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, source))

	result, err := svc.RetryTask(ctx, source.ID, source.UserID)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, publisher.messages, 1)
	retryTask, err := taskRepo.GetTaskByID(ctx, result.TaskID)
	require.NoError(t, err)
	require.Equal(t, "precision_plan", retryTask.TaskType)
	assert.Equal(t, "strict_separate", retryTask.Payload["execution_mode"])
	assert.Equal(t, source.ID, retryTask.Payload["retry_source_task_id"])
	assert.NotEqual(t, "failed-session", retryTask.Payload["precision_session_id"])
	for _, key := range []string{
		"group_index",
		"child_task_ids",
		"items_to_estimate",
		"split_strategy",
		"item_key",
		"item_name",
		"item_hint",
		"planner_modelName",
	} {
		assert.NotContains(t, retryTask.Payload, key)
	}

	var session analyzedomain.PrecisionSession
	require.NoError(t, db.First(&session, "id = ?", retryTask.Payload["precision_session_id"]).Error)
	assert.Equal(t, "strict_separate", session.ExecutionMode)
	assert.Equal(t, source.UserID, session.UserID)
}
