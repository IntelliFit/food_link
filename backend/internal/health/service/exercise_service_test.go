package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type exerciseRoundTripFunc func(*http.Request) (*http.Response, error)

func (f exerciseRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type recordingTaskPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingTaskPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

type mockExerciseRepo struct {
	logs      []domain.ExerciseLog
	tasks     []domain.AnalysisTask
	deletedID string
	profile   *domain.ExerciseUserProfile
	weight    *domain.BodyWeightRecord
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

func (m *mockExerciseRepo) GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error) {
	return m.profile, nil
}

func (m *mockExerciseRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	return m.weight, nil
}

func (m *mockExerciseRepo) CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" && task.TextInput != nil {
		task.ID = "task-" + *task.TextInput
	}
	m.tasks = append(m.tasks, *task)
	return nil
}

func (m *mockExerciseRepo) FailAnalysisTask(ctx context.Context, taskID, errorMsg string) error {
	for i := range m.tasks {
		if m.tasks[i].ID == taskID {
			m.tasks[i].Status = "failed"
		}
	}
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

func TestExerciseService_EstimateImageUsesDoubao(t *testing.T) {
	svc := NewExerciseService(&mockExerciseRepo{}, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://ark.cn-beijing.volces.com/api/v3/chat/completions", req.URL.String())
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "doubao-seed-2-0-lite-260428", body["model"])
		assert.Equal(t, "medium", body["reasoning_effort"])
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步机慢跑\",\"reasoning\":\"图片显示跑步机慢跑\",\"calories_kcal\":180}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	estimate, ok := svc.estimateExerciseCaloriesWithLLM(context.Background(), "", "https://example.com/run.jpg", nil)

	require.True(t, ok)
	assert.Equal(t, 180, estimate.CaloriesKcal)
	assert.Equal(t, "llm", estimate.Source)
	assert.Equal(t, "跑步机慢跑", estimate.ExerciseType)
}

func TestExerciseService_ProcessExerciseTaskUsesDetectedTypeForWeakTitle(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"椭圆机训练\",\"reasoning\":\"图片显示用户在椭圆机上训练\",\"calories_kcal\":220}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	result, err := svc.ProcessExerciseTask(context.Background(), "u1", "运动", "https://example.com/exercise.jpg", "2024-06-15", map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 70},
	})

	require.NoError(t, err)
	require.Len(t, repo.logs, 1)
	assert.Equal(t, "椭圆机训练", repo.logs[0].ExerciseDesc)
	exerciseLog := result["exercise_log"].(map[string]any)
	assert.Equal(t, "椭圆机训练", exerciseLog["exercise_desc"])
}

func TestExerciseService_ProcessExerciseTaskKeepsUsefulUserTitle(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步机慢跑\",\"reasoning\":\"图片显示跑步机慢跑\",\"calories_kcal\":180}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	_, err := svc.ProcessExerciseTask(context.Background(), "u1", "跑步30分钟", "https://example.com/run.jpg", "2024-06-15", map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 70},
	})

	require.NoError(t, err)
	require.Len(t, repo.logs, 1)
	assert.Equal(t, "跑步30分钟", repo.logs[0].ExerciseDesc)
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
	weightDate := time.Now().UTC()
	repo := &mockExerciseRepo{
		profile: &domain.ExerciseUserProfile{ID: "u1"},
		weight:  &domain.BodyWeightRecord{UserID: "u1", WeightKg: 70, RecordedOn: &weightDate},
	}
	svc := NewExerciseService(repo)
	publisher := &recordingTaskPublisher{}
	svc.ConfigureTaskPublisher(publisher)
	ctx := context.Background()

	result, err := svc.CreateLog(ctx, "u1", "跑步30分钟")
	require.NoError(t, err)
	assert.NotEmpty(t, result["task_id"])
	assert.Equal(t, "运动分析任务已提交，请轮询任务状态直至完成", result["message"])
	assert.Len(t, repo.logs, 0)
	assert.Len(t, repo.tasks, 1)
	assert.Equal(t, "exercise", repo.tasks[0].TaskType)
	assert.NotEmpty(t, repo.tasks[0].Payload["profile_snapshot"])
	require.Len(t, publisher.messages, 1)
	assert.Equal(t, result["task_id"], publisher.messages[0].TaskID)
	assert.Equal(t, "exercise", publisher.messages[0].TaskType)
}

func TestExerciseService_EstimateCalories(t *testing.T) {
	repo := &mockExerciseRepo{profile: &domain.ExerciseUserProfile{ID: "u1"}}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	result, err := svc.EstimateCalories(ctx, "u1", "跑步30分钟")
	require.NoError(t, err)
	assert.Greater(t, result["estimated_calories"].(int), 0)
	assert.Equal(t, "跑步30分钟", result["exercise_desc"])
	assert.NotEmpty(t, result["reasoning"])
	assert.NotNil(t, result["profile_snapshot"])
}

func TestExerciseService_ProcessExerciseTask_CreatesLogWithReasoning(t *testing.T) {
	recordedOn := time.Now().In(chinaTZ).Format("2006-01-02")
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)

	result, err := svc.ProcessExerciseTask(context.Background(), "u1", "跑步30分钟", "", recordedOn, map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 70.0},
	})
	require.NoError(t, err)
	assert.Equal(t, "跑步30分钟", result["exercise_log"].(map[string]any)["exercise_desc"])
	assert.NotEmpty(t, result["reasoning"])
	require.Len(t, repo.logs, 1)
	assert.NotNil(t, repo.logs[0].AIReasoning)
	assert.Greater(t, *repo.logs[0].CaloriesBurned, 0.0)
}

func TestExerciseService_EstimateCalories_SplitsMultiItemDescription(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	desc := "慢跑30分钟；跳绳10分钟；拉伸15分钟"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Contains(t, result["reasoning"], "分项估算")
	assert.Greater(t, result["estimated_calories"].(int), 0)
}

func TestExerciseService_DeleteLog(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	err := svc.DeleteLog(ctx, "u1", "log-1")
	require.NoError(t, err)
	assert.Equal(t, "log-1", repo.deletedID)
}
