package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
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
	logs       []domain.ExerciseLog
	tasks      []domain.AnalysisTask
	deletedID  string
	profile    *domain.ExerciseUserProfile
	weight     *domain.BodyWeightRecord
	activity   *domain.ExerciseEnergyActivity
	activities map[string]*domain.ExerciseEnergyActivity
	pending    []domain.ExerciseEnergyActivityInput
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
func (m *mockExerciseRepo) UpdateExerciseLog(ctx context.Context, userID, logID, exerciseDesc, imageURL string, recordedOn *string, caloriesBurned *float64) (int64, error) {
	for i := range m.logs {
		if m.logs[i].ID == logID && m.logs[i].UserID == userID {
			m.logs[i].ExerciseDesc = exerciseDesc
			return 1, nil
		}
	}
	return 0, nil
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

func (m *mockExerciseRepo) ResolveExerciseEnergyActivity(ctx context.Context, name string) (*domain.ExerciseEnergyResolveResult, error) {
	if m.activities != nil {
		if activity := m.activities[name]; activity != nil {
			return &domain.ExerciseEnergyResolveResult{Activity: activity, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
		}
	}
	if m.activity != nil && m.activity.CanonicalName == name {
		return &domain.ExerciseEnergyResolveResult{Activity: m.activity, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	return &domain.ExerciseEnergyResolveResult{Status: "unresolved"}, nil
}

func (m *mockExerciseRepo) CreatePendingExerciseEnergyActivity(ctx context.Context, input domain.ExerciseEnergyActivityInput) (*domain.ExerciseEnergyActivity, error) {
	m.pending = append(m.pending, input)
	return &domain.ExerciseEnergyActivity{
		ID:            "pending-activity-1",
		CanonicalName: input.CanonicalName,
		Category:      input.Category,
		Intensity:     input.Intensity,
		METValue:      input.METValue,
		ReviewStatus:  input.ReviewStatus,
		IsActive:      input.IsActive,
	}, nil
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
		assert.NotContains(t, body, "response_format")
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步机慢跑\",\"reasoning\":\"图片显示跑步机慢跑\",\"calories_kcal\":180}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	estimate, err := svc.estimateExerciseCaloriesWithLLM(context.Background(), "", "https://example.com/run.jpg", nil)

	require.NoError(t, err)
	assert.Equal(t, 180, estimate.CaloriesKcal)
	assert.Equal(t, "llm", estimate.Source)
	assert.Equal(t, "跑步机慢跑", estimate.ExerciseType)
}

func TestExerciseService_EstimateImageUsesQwenOnWanjie(t *testing.T) {
	svc := NewExerciseService(&mockExerciseRepo{}, &config.Config{
		External: config.ExternalConfig{
			DoubaoAPIKey:  "fake-key",
			DoubaoBaseURL: "https://maas-openapi.wanjiedata.com/api/v1",
		},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://maas-openapi.wanjiedata.com/api/v1/chat/completions", req.URL.String())
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "qwen3.6-flash", body["model"])
		assert.Equal(t, "medium", body["reasoning_effort"])
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步机慢跑\",\"reasoning\":\"图片显示跑步机慢跑\",\"calories_kcal\":180}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	estimate, err := svc.estimateExerciseCaloriesWithLLM(context.Background(), "", "https://example.com/run.jpg", nil)

	require.NoError(t, err)
	assert.Equal(t, 180, estimate.CaloriesKcal)
	assert.Equal(t, "llm", estimate.Source)
}

func TestExerciseService_ProcessExerciseTaskDoesNotFallbackForImageLLMFailure(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString(`{"error":"bad upstream"}`)),
			Header:     make(http.Header),
		}, nil
	})}

	_, err := svc.ProcessExerciseTask(context.Background(), "u1", "", "https://example.com/exercise.jpg", "2024-06-15", map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 70},
	})

	require.Error(t, err)
	assert.Empty(t, repo.logs)
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
	require.NotNil(t, repo.logs[0].RecordedOn)
	assert.Equal(t, "2024-06-15", repo.logs[0].RecordedOn.UTC().Format("2006-01-02"))
	assert.Equal(t, "椭圆机训练", repo.logs[0].ExerciseDesc)
	exerciseLog := result["exercise_log"].(map[string]any)
	assert.Equal(t, "椭圆机训练", exerciseLog["exercise_desc"])
	require.Len(t, repo.logs[0].ExerciseItems, 1)
	assert.Equal(t, "椭圆机训练", repo.logs[0].ExerciseItems[0]["name"])
	assert.Equal(t, 220, repo.logs[0].ExerciseItems[0]["calories_kcal"])
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
	require.Len(t, repo.logs[0].ExerciseItems, 1)
	assert.Equal(t, "跑步机慢跑", repo.logs[0].ExerciseItems[0]["name"])
	assert.Equal(t, 30, repo.logs[0].ExerciseItems[0]["duration_min"])
	assert.Equal(t, 180, repo.logs[0].ExerciseItems[0]["calories_kcal"])
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
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步\",\"reasoning\":\"按跑步30分钟估算\",\"calories_kcal\":240}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}
	ctx := context.Background()

	result, err := svc.EstimateCalories(ctx, "u1", "跑步30分钟")
	require.NoError(t, err)
	assert.Equal(t, 240, result["estimated_calories"].(int))
	assert.Equal(t, "跑步30分钟", result["exercise_desc"])
	assert.NotEmpty(t, result["reasoning"])
	assert.NotNil(t, result["profile_snapshot"])
	items := result["exercise_items"].([]map[string]any)
	require.Len(t, items, 1)
	assert.Equal(t, "跑步", items[0]["name"])
	assert.Equal(t, 30, items[0]["duration_min"])
	assert.Equal(t, 240, items[0]["calories_kcal"])
}

func TestExerciseService_EstimateCaloriesDoesNotFallbackWhenLLMUnavailable(t *testing.T) {
	repo := &mockExerciseRepo{profile: &domain.ExerciseUserProfile{ID: "u1"}}
	svc := NewExerciseService(repo)

	_, err := svc.EstimateCalories(context.Background(), "u1", "跑步30分钟")

	require.Error(t, err)
	assert.Empty(t, repo.logs)
}

func TestExerciseService_ProcessExerciseTask_CreatesLogWithReasoning(t *testing.T) {
	recordedOn := time.Now().In(chinaTZ).Format("2006-01-02")
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步\",\"reasoning\":\"按跑步30分钟估算\",\"calories_kcal\":240}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}

	result, err := svc.ProcessExerciseTask(context.Background(), "u1", "跑步30分钟", "", recordedOn, map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 70.0},
	})
	require.NoError(t, err)
	assert.Equal(t, "跑步30分钟", result["exercise_log"].(map[string]any)["exercise_desc"])
	assert.NotEmpty(t, result["reasoning"])
	require.Len(t, repo.logs, 1)
	require.NotNil(t, repo.logs[0].RecordedOn)
	assert.Equal(t, recordedOn, repo.logs[0].RecordedOn.UTC().Format("2006-01-02"))
	assert.NotNil(t, repo.logs[0].AIReasoning)
	assert.Greater(t, *repo.logs[0].CaloriesBurned, 0.0)
	require.Len(t, repo.logs[0].ExerciseItems, 1)
	assert.Equal(t, "跑步", repo.logs[0].ExerciseItems[0]["name"])
	assert.Equal(t, 30, repo.logs[0].ExerciseItems[0]["duration_min"])
	assert.Equal(t, 240, repo.logs[0].ExerciseItems[0]["calories_kcal"])
}

func TestExerciseService_EstimateCalories_SplitsMultiItemDescription(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"分项运动\",\"reasoning\":\"按单项运动估算\",\"calories_kcal\":100}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})}
	desc := "慢跑30分钟；跳绳10分钟；拉伸15分钟"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Contains(t, result["reasoning"], "分项估算")
	assert.Equal(t, 300, result["estimated_calories"].(int))
	items := result["exercise_items"].([]map[string]any)
	require.Len(t, items, 3)
	assert.Equal(t, "慢跑", items[0]["name"])
	assert.Equal(t, 30, items[0]["duration_min"])
	assert.Equal(t, "跳绳", items[1]["name"])
	assert.Equal(t, 10, items[1]["duration_min"])
	assert.Equal(t, "拉伸", items[2]["name"])
	assert.Equal(t, 15, items[2]["duration_min"])
}

func TestExerciseService_EstimateCalories_LongTextUsesLibraryMET(t *testing.T) {
	repo := &mockExerciseRepo{
		profile:  &domain.ExerciseUserProfile{ID: "u1"},
		activity: &domain.ExerciseEnergyActivity{ID: "act-run", CanonicalName: "慢跑", METValue: 7.0, ReviewStatus: "active", IsActive: true},
	}
	repo.weight = &domain.BodyWeightRecord{WeightKg: 80}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"items\":[{\"name\":\"慢跑\",\"duration_min\":30,\"sets\":0,\"reps\":0,\"intensity\":\"moderate\",\"evidence\":\"慢跑30分钟\"}]}"}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := strings.Repeat("今天先做热身，然后", 20) + "慢跑30分钟，最后拉伸。"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Equal(t, 280, result["estimated_calories"].(int))
	assert.Contains(t, result["reasoning"], "分项识别")
	assert.Empty(t, repo.pending)
	items := result["exercise_items"].([]map[string]any)
	require.Len(t, items, 1)
	assert.Equal(t, "慢跑", items[0]["name"])
	assert.Equal(t, 30, int(items[0]["duration_min"].(float64)))
	assert.Equal(t, 7.0, items[0]["met"])
}

func TestExerciseService_EstimateCalories_LongTextCreatesPendingMET(t *testing.T) {
	repo := &mockExerciseRepo{profile: &domain.ExerciseUserProfile{ID: "u1"}}
	repo.weight = &domain.BodyWeightRecord{WeightKg: 70}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	callIndex := 0
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		callIndex++
		content := `{"items":[{"name":"壶铃摆动","duration_min":20,"sets":0,"reps":0,"intensity":"high","evidence":"壶铃摆动20分钟"}]}`
		if callIndex == 2 {
			content = `{"activity_name":"壶铃训练","category":"strength","intensity":"high","met":8.0,"reasoning":"壶铃摆动属于较高强度力量循环训练"}`
		}
		responseBody := `{"choices":[{"message":{"content":` + strconv.Quote(content) + `}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := strings.Repeat("训练内容比较多，包含热身和记录说明。", 12) + "壶铃摆动20分钟。"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Equal(t, 187, result["estimated_calories"].(int))
	require.Len(t, repo.pending, 1)
	assert.Equal(t, "壶铃训练", repo.pending[0].CanonicalName)
	assert.Equal(t, "pending", repo.pending[0].ReviewStatus)
	assert.Equal(t, 8.0, repo.pending[0].METValue)
	items := result["exercise_items"].([]map[string]any)
	require.Len(t, items, 1)
	assert.Equal(t, "壶铃摆动", items[0]["name"])
	assert.Equal(t, 20, int(items[0]["duration_min"].(float64)))
}

func TestExerciseService_EstimateCalories_ShortTextRun40MinutesUsesOriginalLLM(t *testing.T) {
	repo := &mockExerciseRepo{profile: &domain.ExerciseUserProfile{ID: "u1"}}
	repo.weight = &domain.BodyWeightRecord{WeightKg: 70}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{DoubaoAPIKey: "fake-key"},
	})
	callCount := 0
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		callCount++
		responseBody := `{"choices":[{"message":{"content":"{\"exercise_type\":\"跑步\",\"reasoning\":\"短文本按跑步40分钟直接估算\",\"calories_kcal\":320}"}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := "我今天跑了40分钟步"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.LessOrEqual(t, len([]rune(desc)), exerciseLongTextThresholdRunes)
	assert.Equal(t, 1, callCount)
	assert.Equal(t, 320, result["estimated_calories"].(int))
	assert.Equal(t, desc, result["exercise_desc"])
	assert.Contains(t, result["reasoning"], "跑步40分钟")
	assert.Empty(t, repo.pending)
	assert.NotContains(t, result["ai_response"].(string), "long_text_library_met")
	items := result["exercise_items"].([]map[string]any)
	require.Len(t, items, 1)
	assert.Equal(t, "跑步", items[0]["name"])
	assert.Equal(t, 40, items[0]["duration_min"])
	assert.Equal(t, 320, items[0]["calories_kcal"])
}

func TestExerciseService_EstimateCalories_LongTextUsesGemini35Config(t *testing.T) {
	repo := &mockExerciseRepo{
		profile:  &domain.ExerciseUserProfile{ID: "u1"},
		weight:   &domain.BodyWeightRecord{WeightKg: 80},
		activity: &domain.ExerciseEnergyActivity{ID: "act-run", CanonicalName: "跑步", METValue: 7.0, ReviewStatus: "active", IsActive: true},
	}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{
			Gemini35APIKey:  "fake-gemini-key",
			Gemini35BaseURL: "https://gemini-proxy.example.com/v1",
			Gemini35Model:   "gemini-3.5-flash",
		},
	})
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://gemini-proxy.example.com/v1/chat/completions", req.URL.String())
		assert.Equal(t, "Bearer fake-gemini-key", req.Header.Get("Authorization"))
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "gemini-3.5-flash", body["model"])
		assert.Equal(t, map[string]any{"type": "json_object"}, body["response_format"])
		assert.NotContains(t, body, "reasoning_effort")
		responseBody := `{"choices":[{"message":{"content":"{\"items\":[{\"name\":\"跑步\",\"duration_min\":40,\"sets\":0,\"reps\":0,\"intensity\":\"moderate\",\"evidence\":\"跑步40分钟\"}]}"}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := strings.Repeat("今天的训练记录比较完整，我先做了关节活动和动态热身，过程中注意控制呼吸和配速，", 5) + "随后跑步40分钟，结束后做了放松拉伸。"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Equal(t, 373, result["estimated_calories"].(int))
}

func TestExerciseService_EstimateCalories_LongTextEmptyGeminiFallsBackToDoubao(t *testing.T) {
	repo := &mockExerciseRepo{
		profile:  &domain.ExerciseUserProfile{ID: "u1"},
		weight:   &domain.BodyWeightRecord{WeightKg: 80},
		activity: &domain.ExerciseEnergyActivity{ID: "act-treadmill", CanonicalName: "跑步机", METValue: 8.3, ReviewStatus: "active", IsActive: true},
	}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{
			DoubaoAPIKey:    "fake-doubao-key",
			DoubaoBaseURL:   "https://doubao.example.com/api/v3",
			Gemini35APIKey:  "fake-gemini-key",
			Gemini35BaseURL: "https://gemini-proxy.example.com/v1",
			Gemini35Model:   "gemini-3.5-flash",
		},
	})
	requestURLs := make([]string, 0, 2)
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		requestURLs = append(requestURLs, req.URL.String())
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		switch len(requestURLs) {
		case 1:
			assert.Equal(t, "gemini-3.5-flash", body["model"])
			assert.Equal(t, "Bearer fake-gemini-key", req.Header.Get("Authorization"))
			responseBody := `{"choices":[{"message":{"content":""}}]}`
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
		case 2:
			assert.Equal(t, "doubao-seed-2-0-lite-260428", body["model"])
			assert.Equal(t, "Bearer fake-doubao-key", req.Header.Get("Authorization"))
			assert.NotContains(t, body, "response_format")
			content := `{"items":[{"name":"跑步机","duration_min":35,"sets":0,"reps":0,"intensity":"high","evidence":"跑步机。速度8，坡度2。跑35分钟"}]}`
			responseBody := `{"choices":[{"message":{"content":` + strconv.Quote(content) + `}}]}`
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
		default:
			t.Fatalf("unexpected request %d to %s", len(requestURLs), req.URL.String())
			return nil, nil
		}
	})}
	desc := strings.Repeat("今天训练内容很多，包含力量训练、核心和有氧。", 8) + "跑步机。速度8，坡度2。跑35分钟。"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Equal(t, []string{
		"https://gemini-proxy.example.com/v1/chat/completions",
		"https://doubao.example.com/api/v3/chat/completions",
	}, requestURLs)
	assert.Equal(t, 387, result["estimated_calories"].(int))
	assert.Contains(t, result["ai_response"].(string), "long_text_library_met")
	assert.Empty(t, repo.pending)
}

func TestExerciseService_EstimateCalories_LongTextMalformedGeminiFallsBackToDoubao(t *testing.T) {
	repo := &mockExerciseRepo{
		profile:  &domain.ExerciseUserProfile{ID: "u1"},
		weight:   &domain.BodyWeightRecord{WeightKg: 80},
		activity: &domain.ExerciseEnergyActivity{ID: "act-treadmill", CanonicalName: "跑步机", METValue: 8.3, ReviewStatus: "active", IsActive: true},
	}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{
			DoubaoAPIKey:    "fake-doubao-key",
			DoubaoBaseURL:   "https://doubao.example.com/api/v3",
			Gemini35APIKey:  "fake-gemini-key",
			Gemini35BaseURL: "https://gemini-proxy.example.com/v1",
			Gemini35Model:   "gemini-3.5-flash",
		},
	})
	callCount := 0
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		callCount++
		if callCount == 1 {
			responseBody := `{"choices":[{"message":{"content":"{\"items\":["}}]}`
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
		}
		content := `{"items":[{"name":"跑步机","duration_min":35,"sets":0,"reps":0,"intensity":"high","evidence":"跑步机。速度8，坡度2。跑35分钟"}]}`
		responseBody := `{"choices":[{"message":{"content":` + strconv.Quote(content) + `}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := strings.Repeat("今天训练内容很多，包含力量训练、核心和有氧。", 8) + "跑步机。速度8，坡度2。跑35分钟。"

	result, err := svc.EstimateCalories(context.Background(), "u1", desc)
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 387, result["estimated_calories"].(int))
	assert.Contains(t, result["ai_response"].(string), "long_text_library_met")
}

func TestParseExtractedExerciseItems_EmptyResponse(t *testing.T) {
	items, err := parseExtractedExerciseItems("")
	require.Error(t, err)
	assert.Nil(t, items)
	assert.Contains(t, err.Error(), "运动项目抽取结果为空")
}

func TestExerciseService_ProcessExerciseTask_LongStrengthCardioTextIgnoresInvalidImageURL(t *testing.T) {
	activity := func(id, name string, met float64) *domain.ExerciseEnergyActivity {
		return &domain.ExerciseEnergyActivity{ID: id, CanonicalName: name, METValue: met, ReviewStatus: "active", IsActive: true}
	}
	repo := &mockExerciseRepo{
		profile: &domain.ExerciseUserProfile{ID: "u1"},
		weight:  &domain.BodyWeightRecord{WeightKg: 80},
		activities: map[string]*domain.ExerciseEnergyActivity{
			"深蹲":   activity("act-squat", "深蹲", 5.0),
			"卧推":   activity("act-bench", "卧推", 4.5),
			"高位下拉": activity("act-pulldown", "高位下拉", 4.0),
			"坐姿划船": activity("act-row", "坐姿划船", 4.0),
			"哑铃推举": activity("act-press", "哑铃推举", 4.5),
			"弯举":   activity("act-curl", "弯举", 3.5),
			"绳索下压": activity("act-pushdown", "绳索下压", 3.5),
			"跑步机":  activity("act-treadmill", "跑步机", 8.3),
			"卷腹":   activity("act-crunch", "卷腹", 3.8),
			"平板支撑": activity("act-plank", "平板支撑", 3.0),
			"背部伸展": activity("act-back-extension", "背部伸展", 3.5),
			"拉伸":   activity("act-stretch", "拉伸", 2.3),
		},
	}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{
			Gemini35APIKey:  "fake-gemini-key",
			Gemini35BaseURL: "https://gemini-proxy.example.com/v1",
			Gemini35Model:   "gemini-3.5-flash",
		},
	})
	callCount := 0
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		callCount++
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "gemini-3.5-flash", body["model"])
		assert.NotContains(t, body, "reasoning_effort")
		content := `{"items":[
			{"name":"深蹲","duration_min":12,"sets":4,"reps":8,"intensity":"high","evidence":"深蹲架加杠铃片至40公斤。4组8次"},
			{"name":"卧推","duration_min":12,"sets":4,"reps":10,"intensity":"high","evidence":"卧推架躺下。4组10次"},
			{"name":"高位下拉","duration_min":12,"sets":4,"reps":12,"intensity":"moderate","evidence":"龙门架高位下拉。4组12次"},
			{"name":"坐姿划船","duration_min":12,"sets":4,"reps":12,"intensity":"moderate","evidence":"坐姿划船。4组12次"},
			{"name":"哑铃推举","duration_min":12,"sets":4,"reps":10,"intensity":"high","evidence":"哑铃推举。15公斤一对。4组10次"},
			{"name":"弯举","duration_min":9,"sets":3,"reps":12,"intensity":"moderate","evidence":"弯举架。3组12次"},
			{"name":"绳索下压","duration_min":9,"sets":3,"reps":12,"intensity":"moderate","evidence":"绳索下压。3组12次"},
			{"name":"跑步机","duration_min":35,"sets":0,"reps":0,"intensity":"high","evidence":"跑步机。速度8，坡度2。跑35分钟"},
			{"name":"卷腹","duration_min":12,"sets":3,"reps":20,"intensity":"moderate","evidence":"垫上卷腹。3组20次"},
			{"name":"平板支撑","duration_min":3,"sets":3,"reps":0,"intensity":"moderate","evidence":"平板支撑。3组60秒"},
			{"name":"背部伸展","duration_min":12,"sets":3,"reps":15,"intensity":"moderate","evidence":"背部伸展。3组15次"},
			{"name":"拉伸","duration_min":2,"sets":0,"reps":0,"intensity":"low","evidence":"拉伸股四头肌、腘绳肌、胸大肌、背阔肌。各30秒"}
		]}`
		responseBody := `{"choices":[{"message":{"content":` + strconv.Quote(content) + `}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := `08:15刷卡进馆。换衣。戴心率带。深蹲架加杠铃片至40公斤。起杠。下蹲至大腿低于水平。站起。4组8次。组歇90秒。

卧推架躺下。杠铃下放触胸。推起。4组10次。组歇60秒。

龙门架高位下拉。把手拉至锁骨。上放至手臂伸直。4组12次。

坐姿划船。把手拉至腹部。肩胛夹紧。4组12次。

哑铃推举。15公斤一对。推至头顶。下放至耳侧。4组10次。

弯举架。反握。弯举至肩高。下放伸直。3组12次。

绳索下压。直杆压至大腿前。上放至肘关节90度。3组12次。

跑步机。速度8，坡度2。跑35分钟。心率140至155。距离4.6公里。

垫上卷腹。3组20次。平板支撑。3组60秒。背部伸展。3组15次。

拉伸股四头肌、腘绳肌、胸大肌、背阔肌。各30秒。`

	result, err := svc.ProcessExerciseTask(context.Background(), "u1", desc, "undefined", "2026-06-18", map[string]any{
		"profile_snapshot": map[string]any{"weight_kg": 80.0},
	})
	require.NoError(t, err)
	assert.Equal(t, 0, callCount)
	assert.Equal(t, 958, result["estimated_calories"].(int))
	assert.Contains(t, result["ai_response"].(string), "long_text_library_met")
	assert.Contains(t, result["ai_response"].(string), "local_exercise_text_parser")
	assert.Contains(t, result["reasoning"], "分项识别")
	require.Len(t, repo.logs, 1)
	assert.Nil(t, repo.logs[0].ImageURL)
	assert.Empty(t, repo.pending)
	require.NotEmpty(t, repo.logs[0].ExerciseItems)
	assert.Equal(t, "深蹲", repo.logs[0].ExerciseItems[0]["name"])
}

func TestExerciseService_EstimateSingleLongTextItemsResponseFallsBackToLongTextFlow(t *testing.T) {
	repo := &mockExerciseRepo{
		profile:  &domain.ExerciseUserProfile{ID: "u1"},
		weight:   &domain.BodyWeightRecord{WeightKg: 80},
		activity: &domain.ExerciseEnergyActivity{ID: "act-treadmill", CanonicalName: "跑步机", METValue: 8.3, ReviewStatus: "active", IsActive: true},
	}
	svc := NewExerciseService(repo, &config.Config{
		External: config.ExternalConfig{
			DoubaoAPIKey:    "fake-doubao-key",
			Gemini35APIKey:  "fake-gemini-key",
			Gemini35BaseURL: "https://gemini-proxy.example.com/v1",
			Gemini35Model:   "gemini-3.5-flash",
		},
	})
	callCount := 0
	svc.client = &http.Client{Transport: exerciseRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		callCount++
		content := `{"items":[{"name":"跑步机","duration_min":35,"sets":0,"reps":0,"intensity":"high","evidence":"跑步机。速度8，坡度2。跑35分钟"}]}`
		responseBody := `{"choices":[{"message":{"content":` + strconv.Quote(content) + `}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(responseBody)), Header: make(http.Header)}, nil
	})}
	desc := strings.Repeat("今天训练内容很多，包含力量训练、核心和有氧。", 8) + "跑步机。速度8，坡度2。跑35分钟。"

	result, err := svc.estimateExerciseCaloriesWithLLM(context.Background(), desc, "", map[string]any{"weight_kg": 80.0})
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 387, result.CaloriesKcal)
	assert.Equal(t, "long_text_library_met", result.Source)
	assert.Contains(t, result.Raw, "long_text_library_met")
}

func TestExerciseService_DeleteLog(t *testing.T) {
	repo := &mockExerciseRepo{}
	svc := NewExerciseService(repo)
	ctx := context.Background()

	err := svc.DeleteLog(ctx, "u1", "log-1")
	require.NoError(t, err)
	assert.Equal(t, "log-1", repo.deletedID)
}
