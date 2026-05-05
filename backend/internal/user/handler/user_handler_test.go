package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/user/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockUserService struct {
	profile             map[string]any
	profileErr          error
	updateProfile       map[string]any
	updateProfileErr    error
	dashboardTargets    map[string]float64
	dashboardTargetsErr error
	healthProfile       map[string]any
	healthProfileErr    error
	recordDays          int64
	recordDaysErr       error
	lastSeenErr         error
}

func (m *mockUserService) GetProfile(ctx context.Context, userID string) (map[string]any, error) {
	return m.profile, m.profileErr
}
func (m *mockUserService) UpdateProfile(ctx context.Context, userID string, input service.UpdateProfileInput) (map[string]any, error) {
	return m.updateProfile, m.updateProfileErr
}
func (m *mockUserService) GetDashboardTargets(ctx context.Context, userID string) (map[string]float64, error) {
	return m.dashboardTargets, m.dashboardTargetsErr
}
func (m *mockUserService) UpdateDashboardTargets(ctx context.Context, userID string, input service.UpdateDashboardTargetsInput) (map[string]float64, error) {
	return m.dashboardTargets, m.dashboardTargetsErr
}
func (m *mockUserService) GetHealthProfile(ctx context.Context, userID string) (map[string]any, error) {
	return m.healthProfile, m.healthProfileErr
}
func (m *mockUserService) UpdateHealthProfile(ctx context.Context, userID string, input service.UpdateHealthProfileInput) (map[string]any, error) {
	return m.healthProfile, m.healthProfileErr
}
func (m *mockUserService) GetRecordDays(ctx context.Context, userID string) (int64, error) {
	return m.recordDays, m.recordDaysErr
}
func (m *mockUserService) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return m.lastSeenErr
}

type mockBindPhoneService struct {
	output *service.BindPhoneOutput
	err    error
}

func (m *mockBindPhoneService) BindPhone(ctx context.Context, userID string, input service.BindPhoneInput) (*service.BindPhoneOutput, error) {
	return m.output, m.err
}

type mockUploadService struct {
	url string
	err error
}

func (m *mockUploadService) UploadAvatar(userID string, base64Image string) (string, error) {
	return m.url, m.err
}
func (m *mockUploadService) UploadReportImage(userID string, base64Image string) (string, error) {
	return m.url, m.err
}

type mockOCRService struct {
	result map[string]any
	err    error
}

func (m *mockOCRService) ExtractFromBase64(ctx context.Context, base64Image string) (map[string]any, error) {
	return m.result, m.err
}
func (m *mockOCRService) ExtractFromURL(ctx context.Context, imageURL string) (map[string]any, error) {
	return m.result, m.err
}

type mockAnalysisTaskService struct {
	taskID string
	err    error
}

func (m *mockAnalysisTaskService) CreateHealthReportTask(ctx context.Context, userID string, input service.CreateHealthReportTaskInput) (string, error) {
	return m.taskID, m.err
}

func setupRouter(h *UserHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/user/profile", h.GetProfile)
	r.PUT("/api/user/profile", h.UpdateProfile)
	r.POST("/api/user/bind-phone", h.BindPhone)
	r.POST("/api/user/upload-avatar", h.UploadAvatar)
	r.GET("/api/user/dashboard-targets", h.GetDashboardTargets)
	r.PUT("/api/user/dashboard-targets", h.UpdateDashboardTargets)
	r.GET("/api/user/health-profile", h.GetHealthProfile)
	r.PUT("/api/user/health-profile", h.UpdateHealthProfile)
	r.POST("/api/user/health-profile/ocr", h.HealthReportOCR)
	r.POST("/api/user/health-profile/ocr-extract", h.HealthReportOCRExtract)
	r.POST("/api/user/health-profile/submit-report-extraction-task", h.SubmitReportExtractionTask)
	r.POST("/api/user/health-profile/upload-report-image", h.UploadReportImage)
	r.GET("/api/user/record-days", h.GetRecordDays)
	r.POST("/api/user/last-seen-analyze-history", h.UpdateLastSeenAnalyzeHistory)
	return r
}

func TestGetProfile(t *testing.T) {
	mockSvc := &mockUserService{profile: map[string]any{"id": "u1", "nickname": "Test"}}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/user/profile", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]any)
	assert.Equal(t, "Test", data["nickname"])
}

func TestGetProfileError(t *testing.T) {
	mockSvc := &mockUserService{profileErr: errors.New("not found")}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/user/profile", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdateProfile(t *testing.T) {
	mockSvc := &mockUserService{updateProfile: map[string]any{"id": "u1", "nickname": "Updated"}}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"nickname": "Updated"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/user/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "Updated", data["nickname"])
}

func TestBindPhone(t *testing.T) {
	mockSvc := &mockBindPhoneService{output: &service.BindPhoneOutput{Telephone: "13800138000"}}
	h := NewUserHandler(&mockUserService{}, mockSvc, nil, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"phoneCode": "test-code"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/bind-phone", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "13800138000", data["telephone"])
}

func TestUploadAvatar(t *testing.T) {
	mockSvc := &mockUploadService{url: "https://cdn.example.com/avatar.jpg"}
	h := NewUserHandler(&mockUserService{}, nil, mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "data:image/jpeg;base64,test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/upload-avatar", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/avatar.jpg", data["imageUrl"])
}

func TestGetDashboardTargets(t *testing.T) {
	mockSvc := &mockUserService{dashboardTargets: map[string]float64{"calorie_target": 2000}}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/user/dashboard-targets", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(2000), data["calorie_target"])
}

func TestGetHealthProfile(t *testing.T) {
	mockSvc := &mockUserService{healthProfile: map[string]any{"height": 175.0}}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/user/health-profile", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(175), data["height"])
}

func TestHealthReportOCRExtract(t *testing.T) {
	mockSvc := &mockOCRService{result: map[string]any{"indicators": []any{}}}
	h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"imageUrl": "https://example.com/report.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr-extract", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	extracted := data["extracted"].(map[string]any)
	assert.NotNil(t, extracted["indicators"])
}

func TestSubmitReportExtractionTask(t *testing.T) {
	mockSvc := &mockAnalysisTaskService{taskID: "task-123"}
	h := NewUserHandler(&mockUserService{}, nil, nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"imageUrl": "https://example.com/report.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/submit-report-extraction-task", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "task-123", data["taskId"])
}

func TestGetRecordDays(t *testing.T) {
	mockSvc := &mockUserService{recordDays: 42}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/user/record-days", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(42), data["record_days"])
}

func TestUpdateLastSeenAnalyzeHistory(t *testing.T) {
	mockSvc := &mockUserService{}
	h := NewUserHandler(mockSvc, nil, nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/last-seen-analyze-history", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["success"])
}
