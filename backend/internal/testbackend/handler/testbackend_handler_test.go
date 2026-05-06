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
	"food_link/backend/internal/testbackend/domain"
	"food_link/backend/internal/testbackend/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockTestBackendService struct {
	listPrompts        []domain.Prompt
	listPromptsErr     error
	createPrompt       *domain.Prompt
	createPromptErr    error
	getPrompt          *domain.Prompt
	getPromptErr       error
	getActivePrompt    *domain.Prompt
	getActivePromptErr error
	updatePrompt       *domain.Prompt
	updatePromptErr    error
	deletePromptErr    error
	activatePrompt     *domain.Prompt
	activatePromptErr  error
	getPromptHistory   []domain.PromptHistory
	getPromptHistoryErr error
	analyzeResult      map[string]any
	analyzeErr         error
	prepareBatch       *domain.TestBatch
	prepareBatchErr    error
	startBatch         *domain.TestBatch
	startBatchErr      error
	getBatch           *domain.TestBatch
	getBatchErr        error
	listDatasets       []domain.TestDataset
	listDatasetsErr    error
	importDataset      *domain.TestDataset
	importDatasetErr   error
	prepareDataset     *domain.TestDataset
	prepareDatasetErr  error
	loginErr           error
	logoutErr          error
	legacyBatch        map[string]any
	legacyBatchErr     error
	legacySingle       map[string]any
	legacySingleErr    error
}

func (m *mockTestBackendService) ListPrompts(ctx context.Context) ([]domain.Prompt, error) {
	return m.listPrompts, m.listPromptsErr
}
func (m *mockTestBackendService) CreatePrompt(ctx context.Context, input service.CreatePromptInput) (*domain.Prompt, error) {
	return m.createPrompt, m.createPromptErr
}
func (m *mockTestBackendService) GetPrompt(ctx context.Context, id string) (*domain.Prompt, error) {
	return m.getPrompt, m.getPromptErr
}
func (m *mockTestBackendService) GetActivePrompt(ctx context.Context, modelType string) (*domain.Prompt, error) {
	return m.getActivePrompt, m.getActivePromptErr
}
func (m *mockTestBackendService) UpdatePrompt(ctx context.Context, id string, input service.UpdatePromptInput) (*domain.Prompt, error) {
	return m.updatePrompt, m.updatePromptErr
}
func (m *mockTestBackendService) DeletePrompt(ctx context.Context, id string) error {
	return m.deletePromptErr
}
func (m *mockTestBackendService) ActivatePrompt(ctx context.Context, id string) (*domain.Prompt, error) {
	return m.activatePrompt, m.activatePromptErr
}
func (m *mockTestBackendService) GetPromptHistory(ctx context.Context, id string) ([]domain.PromptHistory, error) {
	return m.getPromptHistory, m.getPromptHistoryErr
}
func (m *mockTestBackendService) Analyze(ctx context.Context, input service.AnalyzeInput) (map[string]any, error) {
	return m.analyzeResult, m.analyzeErr
}
func (m *mockTestBackendService) PrepareBatch(ctx context.Context, input service.PrepareBatchInput) (*domain.TestBatch, error) {
	return m.prepareBatch, m.prepareBatchErr
}
func (m *mockTestBackendService) StartBatch(ctx context.Context, input service.StartBatchInput) (*domain.TestBatch, error) {
	return m.startBatch, m.startBatchErr
}
func (m *mockTestBackendService) GetBatch(ctx context.Context, batchID string) (*domain.TestBatch, error) {
	return m.getBatch, m.getBatchErr
}
func (m *mockTestBackendService) ListDatasets(ctx context.Context) ([]domain.TestDataset, error) {
	return m.listDatasets, m.listDatasetsErr
}
func (m *mockTestBackendService) ImportLocalDataset(ctx context.Context, input service.ImportDatasetInput) (*domain.TestDataset, error) {
	return m.importDataset, m.importDatasetErr
}
func (m *mockTestBackendService) PrepareDataset(ctx context.Context, datasetID string) (*domain.TestDataset, error) {
	return m.prepareDataset, m.prepareDatasetErr
}
func (m *mockTestBackendService) Login(ctx context.Context, password string) error {
	return m.loginErr
}
func (m *mockTestBackendService) Logout(ctx context.Context) error {
	return m.logoutErr
}
func (m *mockTestBackendService) LegacyBatchUpload(ctx context.Context, input service.LegacyBatchUploadInput) (map[string]any, error) {
	return m.legacyBatch, m.legacyBatchErr
}
func (m *mockTestBackendService) LegacySingleImage(ctx context.Context, input service.LegacySingleImageInput) (map[string]any, error) {
	return m.legacySingle, m.legacySingleErr
}

func setupRouter(h *TestBackendHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/prompts", h.ListPrompts)
	r.POST("/api/prompts", h.CreatePrompt)
	r.GET("/api/prompts/active/:model_type", h.GetActivePrompt)
	r.DELETE("/api/prompts/:prompt_id", h.DeletePrompt)
	r.GET("/api/prompts/:prompt_id", h.GetPrompt)
	r.PUT("/api/prompts/:prompt_id", h.UpdatePrompt)
	r.POST("/api/prompts/:prompt_id/activate", h.ActivatePrompt)
	r.GET("/api/prompts/:prompt_id/history", h.GetPromptHistory)
	r.POST("/api/test-backend/analyze", h.Analyze)
	r.POST("/api/test-backend/batch/prepare", h.PrepareBatch)
	r.POST("/api/test-backend/batch/start", h.StartBatch)
	r.GET("/api/test-backend/batch/:batch_id", h.GetBatch)
	r.GET("/api/test-backend/datasets", h.ListDatasets)
	r.POST("/api/test-backend/datasets/import-local", h.ImportLocalDataset)
	r.POST("/api/test-backend/datasets/:dataset_id/prepare", h.PrepareDataset)
	r.POST("/api/test-backend/login", h.Login)
	r.POST("/api/test-backend/logout", h.Logout)
	r.POST("/api/test/batch-upload", h.LegacyBatchUpload)
	r.POST("/api/test/single-image", h.LegacySingleImage)
	return r
}

// ---------- Prompt Handler Tests ----------

func TestListPrompts(t *testing.T) {
	mockSvc := &mockTestBackendService{listPrompts: []domain.Prompt{{ID: "p1", Name: "test"}}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	prompts := data["prompts"].([]any)
	assert.Len(t, prompts, 1)
}

func TestCreatePrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{createPrompt: &domain.Prompt{ID: "p1", Name: "test"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "test", "content": "c", "model_type": "vision"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetActivePrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{getActivePrompt: &domain.Prompt{ID: "p1", Name: "active"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/active/qwen", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDeletePrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/prompts/p1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetPrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{getPrompt: &domain.Prompt{ID: "p1", Name: "test"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/p1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetPromptNotFound(t *testing.T) {
	mockSvc := &mockTestBackendService{getPromptErr: commonerrors.ErrNotFound}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/p1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdatePrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{updatePrompt: &domain.Prompt{ID: "p1", Name: "updated"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "updated"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/prompts/p1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestActivatePrompt(t *testing.T) {
	mockSvc := &mockTestBackendService{activatePrompt: &domain.Prompt{ID: "p1", Name: "active", IsActive: true}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/prompts/p1/activate", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetPromptHistory(t *testing.T) {
	mockSvc := &mockTestBackendService{getPromptHistory: []domain.PromptHistory{{ID: "h1", PromptID: "p1", Version: 1}}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/p1/history", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ---------- Analyze Handler Tests ----------

func TestAnalyze(t *testing.T) {
	mockSvc := &mockTestBackendService{analyzeResult: map[string]any{"result": map[string]any{"items": []any{}}}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/img.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ---------- Batch Handler Tests ----------

func TestPrepareBatch(t *testing.T) {
	mockSvc := &mockTestBackendService{prepareBatch: &domain.TestBatch{ID: "b1", Status: "pending"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"dataset_id": "ds-1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/prepare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestStartBatch(t *testing.T) {
	mockSvc := &mockTestBackendService{startBatch: &domain.TestBatch{ID: "b1", Status: "running"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"batch_id": "b1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/start", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetBatch(t *testing.T) {
	mockSvc := &mockTestBackendService{getBatch: &domain.TestBatch{ID: "b1", Status: "running"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test-backend/batch/b1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ---------- Dataset Handler Tests ----------

func TestListDatasets(t *testing.T) {
	mockSvc := &mockTestBackendService{listDatasets: []domain.TestDataset{{ID: "d1", Name: "test"}}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test-backend/datasets", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestImportLocalDataset(t *testing.T) {
	mockSvc := &mockTestBackendService{importDataset: &domain.TestDataset{ID: "d1", Name: "test"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"name": "test", "image_paths": []string{"/a.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/datasets/import-local", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestPrepareDataset(t *testing.T) {
	mockSvc := &mockTestBackendService{prepareDataset: &domain.TestDataset{ID: "d1", Status: "prepared"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/datasets/d1/prepare", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ---------- Auth Handler Tests ----------

func TestLogin(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"password": "secret"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	// Check cookie is set
	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "test_backend_token" {
			found = true
		}
	}
	assert.True(t, found)
}

func TestLoginUnauthorized(t *testing.T) {
	mockSvc := &mockTestBackendService{loginErr: commonerrors.ErrUnauthorized}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"password": "wrong"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestLogout(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/logout", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ---------- Legacy Handler Tests ----------

func TestLegacyBatchUpload(t *testing.T) {
	mockSvc := &mockTestBackendService{legacyBatch: map[string]any{"message": "legacy"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_urls": []string{"/a.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/batch-upload", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestLegacySingleImage(t *testing.T) {
	mockSvc := &mockTestBackendService{legacySingle: map[string]any{"message": "legacy"}}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "/a.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/single-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestLegacySingleImageValidation(t *testing.T) {
	mockSvc := &mockTestBackendService{legacySingleErr: commonerrors.ErrBadRequest}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": ""})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/single-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestListPromptsError(t *testing.T) {
	mockSvc := &mockTestBackendService{listPromptsErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}


func TestCreatePromptBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/prompts", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreatePromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{createPromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "test", "content": "c", "model_type": "vision"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetPromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{getPromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/p1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetActivePromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{getActivePromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/active/qwen", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdatePromptBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/prompts/p1", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdatePromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{updatePromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "updated"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/prompts/p1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestDeletePromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{deletePromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/prompts/p1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestActivatePromptError(t *testing.T) {
	mockSvc := &mockTestBackendService{activatePromptErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/prompts/p1/activate", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetPromptHistoryError(t *testing.T) {
	mockSvc := &mockTestBackendService{getPromptHistoryErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/prompts/p1/history", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyzeBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/analyze", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAnalyzeError(t *testing.T) {
	mockSvc := &mockTestBackendService{analyzeErr: errors.New("analyze error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/img.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestPrepareBatchBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/prepare", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestPrepareBatchError(t *testing.T) {
	mockSvc := &mockTestBackendService{prepareBatchErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"dataset_id": "ds-1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/prepare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestStartBatchBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/start", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestStartBatchError(t *testing.T) {
	mockSvc := &mockTestBackendService{startBatchErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"batch_id": "b1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/batch/start", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetBatchError(t *testing.T) {
	mockSvc := &mockTestBackendService{getBatchErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test-backend/batch/b1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListDatasetsError(t *testing.T) {
	mockSvc := &mockTestBackendService{listDatasetsErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test-backend/datasets", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestImportLocalDatasetBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/datasets/import-local", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestImportLocalDatasetError(t *testing.T) {
	mockSvc := &mockTestBackendService{importDatasetErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"name": "test", "image_paths": []string{"/a.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/datasets/import-local", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestPrepareDatasetError(t *testing.T) {
	mockSvc := &mockTestBackendService{prepareDatasetErr: errors.New("db error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/datasets/d1/prepare", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestLoginBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/login", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLoginError(t *testing.T) {
	mockSvc := &mockTestBackendService{loginErr: errors.New("auth error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"password": "secret"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestLogoutError(t *testing.T) {
	mockSvc := &mockTestBackendService{logoutErr: errors.New("auth error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test-backend/logout", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestLegacyBatchUploadBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/batch-upload", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLegacyBatchUploadError(t *testing.T) {
	mockSvc := &mockTestBackendService{legacyBatchErr: errors.New("batch error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_urls": []string{"/a.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/batch-upload", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestLegacySingleImageBindError(t *testing.T) {
	mockSvc := &mockTestBackendService{}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/single-image", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLegacySingleImageError(t *testing.T) {
	mockSvc := &mockTestBackendService{legacySingleErr: errors.New("single error")}
	h := NewTestBackendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "/a.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test/single-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
