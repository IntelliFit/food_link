package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
	"food_link/backend/pkg/logger"
)

const (
	xpaySessionURL                = "https://api.weixin.qq.com/sns/jscode2session"
	xpayMembershipBeforeExtraKey  = "xpay_membership_before_purchase"
	xpayActivationExtraKey        = "xpay_membership_activation"
	xpayRefundEntitlementExtraKey = "xpay_refund_entitlement"
	xpayActivationPrepared        = "prepared"
	xpayActivationApplied         = "applied"
	xpayRefundEntitlementRestored = "restored"
	xpayRefundEntitlementManual   = "manual_review"
)

type CreateVirtualMembershipPaymentInput struct {
	PlanCode  string
	LoginCode string
}

type xpayConfig struct {
	OfferID              string
	AppKey               string
	Sandbox              bool
	MessageToken         string
	MiniProgramAppID     string
	MiniProgramAppSecret string
}

type xpaySignData struct {
	OfferID      string `json:"offerId"`
	BuyQuantity  int    `json:"buyQuantity"`
	Env          int    `json:"env"`
	CurrencyType string `json:"currencyType"`
	ProductID    string `json:"productId"`
	GoodsPrice   int    `json:"goodsPrice"`
	OutTradeNo   string `json:"outTradeNo"`
	Attach       string `json:"attach"`
}

type xpayGoodsInfo struct {
	ProductID   string `json:"ProductId"`
	Quantity    int    `json:"Quantity"`
	OrigPrice   int    `json:"OrigPrice"`
	ActualPrice int    `json:"ActualPrice"`
	Attach      string `json:"Attach"`
}

type xpayWechatPayInfo struct {
	PaidTime      int64  `json:"PaidTime"`
	TransactionID string `json:"TransactionId"`
}

type xpayGoodsDeliverNotify struct {
	MsgType       string            `json:"MsgType"`
	Event         string            `json:"Event"`
	OpenID        string            `json:"openid"`
	OutTradeNo    string            `json:"OutTradeNo"`
	Env           int               `json:"env"`
	GoodsInfo     xpayGoodsInfo     `json:"GoodsInfo"`
	WechatPayInfo xpayWechatPayInfo `json:"WechatPayInfo"`
}

type xpayRefundNotify struct {
	MsgType                  string `json:"MsgType"`
	Event                    string `json:"Event"`
	OpenID                   string `json:"OpenId"`
	WxRefundID               string `json:"WxRefundId"`
	MchRefundID              string `json:"MchRefundId"`
	WxOrderID                string `json:"WxOrderId"`
	MchOrderID               string `json:"MchOrderId"`
	RefundFee                int    `json:"RefundFee"`
	RetCode                  int    `json:"RetCode"`
	RetMsg                   string `json:"RetMsg"`
	RefundStartTimestamp     int64  `json:"RefundStartTimestamp"`
	RefundSuccessTimestamp   int64  `json:"RefundSuccTimestamp"`
	WxpayRefundTransactionID string `json:"WxpayRefundTransactionId"`
	RetryTimes               int    `json:"RetryTimes"`
}

func (s *MembershipService) xpayConfig() (*xpayConfig, error) {
	if s.cfg == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少小程序虚拟支付配置", HTTPStatus: http.StatusServiceUnavailable}
	}
	cfg := &xpayConfig{
		OfferID:              strings.TrimSpace(s.cfg.Wechat.XPay.OfferID),
		AppKey:               strings.TrimSpace(s.cfg.Wechat.XPay.AppKey),
		Sandbox:              s.cfg.Wechat.XPay.Sandbox,
		MessageToken:         strings.TrimSpace(s.cfg.Wechat.XPay.MessageToken),
		MiniProgramAppID:     strings.TrimSpace(s.cfg.WechatMiniProgramAppID()),
		MiniProgramAppSecret: strings.TrimSpace(s.cfg.WechatMiniProgramAppSecret()),
	}
	missing := make([]string, 0, 4)
	if cfg.OfferID == "" {
		missing = append(missing, "WECHAT_XPAY_OFFER_ID")
	}
	if cfg.AppKey == "" {
		missing = append(missing, "WECHAT_XPAY_APP_KEY")
	}
	if cfg.MiniProgramAppID == "" {
		missing = append(missing, "WECHAT_MINI_PROGRAM_APP_ID")
	}
	if cfg.MiniProgramAppSecret == "" {
		missing = append(missing, "WECHAT_MINI_PROGRAM_APP_SECRET")
	}
	if len(missing) > 0 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少小程序虚拟支付配置：" + strings.Join(missing, ", "), HTTPStatus: http.StatusServiceUnavailable}
	}
	return cfg, nil
}

// CreateVirtualPayment creates only the merchant-side pending order. The
// platform payment UI is opened by wx.requestVirtualPayment on the client.
func (s *MembershipService) CreateVirtualPayment(ctx context.Context, userID string, input CreateVirtualMembershipPaymentInput) (map[string]any, error) {
	planCode := strings.TrimSpace(input.PlanCode)
	loginCode := strings.TrimSpace(input.LoginCode)
	if loginCode == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请刷新小程序登录状态后重试", HTTPStatus: http.StatusBadRequest}
	}
	plan, err := s.repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if plan == nil || !plan.IsActive || !plan.IsVisible || plan.IsTestPlan {
		return nil, commonerrors.ErrNotFound
	}
	if err := s.ensurePlanPurchaseAllowed(ctx, userID, plan); err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil || strings.TrimSpace(user.OpenID) == "" || isAppOnlyOpenID(user.OpenID) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前账号不是有效的小程序登录用户，无法发起虚拟支付", HTTPStatus: http.StatusBadRequest}
	}
	if err := enforceMinorPaymentLimit(user, plan.Amount); err != nil {
		return nil, err
	}
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	cfg, err := s.xpayConfig()
	if err != nil {
		return nil, err
	}
	openID, sessionKey, err := s.exchangeXPaySession(ctx, cfg, loginCode)
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(openID), []byte(strings.TrimSpace(user.OpenID))) {
		return nil, &commonerrors.AppError{Code: 10003, Message: "支付登录用户与当前账号不一致，请重新登录后重试", HTTPStatus: http.StatusForbidden}
	}
	orderNo := generateMembershipOrderNo()
	priceFen := amountToFen(plan.Amount)
	if priceFen <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "会员套餐价格配置异常", HTTPStatus: http.StatusBadRequest}
	}
	env := 0
	if cfg.Sandbox {
		env = 1
	}
	signPayload := xpaySignData{OfferID: cfg.OfferID, BuyQuantity: 1, Env: env, CurrencyType: "CNY", ProductID: plan.Code, GoodsPrice: priceFen, OutTradeNo: orderNo, Attach: "membership:" + plan.Code}
	signDataBytes, err := json.Marshal(signPayload)
	if err != nil {
		return nil, err
	}
	signData := string(signDataBytes)
	paySig := xpayHMACSHA256(cfg.AppKey, "requestVirtualPayment&"+signData)
	signature := xpayHMACSHA256(sessionKey, signData)
	_, _ = s.repo.ExpirePendingMembershipOrders(ctx, userID, "", "superseded_by_new_virtual_order")
	extra := map[string]any{
		"payment_provider":           "wechat_xpay",
		"xpay_env":                   env,
		"xpay_product_id":            plan.Code,
		"xpay_goods_price":           priceFen,
		"xpay_sign_data":             signData,
		xpayMembershipBeforeExtraKey: membershipSnapshotForXPay(membership),
	}
	payment := &domain.MembershipPayment{UserID: userID, PlanCode: plan.Code, OrderNo: orderNo, Amount: plan.Amount, Currency: "CNY", DurationMonths: plan.DurationMonths, PayChannel: "wechat_virtual_payment", TradeType: "XPAY", Status: "pending", WxOpenID: &openID, Extra: extra}
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}
	logger.Info(ctx, "虚拟支付会员订单创建成功", slog.String("user_id", userID), slog.String("order_no", orderNo), slog.String("plan_code", plan.Code), slog.Int("amount_fen", priceFen), slog.Int("xpay.env", env))
	return map[string]any{"order_no": orderNo, "plan_code": plan.Code, "amount": plan.Amount, "virtual_payment": map[string]string{"signData": signData, "paySig": paySig, "signature": signature, "mode": "short_series_goods"}}, nil
}

func (s *MembershipService) exchangeXPaySession(ctx context.Context, cfg *xpayConfig, code string) (string, string, error) {
	query := url.Values{"appid": {cfg.MiniProgramAppID}, "secret": {cfg.MiniProgramAppSecret}, "js_code": {code}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, xpaySessionURL+"?"+query.Encode(), nil)
	if err != nil {
		return "", "", err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	var result struct {
		OpenID     string `json:"openid"`
		SessionKey string `json:"session_key"`
		ErrCode    int    `json:"errcode"`
		ErrMsg     string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", err
	}
	if resp.StatusCode != http.StatusOK || result.ErrCode != 0 || strings.TrimSpace(result.OpenID) == "" || strings.TrimSpace(result.SessionKey) == "" {
		return "", "", &commonerrors.AppError{Code: 10000, Message: "获取虚拟支付登录态失败，请重试", HTTPStatus: http.StatusBadGateway}
	}
	return strings.TrimSpace(result.OpenID), strings.TrimSpace(result.SessionKey), nil
}

func xpayHMACSHA256(key, value string) string {
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func validateXPayMessageSignature(token, timestamp, nonce, signature string) bool {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(timestamp) == "" || strings.TrimSpace(nonce) == "" || strings.TrimSpace(signature) == "" {
		return false
	}
	parts := []string{token, timestamp, nonce}
	sort.Strings(parts)
	sum := sha1.Sum([]byte(strings.Join(parts, "")))
	return hmac.Equal([]byte(hex.EncodeToString(sum[:])), []byte(strings.ToLower(strings.TrimSpace(signature))))
}

func (s *MembershipService) VerifyXPayCallback(timestamp, nonce, signature string) (bool, error) {
	cfg, err := s.xpayConfig()
	if err != nil {
		return false, err
	}
	if cfg.MessageToken == "" {
		return false, &commonerrors.AppError{Code: 10000, Message: "缺少 WECHAT_XPAY_MESSAGE_TOKEN，无法验证发货推送", HTTPStatus: http.StatusServiceUnavailable}
	}
	return validateXPayMessageSignature(cfg.MessageToken, timestamp, nonce, signature), nil
}

func (s *MembershipService) HandleXPayNotify(ctx context.Context, body []byte) error {
	var envelope struct {
		Event string `json:"Event"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return &commonerrors.AppError{Code: 10002, Message: "虚拟支付通知解析失败", HTTPStatus: http.StatusBadRequest}
	}
	switch strings.TrimSpace(envelope.Event) {
	case "xpay_goods_deliver_notify":
		return s.HandleXPayGoodsDeliverNotify(ctx, body)
	case "xpay_refund_notify":
		return s.handleXPayRefundNotify(ctx, body)
	default:
		return &commonerrors.AppError{Code: 10002, Message: "不支持的虚拟支付通知事件", HTTPStatus: http.StatusBadRequest}
	}
}

func (s *MembershipService) HandleXPayGoodsDeliverNotify(ctx context.Context, body []byte) error {
	cfg, err := s.xpayConfig()
	if err != nil {
		return err
	}
	var notice xpayGoodsDeliverNotify
	if err := json.Unmarshal(body, &notice); err != nil {
		return &commonerrors.AppError{Code: 10002, Message: "虚拟支付发货通知解析失败", HTTPStatus: http.StatusBadRequest}
	}
	if notice.Event != "xpay_goods_deliver_notify" || notice.OutTradeNo == "" {
		return &commonerrors.AppError{Code: 10002, Message: "不是有效的虚拟支付发货通知", HTTPStatus: http.StatusBadRequest}
	}
	payment, err := s.repo.GetPaymentByOrderNo(ctx, strings.TrimSpace(notice.OutTradeNo))
	if err != nil {
		return err
	}
	if payment == nil {
		return commonerrors.ErrNotFound
	}
	if payment.PayChannel != "wechat_virtual_payment" || payment.TradeType != "XPAY" {
		return &commonerrors.AppError{Code: 10003, Message: "虚拟支付订单类型不匹配", HTTPStatus: http.StatusForbidden}
	}
	expectedEnv := 0
	if cfg.Sandbox {
		expectedEnv = 1
	}
	if notice.Env != expectedEnv || notice.GoodsInfo.ProductID != payment.PlanCode || notice.GoodsInfo.Quantity != 1 || notice.GoodsInfo.ActualPrice != amountToFen(payment.Amount) || (payment.WxOpenID != nil && strings.TrimSpace(*payment.WxOpenID) != strings.TrimSpace(notice.OpenID)) {
		return &commonerrors.AppError{Code: 10003, Message: "虚拟支付发货通知与订单不一致", HTTPStatus: http.StatusForbidden}
	}
	paidAt := time.Now()
	if notice.WechatPayInfo.PaidTime > 0 {
		paidAt = time.Unix(notice.WechatPayInfo.PaidTime, 0)
	}
	extra := copyXPayMap(payment.Extra)
	activation, activationReady := xpayActivationFromExtra(extra)
	if activationReady && strings.TrimSpace(stringFromAny(activation["status"])) == xpayActivationApplied {
		return nil
	}
	if !activationReady {
		updates, err := s.membershipUpdatesFromPayment(ctx, payment, paidAt)
		if err != nil {
			return err
		}
		activation = xpayActivationFromMembershipUpdates(updates, xpayActivationPrepared)
		extra[xpayActivationExtraKey] = activation
	}
	payload := copyXPayMap(payment.NotifyPayload)
	payload["xpay_goods_deliver_notify"] = notice
	transactionID := strings.TrimSpace(notice.WechatPayInfo.TransactionID)
	if err := s.repo.UpdatePaymentByOrderNo(ctx, payment.OrderNo, map[string]any{
		"status":            "paid",
		"wx_transaction_id": transactionID,
		"paid_at":           paidAt,
		"notify_payload":    payload,
		"extra":             extra,
	}); err != nil {
		return err
	}
	payment.Status, payment.PaidAt, payment.Extra, payment.NotifyPayload = "paid", &paidAt, extra, payload
	if transactionID != "" {
		payment.WxTransactionID = &transactionID
	}
	membershipUpdates, ok := membershipUpdatesFromXPayActivation(activation)
	if !ok {
		return &commonerrors.AppError{Code: 10000, Message: "虚拟支付会员权益数据异常", HTTPStatus: http.StatusInternalServerError}
	}
	if _, err := s.repo.SaveMembership(ctx, payment.UserID, membershipUpdates); err != nil {
		return err
	}
	activation["status"] = xpayActivationApplied
	activation["applied_at"] = time.Now().Format(time.RFC3339Nano)
	extra[xpayActivationExtraKey] = activation
	if err := s.repo.UpdatePaymentByOrderNo(ctx, payment.OrderNo, map[string]any{"extra": extra}); err != nil {
		return err
	}
	logger.Info(ctx, "虚拟支付发货通知已开通会员", slog.String("user_id", payment.UserID), slog.String("order_no", payment.OrderNo), slog.String("plan_code", payment.PlanCode), slog.Int("amount_fen", notice.GoodsInfo.ActualPrice))
	return nil
}

func (s *MembershipService) handleXPayRefundNotify(ctx context.Context, body []byte) error {
	var notice xpayRefundNotify
	if err := json.Unmarshal(body, &notice); err != nil {
		return &commonerrors.AppError{Code: 10002, Message: "虚拟支付退款通知解析失败", HTTPStatus: http.StatusBadRequest}
	}
	orderNo := strings.TrimSpace(notice.MchOrderID)
	if notice.Event != "xpay_refund_notify" || orderNo == "" {
		return &commonerrors.AppError{Code: 10002, Message: "不是有效的虚拟支付退款通知", HTTPStatus: http.StatusBadRequest}
	}
	payment, err := s.repo.GetPaymentByOrderNo(ctx, orderNo)
	if err != nil {
		return err
	}
	if payment == nil {
		return commonerrors.ErrNotFound
	}
	if payment.PayChannel != "wechat_virtual_payment" || payment.TradeType != "XPAY" {
		return &commonerrors.AppError{Code: 10003, Message: "虚拟支付订单类型不匹配", HTTPStatus: http.StatusForbidden}
	}
	payload := copyXPayMap(payment.NotifyPayload)
	payload["xpay_refund_notify"] = notice
	extra := copyXPayMap(payment.Extra)
	if notice.RetCode != 0 {
		extra["xpay_refund_result"] = "failed"
		extra["xpay_refund_message"] = strings.TrimSpace(notice.RetMsg)
		if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"notify_payload": payload, "extra": extra}); err != nil {
			return err
		}
		logger.Warn(ctx, "虚拟支付退款任务失败", slog.String("user_id", payment.UserID), slog.String("order_no", orderNo), slog.Int("ret_code", notice.RetCode))
		return nil
	}
	if notice.RefundFee < amountToFen(payment.Amount) {
		extra[xpayRefundEntitlementExtraKey] = xpayRefundEntitlementManual
		extra["xpay_refund_reason"] = "partial_refund_requires_manual_review"
		if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"notify_payload": payload, "extra": extra}); err != nil {
			return err
		}
		logger.Warn(ctx, "虚拟支付部分退款需人工核对会员权益", slog.String("user_id", payment.UserID), slog.String("order_no", orderNo), slog.Int("refund_fee", notice.RefundFee))
		return nil
	}
	refundedAt := time.Now()
	if notice.RefundSuccessTimestamp > 0 {
		refundedAt = time.Unix(notice.RefundSuccessTimestamp, 0)
	}
	if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{
		"status":         "refunded",
		"refunded_at":    refundedAt,
		"notify_payload": payload,
		"extra":          extra,
	}); err != nil {
		return err
	}
	payment.Status, payment.RefundedAt, payment.NotifyPayload = "refunded", &refundedAt, payload
	if state := strings.TrimSpace(stringFromAny(extra[xpayRefundEntitlementExtraKey])); state == xpayRefundEntitlementRestored || state == xpayRefundEntitlementManual {
		return nil
	}
	current, err := s.repo.GetUserProMembership(ctx, payment.UserID)
	if err != nil {
		return err
	}
	activation, activationOK := xpayActivationFromExtra(extra)
	before, beforeOK := xpayMembershipSnapshotFromExtra(extra[xpayMembershipBeforeExtraKey])
	if activationOK && beforeOK && membershipMatchesXPayActivation(current, activation) {
		if _, err := s.repo.SaveMembership(ctx, payment.UserID, before); err != nil {
			return err
		}
		extra[xpayRefundEntitlementExtraKey] = xpayRefundEntitlementRestored
	} else if beforeOK && membershipMatchesXPayUpdates(current, before) {
		// The membership restore succeeded but the final payment-extra write may
		// have failed. Treat the retry as success without mutating entitlement.
		extra[xpayRefundEntitlementExtraKey] = xpayRefundEntitlementRestored
	} else {
		extra[xpayRefundEntitlementExtraKey] = xpayRefundEntitlementManual
		extra["xpay_refund_reason"] = "membership_changed_or_snapshot_missing"
	}
	if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"extra": extra}); err != nil {
		return err
	}
	logger.Info(ctx, "虚拟支付退款通知处理完成",
		slog.String("user_id", payment.UserID),
		slog.String("order_no", orderNo),
		slog.Int("refund_fee", notice.RefundFee),
		slog.String("entitlement_result", stringFromAny(extra[xpayRefundEntitlementExtraKey])),
	)
	return nil
}

func membershipSnapshotForXPay(membership *domain.UserMembership) map[string]any {
	if membership == nil {
		return map[string]any{"exists": false}
	}
	return map[string]any{
		"exists":               true,
		"current_plan_code":    stringValue(membership.CurrentPlanCode),
		"status":               membership.Status,
		"first_activated_at":   xpayTimeValue(membership.FirstActivatedAt),
		"current_period_start": xpayTimeValue(membership.CurrentPeriodStart),
		"expires_at":           xpayTimeValue(membership.ExpiresAt),
		"last_paid_at":         xpayTimeValue(membership.LastPaidAt),
		"auto_renew":           membership.AutoRenew,
		"daily_credits":        membership.DailyCredits,
	}
}

func xpayActivationFromMembershipUpdates(updates map[string]any, status string) map[string]any {
	return map[string]any{
		"status":               status,
		"current_plan_code":    updates["current_plan_code"],
		"membership_status":    updates["status"],
		"first_activated_at":   xpayTimeAnyValue(updates["first_activated_at"]),
		"current_period_start": xpayTimeAnyValue(updates["current_period_start"]),
		"expires_at":           xpayTimeAnyValue(updates["expires_at"]),
		"last_paid_at":         xpayTimeAnyValue(updates["last_paid_at"]),
		"auto_renew":           updates["auto_renew"],
		"daily_credits":        updates["daily_credits"],
	}
}

func membershipUpdatesFromXPayActivation(activation map[string]any) (map[string]any, bool) {
	planCode := strings.TrimSpace(stringFromAny(activation["current_plan_code"]))
	status := strings.TrimSpace(stringFromAny(activation["membership_status"]))
	first := timeFromAny(activation["first_activated_at"])
	start := timeFromAny(activation["current_period_start"])
	expires := timeFromAny(activation["expires_at"])
	lastPaid := timeFromAny(activation["last_paid_at"])
	if planCode == "" || status == "" || first == nil || start == nil || expires == nil || lastPaid == nil {
		return nil, false
	}
	return map[string]any{
		"current_plan_code": planCode, "status": status, "first_activated_at": *first,
		"current_period_start": *start, "expires_at": *expires, "last_paid_at": *lastPaid,
		"auto_renew": boolFromAny(activation["auto_renew"]), "daily_credits": intFromAny(activation["daily_credits"]),
	}, true
}

func xpayMembershipSnapshotFromExtra(value any) (map[string]any, bool) {
	raw, ok := value.(map[string]any)
	if !ok || raw == nil {
		return nil, false
	}
	if !boolFromAny(raw["exists"]) {
		return map[string]any{
			"current_plan_code": nil, "status": "inactive", "first_activated_at": nil,
			"current_period_start": nil, "expires_at": nil, "last_paid_at": nil,
			"auto_renew": false, "daily_credits": 0,
		}, true
	}
	planCode := strings.TrimSpace(stringFromAny(raw["current_plan_code"]))
	status := strings.TrimSpace(stringFromAny(raw["status"]))
	if planCode == "" || status == "" {
		return nil, false
	}
	updates := map[string]any{
		"current_plan_code": planCode,
		"status":            status,
		"auto_renew":        boolFromAny(raw["auto_renew"]),
		"daily_credits":     intFromAny(raw["daily_credits"]),
	}
	for _, key := range []string{"first_activated_at", "current_period_start", "expires_at", "last_paid_at"} {
		if parsed := timeFromAny(raw[key]); parsed != nil {
			updates[key] = *parsed
		} else {
			updates[key] = nil
		}
	}
	return updates, true
}

func membershipMatchesXPayActivation(membership *domain.UserMembership, activation map[string]any) bool {
	updates, ok := membershipUpdatesFromXPayActivation(activation)
	if !ok {
		return false
	}
	return membershipMatchesXPayUpdates(membership, updates)
}

func membershipMatchesXPayUpdates(membership *domain.UserMembership, updates map[string]any) bool {
	if membership == nil {
		return false
	}
	expectedPlan := strings.TrimSpace(stringFromAny(updates["current_plan_code"]))
	actualPlan := ""
	if membership.CurrentPlanCode != nil {
		actualPlan = strings.TrimSpace(*membership.CurrentPlanCode)
	}
	if actualPlan != expectedPlan || membership.Status != stringFromAny(updates["status"]) || membership.DailyCredits != intFromAny(updates["daily_credits"]) || membership.AutoRenew != boolFromAny(updates["auto_renew"]) {
		return false
	}
	return xpayTimesEqual(membership.FirstActivatedAt, updates["first_activated_at"]) &&
		xpayTimesEqual(membership.CurrentPeriodStart, updates["current_period_start"]) &&
		xpayTimesEqual(membership.ExpiresAt, updates["expires_at"]) &&
		xpayTimesEqual(membership.LastPaidAt, updates["last_paid_at"])
}

func xpayTimesEqual(actual *time.Time, expected any) bool {
	want := timeFromAny(expected)
	if actual == nil || want == nil {
		return actual == nil && want == nil
	}
	return actual.Equal(*want)
}

func xpayActivationFromExtra(extra map[string]any) (map[string]any, bool) {
	activation, ok := extra[xpayActivationExtraKey].(map[string]any)
	return activation, ok && activation != nil
}

func copyXPayMap(source map[string]any) map[string]any {
	out := make(map[string]any, len(source)+1)
	for key, value := range source {
		out[key] = value
	}
	return out
}

func xpayTimeValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339Nano)
}

func xpayTimeAnyValue(value any) any {
	if parsed := timeFromAny(value); parsed != nil {
		return parsed.Format(time.RFC3339Nano)
	}
	return nil
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func boolFromAny(value any) bool {
	result, _ := value.(bool)
	return result
}

func XPaySuccessResponse() map[string]any { return map[string]any{"ErrCode": 0, "ErrMsg": "success"} }
