package service

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"
)

const (
	creditCostStandardFoodAnalysis  = 2
	creditCostPrecisionFoodAnalysis = 4
	creditCostExerciseLog           = 1
	trialDailyCredits               = 8
	earlyUserTop500Limit            = 500
	earlyUserTrialLimit             = 1000
	earlyPaidUserLimit              = 100
	earlyUserTop500TrialDays        = 60
	earlyUserTrialDays              = 30
	regularUserTrialDays            = 3
	earlyUserPaidCreditsMultiplier  = 2
	sharePosterRewardCredits        = 1
	sharePosterDailyMaxEvents       = 3
)

var manualMembershipUpgradeUserIDs = map[string]struct{}{
	"cafa4614-9453-4eb0-bf60-51f442ce0f4a": {},
}

type MembershipRepo interface {
	ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error)
	GetPlanByID(ctx context.Context, planID string) (*domain.MembershipPlan, error)
	GetPlanByCode(ctx context.Context, planCode string) (*domain.MembershipPlan, error)
	GetUserProMembership(ctx context.Context, userID string) (*domain.UserMembership, error)
	GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error)
	SaveMembership(ctx context.Context, userID string, updates map[string]any) (*domain.UserMembership, error)
	CreatePayment(ctx context.Context, p *domain.MembershipPayment) error
	GetPaymentByID(ctx context.Context, id string) (*domain.MembershipPayment, error)
	GetPaymentByOrderNo(ctx context.Context, orderNo string) (*domain.MembershipPayment, error)
	GetLatestPaidMembershipPayment(ctx context.Context, userID string) (*domain.MembershipPayment, error)
	UpdatePaymentStatus(ctx context.Context, id string, status string) error
	UpdatePaymentByOrderNo(ctx context.Context, orderNo string, updates map[string]any) error
	ExpirePendingMembershipOrders(ctx context.Context, userID, excludeOrderNo, reason string) (int, error)
	CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error)
	CountDailySystemCreditUsage(ctx context.Context, userID, chinaDate string) (int, error)
	GetFirstMembershipTrialBatchRank(ctx context.Context, userID string, limit int) (int, error)
	GetFirstPaidMembershipUserRank(ctx context.Context, userID string, limit int) (int, error)
	CountDailyMembershipBonusCredits(ctx context.Context, userID, chinaDate string) (inviteBonus int, shareBonus int, err error)
	GetUser(ctx context.Context, userID string) (*membershiprepo.User, error)
	GetFoodRecordOwner(ctx context.Context, recordID string) (string, error)
	CountSharePosterClaims(ctx context.Context, userID, chinaDate string) (int, error)
	GetSharePosterClaim(ctx context.Context, userID, recordID, chinaDate string) (*domain.UserCreditBonusEvent, error)
	CreateSharePosterBonusEvent(ctx context.Context, userID, recordID, chinaDate string, credits int) (*domain.UserCreditBonusEvent, error)
	ChangeEarnedCredits(ctx context.Context, userID string, delta int, reason, sourceKey, relatedDate string, meta map[string]any) (*domain.UserEarnedCreditLedger, bool, error)
}

type MembershipService struct {
	repo   MembershipRepo
	cfg    *config.Config
	client *http.Client
}

type earlyUserMembershipMeta struct {
	EarlyUserRank       *int
	EarlyUserLimit      int
	EarlyPaidUserRank   *int
	EarlyPaidUserLimit  int
	PaidBonusMultiplier int
	PaidBonusEligible   bool
	PaidBonusSource     any
	PaidBonusActive     bool
}

type trialPolicy struct {
	Active    bool
	ExpiresAt *time.Time
	DaysTotal int
	Policy    any
}

func NewMembershipService(repo MembershipRepo, cfg ...*config.Config) *MembershipService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return &MembershipService{repo: repo, cfg: c, client: &http.Client{Timeout: 15 * time.Second}}
}

func (s *MembershipService) ListPlans(ctx context.Context) ([]map[string]any, error) {
	plans, err := s.repo.ListActivePlans(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		var savings any
		if p.OriginalAmount != nil && *p.OriginalAmount > p.Amount {
			savings = math.Round((*p.OriginalAmount-p.Amount)*100) / 100
		}
		out = append(out, map[string]any{
			"code":            p.Code,
			"name":            p.Name,
			"amount":          p.Amount,
			"duration_months": p.DurationMonths,
			"description":     stringValue(p.Description),
			"tier":            stringValue(p.Tier),
			"period":          stringValue(p.Period),
			"daily_credits":   p.DailyCredits,
			"original_amount": floatPtrValue(p.OriginalAmount),
			"savings":         savings,
			"sort_order":      p.SortOrder,
		})
	}
	return out, nil
}

func (s *MembershipService) GetMyMembership(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	resp := formatMembershipResponse(membership)

	usedToday, err := s.repo.CountAnalysisTasksToday(ctx, userID)
	if err != nil {
		return nil, err
	}
	resp["daily_limit"] = nil
	resp["daily_used"] = usedToday
	resp["daily_remaining"] = nil

	credits, err := s.computeDailyCreditsStatus(ctx, userID, boolValue(resp["is_pro"]), membership, user)
	if err != nil {
		return nil, err
	}
	for k, v := range credits {
		resp[k] = v
	}
	return resp, nil
}

func (s *MembershipService) getEffectiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	membership, err := s.repo.GetUserProMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	membership, err = s.reconcileMembershipFromLatestPaidOrder(ctx, userID, membership)
	if err != nil || membership == nil {
		return membership, err
	}
	if membership.Status == "active" && membership.ExpiresAt != nil && !membership.ExpiresAt.After(time.Now()) {
		updated, err := s.repo.SaveMembership(ctx, userID, map[string]any{"status": "expired"})
		if err != nil {
			return nil, err
		}
		return updated, nil
	}
	return membership, nil
}

func (s *MembershipService) reconcileMembershipFromLatestPaidOrder(ctx context.Context, userID string, membership *domain.UserMembership) (*domain.UserMembership, error) {
	latest, err := s.repo.GetLatestPaidMembershipPayment(ctx, userID)
	if err != nil || latest == nil || !isMembershipPlanCode(latest.PlanCode) {
		return membership, err
	}
	paidAt := latest.PaidAt
	if paidAt == nil {
		paidAt = latest.CreatedAt
	}
	if paidAt == nil {
		now := time.Now()
		paidAt = &now
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, user)
	if err != nil {
		return nil, err
	}
	effectivePlanCode, effectiveDailyCredits, err := s.resolveEffectivePaidPlanAndCredits(ctx, userID, latest.PlanCode, membership, meta)
	if err != nil {
		return nil, err
	}
	durationMonths := latest.DurationMonths
	if durationMonths <= 0 {
		durationMonths = 1
	}
	expectedExpiresAt := addMonths(*paidAt, durationMonths)
	expectedStatus := "expired"
	if expectedExpiresAt.After(time.Now()) {
		expectedStatus = "active"
	}
	firstActivatedAt := *paidAt
	if membership != nil && membership.FirstActivatedAt != nil {
		firstActivatedAt = *membership.FirstActivatedAt
	}
	if membership != nil && membershipMatchesPaidTruth(membership, effectivePlanCode, expectedStatus, *paidAt, expectedExpiresAt, effectiveDailyCredits) {
		return membership, nil
	}
	return s.repo.SaveMembership(ctx, userID, map[string]any{
		"current_plan_code":    effectivePlanCode,
		"status":               expectedStatus,
		"first_activated_at":   firstActivatedAt,
		"current_period_start": *paidAt,
		"expires_at":           expectedExpiresAt,
		"last_paid_at":         *paidAt,
		"auto_renew":           false,
		"daily_credits":        effectiveDailyCredits,
	})
}

func (s *MembershipService) computeDailyCreditsStatus(ctx context.Context, userID string, isPro bool, membership *domain.UserMembership, user *membershiprepo.User) (map[string]any, error) {
	nowCN := time.Now().In(chinaLocation())
	today := nowCN.Format("2006-01-02")
	base := 0
	trialActive := false
	var trialExpiresAt *time.Time
	trialDaysTotal := 0
	var trialPolicy any
	earlyMeta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, user)
	if err != nil {
		return nil, err
	}

	if isPro && membership != nil {
		base, err = s.resolveMembershipDailyCredits(ctx, membership, earlyMeta)
		if err != nil {
			return nil, err
		}
	}
	if base <= 0 && !isPro && user != nil {
		policy := s.resolveUserTrialPolicy(user, earlyMeta)
		trialActive = policy.Active
		trialExpiresAt = policy.ExpiresAt
		trialDaysTotal = policy.DaysTotal
		trialPolicy = policy.Policy
		if trialActive {
			base = trialDailyCredits
		}
	}
	used, err := s.repo.CountDailySystemCreditUsage(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	inviteBonusCredits, shareBonusCredits, err := s.repo.CountDailyMembershipBonusCredits(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	dailyBonusCredits := inviteBonusCredits + shareBonusCredits
	earnedBalance := 0
	if user != nil && user.EarnedCreditsBalance > 0 {
		earnedBalance = user.EarnedCreditsBalance
	}
	systemRemaining := maxInt(base-used, 0)
	earnedConsumedToday := maxInt(used-base, 0)
	totalAvailable := maxInt(systemRemaining+earnedBalance, 0)
	return map[string]any{
		"daily_credits_max":                base,
		"daily_credits_used":               minInt(used, base),
		"daily_credits_remaining":          totalAvailable,
		"daily_credits_base":               base,
		"daily_bonus_credits":              dailyBonusCredits,
		"invite_bonus_credits":             inviteBonusCredits,
		"share_bonus_credits":              shareBonusCredits,
		"system_credits_remaining":         systemRemaining,
		"earned_credits_balance":           earnedBalance,
		"earned_credits_consumed_today":    earnedConsumedToday,
		"total_credits_available":          totalAvailable,
		"credits_reset_at":                 nextChinaMidnightISO(),
		"trial_active":                     trialActive,
		"trial_expires_at":                 timePtrISO(trialExpiresAt),
		"trial_days_total":                 trialDaysTotal,
		"trial_policy":                     trialPolicy,
		"early_user_rank":                  intPtrValue(earlyMeta.EarlyUserRank),
		"early_user_limit":                 earlyMeta.EarlyUserLimit,
		"early_paid_user_rank":             intPtrValue(earlyMeta.EarlyPaidUserRank),
		"early_paid_user_limit":            earlyMeta.EarlyPaidUserLimit,
		"early_user_paid_bonus_multiplier": earlyMeta.PaidBonusMultiplier,
		"early_user_paid_bonus_eligible":   earlyMeta.PaidBonusEligible,
		"early_user_paid_bonus_source":     earlyMeta.PaidBonusSource,
		"early_user_paid_bonus_active":     earlyMeta.PaidBonusActive,
	}, nil
}

func (s *MembershipService) CreatePayment(ctx context.Context, userID, planCode string) (map[string]any, error) {
	plan, err := s.repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if plan == nil || !plan.IsActive {
		return nil, commonerrors.ErrNotFound
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	openID := strings.TrimSpace(user.OpenID)
	if openID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前用户缺少 openid，无法发起微信支付", HTTPStatus: 400}
	}
	payCfg, err := s.wechatPayConfig()
	if err != nil {
		return nil, err
	}
	orderNo := generateMembershipOrderNo()
	canonicalURL := "/v3/pay/transactions/jsapi"
	requestPayload := map[string]any{
		"appid":        payCfg.AppID,
		"mchid":        payCfg.MchID,
		"description":  plan.Name,
		"out_trade_no": orderNo,
		"notify_url":   payCfg.NotifyURL,
		"amount": map[string]any{
			"total":    amountToFen(plan.Amount),
			"currency": "CNY",
		},
		"payer": map[string]any{"openid": openID},
	}
	requestBody, _ := json.Marshal(requestPayload)
	auth, err := buildWechatPayAuthorization(payCfg.MchID, payCfg.SerialNo, payCfg.PrivateKey, http.MethodPost, canonicalURL, string(requestBody))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.mch.weixin.qq.com"+canonicalURL, bytes.NewReader(requestBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "food-link/1.0")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信下单失败: " + parseWechatErrorMessage(respBody), HTTPStatus: 502}
	}
	var wxResp struct {
		PrepayID string `json:"prepay_id"`
	}
	if err := json.Unmarshal(respBody, &wxResp); err != nil {
		return nil, err
	}
	if strings.TrimSpace(wxResp.PrepayID) == "" {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信下单失败：未返回 prepay_id", HTTPStatus: 502}
	}
	_, _ = s.repo.ExpirePendingMembershipOrders(ctx, userID, "", "superseded_by_new_order")
	payment := &domain.MembershipPayment{
		UserID:         userID,
		PlanCode:       plan.Code,
		OrderNo:        orderNo,
		Amount:         plan.Amount,
		Currency:       "CNY",
		DurationMonths: plan.DurationMonths,
		PayChannel:     "wechat_mini_program",
		TradeType:      "JSAPI",
		Status:         "pending",
		WxOpenID:       &openID,
		WxPrepayID:     &wxResp.PrepayID,
		Extra: map[string]any{
			"create_order_payload":         requestPayload,
			"wechat_create_order_response": wxResp,
		},
	}
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}
	params, err := buildMiniProgramPayParams(payCfg.AppID, wxResp.PrepayID, payCfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"order_no":   orderNo,
		"plan_code":  plan.Code,
		"amount":     plan.Amount,
		"pay_params": params,
	}, nil
}

func (s *MembershipService) WechatNotify(ctx context.Context, paymentID string) error {
	if paymentID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "payment_id required", HTTPStatus: 400}
	}
	payment, err := s.repo.GetPaymentByID(ctx, paymentID)
	if err != nil {
		return err
	}
	if payment == nil {
		return commonerrors.ErrNotFound
	}
	if payment.Status == "paid" {
		return nil
	}
	now := time.Now()
	if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "paid"); err != nil {
		return err
	}
	_, err = s.activateMembershipFromPayment(ctx, payment, now)
	return err
}

func (s *MembershipService) HandleWechatNotify(ctx context.Context, headers http.Header, body []byte) (map[string]any, error) {
	payCfg, err := s.wechatPayConfig()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(payCfg.PublicKey) == "" {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少微信支付公钥配置，无法处理支付回调", HTTPStatus: 500}
	}
	signature := headers.Get("Wechatpay-Signature")
	timestamp := headers.Get("Wechatpay-Timestamp")
	nonce := headers.Get("Wechatpay-Nonce")
	if signature == "" || timestamp == "" || nonce == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付回调缺少签名头", HTTPStatus: 400}
	}
	message := timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	ok, err := verifyWithRSASHA256(message, signature, payCfg.PublicKey)
	if err != nil || !ok {
		return nil, &commonerrors.AppError{Code: 10003, Message: "微信支付回调验签失败", HTTPStatus: 401}
	}
	var notifyData map[string]any
	if err := json.Unmarshal(body, &notifyData); err != nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付回调报文解析失败", HTTPStatus: 400}
	}
	resource, _ := notifyData["resource"].(map[string]any)
	decrypted, err := decryptWechatPayResource(resource, payCfg.APIV3Key)
	if err != nil {
		return nil, err
	}
	orderNo := strings.TrimSpace(fmt.Sprintf("%v", decrypted["out_trade_no"]))
	if orderNo == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付回调缺少 out_trade_no", HTTPStatus: 400}
	}
	payment, err := s.repo.GetPaymentByOrderNo(ctx, orderNo)
	if err != nil {
		return nil, err
	}
	if payment == nil {
		return nil, commonerrors.ErrNotFound
	}
	if payment.Status == "paid" {
		return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
	}
	if strings.ToUpper(fmt.Sprintf("%v", decrypted["trade_state"])) != "SUCCESS" {
		return map[string]any{"code": "SUCCESS", "message": "已接收"}, nil
	}
	amount, _ := decrypted["amount"].(map[string]any)
	paidTotal := intFromAny(amount["payer_total"])
	if paidTotal == 0 {
		paidTotal = intFromAny(amount["total"])
	}
	if paidTotal != amountToFen(payment.Amount) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付金额与订单金额不一致", HTTPStatus: 400}
	}
	paidAt := parseTime(fmt.Sprintf("%v", decrypted["success_time"]))
	if paidAt == nil {
		now := time.Now()
		paidAt = &now
	}
	transactionID := stringPtrFromAny(decrypted["transaction_id"])
	bankType := stringPtrFromAny(decrypted["bank_type"])
	if err := s.repo.UpdatePaymentByOrderNo(ctx, orderNo, map[string]any{
		"status":            "paid",
		"wx_transaction_id": wxString(transactionID),
		"wx_bank_type":      wxString(bankType),
		"paid_at":           *paidAt,
		"notify_payload": map[string]any{
			"headers": map[string]any{
				"Wechatpay-Signature": signature,
				"Wechatpay-Timestamp": timestamp,
				"Wechatpay-Nonce":     nonce,
			},
			"body":               notifyData,
			"resource_decrypted": decrypted,
		},
	}); err != nil {
		return nil, err
	}
	payment.PaidAt = paidAt
	if _, err := s.activateMembershipFromPayment(ctx, payment, *paidAt); err != nil {
		return nil, err
	}
	_, _ = s.repo.ExpirePendingMembershipOrders(ctx, payment.UserID, orderNo, "superseded_by_paid_order")
	return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
}

func (s *MembershipService) ClaimSharePosterReward(ctx context.Context, userID, recordID string) (map[string]any, error) {
	if recordID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "record_id required", HTTPStatus: 400}
	}
	ownerID, err := s.repo.GetFoodRecordOwner(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if ownerID == "" {
		return nil, commonerrors.ErrNotFound
	}
	if ownerID != userID {
		return nil, &commonerrors.AppError{Code: 10003, Message: "只能为自己的记录领取海报奖励", HTTPStatus: 403}
	}
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	claimsToday, err := s.repo.CountSharePosterClaims(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	if existing, err := s.repo.GetSharePosterClaim(ctx, userID, recordID, today); err != nil {
		return nil, err
	} else if existing != nil {
		return s.shareRewardResponse(ctx, userID, false, true, false, claimsToday, 0, "本条记录今日海报奖励已领取")
	}
	if claimsToday >= sharePosterDailyMaxEvents {
		return s.shareRewardResponse(ctx, userID, false, false, true, claimsToday, 0, fmt.Sprintf("今日海报奖励已达上限（最多 %d 积分）", sharePosterDailyMaxEvents))
	}
	event, err := s.repo.CreateSharePosterBonusEvent(ctx, userID, recordID, today, sharePosterRewardCredits)
	if err != nil {
		return nil, err
	}
	_, _, _ = s.repo.ChangeEarnedCredits(ctx, userID, sharePosterRewardCredits, "share_poster_reward", "share:"+event.ID, today, map[string]any{
		"bonus_event_id":   event.ID,
		"source_record_id": recordID,
	})
	return s.shareRewardResponse(ctx, userID, true, false, false, claimsToday+1, sharePosterRewardCredits, fmt.Sprintf("本餐海报奖励已到账 +%d 积分", sharePosterRewardCredits))
}

func (s *MembershipService) shareRewardResponse(ctx context.Context, userID string, claimed, alreadyClaimed, dailyCapReached bool, claimsToday, credits int, message string) (map[string]any, error) {
	user, _ := s.repo.GetUser(ctx, userID)
	membership, _ := s.getEffectiveMembership(ctx, userID)
	base := formatMembershipResponse(membership)
	creditsInfo, _ := s.computeDailyCreditsStatus(ctx, userID, boolValue(base["is_pro"]), membership, user)
	return map[string]any{
		"claimed":                   claimed,
		"already_claimed":           alreadyClaimed,
		"daily_cap_reached":         dailyCapReached,
		"share_poster_claims_today": claimsToday,
		"credits":                   credits,
		"daily_credits_max":         creditsInfo["daily_credits_max"],
		"daily_credits_remaining":   creditsInfo["daily_credits_remaining"],
		"earned_credits_balance":    creditsInfo["earned_credits_balance"],
		"total_credits_available":   creditsInfo["total_credits_available"],
		"message":                   message,
	}, nil
}

func (s *MembershipService) ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string) (map[string]any, error) {
	mode := normalizeFoodExecutionMode(executionMode)
	cost := creditCostStandardFoodAnalysis
	analysisLabel := "食物分析"
	if mode == "strict" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "精准分析"
	}
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if mode == "strict" && !canUsePrecisionMode(membership) {
		return nil, &commonerrors.AppError{Code: 10005, Message: "精准模式仅对标准版和进阶版开放，请升级或开通后再试。", HTTPStatus: 402}
	}
	return s.validateCredits(ctx, userID, cost, analysisLabel, recordedOn, membership, user)
}

func (s *MembershipService) ValidateExerciseCredits(ctx context.Context, userID, recordedOn string) (map[string]any, error) {
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.validateCredits(ctx, userID, creditCostExerciseLog, "运动记录", recordedOn, membership, user)
}

func (s *MembershipService) validateCredits(ctx context.Context, userID string, cost int, label, recordedOn string, membership *domain.UserMembership, user *membershiprepo.User) (map[string]any, error) {
	targetDate, err := normalizeChinaDate(recordedOn)
	if err != nil {
		return nil, err
	}
	isPro := membership != nil && formatMembershipResponse(membership)["is_pro"] == true
	creditsInfo, err := s.computeDailyCreditsStatus(ctx, userID, isPro, membership, user)
	if err != nil {
		return nil, err
	}
	spendPlan, err := s.buildCreditSpendPlan(ctx, userID, cost, targetDate, membership, user)
	if err != nil {
		return nil, err
	}
	creditsInfo["credit_cost"] = cost
	creditsInfo["credit_spend_plan"] = spendPlan
	if intFromAny(spendPlan["total_available"]) < cost {
		return nil, &commonerrors.AppError{
			Code:       10005,
			Message:    fmt.Sprintf("%s积分不足，本次需要 %d 积分，当前可用 %d 积分。", label, cost, intFromAny(spendPlan["total_available"])),
			HTTPStatus: 402,
		}
	}
	return creditsInfo, nil
}

func (s *MembershipService) buildCreditSpendPlan(ctx context.Context, userID string, cost int, recordedOn string, membership *domain.UserMembership, user *membershiprepo.User) (map[string]any, error) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	targetRemaining, err := s.daySystemCreditsRemaining(ctx, userID, recordedOn, membership, user)
	if err != nil {
		return nil, err
	}
	todayRemaining := targetRemaining
	if recordedOn != today {
		todayRemaining, err = s.daySystemCreditsRemaining(ctx, userID, today, membership, user)
		if err != nil {
			return nil, err
		}
	}
	earnedBalance := 0
	if user != nil && user.EarnedCreditsBalance > 0 {
		earnedBalance = user.EarnedCreditsBalance
	}
	remainingCost := maxInt(cost, 0)
	systemByDate := map[string]int{}
	useTarget := minInt(remainingCost, targetRemaining)
	if useTarget > 0 {
		systemByDate[recordedOn] = useTarget
		remainingCost -= useTarget
	}
	if remainingCost > 0 && recordedOn != today {
		useToday := minInt(remainingCost, todayRemaining)
		if useToday > 0 {
			systemByDate[today] = useToday
			remainingCost -= useToday
		}
	}
	systemTotal := 0
	for _, value := range systemByDate {
		systemTotal += value
	}
	totalSystemAvailable := targetRemaining
	if recordedOn != today {
		totalSystemAvailable += todayRemaining
	}
	earnedUnits := maxInt(remainingCost, 0)
	return map[string]any{
		"recorded_on":                 recordedOn,
		"cost":                        maxInt(cost, 0),
		"system_by_date":              systemByDate,
		"system_units_total":          systemTotal,
		"earned_units":                earnedUnits,
		"target_day_system_remaining": targetRemaining,
		"today_system_remaining":      todayRemaining,
		"earned_credits_balance":      earnedBalance,
		"total_system_available":      totalSystemAvailable,
		"total_available":             totalSystemAvailable + earnedBalance,
	}, nil
}

func (s *MembershipService) daySystemCreditsRemaining(ctx context.Context, userID, chinaDate string, membership *domain.UserMembership, user *membershiprepo.User) (int, error) {
	base, err := s.dailySystemCreditBaseForDate(ctx, userID, chinaDate, membership, user)
	if err != nil {
		return 0, err
	}
	if base <= 0 {
		return 0, nil
	}
	used, err := s.repo.CountDailySystemCreditUsage(ctx, userID, chinaDate)
	if err != nil {
		return 0, err
	}
	return maxInt(base-used, 0), nil
}

func (s *MembershipService) dailySystemCreditBaseForDate(ctx context.Context, userID, chinaDate string, membership *domain.UserMembership, user *membershiprepo.User) (int, error) {
	target, err := time.ParseInLocation("2006-01-02", chinaDate, chinaLocation())
	if err != nil {
		target = time.Now().In(chinaLocation())
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, user)
	if err != nil {
		return 0, err
	}
	if membershipActiveForChinaDate(membership, target) {
		base, err := s.resolveMembershipDailyCredits(ctx, membership, meta)
		if err != nil {
			return 0, err
		}
		if base > 0 {
			return base, nil
		}
	}
	if user == nil {
		return 0, nil
	}
	created := userRegistrationTime(user)
	if created == nil {
		return 0, nil
	}
	policy := s.resolveUserTrialPolicy(user, meta)
	if policy.ExpiresAt == nil {
		return 0, nil
	}
	createdDate := dateOnly(created.In(chinaLocation()))
	targetDate := dateOnly(target.In(chinaLocation()))
	trialEndDate := dateOnly(policy.ExpiresAt.In(chinaLocation()))
	if !targetDate.Before(createdDate) && !targetDate.After(trialEndDate) {
		return trialDailyCredits, nil
	}
	return 0, nil
}

func (s *MembershipService) ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
	earned := earnedCreditsToConsume(creditsInfo, cost)
	if earned <= 0 {
		return nil
	}
	relatedDate := time.Now().In(chinaLocation()).Format("2006-01-02")
	if plan, ok := creditsInfo["credit_spend_plan"].(map[string]any); ok {
		if value := strings.TrimSpace(fmt.Sprintf("%v", plan["recorded_on"])); value != "" && value != "<nil>" {
			relatedDate = value
		}
	}
	_, _, err := s.repo.ChangeEarnedCredits(ctx, userID, -earned, reason, sourceKey, relatedDate, meta)
	return err
}

func (s *MembershipService) activateMembershipFromPayment(ctx context.Context, payment *domain.MembershipPayment, paidAt time.Time) (*domain.UserMembership, error) {
	plan, err := s.repo.GetPlanByCode(ctx, payment.PlanCode)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, commonerrors.ErrNotFound
	}
	membership, err := s.repo.GetUserProMembership(ctx, payment.UserID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, payment.UserID)
	if err != nil {
		return nil, err
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, payment.UserID, user)
	if err != nil {
		return nil, err
	}
	var start, expires, first time.Time
	if membership != nil && membership.Status == "active" && membership.ExpiresAt != nil && membership.ExpiresAt.After(paidAt) {
		start = timeOr(membership.CurrentPeriodStart, paidAt)
		expires = addMonths(*membership.ExpiresAt, payment.DurationMonths)
		first = timeOr(membership.FirstActivatedAt, paidAt)
	} else {
		start = paidAt
		expires = addMonths(paidAt, payment.DurationMonths)
		first = paidAt
		if membership != nil && membership.FirstActivatedAt != nil {
			first = *membership.FirstActivatedAt
		}
	}
	effectivePlanCode, dailyCredits, err := s.resolveEffectivePaidPlanAndCredits(ctx, payment.UserID, plan.Code, membership, meta)
	if err != nil {
		return nil, err
	}
	return s.repo.SaveMembership(ctx, payment.UserID, map[string]any{
		"current_plan_code":    effectivePlanCode,
		"status":               "active",
		"first_activated_at":   first,
		"current_period_start": start,
		"expires_at":           expires,
		"last_paid_at":         paidAt,
		"auto_renew":           false,
		"daily_credits":        dailyCredits,
	})
}

func (s *MembershipService) resolveEarlyUserMembershipMeta(ctx context.Context, userID string, user *membershiprepo.User) (*earlyUserMembershipMeta, error) {
	meta := &earlyUserMembershipMeta{
		EarlyUserLimit:      earlyUserTrialLimit,
		EarlyPaidUserLimit:  earlyPaidUserLimit,
		PaidBonusMultiplier: 1,
	}
	if userRegistrationTime(user) != nil {
		rank, err := s.repo.GetFirstMembershipTrialBatchRank(ctx, userID, earlyUserTrialLimit)
		if err != nil {
			return nil, err
		}
		if rank > 0 {
			meta.EarlyUserRank = intPtr(rank)
		}
	}
	paidRank, err := s.repo.GetFirstPaidMembershipUserRank(ctx, userID, earlyPaidUserLimit)
	if err != nil {
		return nil, err
	}
	if paidRank > 0 {
		meta.EarlyPaidUserRank = intPtr(paidRank)
	}
	registrationEligible := meta.EarlyUserRank != nil
	paidEligible := meta.EarlyPaidUserRank != nil
	switch {
	case registrationEligible && paidEligible:
		meta.PaidBonusSource = "both"
	case registrationEligible:
		meta.PaidBonusSource = "registration_top_1000"
	case paidEligible:
		meta.PaidBonusSource = "paid_top_100"
	default:
		meta.PaidBonusSource = nil
	}
	meta.PaidBonusEligible = registrationEligible || paidEligible
	if meta.PaidBonusEligible {
		meta.PaidBonusMultiplier = earlyUserPaidCreditsMultiplier
	}
	return meta, nil
}

func (s *MembershipService) resolveUserTrialPolicy(user *membershiprepo.User, meta *earlyUserMembershipMeta) trialPolicy {
	created := userRegistrationTime(user)
	if created == nil {
		return trialPolicy{}
	}
	trialDays := regularUserTrialDays
	policy := any("regular_new_user")
	if meta != nil && meta.EarlyUserRank != nil {
		rank := *meta.EarlyUserRank
		switch {
		case rank <= earlyUserTop500Limit:
			trialDays = earlyUserTop500TrialDays
			policy = "founding_top_500_bonus_month"
		case rank <= earlyUserTrialLimit:
			trialDays = earlyUserTrialDays
			policy = "early_first_1000"
		}
	}
	expires := created.AddDate(0, 0, trialDays)
	return trialPolicy{
		Active:    time.Now().Before(expires),
		ExpiresAt: &expires,
		DaysTotal: trialDays,
		Policy:    policy,
	}
}

func (s *MembershipService) resolveMembershipDailyCredits(ctx context.Context, membership *domain.UserMembership, meta *earlyUserMembershipMeta) (int, error) {
	if membership == nil {
		return 0, nil
	}
	base := membership.DailyCredits
	planDailyCredits := 0
	if membership.CurrentPlanCode != nil {
		var err error
		planDailyCredits, err = s.planDailyCredits(ctx, *membership.CurrentPlanCode)
		if err != nil {
			return 0, err
		}
	}
	if base <= 0 {
		base = planDailyCredits
	}
	if meta != nil && meta.PaidBonusEligible && meta.PaidBonusMultiplier > 1 && base > 0 {
		boostedTarget := base * meta.PaidBonusMultiplier
		if planDailyCredits > 0 {
			boostedTarget = planDailyCredits * meta.PaidBonusMultiplier
		}
		base = maxInt(base, boostedTarget)
		meta.PaidBonusActive = true
	}
	return maxInt(base, 0), nil
}

func (s *MembershipService) resolveEffectivePaidPlanAndCredits(ctx context.Context, userID, paidPlanCode string, membership *domain.UserMembership, meta *earlyUserMembershipMeta) (string, int, error) {
	effectivePlanCode := paidPlanCode
	if _, ok := manualMembershipUpgradeUserIDs[userID]; ok && membership != nil && membership.CurrentPlanCode != nil {
		existingPlanCode := strings.TrimSpace(*membership.CurrentPlanCode)
		if membershipTierOrder(existingPlanCode) > membershipTierOrder(paidPlanCode) {
			effectivePlanCode = existingPlanCode
		}
	}

	paidPlanDailyCredits, err := s.planDailyCredits(ctx, paidPlanCode)
	if err != nil {
		return "", 0, err
	}
	paidPlanDailyCredits = applyEarlyPaidMultiplier(paidPlanDailyCredits, meta)
	effectiveDailyCredits := paidPlanDailyCredits
	if _, ok := manualMembershipUpgradeUserIDs[userID]; ok {
		existingDailyCredits := 0
		if membership != nil {
			existingDailyCredits = membership.DailyCredits
		}
		effectivePlanDailyCredits := paidPlanDailyCredits
		if effectivePlanCode != paidPlanCode {
			effectivePlanDailyCredits, err = s.planDailyCredits(ctx, effectivePlanCode)
			if err != nil {
				return "", 0, err
			}
			effectivePlanDailyCredits = applyEarlyPaidMultiplier(effectivePlanDailyCredits, meta)
		}
		effectiveDailyCredits = maxInt(existingDailyCredits, maxInt(paidPlanDailyCredits, effectivePlanDailyCredits))
	}
	return effectivePlanCode, maxInt(effectiveDailyCredits, 0), nil
}

func (s *MembershipService) planDailyCredits(ctx context.Context, planCode string) (int, error) {
	code := strings.TrimSpace(planCode)
	if code == "" {
		return 0, nil
	}
	plan, err := s.repo.GetPlanByCode(ctx, code)
	if err != nil || plan == nil {
		return 0, err
	}
	return maxInt(plan.DailyCredits, 0), nil
}

func applyEarlyPaidMultiplier(credits int, meta *earlyUserMembershipMeta) int {
	if credits <= 0 {
		return 0
	}
	if meta != nil && meta.PaidBonusEligible && meta.PaidBonusMultiplier > 1 {
		return credits * meta.PaidBonusMultiplier
	}
	return credits
}

func membershipMatchesPaidTruth(membership *domain.UserMembership, planCode, status string, paidAt, expiresAt time.Time, dailyCredits int) bool {
	if membership == nil {
		return false
	}
	if strings.TrimSpace(fmt.Sprintf("%v", stringValue(membership.CurrentPlanCode))) != strings.TrimSpace(planCode) {
		return false
	}
	if strings.TrimSpace(membership.Status) != status {
		return false
	}
	if !timeMatches(membership.CurrentPeriodStart, paidAt) || !timeMatches(membership.ExpiresAt, expiresAt) || !timeMatches(membership.LastPaidAt, paidAt) {
		return false
	}
	return membership.DailyCredits == dailyCredits
}

func membershipActiveForChinaDate(membership *domain.UserMembership, target time.Time) bool {
	if membership == nil {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(membership.Status))
	if status != "" && status != "active" && status != "trialing" {
		return false
	}
	targetDate := dateOnly(target.In(chinaLocation()))
	start := membership.CurrentPeriodStart
	if start == nil {
		start = membership.FirstActivatedAt
	}
	if start != nil && targetDate.Before(dateOnly(start.In(chinaLocation()))) {
		return false
	}
	if membership.ExpiresAt != nil && targetDate.After(dateOnly(membership.ExpiresAt.In(chinaLocation()))) {
		return false
	}
	return true
}

func userRegistrationTime(user *membershiprepo.User) *time.Time {
	if user == nil {
		return nil
	}
	if user.CreateTime != nil {
		return user.CreateTime
	}
	return user.CreatedAt
}

func membershipTierOrder(planCode string) int {
	switch {
	case strings.HasPrefix(strings.ToLower(strings.TrimSpace(planCode)), "light_"):
		return 1
	case strings.HasPrefix(strings.ToLower(strings.TrimSpace(planCode)), "standard_"):
		return 2
	case strings.HasPrefix(strings.ToLower(strings.TrimSpace(planCode)), "advanced_"):
		return 3
	case strings.EqualFold(strings.TrimSpace(planCode), "pro_monthly"):
		return 2
	default:
		return 0
	}
}

func timeMatches(actual *time.Time, expected time.Time) bool {
	if actual == nil {
		return false
	}
	return actual.UTC().Truncate(time.Second).Equal(expected.UTC().Truncate(time.Second))
}

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

type wechatPayConfig struct {
	AppID      string
	MchID      string
	NotifyURL  string
	SerialNo   string
	APIV3Key   string
	PrivateKey string
	PublicKey  string
}

func (s *MembershipService) wechatPayConfig() (*wechatPayConfig, error) {
	if s.cfg == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少微信支付配置", HTTPStatus: 500}
	}
	cfg := &wechatPayConfig{
		AppID:      strings.TrimSpace(s.cfg.External.AppID),
		MchID:      strings.TrimSpace(s.cfg.WechatPay.MchID),
		NotifyURL:  strings.TrimSpace(s.cfg.WechatPay.NotifyURL),
		SerialNo:   strings.TrimSpace(s.cfg.WechatPay.SerialNo),
		APIV3Key:   strings.TrimSpace(s.cfg.WechatPay.APIV3Key),
		PrivateKey: normalizePEMValue(s.cfg.WechatPay.PrivateKey),
		PublicKey:  normalizePEMValue(s.cfg.WechatPay.PublicKey),
	}
	missing := []string{}
	if cfg.AppID == "" {
		missing = append(missing, "APPID")
	}
	if cfg.MchID == "" {
		missing = append(missing, "WECHAT_PAY_MCHID")
	}
	if cfg.NotifyURL == "" {
		missing = append(missing, "WECHAT_PAY_NOTIFY_URL")
	}
	if cfg.SerialNo == "" {
		missing = append(missing, "WECHAT_PAY_SERIAL_NO")
	}
	if cfg.APIV3Key == "" {
		missing = append(missing, "WECHAT_PAY_API_V3_KEY")
	}
	if cfg.PrivateKey == "" {
		missing = append(missing, "WECHAT_PAY_PRIVATE_KEY")
	}
	if len(missing) > 0 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少微信支付配置：" + strings.Join(missing, ", "), HTTPStatus: 500}
	}
	return cfg, nil
}

func formatMembershipResponse(membership *domain.UserMembership) map[string]any {
	if membership == nil {
		return map[string]any{
			"is_pro":               false,
			"status":               "inactive",
			"current_plan_code":    nil,
			"first_activated_at":   nil,
			"current_period_start": nil,
			"expires_at":           nil,
			"last_paid_at":         nil,
		}
	}
	status := membership.Status
	if status == "" {
		status = "inactive"
	}
	if status == "active" && membership.ExpiresAt != nil && !membership.ExpiresAt.After(time.Now()) {
		status = "expired"
	}
	isPro := status == "active" && membership.ExpiresAt != nil && membership.ExpiresAt.After(time.Now())
	return map[string]any{
		"is_pro":               isPro,
		"status":               status,
		"current_plan_code":    stringValue(membership.CurrentPlanCode),
		"first_activated_at":   timePtrISO(membership.FirstActivatedAt),
		"current_period_start": timePtrISO(membership.CurrentPeriodStart),
		"expires_at":           timePtrISO(membership.ExpiresAt),
		"last_paid_at":         timePtrISO(membership.LastPaidAt),
	}
}

func parseWechatErrorMessage(body []byte) string {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err == nil {
		if msg, ok := parsed["message"].(string); ok && msg != "" {
			return msg
		}
		if msg, ok := parsed["detail"].(string); ok && msg != "" {
			return msg
		}
	}
	return strings.TrimSpace(string(body))
}

func generateMembershipOrderNo() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return "PM" + time.Now().In(chinaLocation()).Format("20060102150405") + strings.ToUpper(hex.EncodeToString(b[:]))
}

func amountToFen(amount float64) int {
	return int(math.Round(amount * 100))
}

func buildWechatPayAuthorization(mchID, serialNo, privateKeyPEM, method, canonicalURL, body string) (string, error) {
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	nonce := randomHex(16)
	message := strings.ToUpper(method) + "\n" + canonicalURL + "\n" + timestamp + "\n" + nonce + "\n" + body + "\n"
	signature, err := signWithRSASHA256(message, privateKeyPEM)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",signature="%s",timestamp="%s",serial_no="%s"`, mchID, nonce, signature, timestamp, serialNo), nil
}

func buildMiniProgramPayParams(appID, prepayID, privateKeyPEM string) (map[string]string, error) {
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	nonce := randomHex(16)
	packageValue := "prepay_id=" + prepayID
	message := appID + "\n" + timestamp + "\n" + nonce + "\n" + packageValue + "\n"
	signature, err := signWithRSASHA256(message, privateKeyPEM)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"timeStamp": timestamp,
		"nonceStr":  nonce,
		"package":   packageValue,
		"signType":  "RSA",
		"paySign":   signature,
	}, nil
}

func signWithRSASHA256(message, privateKeyPEM string) (string, error) {
	privateKey, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}
	hashed := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hashed[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func verifyWithRSASHA256(message, signatureB64, publicKeyPEM string) (bool, error) {
	publicKey, err := parseRSAPublicKey(publicKeyPEM)
	if err != nil {
		return false, err
	}
	signature, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		return false, err
	}
	hashed := sha256.Sum256([]byte(message))
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, hashed[:], signature); err != nil {
		return false, nil
	}
	return true, nil
}

func parseRSAPrivateKey(privateKeyPEM string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("invalid private key pem")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not RSA")
	}
	return key, nil
}

func parseRSAPublicKey(publicKeyPEM string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("invalid public key pem")
	}
	if key, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		if rsaKey, ok := key.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		if rsaKey, ok := cert.PublicKey.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	return nil, fmt.Errorf("public key is not RSA")
}

func decryptWechatPayResource(resource map[string]any, apiV3Key string) (map[string]any, error) {
	ciphertext := strings.TrimSpace(fmt.Sprintf("%v", resource["ciphertext"]))
	nonce := strings.TrimSpace(fmt.Sprintf("%v", resource["nonce"]))
	associatedData := strings.TrimSpace(fmt.Sprintf("%v", resource["associated_data"]))
	if ciphertext == "" || nonce == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付回调缺少加密资源字段", HTTPStatus: 400}
	}
	cipherBytes, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	var aad []byte
	if associatedData != "" && associatedData != "<nil>" {
		aad = []byte(associatedData)
	}
	plain, err := gcm.Open(nil, []byte(nonce), cipherBytes, aad)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(plain, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func normalizePEMValue(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	raw = strings.ReplaceAll(raw, `\n`, "\n")
	if strings.Contains(raw, "BEGIN ") {
		return raw
	}
	if bytes, err := os.ReadFile(raw); err == nil {
		return strings.TrimSpace(strings.ReplaceAll(string(bytes), `\n`, "\n"))
	}
	return raw
}

func randomHex(size int) string {
	buf := make([]byte, size)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func addMonths(dt time.Time, months int) time.Time {
	if months <= 0 {
		months = 1
	}
	year, month, day := dt.Date()
	hour, min, sec := dt.Clock()
	nsec := dt.Nanosecond()
	total := int(month) - 1 + months
	year += total / 12
	month = time.Month(total%12 + 1)
	last := lastDayOfMonth(year, month)
	if day > last {
		day = last
	}
	return time.Date(year, month, day, hour, min, sec, nsec, dt.Location())
}

func lastDayOfMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func chinaLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err == nil {
		return loc
	}
	return time.FixedZone("CST", 8*3600)
}

func nextChinaMidnightISO() string {
	now := time.Now().In(chinaLocation())
	next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, chinaLocation())
	return next.Format(time.RFC3339)
}

func timePtrISO(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format(time.RFC3339)
}

func parseTime(value string) *time.Time {
	raw := strings.TrimSpace(value)
	if raw == "" || raw == "<nil>" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t
	}
	if t, err := time.Parse("2006-01-02T15:04:05-07:00", raw); err == nil {
		return &t
	}
	return nil
}

func timeOr(t *time.Time, fallback time.Time) time.Time {
	if t != nil {
		return *t
	}
	return fallback
}

func stringValue(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func floatPtrValue(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func intPtr(value int) *int {
	return &value
}

func intPtrValue(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

func boolValue(v any) bool {
	b, _ := v.(bool)
	return b
}

func stringPtrFromAny(v any) *string {
	s := strings.TrimSpace(fmt.Sprintf("%v", v))
	if s == "" || s == "<nil>" {
		return nil
	}
	return &s
}

func wxString(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func isMembershipPlanCode(planCode string) bool {
	code := strings.TrimSpace(strings.ToLower(planCode))
	return code == "pro_monthly" ||
		strings.HasPrefix(code, "light_") ||
		strings.HasPrefix(code, "standard_") ||
		strings.HasPrefix(code, "advanced_")
}

func normalizeFoodExecutionMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "strict", "precision":
		return "strict"
	default:
		return "standard"
	}
}

func canUsePrecisionMode(membership *domain.UserMembership) bool {
	if membership == nil || membership.Status != "active" || membership.ExpiresAt == nil || !membership.ExpiresAt.After(time.Now()) {
		return false
	}
	if membership.CurrentPlanCode == nil {
		return false
	}
	code := strings.TrimSpace(*membership.CurrentPlanCode)
	return strings.EqualFold(code, "pro_monthly") || strings.HasPrefix(code, "standard_") || strings.HasPrefix(code, "advanced_")
}

func normalizeChinaDate(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return time.Now().In(chinaLocation()).Format("2006-01-02"), nil
	}
	if t, err := time.ParseInLocation("2006-01-02", raw, chinaLocation()); err == nil {
		return t.Format("2006-01-02"), nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.In(chinaLocation()).Format("2006-01-02"), nil
	}
	return "", &commonerrors.AppError{Code: 10002, Message: "date 格式无效", HTTPStatus: 400}
}

func earnedCreditsToConsume(creditsInfo map[string]any, cost int) int {
	if creditsInfo == nil {
		return 0
	}
	if plan, ok := creditsInfo["credit_spend_plan"].(map[string]any); ok {
		return maxInt(intFromAny(plan["earned_units"]), 0)
	}
	systemRemaining := maxInt(intFromAny(creditsInfo["system_credits_remaining"]), 0)
	return maxInt(cost-systemRemaining, 0)
}
