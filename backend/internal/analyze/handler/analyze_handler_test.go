package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockAnalyzeService struct {
	analyzeResult          map[string]any
	analyzeErr             error
	analyzeTextResult      map[string]any
	analyzeTextErr         error
	analyzeCompareResult   map[string]any
	analyzeCompareErr      error
	analyzeEnginesResult   map[string]any
	analyzeEnginesErr      error
	analyzeBatchResult     map[string]any
	analyzeBatchErr        error
	gooseDuckChickenResult service.GooseDuckChickenResult
	gooseDuckChickenErr    error
}

func (m *mockAnalyzeService) Analyze(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeResult, m.analyzeErr
}
func (m *mockAnalyzeService) AnalyzeText(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeTextResult, m.analyzeTextErr
}
func (m *mockAnalyzeService) AnalyzeCompare(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeCompareResult, m.analyzeCompareErr
}
func (m *mockAnalyzeService) AnalyzeCompareEngines(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeEnginesResult, m.analyzeEnginesErr
}
func (m *mockAnalyzeService) AnalyzeBatch(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeBatchResult, m.analyzeBatchErr
}
func (m *mockAnalyzeService) ClassifyGooseDuckChicken(ctx context.Context, userID string, input service.GooseDuckChickenInput) (service.GooseDuckChickenResult, error) {
	return m.gooseDuckChickenResult, m.gooseDuckChickenErr
}

type mockTaskService struct {
	submitTaskID    string
	submitErr       error
	batchTaskID     string
	batchTaskErr    error
	tasks           []domain.AnalysisTask
	listErr         error
	count           int64
	countErr        error
	statusCounts    map[string]any
	statusCountErr  error
	task            *domain.AnalysisTask
	getErr          error
	updateErr       error
	retryResult     *service.RetryTaskResult
	retryErr        error
	retryTaskID     string
	deleteResult    map[string]any
	deleteErr       error
	cleanupAffected int64
	cleanupErr      error
}

type mockPaginatedTaskService struct {
	*mockTaskService
	page    service.TaskListPage
	pageErr error
}

type mockSummaryPaginatedTaskService struct {
	*mockPaginatedTaskService
	summaryPage   service.TaskSummaryListPage
	summaryErr    error
	summaryCalled bool
}

func (m *mockTaskService) SubmitAnalyzeTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error) {
	return m.submitTaskID, m.submitErr
}
func (m *mockTaskService) SubmitTextTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error) {
	return m.submitTaskID, m.submitErr
}
func (m *mockTaskService) CreateBatchTask(ctx context.Context, userID string, imageURLs []string, payload map[string]any, result map[string]any) (string, error) {
	return m.batchTaskID, m.batchTaskErr
}
func (m *mockTaskService) ListTasks(ctx context.Context, userID, taskType, status, search string, limit int) ([]domain.AnalysisTask, error) {
	return m.tasks, m.listErr
}
func (m *mockPaginatedTaskService) ListTasksPage(ctx context.Context, userID, taskType, status, search string, limit, offset int) (service.TaskListPage, error) {
	return m.page, m.pageErr
}
func (m *mockSummaryPaginatedTaskService) ListTaskSummariesPage(ctx context.Context, userID, status, search string, limit, offset int) (service.TaskSummaryListPage, error) {
	m.summaryCalled = true
	return m.summaryPage, m.summaryErr
}
func (m *mockTaskService) CountTasks(ctx context.Context, userID string) (int64, error) {
	return m.count, m.countErr
}
func (m *mockTaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]any, error) {
	return m.statusCounts, m.statusCountErr
}
func (m *mockTaskService) GetTask(ctx context.Context, taskID, userID string) (*domain.AnalysisTask, error) {
	return m.task, m.getErr
}
func (m *mockTaskService) UpdateTaskResult(ctx context.Context, taskID, userID string, result map[string]any) error {
	return m.updateErr
}
func (m *mockTaskService) RetryTask(ctx context.Context, taskID, userID string) (*service.RetryTaskResult, error) {
	m.retryTaskID = taskID
	return m.retryResult, m.retryErr
}
func (m *mockTaskService) DeleteTask(ctx context.Context, taskID, userID string) (map[string]any, error) {
	return m.deleteResult, m.deleteErr
}
func (m *mockTaskService) CleanupTimeoutTasks(ctx context.Context, timeoutMinutes int, adminKey, expectedAdminKey string) (int64, error) {
	return m.cleanupAffected, m.cleanupErr
}

func (m *mockTaskService) SubmitFeedback(ctx context.Context, userID string, input service.SubmitFeedbackInput) error {
	return nil
}

func setupRouter(h *AnalyzeHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.POST("/api/analyze", h.Analyze)
	r.POST("/api/analyze-text", h.AnalyzeText)
	r.POST("/api/analyze-compare", h.AnalyzeCompare)
	r.POST("/api/analyze-compare-engines", h.AnalyzeCompareEngines)
	r.POST("/api/analyze/batch", h.AnalyzeBatch)
	r.POST("/api/analyze/goose-duck-chicken", h.ClassifyGooseDuckChicken)
	r.POST("/api/analyze/submit", h.SubmitAnalyzeTask)
	r.POST("/api/analyze-text/submit", h.SubmitTextTask)
	r.GET("/api/analyze/tasks", h.ListTasks)
	r.GET("/api/analyze/tasks/count", h.CountTasks)
	r.GET("/api/analyze/tasks/status-count", h.CountTasksByStatus)
	r.POST("/api/analyze/tasks/retry", h.RetryTask)
	r.GET("/api/analyze/tasks/:task_id", h.GetTask)
	r.PATCH("/api/analyze/tasks/:task_id/result", h.UpdateTaskResult)
	r.DELETE("/api/analyze/tasks/:task_id", h.DeleteTask)
	r.POST("/api/analyze/tasks/cleanup-timeout", h.CleanupTimeoutTasks)
	return r
}

func TestAnalyzeHandler_ClassifyGooseDuckChicken(t *testing.T) {
	mockSvc := &mockAnalyzeService{gooseDuckChickenResult: service.GooseDuckChickenResult{
		Species:    "duck",
		Label:      "鸭腿",
		Confidence: 0.88,
		Reason:     "皮色和形态更像鸭腿",
	}}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/duck.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/goose-duck-chicken", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "duck", data["species"])
	assert.Equal(t, "鸭腿", data["label"])
	assert.NotContains(t, data, "task_id")
}

func TestAnalyzeHandler_Analyze(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeResult: map[string]any{"description": "test"}}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]any)
	assert.Equal(t, "test", data["description"])
}

func TestAnalyzeHandler_AnalyzeText(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeTextResult: map[string]any{"description": "text analysis"}}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"text": "I ate an apple"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "text analysis", data["description"])
}

func TestAnalyzeHandler_AnalyzeCompare(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeCompareResult: map[string]any{"doubao_result": map[string]any{"success": true}}}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareEngines(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeEnginesResult: map[string]any{"legacy_result": map[string]any{"success": true}}}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare-engines", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAnalyzeHandler_AnalyzeBatch(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeBatchResult: map[string]any{"description": "batch result"}}
	mockTask := &mockTaskService{batchTaskID: "batch-task-123"}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_urls": []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "batch-task-123", data["task_id"])
	assert.Equal(t, float64(2), data["image_count"])
}

func TestAnalyzeHandler_SubmitAnalyzeTask(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{submitTaskID: "task-123"}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "task-123", data["task_id"])
}

func TestAnalyzeHandler_SubmitTextTask(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{submitTaskID: "task-456"}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"text_input": "I ate rice"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "task-456", data["task_id"])
}

func TestAnalyzeHandler_ListTasks(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{tasks: []domain.AnalysisTask{{UserID: "test-user-id", TaskType: "food"}}}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	tasks := data["tasks"].([]any)
	assert.Len(t, tasks, 1)
}

func TestAnalyzeHandler_ListTasksSummary(t *testing.T) {
	largeValue := strings.Repeat("x", 64*1024)
	textInput := strings.Repeat("番茄炒蛋和米饭 ", 20)
	imageURL := "https://example.com/food.jpg"
	page := service.TaskListPage{
		Tasks: []domain.AnalysisTask{{
			ID:         "task-summary-1",
			UserID:     "test-user-id",
			TaskType:   "food_text",
			Status:     "done",
			ImageURL:   &imageURL,
			TextInput:  &textInput,
			IsRecorded: false,
			Payload: map[string]any{
				"execution_mode": "strict",
				"source_type":    "text",
				"meal_type":      "lunch",
				"recorded_on":    "2026-08-12",
				"large_value":    largeValue,
			},
			Result: map[string]any{
				"items": []any{
					map[string]any{"name": "番茄炒蛋", "nutrients": map[string]any{"calories": 120.0}},
					map[string]any{"name": "米饭", "nutrients": map[string]any{"calories": 90.0}},
				},
				"recognitionOutcome": "soft_reject",
				"large_value":        largeValue,
			},
		}},
		HasMore:    true,
		NextOffset: 27,
	}
	mockTask := &mockPaginatedTaskService{
		mockTaskService: &mockTaskService{},
		page:            page,
	}
	h := NewAnalyzeHandler(&mockAnalyzeService{}, mockTask, "admin-key")
	r := setupRouter(h)

	fullRecorder := httptest.NewRecorder()
	fullRequest, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks?limit=20&offset=7", nil)
	r.ServeHTTP(fullRecorder, fullRequest)
	require.Equal(t, http.StatusOK, fullRecorder.Code)

	summaryRecorder := httptest.NewRecorder()
	summaryRequest, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks?summary=1&limit=20&offset=7", nil)
	r.ServeHTTP(summaryRecorder, summaryRequest)
	require.Equal(t, http.StatusOK, summaryRecorder.Code)

	var fullResponse map[string]any
	require.NoError(t, json.Unmarshal(fullRecorder.Body.Bytes(), &fullResponse))
	fullData := fullResponse["data"].(map[string]any)
	fullTask := fullData["tasks"].([]any)[0].(map[string]any)
	assert.Contains(t, fullTask, "payload")
	assert.Contains(t, fullTask, "result")

	var summaryResponse map[string]any
	require.NoError(t, json.Unmarshal(summaryRecorder.Body.Bytes(), &summaryResponse))
	summaryData := summaryResponse["data"].(map[string]any)
	summaryTask := summaryData["tasks"].([]any)[0].(map[string]any)
	assert.NotContains(t, summaryTask, "payload")
	assert.NotContains(t, summaryTask, "result")
	assert.NotContains(t, summaryTask, "user_id")
	assert.Equal(t, true, summaryData["has_more"])
	assert.Equal(t, float64(27), summaryData["next_offset"])
	assert.Equal(t, "strict", summaryTask["execution_mode"])
	assert.Equal(t, "text", summaryTask["source_type"])
	assert.Equal(t, "2026-08-12", summaryTask["recorded_on"])
	resultSummary := summaryTask["result_summary"].(map[string]any)
	assert.Equal(t, "番茄炒蛋", resultSummary["first_item_name"])
	assert.Equal(t, float64(2), resultSummary["item_count"])
	assert.Equal(t, 210.0, resultSummary["total_calories"])
	t.Logf("full response bytes=%d, summary response bytes=%d", fullRecorder.Body.Len(), summaryRecorder.Body.Len())
	assert.Less(t, summaryRecorder.Body.Len(), fullRecorder.Body.Len()/10)
}

func TestAnalyzeHandler_ListTasksSummaryUsesProjectedService(t *testing.T) {
	mockTask := &mockSummaryPaginatedTaskService{
		mockPaginatedTaskService: &mockPaginatedTaskService{
			mockTaskService: &mockTaskService{},
			pageErr:         errors.New("full page path must not run"),
		},
		summaryPage: service.TaskSummaryListPage{
			Tasks:      []service.TaskSummary{{ID: "summary-only", TaskType: "food", Status: "done", HasResult: true}},
			HasMore:    true,
			NextOffset: 21,
		},
	}
	h := NewAnalyzeHandler(&mockAnalyzeService{}, mockTask, "admin-key")
	r := setupRouter(h)
	recorder := httptest.NewRecorder()
	request, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks?summary=1&limit=20", nil)
	r.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, mockTask.summaryCalled)
	assert.Contains(t, recorder.Body.String(), "summary-only")
}

func TestAnalyzeHandler_CountTasks(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{count: 42}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/count", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(42), data["count"])
}

func TestAnalyzeHandler_CountTasksByStatus(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{statusCounts: map[string]any{"pending": int64(2), "done": int64(10)}}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/status-count", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(2), data["pending"])
	assert.Equal(t, float64(10), data["done"])
}

func TestAnalyzeHandler_GetTask(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{task: &domain.AnalysisTask{ID: "t1", UserID: "test-user-id", Status: "done"}}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/t1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "t1", data["id"])
}

func TestAnalyzeHandler_RetryTask(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{retryResult: &service.RetryTaskResult{TaskID: "retry-1", Message: "已重新提交识别任务", SourceTaskID: "t1"}}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"task_id": "t1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/tasks/retry", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "t1", mockTask.retryTaskID)
	assert.Contains(t, w.Body.String(), "retry-1")
}

func TestAnalyzeHandler_UpdateTaskResult(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"result": map[string]any{"description": "updated"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPatch, "/api/analyze/tasks/t1/result", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["success"])
}

func TestAnalyzeHandler_DeleteTask(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{deleteResult: map[string]any{"deleted": true}}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/analyze/tasks/t1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["deleted"])
}

func TestAnalyzeHandler_CleanupTimeoutTasks(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{cleanupAffected: 3}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/tasks/cleanup-timeout?admin_key=admin-key&timeout_minutes=5", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(3), data["affected"])
}

func TestAnalyzeHandler_CleanupTimeoutTasks_Forbidden(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{cleanupErr: errors.New("forbidden")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/tasks/cleanup-timeout?admin_key=wrong-key", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeEmptyImage(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeErr: errors.New("analyze error")}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeTextBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeTextEmpty(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeTextError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeTextErr: errors.New("analyze error")}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"text": "I ate an apple"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareEmptyImage(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeCompareErr: errors.New("compare error")}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareEnginesBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare-engines", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareEnginesEmptyImage(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare-engines", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeCompareEnginesError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeEnginesErr: errors.New("engines error")}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare-engines", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeBatchBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeBatchEmptyImages(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_AnalyzeBatchError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeBatchErr: errors.New("batch error")}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_urls": []string{"https://example.com/1.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_AnalyzeBatchCreateTaskError(t *testing.T) {
	mockSvc := &mockAnalyzeService{analyzeBatchResult: map[string]any{"description": "batch result"}}
	mockTask := &mockTaskService{batchTaskErr: errors.New("task error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_urls": []string{"https://example.com/1.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_SubmitAnalyzeTaskBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/submit", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_SubmitAnalyzeTaskEmptyImage(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_SubmitAnalyzeTaskError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{submitErr: errors.New("submit error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_SubmitTextTaskBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text/submit", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_SubmitTextTaskEmptyText(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"model_name": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_SubmitTextTaskError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{submitErr: errors.New("submit error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"text_input": "I ate rice"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-text/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_ListTasksError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{listErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_CountTasksError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{countErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/count", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_CountTasksByStatusError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{statusCountErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/status-count", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_GetTaskError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{getErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/analyze/tasks/t1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_UpdateTaskResultBindError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPatch, "/api/analyze/tasks/t1/result", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeHandler_UpdateTaskResultError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{updateErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"result": map[string]any{"description": "updated"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPatch, "/api/analyze/tasks/t1/result", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_DeleteTaskError(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{deleteErr: errors.New("db error")}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/analyze/tasks/t1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeHandler_CleanupTimeoutTasksDefaultTimeout(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	mockTask := &mockTaskService{cleanupAffected: 3}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/tasks/cleanup-timeout?admin_key=admin-key", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(3), data["affected"])
}
