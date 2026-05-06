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
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockExpiryService struct {
	dashboardResult *service.DashboardResult
	dashboardErr    error
	listItems       []domain.ExpiryItem
	listErr         error
	createItem      *domain.ExpiryItem
	createErr       error
	getItem         *domain.ExpiryItem
	getErr          error
	updateItem      *domain.ExpiryItem
	updateErr       error
	updateStatus    *domain.ExpiryItem
	updateStatusErr error
	subscribeResult *service.SubscribeResult
	subscribeErr    error
	recognizeResult *service.RecognizeResult
	recognizeErr    error
}

func (m *mockExpiryService) Dashboard(ctx context.Context, userID string) (*service.DashboardResult, error) {
	return m.dashboardResult, m.dashboardErr
}
func (m *mockExpiryService) ListItems(ctx context.Context, userID, status string) ([]domain.ExpiryItem, error) {
	return m.listItems, m.listErr
}
func (m *mockExpiryService) CreateItem(ctx context.Context, userID string, input service.CreateItemInput) (*domain.ExpiryItem, error) {
	return m.createItem, m.createErr
}
func (m *mockExpiryService) GetItem(ctx context.Context, userID, itemID string) (*domain.ExpiryItem, error) {
	return m.getItem, m.getErr
}
func (m *mockExpiryService) UpdateItem(ctx context.Context, userID, itemID string, input service.UpdateItemInput) (*domain.ExpiryItem, error) {
	return m.updateItem, m.updateErr
}
func (m *mockExpiryService) UpdateStatus(ctx context.Context, userID, itemID, status string) (*domain.ExpiryItem, error) {
	return m.updateStatus, m.updateStatusErr
}
func (m *mockExpiryService) Subscribe(ctx context.Context, userID, itemID string) (*service.SubscribeResult, error) {
	return m.subscribeResult, m.subscribeErr
}
func (m *mockExpiryService) Recognize(ctx context.Context, userID string, imageURLs []string) (*service.RecognizeResult, error) {
	return m.recognizeResult, m.recognizeErr
}

func setupRouter(h *ExpiryHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/expiry/dashboard", h.Dashboard)
	r.GET("/api/expiry/items", h.ListItems)
	r.POST("/api/expiry/items", h.CreateItem)
	r.GET("/api/expiry/items/:item_id", h.GetItem)
	r.PUT("/api/expiry/items/:item_id", h.UpdateItem)
	r.POST("/api/expiry/items/:item_id/status", h.UpdateStatus)
	r.POST("/api/expiry/items/:item_id/subscribe", h.Subscribe)
	r.POST("/api/expiry/recognize", h.Recognize)
	return r
}

func TestDashboard(t *testing.T) {
	mockSvc := &mockExpiryService{dashboardResult: &service.DashboardResult{ActiveCount: 5}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/dashboard", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(5), data["active_count"])
}

func TestListItems(t *testing.T) {
	mockSvc := &mockExpiryService{listItems: []domain.ExpiryItem{{ID: "i1", Name: "milk"}}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/items?status=active", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["items"].([]any)
	assert.Len(t, items, 1)
}

func TestCreateItem(t *testing.T) {
	mockSvc := &mockExpiryService{createItem: &domain.ExpiryItem{ID: "i1", Name: "bread"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "bread"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "创建成功", data["message"])
}

func TestGetItem(t *testing.T) {
	mockSvc := &mockExpiryService{getItem: &domain.ExpiryItem{ID: "i1", Name: "egg"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/items/i1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetItemNotFound(t *testing.T) {
	mockSvc := &mockExpiryService{getErr: commonerrors.ErrNotFound}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/items/i1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateItem(t *testing.T) {
	mockSvc := &mockExpiryService{updateItem: &domain.ExpiryItem{ID: "i1", Name: "sourdough"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "sourdough"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/expiry/items/i1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "更新成功", data["message"])
}

func TestUpdateStatus(t *testing.T) {
	mockSvc := &mockExpiryService{updateStatus: &domain.ExpiryItem{ID: "i1", Status: "consumed"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"status": "consumed"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items/i1/status", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "状态已更新", data["message"])
}

func TestSubscribe(t *testing.T) {
	mockSvc := &mockExpiryService{subscribeResult: &service.SubscribeResult{Subscribed: true, Message: "订阅成功"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items/i1/subscribe", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.True(t, data["subscribed"].(bool))
}

func TestRecognize(t *testing.T) {
	mockSvc := &mockExpiryService{recognizeResult: &service.RecognizeResult{TaskID: "t1", Message: "识别任务已创建"}}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string][]string{"image_urls": {"https://example.com/img.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/recognize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "t1", data["task_id"])
}

func TestRecognizeNoImages(t *testing.T) {
	mockSvc := &mockExpiryService{}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string][]string{"image_urls": {}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/recognize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestListItemsError(t *testing.T) {
	mockSvc := &mockExpiryService{listErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/items?status=active", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateItemBindError(t *testing.T) {
	mockSvc := &mockExpiryService{}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateItemError(t *testing.T) {
	mockSvc := &mockExpiryService{createErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "bread"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetItemError(t *testing.T) {
	mockSvc := &mockExpiryService{getErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/expiry/items/i1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdateItemBindError(t *testing.T) {
	mockSvc := &mockExpiryService{}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/expiry/items/i1", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateItemError(t *testing.T) {
	mockSvc := &mockExpiryService{updateErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"name": "sourdough"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/expiry/items/i1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdateStatusBindError(t *testing.T) {
	mockSvc := &mockExpiryService{}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items/i1/status", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateStatusError(t *testing.T) {
	mockSvc := &mockExpiryService{updateStatusErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"status": "consumed"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items/i1/status", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSubscribeError(t *testing.T) {
	mockSvc := &mockExpiryService{subscribeErr: errors.New("db error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/items/i1/subscribe", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestRecognizeBindError(t *testing.T) {
	mockSvc := &mockExpiryService{}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/recognize", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRecognizeError(t *testing.T) {
	mockSvc := &mockExpiryService{recognizeErr: errors.New("recognize error")}
	h := NewExpiryHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string][]string{"image_urls": {"https://example.com/img.jpg"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/expiry/recognize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
