package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildMembershipPaymentTermsRejectsDowngrade(t *testing.T) {
	now := time.Now()
	expiresAt := now.AddDate(0, 1, 0)
	startedAt := now.AddDate(0, 0, -5)
	currentPlanCode := "advanced_monthly"
	targetPlanCode := "standard_yearly"
	repo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{currentPlanCode: {
			Code: currentPlanCode, Amount: 29.9, DurationMonths: 1, IsActive: true, IsVisible: true,
		}},
	}
	svc := NewMembershipService(repo)
	targetPlan := &domain.MembershipPlan{Code: targetPlanCode, Amount: 199, DurationMonths: 12}
	membership := &domain.UserMembership{
		UserID: "u1", Status: "active", CurrentPlanCode: &currentPlanCode,
		CurrentPeriodStart: &startedAt, ExpiresAt: &expiresAt,
	}

	_, err := svc.buildMembershipPaymentTerms(context.Background(), targetPlan, membership, now)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "不支持降档")
}

func TestXPaySignDataIncludesProratedActualPrice(t *testing.T) {
	actualPrice := 1234
	payload, err := json.Marshal(xpaySignData{
		OfferID: "offer", BuyQuantity: 1, Env: 0, CurrencyType: "CNY",
		ProductID: "advanced_monthly", GoodsPrice: 2990,
		ActivitySellingPrice: &actualPrice, OutTradeNo: "PMX1", Attach: "membership:advanced_monthly",
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"offerId":"offer","buyQuantity":1,"env":0,"currencyType":"CNY",
		"productId":"advanced_monthly","goodsPrice":2990,"activitySellingPrice":1234,
		"outTradeNo":"PMX1","attach":"membership:advanced_monthly"
	}`, string(payload))
}

func TestCreateVirtualPaymentUpgradeUsesProratedAmount(t *testing.T) {
	now := time.Now()
	startedAt := now.AddDate(0, 0, -10)
	expiresAt := startedAt.AddDate(0, 1, 0)
	currentPlanCode := "light_monthly"
	targetPlanCode := "advanced_monthly"
	openID := "openid-u1"
	repo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{
			currentPlanCode: {Code: currentPlanCode, Amount: 9.9, DurationMonths: 1, IsActive: true, IsVisible: true},
			targetPlanCode:  {Code: targetPlanCode, Amount: 29.9, DurationMonths: 1, IsActive: true, IsVisible: true},
		},
		membership: &domain.UserMembership{
			UserID: "u1", Status: "active", CurrentPlanCode: &currentPlanCode,
			CurrentPeriodStart: &startedAt, ExpiresAt: &expiresAt,
		},
		user: &membershiprepo.User{ID: "u1", OpenID: openID},
	}
	svc := NewMembershipService(repo, xpayTestConfig())
	svc.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"openid":"openid-u1","session_key":"session-key"}`)),
			Header:     make(http.Header),
		}, nil
	})}

	data, err := svc.CreateVirtualPayment(context.Background(), "u1", CreateVirtualMembershipPaymentInput{
		PlanCode: targetPlanCode, LoginCode: "login-code",
	})

	require.NoError(t, err)
	require.NotNil(t, repo.payment)
	assert.Equal(t, "prorated_current_period_upgrade", data["order_mode"])
	assert.Less(t, repo.payment.Amount, 29.9)
	assert.Greater(t, repo.payment.Amount, 0.0)
	assert.Equal(t, repo.payment.Amount, data["amount"])
	var signPayload xpaySignData
	require.NoError(t, json.Unmarshal([]byte(data["virtual_payment"].(map[string]string)["signData"]), &signPayload))
	require.NotNil(t, signPayload.ActivitySellingPrice)
	assert.Equal(t, amountToFen(repo.payment.Amount), *signPayload.ActivitySellingPrice)
	assert.Equal(t, 2990, signPayload.GoodsPrice)
	assert.Equal(t, "prorated_current_period_upgrade", repo.payment.Extra["order_mode"])
}

func TestSyncWechatPaymentXPayRequiresAppliedEntitlement(t *testing.T) {
	for _, tc := range []struct {
		name              string
		paymentStatus     string
		entitlementStatus string
		wantSynced        bool
	}{
		{name: "pending", paymentStatus: "pending", wantSynced: false},
		{name: "paid but entitlement pending", paymentStatus: "paid", entitlementStatus: xpayActivationPrepared, wantSynced: false},
		{name: "paid and entitlement applied", paymentStatus: "paid", entitlementStatus: xpayActivationApplied, wantSynced: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			extra := map[string]any{}
			if tc.entitlementStatus != "" {
				extra[xpayActivationExtraKey] = map[string]any{"status": tc.entitlementStatus}
			}
			expiresAt := time.Now().AddDate(0, 1, 0)
			repo := &mockMembershipRepo{
				payment: &domain.MembershipPayment{
					UserID: "u1", OrderNo: "PMX1", Status: tc.paymentStatus,
					PayChannel: "wechat_virtual_payment", TradeType: "XPAY", Extra: extra,
				},
				membership: &domain.UserMembership{UserID: "u1", Status: "active", ExpiresAt: &expiresAt},
			}
			svc := NewMembershipService(repo)

			data, err := svc.SyncWechatPayment(context.Background(), "u1", "PMX1")

			require.NoError(t, err)
			assert.Equal(t, tc.wantSynced, data["synced"])
			assert.Equal(t, tc.paymentStatus, data["status"])
			assert.Equal(t, tc.entitlementStatus, data["entitlement_status"])
		})
	}
}

func TestXPaySignatures(t *testing.T) {
	signData := `{"offerId":"1450593228","buyQuantity":1,"env":1,"currencyType":"CNY","productId":"light_monthly","goodsPrice":990,"outTradeNo":"PM20260719123000A1B2C3D4","attach":"membership:light_monthly"}`
	if got, want := xpayHMACSHA256("app-key", "requestVirtualPayment&"+signData), "e00d94ab6e3fd1f7e6a8a0b33bc9b06f6d51b871b8f3dd9ccbb8064afa82b29c"; got != want {
		t.Fatalf("paySig = %s, want %s", got, want)
	}
	if got, want := xpayHMACSHA256("session-key", signData), "b5895c916a154b2ad05564713c789285bb6aabc2db54ca9e86662b78b4336f45"; got != want {
		t.Fatalf("signature = %s, want %s", got, want)
	}
}

func TestValidateXPayMessageSignature(t *testing.T) {
	if !validateXPayMessageSignature("token", "1710000000", "nonce", "80b94323d2cec5b96d07867a5166387fa34e8f84") {
		t.Fatal("expected valid callback signature")
	}
	if validateXPayMessageSignature("token", "1710000000", "nonce", "invalid") {
		t.Fatal("invalid callback signature must be rejected")
	}
}

func TestHandleXPayNotifyGoodsDeliveryIsIdempotent(t *testing.T) {
	paidAt := time.Now().Add(-time.Minute).Truncate(time.Second)
	planCode := "light_monthly"
	openID := "openid-u1"
	payment := &domain.MembershipPayment{
		ID: "pay-1", UserID: "u1", PlanCode: planCode, OrderNo: "PMX1", Amount: 9.9,
		DurationMonths: 1, PayChannel: "wechat_virtual_payment", TradeType: "XPAY",
		Status: "pending", WxOpenID: &openID, Extra: map[string]any{"xpay_env": 1},
	}
	repo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{planCode: {Code: planCode, Amount: 9.9, DurationMonths: 1, DailyCredits: 8, IsActive: true}},
		payment:    payment,
		user:       &membershiprepo.User{ID: "u1", OpenID: openID},
	}
	svc := NewMembershipService(repo, xpayTestConfig())
	body, err := json.Marshal(map[string]any{
		"Event": "xpay_goods_deliver_notify", "openid": openID, "OutTradeNo": "PMX1", "env": 1,
		"GoodsInfo":     map[string]any{"ProductId": planCode, "Quantity": 1, "OrigPrice": 990, "ActualPrice": 990},
		"WechatPayInfo": map[string]any{"PaidTime": paidAt.Unix(), "TransactionId": "WXTX1"},
	})
	require.NoError(t, err)

	require.NoError(t, svc.HandleXPayNotify(context.Background(), body))
	require.NotNil(t, repo.membership)
	firstExpiry := *repo.membership.ExpiresAt
	require.NoError(t, svc.HandleXPayNotify(context.Background(), body))

	assert.Equal(t, "paid", payment.Status)
	assert.Equal(t, firstExpiry, *repo.membership.ExpiresAt, "duplicate delivery must not extend membership twice")
	activation, _ := payment.Extra[xpayActivationExtraKey].(map[string]any)
	assert.Equal(t, xpayActivationApplied, activation["status"])
}

func TestHandleXPayNotifySuccessfulRefundRestoresPreviousMembership(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	previousStart := now.AddDate(0, -1, 0)
	previousExpiry := now.AddDate(0, 1, 0)
	activatedExpiry := previousExpiry.AddDate(0, 1, 0)
	previousPlan := "light_monthly"
	payment := &domain.MembershipPayment{
		ID: "pay-2", UserID: "u1", PlanCode: previousPlan, OrderNo: "PMX2", Amount: 9.9,
		DurationMonths: 1, PayChannel: "wechat_virtual_payment", TradeType: "XPAY", Status: "paid",
		Extra: map[string]any{
			xpayMembershipBeforeExtraKey: map[string]any{
				"exists": true, "current_plan_code": previousPlan, "status": "active",
				"current_period_start": previousStart.Format(time.RFC3339), "expires_at": previousExpiry.Format(time.RFC3339),
				"last_paid_at": previousStart.Format(time.RFC3339), "auto_renew": false, "daily_credits": 8,
			},
			xpayActivationExtraKey: map[string]any{
				"status": xpayActivationApplied, "current_plan_code": previousPlan, "membership_status": "active",
				"first_activated_at":   previousStart.Format(time.RFC3339),
				"current_period_start": previousStart.Format(time.RFC3339), "expires_at": activatedExpiry.Format(time.RFC3339),
				"last_paid_at": now.Format(time.RFC3339), "auto_renew": false, "daily_credits": 8,
			},
		},
	}
	repo := &mockMembershipRepo{
		payment: payment,
		membership: &domain.UserMembership{
			ID: "membership-1", UserID: "u1", CurrentPlanCode: &previousPlan, Status: "active",
			FirstActivatedAt: &previousStart, CurrentPeriodStart: &previousStart, ExpiresAt: &activatedExpiry, LastPaidAt: &now, DailyCredits: 8,
		},
	}
	svc := NewMembershipService(repo, xpayTestConfig())
	body, err := json.Marshal(map[string]any{
		"Event": "xpay_refund_notify", "MchOrderId": "PMX2", "MchRefundId": "R1",
		"RefundFee": 990, "RetCode": 0, "RefundSuccTimestamp": now.Unix(),
	})
	require.NoError(t, err)

	require.NoError(t, svc.HandleXPayNotify(context.Background(), body))

	assert.Equal(t, "refunded", payment.Status)
	require.NotNil(t, payment.RefundedAt)
	require.NotNil(t, repo.membership.ExpiresAt)
	assert.Equal(t, previousExpiry, *repo.membership.ExpiresAt)
	assert.Equal(t, previousPlan, *repo.membership.CurrentPlanCode)
	assert.Equal(t, "restored", payment.Extra[xpayRefundEntitlementExtraKey])
}

func xpayTestConfig() *config.Config {
	return &config.Config{Wechat: config.WechatConfig{
		MiniProgram: config.WechatMiniProgramConfig{AppID: "wx-test", AppSecret: "secret"},
		XPay:        config.WechatXPayConfig{OfferID: "offer", AppKey: "app-key", Sandbox: true, MessageToken: "token"},
	}}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
