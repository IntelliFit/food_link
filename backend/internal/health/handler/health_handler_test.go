package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockBodyMetricsSvc struct {
	summary    *service.BodyMetricsSummary
	syncResult map[string]any
	err        error
}

func (m *mockBodyMetricsSvc) GetSummary(ctx context.Context, userID string, statsRange string) (*service.BodyMetricsSummary, error) {
	return m.summary, m.err
}

func (m *mockBodyMetricsSvc) SyncLocal(ctx context.Context, userID string, input service.SyncLocalInput) (map[string]any, error) {
	return m.syncResult, m.err
}

func (m *mockBodyMetricsSvc) AddWaterLog(ctx context.Context, userID string, amountMl int, recordedOn string) (map[string]any, error) {
	return map[string]any{"message": "喝水已记录"}, m.err
}

func (m *mockBodyMetricsSvc) ResetWaterLogs(ctx context.Context, userID string, recordedOn string) (map[string]any, error) {
	return map[string]any{"message": "已清空"}, m.err
}

func (m *mockBodyMetricsSvc) SaveWeightRecord(ctx context.Context, userID string, weightKg float64, recordedOn string) (map[string]any, error) {
	return map[string]any{"message": "体重已保存"}, m.err
}

type mockExerciseSvc struct {
	logs            map[string]any
	createResult    map[string]any
	estimateResult  map[string]any
	dailyCalories   map[string]any
	deleteErr       error
	err             error
}

func (m *mockExerciseSvc) GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error) {
	return m.dailyCalories, m.err
}

func (m *mockExerciseSvc) ListLogs(ctx context.Context, userID string, date string) (map[string]any, error) {
	return m.logs, m.err
}

func (m *mockExerciseSvc) CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	return m.createResult, m.err
}

func (m *mockExerciseSvc) EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	return m.estimateResult, m.err
}

func (m *mockExerciseSvc) DeleteLog(ctx context.Context, userID, logID string) error {
	return m.deleteErr
}

type mockStatsSvc struct {
	summary        *service.StatsSummary
	insightResult  map[string]any
	saveErr        error
	err            error
}

func (m *mockStatsSvc) GetSummary(ctx context.Context, userID string, statsRange string, tdee int, streakDays int) (*service.StatsSummary, error) {
	return m.summary, m.err
}

func (m *mockStatsSvc) GenerateInsight(ctx context.Context, userID string, dateRange string, tdee int, streakDays int) (map[string]any, error) {
	return m.insightResult, m.err
}

func (m *mockStatsSvc) SaveInsight(ctx context.Context, userID string, content string, dateRange string) error {
	return m.saveErr
}

func setupHealthRouter(h *HealthHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/body-metrics/summary", h.GetBodyMetricsSummary)
	r.POST("/api/body-metrics/sync-local", h.SyncLocalBodyMetrics)
	r.POST("/api/body-metrics/water", h.SaveBodyWaterLog)
	r.POST("/api/body-metrics/water/reset", h.ResetBodyWaterLogs)
	r.POST("/api/body-metrics/weight", h.SaveBodyWeightRecord)
	r.GET("/api/stats/summary", h.GetStatsSummary)
	r.POST("/api/stats/insight/generate", h.GenerateStatsInsight)
	r.POST("/api/stats/insight/save", h.SaveStatsInsight)
	r.GET("/api/exercise-calories/daily", h.GetExerciseCaloriesDaily)
	r.GET("/api/exercise-logs", h.GetExerciseLogs)
	r.POST("/api/exercise-logs", h.CreateExerciseLog)
	r.POST("/api/exercise-logs/estimate-calories", h.EstimateExerciseCalories)
	r.DELETE("/api/exercise-logs/:log_id", h.DeleteExerciseLog)
	return r
}

func TestGetBodyMetricsSummary(t *testing.T) {
	change := -0.5
	mockSvc := &mockBodyMetricsSvc{
		summary: &service.BodyMetricsSummary{
			WeightEntries:    []service.WeightEntry{{Date: "2024-06-15", Value: 70.0}},
			LatestWeight:     &service.WeightEntry{Date: "2024-06-15", Value: 70.0},
			PreviousWeight:   &service.WeightEntry{Date: "2024-06-14", Value: 70.5},
			WeightChange:     &change,
			WaterGoalMl:      2000,
			TodayWater:       service.WaterDaily{Date: "2024-06-15", Total: 500},
			TotalWaterMl:     500,
			AvgDailyWaterMl:  500.0,
			WaterRecordedDays: 1,
		},
	}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/body-metrics/summary?range=week", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestSyncLocalBodyMetrics(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{
		syncResult: map[string]any{
			"message":               "本地身体指标已同步",
			"imported_weight_count": 1,
			"imported_water_count":  2,
		},
	}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{
		"weight_entries": []map[string]any{{"date": "2024-06-15", "value": 70.5, "client_id": "w1"}},
		"water_by_date":  map[string]any{"2024-06-15": map[string]any{"total": 500, "logs": []int{250, 250}}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/sync-local", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveBodyWaterLog(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"amount_ml": 300, "recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestResetBodyWaterLogs(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water/reset", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveBodyWeightRecord(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"weight_kg": 72.5, "recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/weight", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetStatsSummary(t *testing.T) {
	mockSvc := &mockStatsSvc{
		summary: &service.StatsSummary{
			Range:             "week",
			TotalCalories:     3500,
			AvgCaloriesPerDay: 500,
			StreakDays:        7,
		},
	}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/stats/summary?range=week", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGenerateStatsInsight(t *testing.T) {
	mockSvc := &mockStatsSvc{
		insightResult: map[string]any{"analysis_summary": "Test insight"},
	}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"date_range": "week"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/stats/insight/generate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveStatsInsight(t *testing.T) {
	mockSvc := &mockStatsSvc{}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"content": "Test insight", "date_range": "week"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/stats/insight/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetExerciseCaloriesDaily(t *testing.T) {
	mockSvc := &mockExerciseSvc{
		dailyCalories: map[string]any{"date": "2024-06-15", "total_calories_burned": 300},
	}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/exercise-calories/daily?date=2024-06-15", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetExerciseLogs(t *testing.T) {
	mockSvc := &mockExerciseSvc{
		logs: map[string]any{"logs": []any{}, "total_calories": 0, "count": 0},
	}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/exercise-logs?date=2024-06-15", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCreateExerciseLog(t *testing.T) {
	mockSvc := &mockExerciseSvc{
		createResult: map[string]any{"task_id": "task-1", "message": "运动分析任务已提交"},
	}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"exercise_desc": "跑步30分钟"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestEstimateExerciseCalories(t *testing.T) {
	mockSvc := &mockExerciseSvc{
		estimateResult: map[string]any{"estimated_calories": 150, "exercise_desc": "走路20分钟"},
	}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"exercise_desc": "走路20分钟"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs/estimate-calories", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDeleteExerciseLog(t *testing.T) {
	mockSvc := &mockExerciseSvc{}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/exercise-logs/log-1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDeleteExerciseLogNotFound(t *testing.T) {
	mockSvc := &mockExerciseSvc{deleteErr: commonerrors.ErrNotFound}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/exercise-logs/log-1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetStatsSummaryError(t *testing.T) {
	mockSvc := &mockStatsSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/stats/summary", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}


func TestSyncLocalBodyMetricsBindError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/sync-local", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSyncLocalBodyMetricsError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{err: errors.New("db error")}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{
		"weight_entries": []map[string]any{{"date": "2024-06-15", "value": 70.5, "client_id": "w1"}},
		"water_by_date":  map[string]any{"2024-06-15": map[string]any{"total": 500, "logs": []int{250, 250}}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/sync-local", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSaveBodyWaterLogBindError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSaveBodyWaterLogError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{err: errors.New("db error")}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"amount_ml": 300, "recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestResetBodyWaterLogsBindError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water/reset", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResetBodyWaterLogsError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{err: errors.New("db error")}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/water/reset", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSaveBodyWeightRecordBindError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/weight", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSaveBodyWeightRecordError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{err: errors.New("db error")}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"weight_kg": 72.5, "recorded_on": "2024-06-15"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/body-metrics/weight", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetStatsSummaryWithMonthRange(t *testing.T) {
	mockSvc := &mockStatsSvc{
		summary: &service.StatsSummary{
			Range:             "month",
			TotalCalories:     3500,
			AvgCaloriesPerDay: 500,
			StreakDays:        7,
		},
	}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/stats/summary?range=month", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetStatsSummaryWithInvalidRange(t *testing.T) {
	mockSvc := &mockStatsSvc{
		summary: &service.StatsSummary{
			Range:             "week",
			TotalCalories:     3500,
			AvgCaloriesPerDay: 500,
		},
	}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/stats/summary?range=invalid", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "week", data["range"])
}
func TestGenerateStatsInsightError(t *testing.T) {
	mockSvc := &mockStatsSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"date_range": "week"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/stats/insight/generate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSaveStatsInsightBindError(t *testing.T) {
	mockSvc := &mockStatsSvc{}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/stats/insight/save", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSaveStatsInsightError(t *testing.T) {
	mockSvc := &mockStatsSvc{saveErr: errors.New("db error")}
	h := NewHealthHandler(nil, nil, mockSvc)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"content": "Test insight", "date_range": "week"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/stats/insight/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetExerciseCaloriesDailyError(t *testing.T) {
	mockSvc := &mockExerciseSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/exercise-calories/daily?date=2024-06-15", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetExerciseLogsError(t *testing.T) {
	mockSvc := &mockExerciseSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/exercise-logs?date=2024-06-15", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateExerciseLogBindError(t *testing.T) {
	mockSvc := &mockExerciseSvc{}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateExerciseLogError(t *testing.T) {
	mockSvc := &mockExerciseSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"exercise_desc": "跑步30分钟"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestEstimateExerciseCaloriesBindError(t *testing.T) {
	mockSvc := &mockExerciseSvc{}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs/estimate-calories", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestEstimateExerciseCaloriesError(t *testing.T) {
	mockSvc := &mockExerciseSvc{err: errors.New("db error")}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	body, _ := json.Marshal(map[string]any{"exercise_desc": "走路20分钟"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/exercise-logs/estimate-calories", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestDeleteExerciseLogError(t *testing.T) {
	mockSvc := &mockExerciseSvc{deleteErr: errors.New("db error")}
	h := NewHealthHandler(nil, mockSvc, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/exercise-logs/log-1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetBodyMetricsSummaryError(t *testing.T) {
	mockSvc := &mockBodyMetricsSvc{err: errors.New("db error")}
	h := NewHealthHandler(mockSvc, nil, nil)
	r := setupHealthRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/body-metrics/summary", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
