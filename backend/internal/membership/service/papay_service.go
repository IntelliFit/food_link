package service

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
	"food_link/backend/pkg/logger"
)

const (
	papaySigningEnabled       = false
	papaySignMiniProgramAppID = "wxbd687630cd02ce1d"
	papayV2ApplyURL           = "https://api.mch.weixin.qq.com/pay/pappayapply"
	papayV2TerminateURL       = "https://api.mch.weixin.qq.com/papay/deletecontract"
	papayFirstChargeWindow    = 12 * time.Hour
	papayRetryDelay           = 15 * time.Minute
)

var papayTemplateIDsByPlanCode = map[string]string{
	"light_monthly":      "214835",
	"standard_monthly":   "214826",
	"advanced_monthly":   "214836",
	"light_quarterly":    "214837",
	"standard_quarterly": "214838",
	"advanced_quarterly": "214839",
	"light_yearly":       "214840",
	"standard_yearly":    "214841",
	"advanced_yearly":    "214842",
}

// PapayContractRepository is intentionally separate from MembershipRepo so the
// existing membership service tests can keep lightweight payment-only mocks.
type PapayContractRepository interface {
	CreatePapayContract(ctx context.Context, contract *domain.PapayContract) error
	GetEffectivePapayContract(ctx context.Context, userID string) (*domain.PapayContract, error)
	GetPapayContractByMerchantCode(ctx context.Context, code string) (*domain.PapayContract, error)
	GetPapayContractByWechatID(ctx context.Context, contractID string) (*domain.PapayContract, error)
	UpdatePapayContract(ctx context.Context, id string, updates map[string]any) error
	ListPapayContractsReadyForAction(ctx context.Context, now time.Time, limit int) ([]domain.PapayContract, error)
	ClaimPapayContractAction(ctx context.Context, id, state string) (bool, error)
}

type papayConfig struct {
	AppID         string
	MchID         string
	APIV2Key      string
	SignNotifyURL string
	PayNotifyURL  string
	SerialNo      string
	PrivateKey    string
}

func (s *MembershipService) papayConfig() (*papayConfig, error) {
	pay, err := s.wechatPayConfig()
	if err != nil {
		return nil, err
	}
	resolved := s.cfg.ResolvedWechatPay()
	cfg := &papayConfig{
		AppID:         pay.MiniProgramAppID,
		MchID:         pay.MchID,
		APIV2Key:      strings.TrimSpace(resolved.APIV2Key),
		SignNotifyURL: strings.TrimSpace(resolved.PapaySignNotifyURL),
		PayNotifyURL:  strings.TrimSpace(resolved.PapayPayNotifyURL),
		SerialNo:      pay.SerialNo,
		PrivateKey:    pay.PrivateKey,
	}
	missing := make([]string, 0, 3)
	if cfg.AppID == "" {
		missing = append(missing, "WECHAT_MINI_PROGRAM_APP_ID")
	}
	if cfg.APIV2Key == "" {
		missing = append(missing, "WECHAT_PAY_API_V2_KEY")
	}
	if cfg.SignNotifyURL == "" {
		missing = append(missing, "WECHAT_PAY_PAPAY_SIGN_NOTIFY_URL")
	}
	if cfg.PayNotifyURL == "" {
		missing = append(missing, "WECHAT_PAY_PAPAY_PAY_NOTIFY_URL")
	}
	if len(missing) > 0 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少微信委托代扣配置：" + strings.Join(missing, ", "), HTTPStatus: http.StatusInternalServerError}
	}
	return cfg, nil
}

func (s *MembershipService) CreatePapaySigning(ctx context.Context, userID, planCode string) (map[string]any, error) {
	if !papaySigningEnabled {
		return nil, &commonerrors.AppError{
			Code:       10004,
			Message:    "自动续费尚未取得小程序虚拟支付会员订阅准入，当前仅支持一次性开通",
			HTTPStatus: http.StatusForbidden,
		}
	}
	if s.papayRepo == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "自动续费服务尚未初始化", HTTPStatus: http.StatusServiceUnavailable}
	}
	planCode = strings.TrimSpace(strings.ToLower(planCode))
	templateID, ok := papayTemplateIDsByPlanCode[planCode]
	if !ok {
		return nil, &commonerrors.AppError{Code: 10002, Message: "该会员套餐暂不支持自动续费", HTTPStatus: http.StatusBadRequest}
	}
	plan, err := s.repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if plan == nil || !plan.IsActive || !plan.IsVisible || plan.IsTestPlan {
		return nil, &commonerrors.AppError{Code: 10002, Message: "该会员套餐当前不可开通自动续费", HTTPStatus: http.StatusBadRequest}
	}
	if existing, err := s.papayRepo.GetEffectivePapayContract(ctx, userID); err != nil {
		return nil, err
	} else if existing != nil {
		return nil, &commonerrors.AppError{Code: 10003, Message: "你已开通或正在开通自动续费，请先关闭当前自动续费", HTTPStatus: http.StatusConflict}
	}
	membership, err := s.repo.GetActiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	if membership != nil && membership.CurrentPlanCode != nil && strings.TrimSpace(*membership.CurrentPlanCode) != planCode {
		return nil, &commonerrors.AppError{Code: 10003, Message: "自动续费仅支持当前生效套餐；切换套餐请使用一次性购买", HTTPStatus: http.StatusConflict}
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return nil, err
	}
	contractCode, err := newPapayContractCode()
	if err != nil {
		return nil, err
	}
	requestSerial := strconv.FormatInt(time.Now().UnixMilli(), 10)
	if err := s.papayRepo.CreatePapayContract(ctx, &domain.PapayContract{
		UserID:               userID,
		PlanCode:             planCode,
		TemplateID:           templateID,
		MerchantContractCode: contractCode,
		Status:               "pending",
		RenewalState:         "awaiting_sign",
		RequestSerial:        requestSerial,
	}); err != nil {
		return nil, err
	}
	timestamp := time.Now().Unix()
	encodedNotifyURL := url.QueryEscape(cfg.SignNotifyURL)
	signFields := map[string]string{
		"appid":                    cfg.AppID,
		"mch_id":                   cfg.MchID,
		"plan_id":                  templateID,
		"contract_code":            contractCode,
		"request_serial":           requestSerial,
		"contract_display_account": "食探会员",
		"notify_url":               encodedNotifyURL,
		"timestamp":                strconv.FormatInt(timestamp, 10),
		"outerid":                  userID,
	}
	signFields["sign"] = signPapayV2(signFields, cfg.APIV2Key)
	return map[string]any{
		"target_app_id": papaySignMiniProgramAppID,
		"path":          "pages/index/index",
		"extra_data": map[string]any{
			"appid":                    signFields["appid"],
			"mch_id":                   signFields["mch_id"],
			"plan_id":                  signFields["plan_id"],
			"contract_code":            signFields["contract_code"],
			"request_serial":           timestampToInt64(requestSerial),
			"contract_display_account": signFields["contract_display_account"],
			"notify_url":               signFields["notify_url"],
			"timestamp":                timestamp,
			"outerid":                  signFields["outerid"],
			"sign":                     signFields["sign"],
		},
		"plan_code": planCode,
		"plan_name": plan.Name,
	}, nil
}

func (s *MembershipService) HandlePapayContractNotify(ctx context.Context, body []byte) error {
	notice, err := parsePapayV2XML(body)
	if err != nil {
		return err
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return err
	}
	if err := verifyPapayV2Notice(notice, cfg); err != nil {
		return err
	}
	contractCode := strings.TrimSpace(notice["contract_code"])
	contract, err := s.papayRepo.GetPapayContractByMerchantCode(ctx, contractCode)
	if err != nil {
		return err
	}
	if contract == nil {
		return &commonerrors.AppError{Code: 10004, Message: "未找到对应的自动续费签约", HTTPStatus: http.StatusNotFound}
	}
	if strings.TrimSpace(notice["plan_id"]) != contract.TemplateID {
		return &commonerrors.AppError{Code: 10002, Message: "自动续费模板不匹配", HTTPStatus: http.StatusBadRequest}
	}
	if !papayNoticeSuccess(notice) {
		message := papayNoticeMessage(notice)
		return s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
			"status":              "failed",
			"renewal_state":       "sign_failed",
			"last_error":          message,
			"sign_notify_payload": notice,
		})
	}
	wechatContractID := strings.TrimSpace(notice["contract_id"])
	if wechatContractID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "微信签约通知缺少 contract_id", HTTPStatus: http.StatusBadRequest}
	}
	now := time.Now()
	state := "initial_pending"
	nextActionAt := now
	var renewalDueAt *time.Time
	membership, err := s.repo.GetActiveMembership(ctx, contract.UserID)
	if err != nil {
		return err
	}
	if membership != nil && membership.CurrentPlanCode != nil && *membership.CurrentPlanCode == contract.PlanCode && membership.ExpiresAt != nil && membership.ExpiresAt.After(now) {
		due := *membership.ExpiresAt
		renewalDueAt = &due
		state = "renewal_pending"
		preNotifyAt := papayPreNotifyTime(due)
		nextActionAt = preNotifyAt
	}
	updates := map[string]any{
		"wechat_contract_id":  wechatContractID,
		"openid":              strings.TrimSpace(notice["openid"]),
		"status":              "active",
		"renewal_state":       state,
		"next_action_at":      nextActionAt,
		"renewal_due_at":      renewalDueAt,
		"last_error":          nil,
		"sign_notify_payload": notice,
	}
	if err := s.papayRepo.UpdatePapayContract(ctx, contract.ID, updates); err != nil {
		return err
	}
	if membership != nil {
		_, _ = s.repo.SaveMembership(ctx, contract.UserID, map[string]any{"auto_renew": true})
	}
	logger.Info(ctx, "微信自动续费签约成功",
		slog.String("user_id", contract.UserID),
		slog.String("plan_code", contract.PlanCode),
		slog.String("wechat.contract_id", wechatContractID),
	)
	return nil
}

func (s *MembershipService) CancelPapayContract(ctx context.Context, userID string) (map[string]any, error) {
	if s.papayRepo == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "自动续费服务尚未初始化", HTTPStatus: http.StatusServiceUnavailable}
	}
	contract, err := s.papayRepo.GetEffectivePapayContract(ctx, userID)
	if err != nil {
		return nil, err
	}
	if contract == nil || contract.Status != "active" {
		return nil, &commonerrors.AppError{Code: 10004, Message: "当前没有可关闭的自动续费", HTTPStatus: http.StatusNotFound}
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return nil, err
	}
	params := map[string]string{
		"appid":                       cfg.AppID,
		"mch_id":                      cfg.MchID,
		"contract_termination_remark": "用户主动关闭自动续费",
		"version":                     "1.0",
	}
	if contract.WechatContractID != nil && strings.TrimSpace(*contract.WechatContractID) != "" {
		params["contract_id"] = strings.TrimSpace(*contract.WechatContractID)
	} else {
		params["plan_id"] = contract.TemplateID
		params["contract_code"] = contract.MerchantContractCode
	}
	result, err := s.callPapayV2XML(ctx, papayV2TerminateURL, params, cfg.APIV2Key)
	if err != nil {
		return nil, err
	}
	if !papayNoticeSuccess(result) {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信解约失败：" + papayNoticeMessage(result), HTTPStatus: http.StatusBadGateway}
	}
	if err := s.markPapayContractTerminated(ctx, contract, "merchant_cancel", result); err != nil {
		return nil, err
	}
	return map[string]any{"cancelled": true, "contract": formatPapayContract(contract)}, nil
}

func (s *MembershipService) HandlePapayTerminateNotify(ctx context.Context, body []byte) error {
	notice, err := parsePapayV2XML(body)
	if err != nil {
		return err
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return err
	}
	if err := verifyPapayV2Notice(notice, cfg); err != nil {
		return err
	}
	contract, err := s.findPapayContractForNotice(ctx, notice)
	if err != nil {
		return err
	}
	if contract == nil {
		return &commonerrors.AppError{Code: 10004, Message: "未找到自动续费合同", HTTPStatus: http.StatusNotFound}
	}
	return s.markPapayContractTerminated(ctx, contract, "wechat_notify", notice)
}

func (s *MembershipService) HandlePapayPaymentNotify(ctx context.Context, body []byte) error {
	notice, err := parsePapayV2XML(body)
	if err != nil {
		return err
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return err
	}
	if err := verifyPapayV2Notice(notice, cfg); err != nil {
		return err
	}
	orderNo := strings.TrimSpace(notice["out_trade_no"])
	payment, err := s.repo.GetPaymentByOrderNo(ctx, orderNo)
	if err != nil {
		return err
	}
	if payment == nil || payment.PayChannel != "wechat_papay" {
		return &commonerrors.AppError{Code: 10004, Message: "未找到自动续费扣款订单", HTTPStatus: http.StatusNotFound}
	}
	if payment.Status == "paid" {
		return nil
	}
	if !papayNoticeSuccess(notice) {
		_ = s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"status": "failed", "notify_payload": notice})
		return s.resetPapayChargeAfterFailure(ctx, payment, papayNoticeMessage(notice))
	}
	if totalFee, _ := strconv.Atoi(strings.TrimSpace(notice["total_fee"])); totalFee != amountToFen(payment.Amount) {
		return &commonerrors.AppError{Code: 10002, Message: "微信自动续费金额与订单金额不一致", HTTPStatus: http.StatusBadRequest}
	}
	paidAt := parsePapayTime(notice["time_end"])
	if paidAt == nil {
		now := time.Now()
		paidAt = &now
	}
	transactionID := strings.TrimSpace(notice["transaction_id"])
	if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{
		"status":            "paid",
		"wx_transaction_id": nullableString(transactionID),
		"wx_bank_type":      nullableString(strings.TrimSpace(notice["bank_type"])),
		"paid_at":           *paidAt,
		"notify_payload":    notice,
	}); err != nil {
		return err
	}
	payment.Status = "paid"
	payment.PaidAt = paidAt
	membership, err := s.activateMembershipFromPayment(ctx, payment, *paidAt)
	if err != nil {
		return err
	}
	contractID := stringFromMap(payment.Extra, "papay_contract_id")
	contract, err := s.papayRepo.GetPapayContractByWechatID(ctx, contractID)
	if err != nil || contract == nil {
		contract, err = s.papayRepo.GetPapayContractByMerchantCode(ctx, contractID)
	}
	if err != nil {
		return err
	}
	if contract != nil && membership != nil && membership.ExpiresAt != nil {
		due := *membership.ExpiresAt
		if err := s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
			"renewal_state":  "renewal_pending",
			"renewal_due_at": due,
			"next_action_at": papayPreNotifyTime(due),
			"last_order_no":  orderNo,
			"last_error":     nil,
		}); err != nil {
			return err
		}
	}
	logger.Info(ctx, "微信自动续费扣款成功",
		slog.String("user_id", payment.UserID),
		slog.String("order_no", orderNo),
		slog.String("plan_code", payment.PlanCode),
	)
	return nil
}

func (s *MembershipService) ProcessPapayRenewals(ctx context.Context) (int, error) {
	if s.papayRepo == nil {
		return 0, nil
	}
	now := time.Now().In(chinaLocation())
	contracts, err := s.papayRepo.ListPapayContractsReadyForAction(ctx, now, 20)
	if err != nil {
		return 0, err
	}
	processed := 0
	for i := range contracts {
		contract := contracts[i]
		if !papayActionAllowedNow(now) {
			continue
		}
		claimed, claimErr := s.papayRepo.ClaimPapayContractAction(ctx, contract.ID, contract.RenewalState)
		if claimErr != nil {
			return processed, claimErr
		}
		if !claimed {
			continue
		}
		processed++
		var processErr error
		switch contract.RenewalState {
		case "renewal_pending":
			processErr = s.sendPapayPreNotify(ctx, &contract)
		case "initial_pending", "pre_notified":
			processErr = s.applyPapayCharge(ctx, &contract)
		}
		if processErr != nil {
			logger.Warn(ctx, "微信自动续费任务处理失败", logger.Err(processErr), slog.String("contract_id", contract.ID), slog.String("renewal_state", contract.RenewalState))
		}
	}
	return processed, nil
}

func (s *MembershipService) sendPapayPreNotify(ctx context.Context, contract *domain.PapayContract) error {
	if contract == nil || contract.WechatContractID == nil || strings.TrimSpace(*contract.WechatContractID) == "" {
		return s.resetPapayAction(ctx, contract, "renewal_pending", "合同缺少微信协议号")
	}
	plan, err := s.repo.GetPlanByCode(ctx, contract.PlanCode)
	if err != nil || plan == nil {
		return s.resetPapayAction(ctx, contract, "renewal_pending", "会员套餐不存在")
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return s.resetPapayAction(ctx, contract, "renewal_pending", err.Error())
	}
	path := "/v3/papay/contracts/" + url.PathEscape(*contract.WechatContractID) + "/notify"
	body, _ := json.Marshal(map[string]any{
		"mchid":            cfg.MchID,
		"appid":            cfg.AppID,
		"deduct_duration":  map[string]any{"count": 1, "unit": "DAY"},
		"estimated_amount": map[string]any{"amount": amountToFen(plan.Amount), "currency": "CNY"},
	})
	auth, err := buildWechatPayAuthorization(cfg.MchID, cfg.SerialNo, cfg.PrivateKey, http.MethodPost, path, string(body))
	if err != nil {
		return s.resetPapayAction(ctx, contract, "renewal_pending", err.Error())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(wechatPayAPIBaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return s.resetPapayAction(ctx, contract, "renewal_pending", err.Error())
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return s.resetPapayAction(ctx, contract, "renewal_pending", err.Error())
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusNoContent && !(resp.StatusCode == http.StatusConflict && strings.Contains(string(respBody), "RESOURCE_ALREADY_EXISTS")) {
		return s.resetPapayAction(ctx, contract, "renewal_pending", "预扣费通知失败："+parseWechatErrorMessage(respBody))
	}
	due := time.Now().In(chinaLocation()).AddDate(0, 0, 2)
	if contract.RenewalDueAt != nil && contract.RenewalDueAt.After(time.Now()) {
		due = *contract.RenewalDueAt
	}
	return s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
		"renewal_state":  "pre_notified",
		"next_action_at": papayChargeTime(due),
		"renewal_due_at": due,
		"last_error":     nil,
	})
}

func (s *MembershipService) applyPapayCharge(ctx context.Context, contract *domain.PapayContract) error {
	if contract == nil || contract.WechatContractID == nil || strings.TrimSpace(*contract.WechatContractID) == "" {
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), "合同缺少微信协议号")
	}
	if contract.RenewalState == "initial_pending" && contract.CreatedAt != nil && time.Since(*contract.CreatedAt) > papayFirstChargeWindow {
		due := time.Now().In(chinaLocation()).AddDate(0, 0, 2)
		return s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
			"renewal_state":  "renewal_pending",
			"renewal_due_at": due,
			"next_action_at": time.Now(),
			"last_error":     "首次签约超过 12 小时，已转入预扣费通知流程",
		})
	}
	plan, err := s.repo.GetPlanByCode(ctx, contract.PlanCode)
	if err != nil || plan == nil {
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), "会员套餐不存在")
	}
	cfg, err := s.papayConfig()
	if err != nil {
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), err.Error())
	}
	orderNo := generatePapayOrderNo()
	payment := &domain.MembershipPayment{
		UserID:         contract.UserID,
		PlanCode:       contract.PlanCode,
		OrderNo:        orderNo,
		Amount:         plan.Amount,
		Currency:       "CNY",
		DurationMonths: plan.DurationMonths,
		PayChannel:     "wechat_papay",
		TradeType:      "PAP",
		Status:         "pending",
		Extra: map[string]any{
			"papay_contract_id":            *contract.WechatContractID,
			"papay_merchant_contract_code": contract.MerchantContractCode,
			"papay_template_id":            contract.TemplateID,
			"papay_renewal_state":          contract.RenewalState,
		},
	}
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), err.Error())
	}
	params := map[string]string{
		"appid":            cfg.AppID,
		"mch_id":           cfg.MchID,
		"nonce_str":        papayNonce(),
		"body":             "食探会员自动续费",
		"attach":           contract.ID,
		"out_trade_no":     orderNo,
		"total_fee":        strconv.Itoa(amountToFen(plan.Amount)),
		"fee_type":         "CNY",
		"spbill_create_ip": "127.0.0.1",
		"notify_url":       cfg.PayNotifyURL,
		"trade_type":       "PAP",
		"contract_id":      *contract.WechatContractID,
	}
	result, err := s.callPapayV2XML(ctx, papayV2ApplyURL, params, cfg.APIV2Key)
	if err != nil {
		_ = s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"status": "failed"})
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), err.Error())
	}
	if !papayNoticeSuccess(result) {
		_ = s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{"status": "failed", "notify_payload": result})
		return s.resetPapayAction(ctx, contract, actionStateFromProcessing(contract.RenewalState), papayNoticeMessage(result))
	}
	return s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
		"renewal_state":  "awaiting_payment",
		"next_action_at": nil,
		"last_order_no":  orderNo,
		"last_error":     nil,
	})
}

func (s *MembershipService) callPapayV2XML(ctx context.Context, endpoint string, params map[string]string, key string) (map[string]string, error) {
	params["sign"] = signPapayV2(params, key)
	body, err := marshalPapayV2XML(params)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/xml; charset=utf-8")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信委托代扣请求失败：" + parseWechatErrorMessage(respBody), HTTPStatus: http.StatusBadGateway}
	}
	result, err := parsePapayV2XML(respBody)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(result["sign"]) != "" && !verifyPapayV2Sign(result, key) {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信委托代扣响应验签失败", HTTPStatus: http.StatusBadGateway}
	}
	return result, nil
}

func (s *MembershipService) findPapayContractForNotice(ctx context.Context, notice map[string]string) (*domain.PapayContract, error) {
	if id := strings.TrimSpace(notice["contract_id"]); id != "" {
		contract, err := s.papayRepo.GetPapayContractByWechatID(ctx, id)
		if err != nil || contract != nil {
			return contract, err
		}
	}
	return s.papayRepo.GetPapayContractByMerchantCode(ctx, strings.TrimSpace(notice["contract_code"]))
}

func (s *MembershipService) markPapayContractTerminated(ctx context.Context, contract *domain.PapayContract, source string, payload map[string]string) error {
	if contract == nil {
		return nil
	}
	now := time.Now()
	if err := s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
		"status": "terminated", "renewal_state": "terminated", "next_action_at": nil,
		"terminated_at": now, "termination_source": source, "terminate_notify_payload": payload,
	}); err != nil {
		return err
	}
	_, err := s.repo.SaveMembership(ctx, contract.UserID, map[string]any{"auto_renew": false})
	return err
}

func (s *MembershipService) resetPapayChargeAfterFailure(ctx context.Context, payment *domain.MembershipPayment, reason string) error {
	if payment == nil || s.papayRepo == nil {
		return nil
	}
	contract, err := s.findPapayContractForNotice(ctx, map[string]string{"contract_id": stringFromMap(payment.Extra, "papay_contract_id")})
	if err != nil || contract == nil {
		return err
	}
	return s.resetPapayAction(ctx, contract, "pre_notified", reason)
}

func (s *MembershipService) resetPapayAction(ctx context.Context, contract *domain.PapayContract, state, reason string) error {
	if contract == nil {
		return fmt.Errorf("自动续费合同不存在")
	}
	return s.papayRepo.UpdatePapayContract(ctx, contract.ID, map[string]any{
		"renewal_state":  state,
		"next_action_at": time.Now().Add(papayRetryDelay),
		"last_error":     truncatePapayError(reason),
	})
}

func formatPapayContract(contract *domain.PapayContract) any {
	if contract == nil || (contract.Status != "pending" && contract.Status != "active" && contract.Status != "termination_requested") {
		return nil
	}
	return map[string]any{
		"status": contract.Status, "plan_code": contract.PlanCode, "template_id": contract.TemplateID,
		"renewal_state": contract.RenewalState, "next_action_at": contract.NextActionAt,
		"renewal_due_at": contract.RenewalDueAt,
	}
}

func verifyPapayV2Notice(notice map[string]string, cfg *papayConfig) error {
	if strings.TrimSpace(notice["mch_id"]) != cfg.MchID || strings.TrimSpace(notice["appid"]) != cfg.AppID {
		return &commonerrors.AppError{Code: 10002, Message: "微信委托代扣通知商户信息不匹配", HTTPStatus: http.StatusBadRequest}
	}
	if !verifyPapayV2Sign(notice, cfg.APIV2Key) {
		return &commonerrors.AppError{Code: 10002, Message: "微信委托代扣通知验签失败", HTTPStatus: http.StatusBadRequest}
	}
	return nil
}

func signPapayV2(values map[string]string, key string) string {
	keys := make([]string, 0, len(values))
	for name, value := range values {
		if name != "sign" && strings.TrimSpace(value) != "" {
			keys = append(keys, name)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys)+1)
	for _, name := range keys {
		parts = append(parts, name+"="+values[name])
	}
	parts = append(parts, "key="+key)
	sum := md5.Sum([]byte(strings.Join(parts, "&")))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func verifyPapayV2Sign(values map[string]string, key string) bool {
	provided := strings.TrimSpace(values["sign"])
	return provided != "" && strings.EqualFold(provided, signPapayV2(values, key))
}

type papayXML struct {
	XMLName xml.Name `xml:"xml"`
	Fields  []struct {
		XMLName xml.Name
		Value   string `xml:",chardata"`
	} `xml:",any"`
}

func parsePapayV2XML(body []byte) (map[string]string, error) {
	var payload papayXML
	if err := xml.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.XMLName.Local != "xml" {
		return nil, fmt.Errorf("微信委托代扣 XML 根节点无效")
	}
	result := make(map[string]string, len(payload.Fields))
	for _, field := range payload.Fields {
		result[field.XMLName.Local] = strings.TrimSpace(field.Value)
	}
	return result, nil
}

func marshalPapayV2XML(values map[string]string) ([]byte, error) {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	out.WriteString("<xml>")
	for _, key := range keys {
		out.WriteString("<" + key + "><![CDATA[" + strings.ReplaceAll(values[key], "]]>", "]]&gt;") + "]]></" + key + ">")
	}
	out.WriteString("</xml>")
	return []byte(out.String()), nil
}

func papayNoticeSuccess(values map[string]string) bool {
	return strings.EqualFold(strings.TrimSpace(values["return_code"]), "SUCCESS") && (strings.TrimSpace(values["result_code"]) == "" || strings.EqualFold(strings.TrimSpace(values["result_code"]), "SUCCESS"))
}

func papayNoticeMessage(values map[string]string) string {
	for _, key := range []string{"err_code_des", "return_msg", "err_code"} {
		if value := strings.TrimSpace(values[key]); value != "" {
			return value
		}
	}
	return "微信支付未返回成功"
}

func papayPreNotifyTime(due time.Time) time.Time {
	local := due.In(chinaLocation()).AddDate(0, 0, -2)
	return time.Date(local.Year(), local.Month(), local.Day(), 10, 0, 0, 0, chinaLocation())
}

func papayChargeTime(due time.Time) time.Time {
	local := due.In(chinaLocation())
	return time.Date(local.Year(), local.Month(), local.Day(), 10, 0, 0, 0, chinaLocation())
}

func papayActionAllowedNow(now time.Time) bool { return now.Hour() >= 7 && now.Hour() < 22 }

func actionStateFromProcessing(state string) string { return strings.TrimSuffix(state, "_processing") }

func newPapayContractCode() (string, error) {
	var random [4]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	return "PAP" + time.Now().In(chinaLocation()).Format("20060102150405") + strings.ToUpper(hex.EncodeToString(random[:])), nil
}

func generatePapayOrderNo() string {
	var random [3]byte
	_, _ = rand.Read(random[:])
	return "PAP" + time.Now().In(chinaLocation()).Format("20060102150405") + strings.ToUpper(hex.EncodeToString(random[:]))
}

func papayNonce() string {
	var random [16]byte
	_, _ = rand.Read(random[:])
	return strings.ToUpper(hex.EncodeToString(random[:]))
}

func timestampToInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}

func parsePapayTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := time.ParseInLocation("20060102150405", value, chinaLocation())
	if err != nil {
		return nil
	}
	return &parsed
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprintf("%v", values[key]))
}
func truncatePapayError(value string) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > 500 {
		return string([]rune(value)[:500])
	}
	return value
}
