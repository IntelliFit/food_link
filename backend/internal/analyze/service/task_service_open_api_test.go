package service

import (
	"context"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"

	"github.com/stretchr/testify/require"
)

func TestSubmitOpenAnalyzeTaskUsesOpenLedgerInsteadOfUserCredits(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{earnedUnits: 100}
	svc.ConfigureCreditGuard(guard)

	taskID, err := svc.SubmitOpenAnalyzeTask(context.Background(), "service-user", SubmitTaskInput{
		ImageURLs: []string{"https://example.com/meal.jpg"},
		ExtraPayload: map[string]any{
			"open_api":            true,
			"open_api_app_id":     "app-1",
			"open_api_request_id": "request-1",
		},
	})
	require.NoError(t, err)
	require.Empty(t, guard.validateCalls)
	require.Empty(t, guard.consumeCalls)

	task, err := taskRepo.GetTaskByID(context.Background(), taskID)
	require.NoError(t, err)
	require.Equal(t, "open_api", task.Payload["billing_source"])
	require.Equal(t, "app-1", task.Payload["open_api_app_id"])
	require.Equal(t, "request-1", task.Payload["open_api_request_id"])
}

func TestSubmitOpenTextTaskRejectsUntrustedDirectCall(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)

	_, err := svc.SubmitOpenTextTask(context.Background(), "service-user", SubmitTaskInput{TextInput: "米饭"})
	require.Error(t, err)
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 403, appErr.HTTPStatus)
}
