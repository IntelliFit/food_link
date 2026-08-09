package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/membership/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockMembershipService struct {
	listPlansResult              []map[string]any
	listPlansErr                 error
	getMyMembershipResult        map[string]any
	getMyMembershipErr           error
	createPaymentResult          map[string]any
	createPaymentErr             error
	createPaymentInput           service.CreateMembershipPaymentInput
	createVirtualPaymentInput    service.CreateVirtualMembershipPaymentInput
	createVirtualPaymentResult   map[string]any
	createVirtualPaymentErr      error
	xpayCallbackOK               bool
	xpayCallbackErr              error
	xpayNotifyErr                error
	wechatNotifyResult           map[string]any
	wechatNotifyErr              error
	rewardCenterResult           map[string]any
	rewardCenterErr              error
	claimLoginCheckInResult      map[string]any
	claimLoginCheckInErr         error
	claimSharePosterRewardResult map[string]any
	claimSharePosterRewardErr    error
	papaySigningResult           map[string]any
	papaySigningErr              error
	papayCancelResult            map[string]any
	papayCancelErr               error
	papayNotifyErr               error
}

func (m *mockMembershipService) ListPlans(ctx context.Context, userID string) ([]map[string]any, error) {
	return m.listPlansResult, m.listPlansErr
}
func (m *mockMembershipService) GetMyMembership(ctx context.Context, userID string, date string) (map[string]any, error) {
	return m.getMyMembershipResult, m.getMyMembershipErr
}
func (m *mockMembershipService) GetRewardCenter(ctx context.Context, userID string) (map[string]any, error) {
	return m.rewardCenterResult, m.rewardCenterErr
}
func (m *mockMembershipService) ClaimLoginCheckIn(ctx context.Context, userID string) (map[string]any, error) {
	return m.claimLoginCheckInResult, m.claimLoginCheckInErr
}
func (m *mockMembershipService) GetInviteRewardStatus(ctx context.Context, userID string) (map[string]any, error) {
	return map[string]any{"eligible": false}, nil
}
func (m *mockMembershipService) CreatePaymentWithInput(ctx context.Context, userID string, input service.CreateMembershipPaymentInput) (map[string]any, error) {
	m.createPaymentInput = input
	return m.createPaymentResult, m.createPaymentErr
}
func (m *mockMembershipService) CreateVirtualPayment(ctx context.Context, userID string, input service.CreateVirtualMembershipPaymentInput) (map[string]any, error) {
	m.createVirtualPaymentInput = input
	return m.createVirtualPaymentResult, m.createVirtualPaymentErr
}
func (m *mockMembershipService) VerifyXPayCallback(timestamp, nonce, signature string) (bool, error) {
	return m.xpayCallbackOK, m.xpayCallbackErr
}
func (m *mockMembershipService) HandleXPayNotify(ctx context.Context, body []byte) error {
	return m.xpayNotifyErr
}
func (m *mockMembershipService) SyncWechatPayment(ctx context.Context, userID, orderNo string) (map[string]any, error) {
	return map[string]any{"synced": true, "order_no": orderNo}, nil
}
func (m *mockMembershipService) WechatNotify(ctx context.Context, paymentID string) error {
	return m.wechatNotifyErr
}
func (m *mockMembershipService) HandleWechatNotify(ctx context.Context, headers http.Header, body []byte) (map[string]any, error) {
	if m.wechatNotifyResult != nil {
		return m.wechatNotifyResult, m.wechatNotifyErr
	}
	return map[string]any{"code": "SUCCESS", "message": "成功"}, m.wechatNotifyErr
}
func (m *mockMembershipService) CreatePapaySigning(ctx context.Context, userID, planCode string) (map[string]any, error) {
	return m.papaySigningResult, m.papaySigningErr
}
func (m *mockMembershipService) CancelPapayContract(ctx context.Context, userID string) (map[string]any, error) {
	return m.papayCancelResult, m.papayCancelErr
}
func (m *mockMembershipService) HandlePapayContractNotify(ctx context.Context, body []byte) error {
	return m.papayNotifyErr
}
func (m *mockMembershipService) HandlePapayTerminateNotify(ctx context.Context, body []byte) error {
	return m.papayNotifyErr
}
func (m *mockMembershipService) HandlePapayPaymentNotify(ctx context.Context, body []byte) error {
	return m.papayNotifyErr
}
func (m *mockMembershipService) ClaimSharePosterReward(ctx context.Context, userID string, input service.SharePosterRewardClaimInput) (map[string]any, error) {
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
	r.POST("/api/membership/xpay/create", h.CreateVirtualPayment)
	r.GET("/api/payment/wechat/xpay/notify", h.XPayNotify)
	r.POST("/api/payment/wechat/xpay/notify", h.XPayNotify)
	r.POST("/api/membership/pay/sync", h.SyncPayment)
	r.POST("/api/payment/wechat/notify/membership", h.WechatNotify)
	r.POST("/api/membership/auto-renew/signing", h.CreatePapaySigning)
	r.POST("/api/membership/auto-renew/cancel", h.CancelPapayContract)
	r.POST("/api/payment/wechat/papay/contract/notify", h.PapayContractNotify)
	r.POST("/api/payment/wechat/papay/pay/notify", h.PapayPaymentNotify)
	r.POST("/api/payment/wechat/papay/contract/terminate-notify", h.PapayContractTerminateNotify)
	r.POST("/api/membership/rewards/share-poster/claim", h.ClaimSharePosterReward)
	r.POST("/api/membership/rewards/login-check-in/claim", h.ClaimLoginCheckIn)
	return r
}

func TestMembershipHandler_CreateVirtualPayment(t *testing.T) {
	mockSvc := &mockMembershipService{createVirtualPaymentResult: map[string]any{"order_no": "PMX1"}}
	r := setupRouter(NewMembershipHandler(mockSvc))
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/xpay/create", bytes.NewBufferString(`{"plan_code":"light_monthly","login_code":"fresh-code"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "light_monthly", mockSvc.createVirtualPaymentInput.PlanCode)
	assert.Equal(t, "fresh-code", mockSvc.createVirtualPaymentInput.LoginCode)
}

func TestMembershipHandler_XPayNotifyVerification(t *testing.T) {
	r := setupRouter(NewMembershipHandler(&mockMembershipService{xpayCallbackOK: true}))
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/payment/wechat/xpay/notify?timestamp=1&nonce=2&signature=s&echostr=ok", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ok", w.Body.String())
}

func TestMembershipHandler_XPayNotifyPostReturnsPlatformSuccess(t *testing.T) {
	r := setupRouter(NewMembershipHandler(&mockMembershipService{xpayCallbackOK: true}))
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/payment/wechat/xpay/notify?timestamp=1&nonce=2&signature=s", bytes.NewBufferString(`{"Event":"xpay_refund_notify"}`))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["ErrCode"])
}

func TestMembershipHandler_ListPlans(t *testing.T) {
	mockSvc := &mockMembershipService{listPlansResult: []map[string]any{{"code": "standard_monthly", "name": "标准版"}}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/plans", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Len(t, data["list"].([]any), 1)
}

func TestMembershipHandler_GetMyMembership(t *testing.T) {
	mockSvc := &mockMembershipService{getMyMembershipResult: map[string]any{"status": "active", "daily_credits_max": 40}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/me", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMembershipHandler_CreatePayment(t *testing.T) {
	mockSvc := &mockMembershipService{createPaymentResult: map[string]any{"order_no": "PM1"}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"plan_code": "standard_monthly"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "PM1", data["order_no"])
}

func TestMembershipHandler_CreatePaymentPassesAppTradeType(t *testing.T) {
	mockSvc := &mockMembershipService{createPaymentResult: map[string]any{"order_no": "PM2", "trade_type": "APP"}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{
		"plan_code":   "standard_monthly",
		"pay_channel": "wechat",
		"trade_type":  "APP",
		"client":      "mobile_app",
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "standard_monthly", mockSvc.createPaymentInput.PlanCode)
	assert.Equal(t, "wechat", mockSvc.createPaymentInput.PayChannel)
	assert.Equal(t, "APP", mockSvc.createPaymentInput.TradeType)
	assert.Equal(t, "mobile_app", mockSvc.createPaymentInput.Client)
}

func TestMembershipHandler_CreatePaymentReadsMobileClientHeader(t *testing.T) {
	mockSvc := &mockMembershipService{createPaymentResult: map[string]any{"order_no": "PM3"}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"plan_code": "standard_monthly"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Food-Link-Client", "mobile_app")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "mobile_app", mockSvc.createPaymentInput.Client)
}

func TestMembershipHandler_CreatePaymentMissingPlanCode(t *testing.T) {
	h := NewMembershipHandler(&mockMembershipService{})
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/create", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMembershipHandler_SyncPayment(t *testing.T) {
	h := NewMembershipHandler(&mockMembershipService{})
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"order_no": "PM1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/pay/sync", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["synced"])
	assert.Equal(t, "PM1", data["order_no"])
}

func TestMembershipHandler_WechatNotifyRawSuccess(t *testing.T) {
	h := NewMembershipHandler(&mockMembershipService{})
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/payment/wechat/notify/membership", bytes.NewReader([]byte(`{"id":"notify"}`)))
	req.Header.Set("Wechatpay-Signature", "sig")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "SUCCESS", resp["code"])
}

func TestMembershipHandler_PapayContractTerminateNotifySuccessXML(t *testing.T) {
	h := NewMembershipHandler(&mockMembershipService{})
	r := setupRouter(h)

	body := []byte(`<xml>
		<return_code><![CDATA[SUCCESS]]></return_code>
		<result_code><![CDATA[SUCCESS]]></result_code>
		<appid><![CDATA[wx123]]></appid>
		<mch_id><![CDATA[1900000109]]></mch_id>
		<contract_id><![CDATA[contract-1]]></contract_id>
		<contract_code><![CDATA[user-contract-1]]></contract_code>
		<plan_id><![CDATA[214826]]></plan_id>
		<change_type><![CDATA[DELETE]]></change_type>
		<operate_time><![CDATA[2026-06-17 23:20:31]]></operate_time>
	</xml>`)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/payment/wechat/papay/contract/terminate-notify", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/xml")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/xml")
	assert.Equal(t, "<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>", w.Body.String())
}

func TestMembershipHandler_ClaimSharePosterReward(t *testing.T) {
	mockSvc := &mockMembershipService{claimSharePosterRewardResult: map[string]any{"claimed": true}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"record_id": "rec1"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/rewards/share-poster/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMembershipHandler_ClaimSharePosterRewardDailyScope(t *testing.T) {
	mockSvc := &mockMembershipService{claimSharePosterRewardResult: map[string]any{"claimed": true}}
	h := NewMembershipHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"share_scope": "daily_food", "share_date": "2026-05-26"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/rewards/share-poster/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMembershipHandler_ErrorPaths(t *testing.T) {
	h := NewMembershipHandler(&mockMembershipService{listPlansErr: errors.New("db error")})
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/membership/plans", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	gin.SetMode(gin.TestMode)
	unauth := gin.New()
	unauth.GET("/api/membership/me", h.GetMyMembership)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodGet, "/api/membership/me", nil)
	unauth.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
