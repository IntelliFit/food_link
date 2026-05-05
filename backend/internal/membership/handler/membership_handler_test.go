package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockMembershipService struct {
	listPlansResult               []map[string]any
	listPlansErr                  error
	getMyMembershipResult         map[string]any
	getMyMembershipErr            error
	createPaymentResult           map[string]any
	createPaymentErr              error
	wechatNotifyErr               error
	claimSharePosterRewardResult  map[string]any
	claimSharePosterRewardErr     error
}

func (m *mockMembershipService) ListPlans(ctx context.Context) ([]map[string]any, error) {
	return m.listPlansResult, m.listPlansErr
}
func (m *mockMembershipService) GetMyMembership(ctx context.Context, userID string) (map[string]any, error) {
	return m.getMyMembershipResult, m.getMyMembershipErr
}
func (m *mockMembershipService) CreatePayment(ctx context.Context, userID, planID string) (map[string]any, error) {
	return m.createPaymentResult, m.createPaymentErr
}
func (m *mockMembershipService) WechatNotify(ctx context.Context, paymentID string) error {
	return m.wechatNotifyErr
}
func (m *mockMembershipService) ClaimSharePosterReward(ctx context.Context, userID, recordID string) (map[string]any, error) {
	return m.claimSharePosterRewardResult, m.claimSharePosterRewardErr
}

func setupRouter(h *MembershipHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/membership/plans", h.ListPlans)
	r.GET("/api/membership/me", h.GetMyMembership)
	r.POST("/api/membership/pay/create", h.CreatePayment)
	r.POST("/api/payment/wechat/notify/membership", h.WechatNotify)
	r.POST("/api/membership/rewards/share-poster/claim", h.ClaimSharePosterReward)
	return r
}

func TestMembershipHandler_ListPlans(t *testing.T) {
	mockSvc := &mockMembershipService{listPlansResult: []map[string]any{{"id": "p1", "name": "Basic"}}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/plans", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].([]any)
	assert.Len(t, data, 1)
}

func TestMembershipHandler_GetMyMembership(t *testing.T) {
	mockSvc := &mockMembershipService{getMyMembershipResult: map[string]any{"status": "active", "daily_limit": int64(100)}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/me", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestMembershipHandler_CreatePayment(t *testing.T) {
	mockSvc := &mockMembershipService{createPaymentResult: map[string]any{"payment_id": "pay1"}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"plan_id": "p1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "pay1", data["payment_id"])
}

func TestMembershipHandler_CreatePaymentMissingPlanID(t *testing.T) {
	mockSvc := &mockMembershipService{}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMembershipHandler_WechatNotify(t *testing.T) {
	mockSvc := &mockMembershipService{}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"payment_id": "pay1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/payment/wechat/notify/membership", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, true, resp["data"].(map[string]any)["success"])
}

func TestMembershipHandler_WechatNotifyMissingPaymentID(t *testing.T) {
	mockSvc := &mockMembershipService{}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/payment/wechat/notify/membership", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMembershipHandler_ClaimSharePosterReward(t *testing.T) {
	mockSvc := &mockMembershipService{claimSharePosterRewardResult: map[string]any{"success": true, "reward_id": "rwd1"}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"record_id": "rec1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/rewards/share-poster/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["success"])
}

func TestMembershipHandler_ClaimSharePosterRewardMissingRecordID(t *testing.T) {
	mockSvc := &mockMembershipService{}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/rewards/share-poster/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMembershipHandler_Error(t *testing.T) {
	mockSvc := &mockMembershipService{listPlansErr: errors.New("db error")}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/plans", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
