package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockAnalyzeService struct {
	analyzeResult         map[string]any
	analyzeErr            error
	analyzeTextResult     map[string]any
	analyzeTextErr        error
	analyzeCompareResult  map[string]any
	analyzeCompareErr     error
	analyzeEnginesResult  map[string]any
	analyzeEnginesErr     error
	analyzeBatchResult    map[string]any
	analyzeBatchErr       error
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

type mockTaskService struct {
	submitTaskID   string
	submitErr      error
	batchTaskID    string
	batchTaskErr   error
	tasks          []domain.AnalysisTask
	listErr        error
	count          int64
	countErr       error
	statusCounts   map[string]int64
	statusCountErr error
	task           *domain.AnalysisTask
	getErr         error
	updateErr      error
	deleteResult   map[string]any
	deleteErr      error
	cleanupAffected int64
	cleanupErr      error
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
func (m *mockTaskService) ListTasks(ctx context.Context, userID, taskType, status string, limit int) ([]domain.AnalysisTask, error) {
	return m.tasks, m.listErr
}
func (m *mockTaskService) CountTasks(ctx context.Context, userID string) (int64, error) {
	return m.count, m.countErr
}
func (m *mockTaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]int64, error) {
	return m.statusCounts, m.statusCountErr
}
func (m *mockTaskService) GetTask(ctx context.Context, taskID, userID string) (*domain.AnalysisTask, error) {
	return m.task, m.getErr
}
func (m *mockTaskService) UpdateTaskResult(ctx context.Context, taskID, userID string, result map[string]any) error {
	return m.updateErr
}
func (m *mockTaskService) DeleteTask(ctx context.Context, taskID, userID string) (map[string]any, error) {
	return m.deleteResult, m.deleteErr
}
func (m *mockTaskService) CleanupTimeoutTasks(ctx context.Context, timeoutMinutes int, adminKey, expectedAdminKey string) (int64, error) {
	return m.cleanupAffected, m.cleanupErr
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
	r.POST("/api/analyze/submit", h.SubmitAnalyzeTask)
	r.POST("/api/analyze-text/submit", h.SubmitTextTask)
	r.GET("/api/analyze/tasks", h.ListTasks)
	r.GET("/api/analyze/tasks/count", h.CountTasks)
	r.GET("/api/analyze/tasks/status-count", h.CountTasksByStatus)
	r.GET("/api/analyze/tasks/:task_id", h.GetTask)
	r.PATCH("/api/analyze/tasks/:task_id/result", h.UpdateTaskResult)
	r.DELETE("/api/analyze/tasks/:task_id", h.DeleteTask)
	r.POST("/api/analyze/tasks/cleanup-timeout", h.CleanupTimeoutTasks)
	return r
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
	mockSvc := &mockAnalyzeService{analyzeCompareResult: map[string]any{"qwen_result": map[string]any{"success": true}}}
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
	mockTask := &mockTaskService{statusCounts: map[string]int64{"pending": 2, "done": 10}}
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
	assert.Equal(t, "t1", data["ID"])
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
