package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
