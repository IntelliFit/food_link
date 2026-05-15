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
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockFoodRecordService struct {
	saveRecord          *domain.FoodRecord
	saveErr             error
	listRecords         []domain.FoodRecord
	listErr             error
	getRecord           *domain.FoodRecord
	getErr              error
	updateRecord        *domain.FoodRecord
	updateErr           error
	deleteErr           error
	shareRecord         *domain.FoodRecord
	shareErr            error
	saveCriticalSamplesErr error
}

func (m *mockFoodRecordService) Save(ctx context.Context, userID string, input service.SaveFoodRecordInput) (*domain.FoodRecord, error) {
	return m.saveRecord, m.saveErr
}
func (m *mockFoodRecordService) List(ctx context.Context, userID, date string) ([]domain.FoodRecord, error) {
	return m.listRecords, m.listErr
}
func (m *mockFoodRecordService) Get(ctx context.Context, userID, recordID string) (*domain.FoodRecord, error) {
	return m.getRecord, m.getErr
}
func (m *mockFoodRecordService) Update(ctx context.Context, userID, recordID string, input service.UpdateFoodRecordInput) (*domain.FoodRecord, error) {
	return m.updateRecord, m.updateErr
}
func (m *mockFoodRecordService) Delete(ctx context.Context, userID, recordID string) error {
	return m.deleteErr
}
func (m *mockFoodRecordService) Share(ctx context.Context, recordID string) (*domain.FoodRecord, error) {
	return m.shareRecord, m.shareErr
}
func (m *mockFoodRecordService) SaveCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error {
	return m.saveCriticalSamplesErr
}

type mockUploadService struct {
	url string
	err error
}

func (m *mockUploadService) UploadBase64(base64Image string) (string, error) {
	return m.url, m.err
}
func (m *mockUploadService) UploadFile(fileBytes []byte, ext, contentType string) (string, error) {
	return m.url, m.err
}

type mockNutritionService struct {
	items []map[string]any
	logs  []domain.FoodUnresolvedLog
	err   error
}

func (m *mockNutritionService) Search(ctx context.Context, query string, limit int) ([]map[string]any, error) {
	return m.items, m.err
}
func (m *mockNutritionService) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	return m.logs, m.err
}

func setupRouter(h *FoodRecordHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.POST("/api/food-record/save", h.SaveFoodRecord)
	r.GET("/api/food-record/list", h.ListFoodRecords)
	r.GET("/api/food-record/:record_id", h.GetFoodRecord)
	r.PUT("/api/food-record/:record_id", h.UpdateFoodRecord)
	r.DELETE("/api/food-record/:record_id", h.DeleteFoodRecord)
	r.GET("/api/food-record/share/:record_id", h.ShareFoodRecord)
	r.POST("/api/upload-analyze-image", h.UploadAnalyzeImage)
	r.POST("/api/upload-analyze-image-file", h.UploadAnalyzeImageFile)
	r.GET("/api/food-nutrition/search", h.SearchFoodNutrition)
	r.GET("/api/food-nutrition/unresolved/top", h.GetUnresolvedTop)
	r.POST("/api/critical-samples", h.SaveCriticalSamples)
	return r
}

func TestSaveFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"meal_type": "lunch"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "r1", data["id"])
	assert.Equal(t, "记录成功", data["message"])
}

func TestListFoodRecords(t *testing.T) {
	mockSvc := &mockFoodRecordService{listRecords: []domain.FoodRecord{{ID: "r1", MealType: "breakfast"}}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	records := data["records"].([]any)
	assert.Len(t, records, 1)
}

func TestGetFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{getRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestUpdateFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{updateRecord: &domain.FoodRecord{ID: "r1", MealType: "dinner"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"total_calories": 300})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDeleteFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestShareFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestShareFoodRecordForbidden(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareErr: commonerrors.ErrForbidden}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestUploadAnalyzeImage(t *testing.T) {
	mockSvc := &mockUploadService{url: "https://cdn.example.com/img.jpg"}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "data:image/jpeg;base64,test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/img.jpg", data["imageUrl"])
}

func TestSearchFoodNutrition(t *testing.T) {
	mockSvc := &mockNutritionService{items: []map[string]any{{"food_id": "f1", "canonical_name": "apple"}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetUnresolvedTop(t *testing.T) {
	mockSvc := &mockNutritionService{logs: []domain.FoodUnresolvedLog{{ID: "u1", RawName: "foo", HitCount: 5}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveCriticalSamples(t *testing.T) {
	mockSvc := &mockFoodRecordService{}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{"food_name": "apple", "ai_weight": 100, "user_weight": 120, "deviation_percent": 20}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/critical-samples", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "已保存偏差样本", data["message"])
	assert.Equal(t, float64(1), data["count"])
}

func TestSaveFoodRecordValidationError(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveErr: errors.New("bad request")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"meal_type": "invalid"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}


func TestUploadAnalyzeImageFile(t *testing.T) {
	mockSvc := &mockUploadService{url: "https://cdn.example.com/file.jpg"}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body := "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\ntestdata\r\n--boundary--\r\n"
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/file.jpg", data["imageUrl"])
}

func TestUploadAnalyzeImageFileMissingFile(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageFileNonImage(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	body := "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.txt\"\r\nContent-Type: text/plain\r\n\r\ntestdata\r\n--boundary--\r\n"
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageEmpty(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": ""})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageError(t *testing.T) {
	mockSvc := &mockUploadService{err: errors.New("upload error")}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "data:image/jpeg;base64,test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSaveFoodRecordBindError(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateFoodRecordBindError(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{getErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestDeleteFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{deleteErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListFoodRecordsError(t *testing.T) {
	mockSvc := &mockFoodRecordService{listErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestShareFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSearchFoodNutritionError(t *testing.T) {
	mockSvc := &mockNutritionService{err: errors.New("db error")}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSearchFoodNutritionWithLimit(t *testing.T) {
	mockSvc := &mockNutritionService{items: []map[string]any{{"food_id": "f1", "canonical_name": "apple"}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple&limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetUnresolvedTopError(t *testing.T) {
	mockSvc := &mockNutritionService{err: errors.New("db error")}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetUnresolvedTopWithLimit(t *testing.T) {
	mockSvc := &mockNutritionService{logs: []domain.FoodUnresolvedLog{{ID: "u1", RawName: "foo", HitCount: 5}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveCriticalSamplesError(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveCriticalSamplesErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{"food_name": "apple", "ai_weight": 100, "user_weight": 120, "deviation_percent": 20}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/critical-samples", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
