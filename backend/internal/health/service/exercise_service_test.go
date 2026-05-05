package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockExerciseRepo struct {
	logs      []domain.ExerciseLog
	tasks     []domain.AnalysisTask
	deletedID string
}

func (m *mockExerciseRepo) CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error {
	m.logs = append(m.logs, *log)
	return nil
}

func (m *mockExerciseRepo) ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error) {
	return m.logs, nil
}

func (m *mockExerciseRepo) GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error) {
	for _, log := range m.logs {
		if log.ID == logID && log.UserID == userID {
			return &log, nil
		}
	}
	return nil, nil
}

func (m *mockExerciseRepo) DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error) {
	m.deletedID = logID
	return 1, nil
}

func (m *mockExerciseRepo) GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error) {
	var total int64
	for _, log := range m.logs {
		if log.RecordedOn != nil && log.RecordedOn.Format("2006-01-02") == recordedOn && log.CaloriesBurned != nil {
			total += int64(*log.CaloriesBurned)
		}
	}
	return total, nil
}

func (m *mockExerciseRepo) CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" && task.TextInput != nil {
		task.ID = "task-" + *task.TextInput
	}
	m.tasks = append(m.tasks, *task)
	return nil
}

func TestExerciseService_GetDailyCalories(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	calories := 300.0
	repo.logs = []domain.ExerciseLog{
		{UserID: "u1", ExerciseDesc: "run", CaloriesBurned: &calories, RecordedOn: &recordedOn, CreatedAt: &now},
	}

	result, err := svc.GetDailyCalories(ctx, "u1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, 300, result["total_calories_burned"])
}

func TestExerciseService_ListLogs(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	calories := 300.0
	repo.logs = []domain.ExerciseLog{
		{UserID: "u1", ExerciseDesc: "run", CaloriesBurned: &calories, RecordedOn: &recordedOn, CreatedAt: &now},
	}

	result, err := svc.ListLogs(ctx, "u1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, 1, result["count"])
	assert.Equal(t, 300, result["total_calories"])
}

func TestExerciseService_CreateLog(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	result, err := svc.CreateLog(ctx, "u1", "跑步30分钟")
	require.NoError(t, err)
	assert.NotEmpty(t, result["task_id"])
	assert.Equal(t, "运动分析任务已提交，请轮询任务状态直至完成", result["message"])
	assert.Len(t, repo.logs, 1)
	assert.Len(t, repo.tasks, 1)
	assert.Equal(t, "exercise", repo.tasks[0].TaskType)
}

func TestExerciseService_EstimateCalories(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	result, err := svc.EstimateCalories(ctx, "u1", "跑步30分钟")
	require.NoError(t, err)
	assert.Greater(t, result["estimated_calories"].(float64), 0.0)
	assert.Equal(t, "跑步30分钟", result["exercise_desc"])
}

func TestExerciseService_DeleteLog(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	err := svc.DeleteLog(ctx, "u1", "log-1")
	require.NoError(t, err)
	assert.Equal(t, "log-1", repo.deletedID)
}
