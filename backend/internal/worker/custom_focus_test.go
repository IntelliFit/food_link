package worker

import (
	"context"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

type fakeCustomFocusProcessor struct {
	userID     string
	statsRange string
	focusID    string
	result     map[string]any
	err        error
}

func (f *fakeCustomFocusProcessor) ProcessCustomFocusTask(_ context.Context, userID, statsRange, focusID string) (map[string]any, error) {
	f.userID = userID
	f.statsRange = statsRange
	f.focusID = focusID
	return f.result, f.err
}

func TestWorkerProcessesCustomFocusAsPersistedBackgroundTask(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&analyzedomain.AnalysisTask{}))
	tasks := analyzerepo.NewTaskRepo(db)
	require.Contains(t, SupportedTaskTypes(), "custom_focus")
	task := &analyzedomain.AnalysisTask{
		ID: "custom-focus-task-1", UserID: "user-1", TaskType: "custom_focus", Status: "processing",
		Payload: map[string]any{"range": "week", "focus_id": "focus-1"},
	}
	require.NoError(t, tasks.CreateTask(context.Background(), task))
	processor := &fakeCustomFocusProcessor{result: map[string]any{
		"card": map[string]any{"key": "custom:focus-1", "title": "力量提升", "score": 64},
	}}
	runner := &Runner{tasks: tasks, customFocus: processor}

	require.NoError(t, runner.processCustomFocus(context.Background(), task))
	require.Equal(t, "user-1", processor.userID)
	require.Equal(t, "week", processor.statsRange)
	require.Equal(t, "focus-1", processor.focusID)
	stored, err := tasks.GetTaskByID(context.Background(), task.ID)
	require.NoError(t, err)
	require.Equal(t, "done", stored.Status)
	require.Equal(t, float64(64), stored.Result["card"].(map[string]any)["score"])
}
