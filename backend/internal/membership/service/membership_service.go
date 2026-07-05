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
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
)

const (
	creditCostStandardFoodAnalysis  = 2
	creditCostPrecisionFoodAnalysis = 4
	creditCostStandardCorrection    = 1
	creditCostPrecisionCorrection   = 2
	creditCostExerciseLog           = 1
	creditCostDietRecommendation    = 1
	creditCostStatsInsight          = 1
	trialDailyCredits               = 8
	earlyUserTop500Limit            = 500
	earlyUserTrialLimit             = 1000
	earlyPaidUserLimit              = 100
	earlyUserTop500TrialDays        = 60
	earlyUserTrialDays              = 30
	regularUserTrialDays            = 3
	earlyUserPaidCreditsMultiplier  = 2
	inviteRewardRequiredDays        = 2
	inviteRewardWindowDays          = 7
	inviteRewardCreditsOnQualify    = 15
	inviteRewardMembershipGrantDays = 7
	inviteRewardMembershipPlanCode  = "light_monthly"
	inviteRewardMembershipType      = "membership_light_week"
	inviteRewardMembershipLabel     = "一周轻度版会员"
	inviteRewardMonthlyLimit        = 5
	inviteRewardLegacyCreditsPerDay = 5
	sharePosterRewardCredits        = 1
	sharePosterDailyMaxEvents       = 3
	packagedUploadRewardCredits     = 1
	packagedUploadDailyMaxEvents    = 0
	publicFoodUploadRewardCredits   = 1
	publicFoodUploadDailyMaxEvents  = 3
)

var wechatPayAPIBaseURL = "https://api.mch.weixin.qq.com"

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
	GetTrialEntitlementByUserID(ctx context.Context, userID string) (*domain.UserTrialEntitlement, error)
	GetFirstPaidMembershipUserRank(ctx context.Context, userID string, limit int) (int, error)
	CountDailyMembershipBonusCredits(ctx context.Context, userID, chinaDate string) (inviteBonus int, shareBonus int, err error)
	GetMembershipGrantBySourceKey(ctx context.Context, sourceKey string) (*domain.UserMembershipGrant, error)
	GrantMembership(ctx context.Context, input domain.MembershipGrantInput) (*domain.UserMembershipGrant, *domain.UserMembership, bool, error)
	GetInviteReferralByInvitee(ctx context.Context, inviteeUserID string) (*domain.UserInviteReferral, error)
	UpdateInviteReferral(ctx context.Context, id string, updates map[string]any) (*domain.UserInviteReferral, error)
	ListPendingInviteReferralsByInviter(ctx context.Context, inviterUserID string) ([]domain.UserInviteReferral, error)
	ListInviteReferralsForUser(ctx context.Context, userID string) ([]domain.UserInviteReferral, error)
	CountCompletedInviteRewardsForInviterInMonth(ctx context.Context, inviterUserID, monthStart, nextMonthStart string) (int, error)
	ListActiveInviteRewards(ctx context.Context, userID, chinaDate string) ([]domain.UserInviteReferral, error)
	ListSharePosterBonusEvents(ctx context.Context, userID, chinaDate string) ([]domain.UserCreditBonusEvent, error)
	GetUser(ctx context.Context, userID string) (*membershiprepo.User, error)
	GetFoodRecordOwner(ctx context.Context, recordID string) (string, error)
	CountFoodRecordsByDate(ctx context.Context, userID, chinaDate string) (int, error)
	CountSharePosterClaims(ctx context.Context, userID, chinaDate string) (int, error)
	GetSharePosterClaim(ctx context.Context, userID, recordID, chinaDate string) (*domain.UserCreditBonusEvent, error)
	GetSharePosterClaimBySourceKey(ctx context.Context, userID, sourceKey, chinaDate string) (*domain.UserCreditBonusEvent, error)
	CreateSharePosterBonusEvent(ctx context.Context, userID, sourceKey, sourceScope, recordID, chinaDate string, credits int, meta map[string]any) (*domain.UserCreditBonusEvent, error)
	GetEarnedCreditLedgerBySource(ctx context.Context, userID, reason, sourceKey string) (*domain.UserEarnedCreditLedger, error)
	ChangeEarnedCredits(ctx context.Context, userID string, delta int, reason, sourceKey, relatedDate string, meta map[string]any) (*domain.UserEarnedCreditLedger, bool, error)
	ChangeCreditsWithSystemUsage(ctx context.Context, userID string, earnedDelta int, earnedReason, earnedSourceKey, systemReason, systemSourceKey, relatedDate string, earnedMeta, systemMeta map[string]any) error
	SumPositiveEarnedCreditsByDate(ctx context.Context, userID, chinaDate string) (int, error)
	CountRewardTaskUploads(ctx context.Context, userID, taskType, chinaDate, status string) (int, error)
	GetRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string) (*domain.RewardTaskUpload, error)
	CreateRewardTaskUpload(ctx context.Context, row *domain.RewardTaskUpload) error
	UpdateRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string, updates map[string]any) (*domain.RewardTaskUpload, error)
}

type PaymentTestPolicyRepo interface {
	GetPaymentTestAccess(ctx context.Context, userID string) (*domain.PaymentTestAccess, error)
}

type SharePosterRewardClaimInput struct {
	RecordID   string `json:"record_id"`
	ShareScope string `json:"share_scope"`
	ShareDate  string `json:"share_date"`
}

type CreateMembershipPaymentInput struct {
	PlanCode   string
	PayChannel string
	TradeType  string
	Client     string
}

type MembershipService struct {
	repo            MembershipRepo
	paymentTestRepo PaymentTestPolicyRepo
	cfg             *config.Config
	client          *http.Client
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
	StartAt   *time.Time
}

type membershipPaymentTerms struct {
	Mode                       string
	ChargeAmount               float64
	CurrentPlanCode            string
	CurrentPeriodStart         time.Time
	CurrentExpiresAt           time.Time
	TargetPeriodStart          time.Time
	TargetExpiresAt            time.Time
	CurrentRemainingValue      float64
	TargetRemainingValue       float64
	UnusedCurrentCreditApplied float64
}

type membershipPaymentKind struct {
	Channel       string
	StoredChannel string
	TradeType     string
	CanonicalURL  string
}

func NewMembershipService(repo MembershipRepo, cfg ...*config.Config) *MembershipService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	svc := &MembershipService{repo: repo, cfg: c, client: &http.Client{Timeout: 15 * time.Second}}
	if paymentTestRepo, ok := repo.(PaymentTestPolicyRepo); ok {
		svc.paymentTestRepo = paymentTestRepo
	}
	return svc
}

func (s *MembershipService) ListPlans(ctx context.Context, userID string) ([]map[string]any, error) {
	plans, err := s.repo.ListActivePlans(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) != "" && s.paymentTestRepo != nil {
		testPlan, err := s.visiblePaymentTestPlan(ctx, userID)
		if err != nil {
			return nil, err
		}
		if testPlan != nil {
			plans = append(plans, *testPlan)
		}
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
			"is_test_plan":    p.IsTestPlan,
		})
	}
	return out, nil
}

func (s *MembershipService) visiblePaymentTestPlan(ctx context.Context, userID string) (*domain.MembershipPlan, error) {
	access, err := s.paymentTestRepo.GetPaymentTestAccess(ctx, userID)
	if err != nil {
		return nil, err
	}
	if access == nil || !access.Enabled || !access.UserAllowed {
		return nil, nil
	}
	plan, err := s.repo.GetPlanByCode(ctx, domain.PaymentTestPlanCode)
	if err != nil {
		return nil, err
	}
	if plan == nil || !plan.IsActive || !plan.IsTestPlan {
		return nil, nil
	}
	return plan, nil
}

func (s *MembershipService) GetMyMembership(ctx context.Context, userID string, date string) (map[string]any, error) {
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

	credits, err := s.computeDailyCreditsStatus(ctx, userID, boolValue(resp["is_pro"]), membership, user, date)
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
	if err != nil || latest == nil || !isMembershipPlanCode(latest.PlanCode) || isPaymentTestPlanCode(latest.PlanCode) {
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
	trialEntitlement, err := s.repo.GetTrialEntitlementByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, trialEntitlement)
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
	expectedPeriodStart := *paidAt
	expectedExpiresAt := addMonths(*paidAt, durationMonths)
	if terms, ok := paymentTermsFromExtra(latest.Extra); ok && terms.Mode == "prorated_current_period_upgrade" {
		expectedPeriodStart = terms.TargetPeriodStart
		expectedExpiresAt = terms.TargetExpiresAt
	}
	expectedStatus := "expired"
	if expectedExpiresAt.After(time.Now()) {
		expectedStatus = "active"
	}
	firstActivatedAt := *paidAt
	if membership != nil && membership.FirstActivatedAt != nil {
		firstActivatedAt = *membership.FirstActivatedAt
	}
	if membership != nil && membershipMatchesPaidTruth(membership, effectivePlanCode, expectedStatus, expectedPeriodStart, expectedExpiresAt, *paidAt, effectiveDailyCredits) {
		return membership, nil
	}
	return s.repo.SaveMembership(ctx, userID, map[string]any{
		"current_plan_code":    effectivePlanCode,
		"status":               expectedStatus,
		"first_activated_at":   firstActivatedAt,
		"current_period_start": expectedPeriodStart,
		"expires_at":           expectedExpiresAt,
		"last_paid_at":         *paidAt,
		"auto_renew":           false,
		"daily_credits":        effectiveDailyCredits,
	})
}

func (s *MembershipService) computeDailyCreditsStatus(ctx context.Context, userID string, isPro bool, membership *domain.UserMembership, user *membershiprepo.User, date string) (map[string]any, error) {
	nowCN := time.Now().In(chinaLocation())
	today := nowCN.Format("2006-01-02")
	if strings.TrimSpace(date) != "" {
		today = strings.TrimSpace(date)
	}
	base := 0
	trialActive := false
	var trialExpiresAt *time.Time
	trialDaysTotal := 0
	var trialPolicy any
	trialEntitlement, err := s.repo.GetTrialEntitlementByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	earlyMeta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, trialEntitlement)
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
		policy := s.resolveUserTrialPolicy(trialEntitlement, earlyMeta)
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
	if _, _, err := s.materializeDailyBonusCredits(ctx, userID, today); err != nil {
		return nil, err
	}
	inviteBonusCredits, shareBonusCredits, err := s.repo.CountDailyMembershipBonusCredits(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	dailyBonusCredits := inviteBonusCredits + shareBonusCredits
	if refreshedUser, err := s.repo.GetUser(ctx, userID); err == nil && refreshedUser != nil {
		user = refreshedUser
	}
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

func (s *MembershipService) ActivatePendingInviteReferralOnFirstValidUse(ctx context.Context, inviteeUserID, effectiveAction string) (*domain.UserInviteReferral, error) {
	inviteeUserID = strings.TrimSpace(inviteeUserID)
	if inviteeUserID == "" {
		return nil, nil
	}
	referral, err := s.repo.GetInviteReferralByInvitee(ctx, inviteeUserID)
	if err != nil || referral == nil {
		return referral, err
	}
	status := strings.TrimSpace(referral.Status)
	switch status {
	case "reward_completed", "reward_blocked", "cancelled", "reward_active":
		return referral, nil
	case "pending_qualified":
	default:
		return referral, nil
	}

	nowUTC := time.Now().UTC()
	todayCN := dateOnly(nowUTC.In(chinaLocation()))
	createdAt := nowUTC
	if referral.CreatedAt != nil {
		createdAt = *referral.CreatedAt
	}
	deadlineCN := dateOnly(createdAt.In(chinaLocation())).AddDate(0, 0, inviteRewardWindowDays-1)
	if todayCN.After(deadlineCN) {
		blocked := "qualification_window_expired"
		return s.repo.UpdateInviteReferral(ctx, referral.ID, map[string]any{
			"status":         "reward_blocked",
			"blocked_reason": blocked,
			"updated_at":     nowUTC,
		})
	}

	if referral.FirstEffectiveActionAt == nil {
		action := strings.TrimSpace(effectiveAction)
		return s.repo.UpdateInviteReferral(ctx, referral.ID, map[string]any{
			"first_effective_action_at":   nowUTC,
			"first_effective_action_type": action,
			"updated_at":                  nowUTC,
		})
	}
	firstDay := dateOnly(referral.FirstEffectiveActionAt.In(chinaLocation()))
	if todayCN.Equal(firstDay) {
		return referral, nil
	}

	monthStart := time.Date(todayCN.Year(), todayCN.Month(), 1, 0, 0, 0, 0, chinaLocation())
	nextMonthStart := monthStart.AddDate(0, 1, 0)
	qualifiedCount, err := s.repo.CountCompletedInviteRewardsForInviterInMonth(ctx, referral.InviterUserID, monthStart.Format("2006-01-02"), nextMonthStart.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	if qualifiedCount >= inviteRewardMonthlyLimit {
		blocked := "monthly_limit_reached"
		return s.repo.UpdateInviteReferral(ctx, referral.ID, map[string]any{
			"status":         "reward_blocked",
			"blocked_reason": blocked,
			"updated_at":     nowUTC,
		})
	}

	qualifiedDate := todayCN.Format("2006-01-02")
	baseMeta := map[string]any{
		"referral_id":     referral.ID,
		"inviter_user_id": referral.InviterUserID,
		"invitee_user_id": referral.InviteeUserID,
		"qualified_date":  qualifiedDate,
		"rule":            fmt.Sprintf("%dd/%ddays/%ddays-light-membership", inviteRewardWindowDays, inviteRewardRequiredDays, inviteRewardMembershipGrantDays),
		"reward_type":     inviteRewardMembershipType,
		"reward_label":    inviteRewardMembershipLabel,
	}
	inviterMeta := copyMeta(baseMeta)
	inviterMeta["role"] = "inviter"
	if _, err := s.grantInviteRewardMembership(ctx, referral, "inviter", inviterMeta); err != nil {
		return nil, err
	}
	inviteeMeta := copyMeta(baseMeta)
	inviteeMeta["role"] = "invitee"
	if _, err := s.grantInviteRewardMembership(ctx, referral, "invitee", inviteeMeta); err != nil {
		return nil, err
	}
	rewardDate := todayCN
	rewardEndDate := todayCN.AddDate(0, 0, inviteRewardMembershipGrantDays-1)
	return s.repo.UpdateInviteReferral(ctx, referral.ID, map[string]any{
		"status":            "reward_completed",
		"reward_start_date": rewardDate,
		"reward_end_date":   rewardEndDate,
		"blocked_reason":    nil,
		"updated_at":        nowUTC,
	})
}

func (s *MembershipService) grantInviteRewardMembership(ctx context.Context, referral *domain.UserInviteReferral, role string, meta map[string]any) (*domain.UserMembershipGrant, error) {
	if referral == nil {
		return nil, nil
	}
	userID := referral.InviteeUserID
	if role == "inviter" {
		userID = referral.InviterUserID
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, nil
	}
	plan, err := s.repo.GetPlanByCode(ctx, inviteRewardMembershipPlanCode)
	if err != nil {
		return nil, err
	}
	dailyCredits := trialDailyCredits
	if plan != nil && plan.DailyCredits > 0 {
		dailyCredits = plan.DailyCredits
	}
	sourceKey := inviteMembershipGrantSourceKey(referral.ID, role)
	grant, membership, applied, err := s.repo.GrantMembership(ctx, domain.MembershipGrantInput{
		UserID:       userID,
		SourceType:   "invite_qualified_reward",
		SourceKey:    sourceKey,
		PlanCode:     inviteRewardMembershipPlanCode,
		DailyCredits: dailyCredits,
		GrantDays:    inviteRewardMembershipGrantDays,
		ReferralID:   referral.ID,
		Role:         role,
		Meta:         meta,
	})
	if err != nil {
		return nil, err
	}
	if applied {
		membershipExpiresAt := ""
		if membership != nil {
			membershipExpiresAt = fmt.Sprintf("%v", timePtrISO(membership.ExpiresAt))
		}
		logger.Info(ctx, "邀请达标会员奖励已发放",
			slog.String("referral_id", referral.ID),
			slog.String("user_id", userID),
			slog.String("role", role),
			slog.String("source_key", sourceKey),
			slog.String("plan_code", grant.PlanCode),
			slog.Int("grant_days", inviteRewardMembershipGrantDays),
			slog.String("membership_expires_at", membershipExpiresAt),
		)
	}
	return grant, nil
}

// GetInviteRewardStatus 返回当前用户作为被邀请人和邀请人的邀请奖励进度。
func (s *MembershipService) GetInviteRewardStatus(ctx context.Context, userID string) (map[string]any, error) {
	userID = strings.TrimSpace(userID)
	result := map[string]any{
		"as_invitee": nil,
		"as_inviter": []any{},
		"records":    []any{},
	}
	if userID == "" {
		return result, nil
	}

	todayCN := dateOnly(time.Now().In(chinaLocation()))

	referral, err := s.repo.GetInviteReferralByInvitee(ctx, userID)
	if err != nil {
		return nil, err
	}
	if ok, days := s.pendingInviteRecordsNeeded(referral, todayCN); ok {
		inviterNickname := ""
		if inviter, err := s.repo.GetUser(ctx, referral.InviterUserID); err == nil && inviter != nil && inviter.Nickname != nil {
			inviterNickname = *inviter.Nickname
		}
		result["as_invitee"] = map[string]any{
			"referral_id":      referral.ID,
			"status":           referral.Status,
			"records_needed":   days,
			"reward_credits":   inviteRewardCreditsOnQualify,
			"reward_type":      inviteRewardMembershipType,
			"reward_label":     inviteRewardMembershipLabel,
			"reward_days":      inviteRewardMembershipGrantDays,
			"reward_plan_code": inviteRewardMembershipPlanCode,
			"inviter_nickname": inviterNickname,
		}
	}

	inviterRows, err := s.repo.ListPendingInviteReferralsByInviter(ctx, userID)
	if err != nil {
		return nil, err
	}
	inviterList := make([]any, 0, len(inviterRows))
	for _, ref := range inviterRows {
		if ok, days := s.pendingInviteRecordsNeeded(&ref, todayCN); ok {
			inviteeNickname := ""
			if invitee, err := s.repo.GetUser(ctx, ref.InviteeUserID); err == nil && invitee != nil && invitee.Nickname != nil {
				inviteeNickname = *invitee.Nickname
			}
			inviterList = append(inviterList, map[string]any{
				"referral_id":      ref.ID,
				"invitee_nickname": inviteeNickname,
				"status":           ref.Status,
				"records_needed":   days,
				"reward_credits":   inviteRewardCreditsOnQualify,
				"reward_type":      inviteRewardMembershipType,
				"reward_label":     inviteRewardMembershipLabel,
				"reward_days":      inviteRewardMembershipGrantDays,
				"reward_plan_code": inviteRewardMembershipPlanCode,
			})
		}
	}
	result["as_inviter"] = inviterList

	rows, err := s.repo.ListInviteReferralsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	records := make([]any, 0, len(rows))
	for _, row := range rows {
		records = append(records, s.buildInviteRewardRecord(ctx, userID, row, todayCN))
	}
	result["records"] = records
	return result, nil
}

func (s *MembershipService) buildInviteRewardRecord(ctx context.Context, userID string, referral domain.UserInviteReferral, todayCN time.Time) map[string]any {
	role := "invitee"
	otherUserID := referral.InviterUserID
	if referral.InviterUserID == userID {
		role = "inviter"
		otherUserID = referral.InviteeUserID
	}
	otherNickname := ""
	if other, err := s.repo.GetUser(ctx, otherUserID); err == nil && other != nil && other.Nickname != nil {
		otherNickname = strings.TrimSpace(*other.Nickname)
	}

	recordsNeeded, expired := inviteRewardProgress(referral, todayCN)
	statusLabel := inviteRewardStatusLabel(referral.Status, expired)
	blockedReasonLabel := inviteRewardBlockedReasonLabel(referral.BlockedReason)
	grant := s.inviteMembershipGrantForRecord(ctx, referral.ID, role)
	hasMembershipGrant := grant != nil
	requirementText, nextActionText := inviteRewardActionTextsV2(role, referral, recordsNeeded, expired, blockedReasonLabel, hasMembershipGrant)
	rewardType := inviteRewardMembershipType
	rewardLabel := inviteRewardMembershipLabel
	rewardDays := inviteRewardMembershipGrantDays
	rewardPlanCode := inviteRewardMembershipPlanCode
	var membershipGrantStartAt any
	var membershipGrantExpiresAt any
	if grant != nil {
		membershipGrantStartAt = timePtrISO(grant.StartsAt)
		membershipGrantExpiresAt = timePtrISO(grant.ExpiresAt)
		if strings.TrimSpace(grant.PlanCode) != "" {
			rewardPlanCode = grant.PlanCode
		}
	} else if referral.Status == "reward_completed" {
		rewardType = "earned_credits"
		rewardLabel = fmt.Sprintf("%d 奖励积分", inviteRewardCreditsOnQualify)
		rewardDays = 0
		rewardPlanCode = ""
	}
	return map[string]any{
		"referral_id":                 referral.ID,
		"role":                        role,
		"status":                      referral.Status,
		"status_label":                statusLabel,
		"invite_code":                 stringValue(referral.InviteCode),
		"other_user_id":               otherUserID,
		"other_nickname":              otherNickname,
		"records_needed":              recordsNeeded,
		"reward_credits":              inviteRewardCreditsOnQualify,
		"reward_type":                 rewardType,
		"reward_label":                rewardLabel,
		"reward_days":                 rewardDays,
		"reward_plan_code":            rewardPlanCode,
		"membership_grant_start_at":   membershipGrantStartAt,
		"membership_grant_expires_at": membershipGrantExpiresAt,
		"requirement_text":            requirementText,
		"next_action_text":            nextActionText,
		"first_effective_action_at":   timePtrISO(referral.FirstEffectiveActionAt),
		"first_effective_action_type": stringValue(referral.FirstEffectiveActionType),
		"reward_start_date":           datePtrValue(referral.RewardStartDate),
		"reward_end_date":             datePtrValue(referral.RewardEndDate),
		"blocked_reason":              stringValue(referral.BlockedReason),
		"blocked_reason_label":        blockedReasonLabel,
		"created_at":                  timePtrISO(referral.CreatedAt),
		"updated_at":                  timePtrISO(referral.UpdatedAt),
	}
}

func (s *MembershipService) inviteMembershipGrantForRecord(ctx context.Context, referralID, role string) *domain.UserMembershipGrant {
	grant, err := s.repo.GetMembershipGrantBySourceKey(ctx, inviteMembershipGrantSourceKey(referralID, role))
	if err != nil {
		return nil
	}
	return grant
}

func inviteMembershipGrantSourceKey(referralID, role string) string {
	referralID = strings.TrimSpace(referralID)
	role = strings.TrimSpace(role)
	if referralID == "" || role == "" {
		return ""
	}
	return "invite-qualified:" + referralID + ":" + role
}

func inviteRewardProgress(referral domain.UserInviteReferral, todayCN time.Time) (int, bool) {
	if referral.Status != "pending_qualified" {
		return 0, false
	}
	createdAt := time.Now().UTC()
	if referral.CreatedAt != nil {
		createdAt = *referral.CreatedAt
	}
	deadlineCN := dateOnly(createdAt.In(chinaLocation())).AddDate(0, 0, inviteRewardWindowDays-1)
	if todayCN.After(deadlineCN) {
		return 0, true
	}
	distinctDays := 0
	if referral.FirstEffectiveActionAt != nil {
		distinctDays = 1
	}
	return maxInt(inviteRewardRequiredDays-distinctDays, 0), false
}

func inviteRewardStatusLabel(status string, expired bool) string {
	if expired {
		return "已过期"
	}
	switch strings.TrimSpace(status) {
	case "pending_qualified":
		return "进行中"
	case "reward_completed":
		return "已完成"
	case "reward_blocked":
		return "未达成"
	case "reward_active":
		return "奖励中"
	case "cancelled":
		return "已取消"
	default:
		if strings.TrimSpace(status) == "" {
			return "未知状态"
		}
		return status
	}
}

func inviteRewardBlockedReasonLabel(reason *string) string {
	raw := ""
	if reason != nil {
		raw = *reason
	}
	switch strings.TrimSpace(raw) {
	case "qualification_window_expired":
		return "7 天有效期已过"
	case "monthly_limit_reached":
		return "邀请人当月奖励名额已满"
	default:
		return ""
	}
}

func inviteRewardActionTexts(role string, referral domain.UserInviteReferral, recordsNeeded int, expired bool, blockedReasonLabel string, hasMembershipGrant bool) (string, string) {
	rewardText := "完成后双方各得" + inviteRewardMembershipLabel
	if role == "inviter" {
		rewardText = "好友完成后你们各得" + inviteRewardMembershipLabel
	}
	switch strings.TrimSpace(referral.Status) {
	case "pending_qualified":
		if expired {
			return fmt.Sprintf("注册后 %d 天内完成 %d 个不同自然日有效记录", inviteRewardWindowDays, inviteRewardRequiredDays), "已超过有效期，无法获得奖励"
		}
		if recordsNeeded <= 1 {
			return fmt.Sprintf("还需在另一个自然日再完成 1 次有效记录，%s", rewardText), "完成 1 个不同自然日的饮食或运动记录"
		}
		return fmt.Sprintf("还需完成 %d 个不同自然日的饮食或运动记录，%s", recordsNeeded, rewardText), "完成饮食或运动记录，先点亮第 1 个有效自然日"
	case "reward_completed":
		if hasMembershipGrant {
			return "已完成，双方已获得" + inviteRewardMembershipLabel, "会员奖励已发放"
		}
		return fmt.Sprintf("已完成，双方各 +%d 积分", inviteRewardCreditsOnQualify), "奖励已进入奖励积分余额"
	case "reward_blocked":
		if blockedReasonLabel != "" {
			return blockedReasonLabel, "该邀请奖励无法继续发放"
		}
		return "奖励条件未达成", "该邀请奖励无法继续发放"
	case "reward_active":
		return "旧版邀请奖励进行中", "系统会按旧版规则处理每日奖励"
	case "cancelled":
		return "邀请关系已取消", "无需继续处理"
	default:
		return "邀请奖励状态待确认", "请根据状态字段继续排查"
	}
}

func (s *MembershipService) pendingInviteRecordsNeeded(referral *domain.UserInviteReferral, todayCN time.Time) (bool, int) {
	if referral == nil || referral.Status != "pending_qualified" {
		return false, 0
	}
	createdAt := time.Now().UTC()
	if referral.CreatedAt != nil {
		createdAt = *referral.CreatedAt
	}
	deadlineCN := dateOnly(createdAt.In(chinaLocation())).AddDate(0, 0, inviteRewardWindowDays-1)
	if todayCN.After(deadlineCN) {
		return false, 0
	}
	distinctDays := 0
	if referral.FirstEffectiveActionAt != nil {
		distinctDays = 1
	}
	needed := inviteRewardRequiredDays - distinctDays
	if needed <= 0 {
		return false, 0
	}
	return true, needed
}

func (s *MembershipService) materializeDailyBonusCredits(ctx context.Context, userID, chinaDate string) (int, int, error) {
	inviteAwarded, err := s.materializeDailyInviteRewardCredits(ctx, userID, chinaDate)
	if err != nil {
		return 0, 0, err
	}
	shareAwarded, err := s.materializeDailySharePosterRewardCredits(ctx, userID, chinaDate)
	if err != nil {
		return inviteAwarded, 0, err
	}
	return inviteAwarded, shareAwarded, nil
}

func (s *MembershipService) materializeDailyInviteRewardCredits(ctx context.Context, userID, chinaDate string) (int, error) {
	rows, err := s.repo.ListActiveInviteRewards(ctx, userID, chinaDate)
	if err != nil {
		return 0, err
	}
	awarded := 0
	for _, row := range rows {
		role := ""
		if row.InviterUserID == userID {
			role = "inviter"
		} else if row.InviteeUserID == userID {
			role = "invitee"
		}
		if role == "" || row.ID == "" {
			continue
		}
		meta := map[string]any{
			"role":            role,
			"referral_id":     row.ID,
			"inviter_user_id": row.InviterUserID,
			"invitee_user_id": row.InviteeUserID,
		}
		_, applied, err := s.repo.ChangeEarnedCredits(ctx, userID, inviteRewardLegacyCreditsPerDay, "invite_daily_reward", "invite:"+row.ID+":"+role+":"+chinaDate, chinaDate, meta)
		if err != nil {
			return awarded, err
		}
		if applied {
			awarded += inviteRewardLegacyCreditsPerDay
		}
	}
	return awarded, nil
}

func (s *MembershipService) materializeDailySharePosterRewardCredits(ctx context.Context, userID, chinaDate string) (int, error) {
	rows, err := s.repo.ListSharePosterBonusEvents(ctx, userID, chinaDate)
	if err != nil {
		return 0, err
	}
	awarded := 0
	for _, row := range rows {
		if row.ID == "" || row.Credits <= 0 {
			continue
		}
		meta := map[string]any{"bonus_event_id": row.ID}
		sourceKey := "share:" + row.ID
		if row.SourceRecordID != nil {
			meta["source_record_id"] = *row.SourceRecordID
		}
		if row.SourceScope != nil {
			meta["source_scope"] = *row.SourceScope
		}
		if row.SourceKey != nil && strings.TrimSpace(*row.SourceKey) != "" {
			sourceKey = "share_poster:" + *row.SourceKey + ":" + chinaDate
			meta["source_key"] = *row.SourceKey
		}
		_, applied, err := s.repo.ChangeEarnedCredits(ctx, userID, row.Credits, "share_poster_reward", sourceKey, chinaDate, meta)
		if err != nil {
			return awarded, err
		}
		if applied {
			awarded += row.Credits
		}
	}
	return awarded, nil
}

func (s *MembershipService) CreatePayment(ctx context.Context, userID, planCode string) (map[string]any, error) {
	return s.CreatePaymentWithInput(ctx, userID, CreateMembershipPaymentInput{PlanCode: planCode})
}

func (s *MembershipService) CreatePaymentWithInput(ctx context.Context, userID string, input CreateMembershipPaymentInput) (map[string]any, error) {
	planCode := strings.TrimSpace(input.PlanCode)
	plan, err := s.repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if plan == nil || !plan.IsActive {
		return nil, commonerrors.ErrNotFound
	}
	if err := s.ensurePlanPurchaseAllowed(ctx, userID, plan); err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	terms, err := s.buildMembershipPaymentTerms(ctx, plan, membership, now)
	if err != nil {
		return nil, err
	}
	if err := enforceMinorPaymentLimit(user, terms.ChargeAmount); err != nil {
		return nil, err
	}
	paymentKind, err := normalizeMembershipPaymentKind(input.PayChannel, input.TradeType)
	if err != nil {
		return nil, err
	}
	if paymentKind.Channel == "alipay" {
		return nil, &commonerrors.AppError{Code: 10004, Message: "支付宝 App 支付通道已预留，当前暂未接入支付宝下单接口", HTTPStatus: http.StatusNotImplemented}
	}
	if isMobileAppPaymentRequest(input, paymentKind) {
		return nil, &commonerrors.AppError{Code: 10004, Message: "App 支付暂未开放，当前只支持在微信小程序中完成会员支付", HTTPStatus: http.StatusNotImplemented}
	}
	openID := strings.TrimSpace(user.OpenID)
	if paymentKind.TradeType == "JSAPI" && isAppOnlyOpenID(openID) {
		return nil, &commonerrors.AppError{Code: 10004, Message: "App 支付暂未开放，当前只支持在微信小程序中完成会员支付", HTTPStatus: http.StatusNotImplemented}
	}
	if paymentKind.TradeType == "JSAPI" && openID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前用户缺少 openid，无法发起微信支付", HTTPStatus: 400}
	}
	payCfg, err := s.wechatPayConfig()
	if err != nil {
		return nil, err
	}
	appID, err := payCfg.appIDForTradeType(paymentKind.TradeType)
	if err != nil {
		return nil, err
	}
	orderNo := generateMembershipOrderNo()
	canonicalURL := paymentKind.CanonicalURL
	orderExtra := buildPaymentExtra(plan, terms)
	orderExtra["pay_channel"] = paymentKind.StoredChannel
	orderExtra["trade_type"] = paymentKind.TradeType
	if client := strings.TrimSpace(input.Client); client != "" {
		orderExtra["client"] = client
	}
	requestPayload := map[string]any{
		"appid":        appID,
		"mchid":        payCfg.MchID,
		"description":  plan.Name,
		"out_trade_no": orderNo,
		"notify_url":   payCfg.NotifyURL,
		"amount": map[string]any{
			"total":    amountToFen(terms.ChargeAmount),
			"currency": "CNY",
		},
	}
	if paymentKind.TradeType == "JSAPI" {
		requestPayload["payer"] = map[string]any{"openid": openID}
	}
	requestBody, _ := json.Marshal(requestPayload)
	auth, err := buildWechatPayAuthorization(payCfg.MchID, payCfg.SerialNo, payCfg.PrivateKey, http.MethodPost, canonicalURL, string(requestBody))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(wechatPayAPIBaseURL, "/")+canonicalURL, bytes.NewReader(requestBody))
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
		Amount:         terms.ChargeAmount,
		Currency:       "CNY",
		DurationMonths: plan.DurationMonths,
		PayChannel:     paymentKind.StoredChannel,
		TradeType:      paymentKind.TradeType,
		Status:         "pending",
		WxPrepayID:     &wxResp.PrepayID,
		Extra:          orderExtra,
	}
	if paymentKind.TradeType == "JSAPI" {
		payment.WxOpenID = &openID
	}
	payment.Extra["create_order_payload"] = requestPayload
	payment.Extra["wechat_create_order_response"] = wxResp
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}
	params, err := buildWechatPayParams(paymentKind.TradeType, appID, payCfg.MchID, wxResp.PrepayID, payCfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "会员支付订单创建成功",
		slog.String("user_id", userID),
		slog.String("order_no", orderNo),
		slog.String("plan_code", plan.Code),
		slog.String("pay_channel", paymentKind.StoredChannel),
		slog.String("trade_type", paymentKind.TradeType),
		slog.Float64("amount", terms.ChargeAmount),
		slog.String("order_mode", terms.Mode),
		slog.Int("duration_months", plan.DurationMonths),
	)
	return map[string]any{
		"order_no":        orderNo,
		"plan_code":       plan.Code,
		"amount":          terms.ChargeAmount,
		"original_amount": plan.Amount,
		"order_mode":      terms.Mode,
		"upgrade_terms":   orderExtra["upgrade_terms"],
		"pay_channel":     paymentKind.StoredChannel,
		"trade_type":      paymentKind.TradeType,
		"prepay_id":       wxResp.PrepayID,
		"pay_params":      params,
	}, nil
}

func (s *MembershipService) ensurePlanPurchaseAllowed(ctx context.Context, userID string, plan *domain.MembershipPlan) error {
	if plan == nil || !plan.IsTestPlan {
		return nil
	}
	if s.paymentTestRepo == nil {
		return &commonerrors.AppError{Code: 20003, Message: "支付测试套餐暂未开放", HTTPStatus: http.StatusForbidden}
	}
	access, err := s.paymentTestRepo.GetPaymentTestAccess(ctx, userID)
	if err != nil {
		return err
	}
	if access == nil || !access.Enabled {
		return &commonerrors.AppError{Code: 20003, Message: "支付测试套餐暂未启用", HTTPStatus: http.StatusForbidden}
	}
	if !access.UserAllowed {
		return &commonerrors.AppError{Code: 20003, Message: "当前账号未加入支付测试名单", HTTPStatus: http.StatusForbidden}
	}
	return nil
}

func isPaymentTestPlan(plan *domain.MembershipPlan) bool {
	if plan == nil {
		return false
	}
	return plan.IsTestPlan || isPaymentTestPlanCode(plan.Code)
}

func isPaymentTestPlanCode(planCode string) bool {
	return strings.TrimSpace(planCode) == domain.PaymentTestPlanCode
}

func isMobileAppPaymentRequest(input CreateMembershipPaymentInput, paymentKind *membershipPaymentKind) bool {
	if paymentKind != nil && strings.EqualFold(paymentKind.TradeType, "APP") {
		return true
	}
	client := strings.ToLower(strings.TrimSpace(input.Client))
	return client == "mobile_app" || client == "app" || client == "android" || client == "ios"
}

func isAppOnlyOpenID(openID string) bool {
	normalized := strings.ToLower(strings.TrimSpace(openID))
	return strings.HasPrefix(normalized, "app-wx:") ||
		strings.HasPrefix(normalized, "app-phone:") ||
		strings.HasPrefix(normalized, "app-pwd:") ||
		strings.HasPrefix(normalized, "app-pwd-phone:")
}

func (s *MembershipService) buildMembershipPaymentTerms(ctx context.Context, targetPlan *domain.MembershipPlan, membership *domain.UserMembership, now time.Time) (*membershipPaymentTerms, error) {
	terms := &membershipPaymentTerms{
		Mode:         "new_purchase",
		ChargeAmount: roundMoney(targetPlan.Amount),
	}
	if membership == nil || membership.Status != "active" || membership.ExpiresAt == nil || !membership.ExpiresAt.After(now) || membership.CurrentPlanCode == nil {
		return terms, nil
	}
	currentPlanCode := strings.TrimSpace(*membership.CurrentPlanCode)
	targetPlanCode := strings.TrimSpace(targetPlan.Code)
	if currentPlanCode == "" || currentPlanCode == targetPlanCode {
		terms.Mode = "renewal"
		return terms, nil
	}
	currentPlan, err := s.repo.GetPlanByCode(ctx, currentPlanCode)
	if err != nil {
		return nil, err
	}
	if currentPlan == nil || currentPlan.Amount <= 0 || currentPlan.DurationMonths <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前会员套餐配置缺失，暂无法计算升级补差", HTTPStatus: 400}
	}
	start := timeOr(membership.CurrentPeriodStart, timeOr(membership.FirstActivatedAt, now))
	if !start.Before(now) {
		start = now
	}
	currentExpires := *membership.ExpiresAt
	targetExpires := addMonths(start, targetPlan.DurationMonths)
	if !targetExpires.After(now) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "所选套餐周期已短于当前已使用时长，请选择更长周期或等待当前会员到期后再购买", HTTPStatus: 400}
	}
	if targetExpires.Before(currentExpires) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "所选套餐会缩短当前会员有效期，请选择不短于当前有效期的套餐", HTTPStatus: 400}
	}
	currentDurationEnd := addMonths(start, currentPlan.DurationMonths)
	targetDurationSeconds := targetExpires.Sub(start).Seconds()
	currentDurationSeconds := currentDurationEnd.Sub(start).Seconds()
	if targetDurationSeconds <= 0 || currentDurationSeconds <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "套餐周期配置异常，暂无法计算升级补差", HTTPStatus: 400}
	}
	currentRemainingSeconds := currentExpires.Sub(now).Seconds()
	targetRemainingSeconds := targetExpires.Sub(now).Seconds()
	currentRemainingValue := currentPlan.Amount * currentRemainingSeconds / currentDurationSeconds
	targetRemainingValue := targetPlan.Amount * targetRemainingSeconds / targetDurationSeconds
	chargeAmount := roundMoney(targetRemainingValue - currentRemainingValue)
	if chargeAmount <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前套餐剩余价值已覆盖所选套餐，请选择更高档位或更长周期", HTTPStatus: 400}
	}
	terms.Mode = "prorated_current_period_upgrade"
	terms.ChargeAmount = chargeAmount
	terms.CurrentPlanCode = currentPlanCode
	terms.CurrentPeriodStart = start
	terms.CurrentExpiresAt = currentExpires
	terms.TargetPeriodStart = start
	terms.TargetExpiresAt = targetExpires
	terms.CurrentRemainingValue = roundMoney(currentRemainingValue)
	terms.TargetRemainingValue = roundMoney(targetRemainingValue)
	terms.UnusedCurrentCreditApplied = roundMoney(currentRemainingValue)
	return terms, nil
}

func buildPaymentExtra(plan *domain.MembershipPlan, terms *membershipPaymentTerms) map[string]any {
	extra := map[string]any{
		"order_mode":      terms.Mode,
		"original_amount": plan.Amount,
		"charge_amount":   terms.ChargeAmount,
	}
	if isPaymentTestPlan(plan) {
		extra["is_payment_test_order"] = true
	}
	if terms.Mode == "prorated_current_period_upgrade" {
		extra["upgrade_terms"] = map[string]any{
			"mode":                          terms.Mode,
			"current_plan_code":             terms.CurrentPlanCode,
			"current_period_start":          terms.CurrentPeriodStart.Format(time.RFC3339),
			"current_expires_at":            terms.CurrentExpiresAt.Format(time.RFC3339),
			"target_period_start":           terms.TargetPeriodStart.Format(time.RFC3339),
			"target_expires_at":             terms.TargetExpiresAt.Format(time.RFC3339),
			"current_remaining_value":       terms.CurrentRemainingValue,
			"target_remaining_value":        terms.TargetRemainingValue,
			"unused_current_credit_applied": terms.UnusedCurrentCreditApplied,
			"payable_amount":                terms.ChargeAmount,
		}
	}
	return extra
}

func normalizeMembershipPaymentKind(payChannel, tradeType string) (*membershipPaymentKind, error) {
	channel := strings.ToLower(strings.TrimSpace(payChannel))
	trade := strings.ToUpper(strings.TrimSpace(tradeType))
	switch channel {
	case "", "wechat":
		channel = "wechat"
	case "wechat_app":
		channel = "wechat"
		if trade == "" {
			trade = "APP"
		}
	case "wechat_mini_program", "wechat_miniprogram", "wechat_jsapi":
		channel = "wechat"
		if trade == "" {
			trade = "JSAPI"
		}
	case "alipay", "alipay_app":
		return &membershipPaymentKind{Channel: "alipay", StoredChannel: "alipay_app", TradeType: "APP"}, nil
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "不支持的会员支付渠道", HTTPStatus: 400}
	}
	if trade == "" {
		trade = "JSAPI"
	}
	switch trade {
	case "JSAPI":
		return &membershipPaymentKind{Channel: channel, StoredChannel: "wechat_mini_program", TradeType: "JSAPI", CanonicalURL: "/v3/pay/transactions/jsapi"}, nil
	case "APP":
		return &membershipPaymentKind{Channel: channel, StoredChannel: "wechat_app", TradeType: "APP", CanonicalURL: "/v3/pay/transactions/app"}, nil
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "不支持的微信支付交易类型", HTTPStatus: 400}
	}
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
		logger.Info(ctx, "手动标记微信支付订单已是支付状态，跳过重复激活",
			slog.String("payment_id", payment.ID),
			slog.String("user_id", payment.UserID),
			slog.String("order_no", payment.OrderNo),
			slog.String("plan_code", payment.PlanCode),
		)
		return nil
	}
	now := time.Now()
	if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "paid"); err != nil {
		return err
	}
	_, err = s.activateMembershipFromPayment(ctx, payment, now)
	if err != nil {
		return err
	}
	logMessage := "手动标记微信支付并激活会员成功"
	logger.Info(ctx, logMessage,
		slog.String("payment_id", payment.ID),
		slog.String("user_id", payment.UserID),
		slog.String("order_no", payment.OrderNo),
		slog.String("plan_code", payment.PlanCode),
	)
	return nil
}

func (s *MembershipService) SyncWechatPayment(ctx context.Context, userID, orderNo string) (map[string]any, error) {
	orderNo = strings.TrimSpace(orderNo)
	if orderNo == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "order_no required", HTTPStatus: 400}
	}
	payment, err := s.repo.GetPaymentByOrderNo(ctx, orderNo)
	if err != nil {
		return nil, err
	}
	if payment == nil {
		return nil, commonerrors.ErrNotFound
	}
	if strings.TrimSpace(payment.UserID) != strings.TrimSpace(userID) {
		return nil, commonerrors.ErrForbidden
	}
	if payment.Status == "paid" {
		membership, err := s.getEffectiveMembership(ctx, userID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"synced":     true,
			"status":     "paid",
			"membership": formatMembershipResponse(membership),
		}, nil
	}
	state, err := s.queryWechatOrder(ctx, orderNo)
	if err != nil {
		logger.Error(ctx, "查询微信支付订单失败", err,
			slog.String("user_id", userID),
			slog.String("order_no", orderNo),
		)
		return nil, err
	}
	tradeState := strings.ToUpper(strings.TrimSpace(fmt.Sprintf("%v", state["trade_state"])))
	if tradeState != "SUCCESS" {
		logger.Info(ctx, "微信支付订单尚未支付成功",
			slog.String("user_id", userID),
			slog.String("order_no", orderNo),
			slog.String("trade_state", tradeState),
		)
		return map[string]any{
			"synced":      false,
			"status":      payment.Status,
			"trade_state": tradeState,
		}, nil
	}
	if paidTotalFromWechatState(state) != amountToFen(payment.Amount) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付金额与订单金额不一致", HTTPStatus: 400}
	}
	if err := s.markPaymentPaidFromWechatState(ctx, payment, state, map[string]any{"source": "active_query"}); err != nil {
		return nil, err
	}
	_, _ = s.repo.ExpirePendingMembershipOrders(ctx, payment.UserID, orderNo, "superseded_by_paid_order")
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	logMessage := "主动查询微信支付并同步会员成功"
	logger.Info(ctx, logMessage,
		slog.String("user_id", userID),
		slog.String("order_no", orderNo),
		slog.String("plan_code", payment.PlanCode),
	)
	return map[string]any{
		"synced":      true,
		"status":      "paid",
		"trade_state": tradeState,
		"membership":  formatMembershipResponse(membership),
	}, nil
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
	tradeState := strings.ToUpper(strings.TrimSpace(fmt.Sprintf("%v", decrypted["trade_state"])))
	if payment.Status == "paid" {
		logger.Info(ctx, "微信支付回调订单已支付，跳过重复处理",
			slog.String("payment_id", payment.ID),
			slog.String("user_id", payment.UserID),
			slog.String("order_no", payment.OrderNo),
			slog.String("plan_code", payment.PlanCode),
			slog.String("wechat.trade_state", tradeState),
		)
		return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
	}
	if tradeState != "SUCCESS" {
		logger.Info(ctx, "微信支付回调已接收但未支付成功",
			slog.String("payment_id", payment.ID),
			slog.String("user_id", payment.UserID),
			slog.String("order_no", payment.OrderNo),
			slog.String("plan_code", payment.PlanCode),
			slog.String("wechat.trade_state", tradeState),
		)
		return map[string]any{"code": "SUCCESS", "message": "已接收"}, nil
	}
	if paidTotalFromWechatState(decrypted) != amountToFen(payment.Amount) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "微信支付金额与订单金额不一致", HTTPStatus: 400}
	}
	if err := s.markPaymentPaidFromWechatState(ctx, payment, decrypted, map[string]any{
		"source": "notify",
		"headers": map[string]any{
			"Wechatpay-Signature": signature,
			"Wechatpay-Timestamp": timestamp,
			"Wechatpay-Nonce":     nonce,
		},
		"body": notifyData,
	}); err != nil {
		return nil, err
	}
	_, _ = s.repo.ExpirePendingMembershipOrders(ctx, payment.UserID, orderNo, "superseded_by_paid_order")
	logMessage := "微信支付回调同步会员成功"
	logger.Info(ctx, logMessage,
		slog.String("payment_id", payment.ID),
		slog.String("user_id", payment.UserID),
		slog.String("order_no", payment.OrderNo),
		slog.String("plan_code", payment.PlanCode),
		slog.String("wechat.trade_state", tradeState),
	)
	return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
}

func (s *MembershipService) ClaimSharePosterReward(ctx context.Context, userID string, input SharePosterRewardClaimInput) (map[string]any, error) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	source, err := s.resolveSharePosterRewardSource(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	claimsToday, err := s.repo.CountSharePosterClaims(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	if existing, err := s.repo.GetSharePosterClaimBySourceKey(ctx, userID, source.SourceKey, today); err != nil {
		return nil, err
	} else if existing != nil {
		return s.shareRewardResponse(ctx, userID, false, true, false, claimsToday, 0, source.AlreadyClaimedMessage)
	}
	if source.RecordID != "" {
		if existing, err := s.repo.GetSharePosterClaim(ctx, userID, source.RecordID, today); err != nil {
			return nil, err
		} else if existing != nil {
			return s.shareRewardResponse(ctx, userID, false, true, false, claimsToday, 0, source.AlreadyClaimedMessage)
		}
	}
	if claimsToday >= sharePosterDailyMaxEvents {
		return s.shareRewardResponse(ctx, userID, false, false, true, claimsToday, 0, fmt.Sprintf("今日海报奖励已达上限（最多 %d 积分）", sharePosterDailyMaxEvents))
	}
	event, err := s.repo.CreateSharePosterBonusEvent(ctx, userID, source.SourceKey, source.Scope, source.RecordID, today, sharePosterRewardCredits, source.Meta)
	if err != nil {
		return nil, err
	}
	ledgerMeta := copyMeta(source.Meta)
	ledgerMeta["bonus_event_id"] = event.ID
	_, _, _ = s.repo.ChangeEarnedCredits(ctx, userID, sharePosterRewardCredits, "share_poster_reward", "share_poster:"+source.SourceKey+":"+today, today, ledgerMeta)
	return s.shareRewardResponse(ctx, userID, true, false, false, claimsToday+1, sharePosterRewardCredits, fmt.Sprintf("%s +%d 积分", source.ClaimedMessagePrefix, sharePosterRewardCredits))
}

type sharePosterRewardSource struct {
	Scope                 string
	SourceKey             string
	RecordID              string
	ShareDate             string
	Meta                  map[string]any
	AlreadyClaimedMessage string
	ClaimedMessagePrefix  string
}

func (s *MembershipService) resolveSharePosterRewardSource(ctx context.Context, userID string, input SharePosterRewardClaimInput) (*sharePosterRewardSource, error) {
	recordID := strings.TrimSpace(input.RecordID)
	if recordID != "" {
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
		sourceKey := "meal_record:" + recordID
		return &sharePosterRewardSource{
			Scope:     "meal_record",
			SourceKey: sourceKey,
			RecordID:  recordID,
			Meta: map[string]any{
				"source_scope":     "meal_record",
				"source_key":       sourceKey,
				"source_record_id": recordID,
			},
			AlreadyClaimedMessage: "本条记录今日海报奖励已领取",
			ClaimedMessagePrefix:  "本餐分享奖励已到账",
		}, nil
	}
	scope := strings.ToLower(strings.TrimSpace(input.ShareScope))
	if scope != "daily_food" && scope != "daily_summary" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "record_id 或 share_scope required", HTTPStatus: 400}
	}
	shareDate, err := normalizeChinaDate(input.ShareDate)
	if err != nil {
		return nil, err
	}
	recordCount, err := s.repo.CountFoodRecordsByDate(ctx, userID, shareDate)
	if err != nil {
		return nil, err
	}
	if recordCount <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当天没有饮食记录，无法领取分享奖励", HTTPStatus: 400}
	}
	sourceKey := scope + ":" + shareDate
	alreadyMessage := "今日饮食分享奖励已领取"
	claimPrefix := "今日饮食分享奖励已到账"
	if scope == "daily_summary" {
		alreadyMessage = "今日小结分享奖励已领取"
		claimPrefix = "今日小结分享奖励已到账"
	}
	return &sharePosterRewardSource{
		Scope:     scope,
		SourceKey: sourceKey,
		ShareDate: shareDate,
		Meta: map[string]any{
			"source_scope": scope,
			"source_key":   sourceKey,
			"share_date":   shareDate,
		},
		AlreadyClaimedMessage: alreadyMessage,
		ClaimedMessagePrefix:  claimPrefix,
	}, nil
}

func (s *MembershipService) GetRewardCenter(ctx context.Context, userID string) (map[string]any, error) {
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	credits, err := s.computeDailyCreditsStatus(ctx, userID, membership != nil && membership.Status == "active", membership, user, "")
	if err != nil {
		return nil, err
	}
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	todayEarned, err := s.repo.SumPositiveEarnedCreditsByDate(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	shareCount, err := s.repo.CountSharePosterClaims(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	packagedCount, err := s.repo.CountRewardTaskUploads(ctx, userID, "packaged_food_upload", today, "succeeded")
	if err != nil {
		return nil, err
	}
	publicCount, err := s.repo.CountRewardTaskUploads(ctx, userID, "public_food_upload", today, "succeeded")
	if err != nil {
		return nil, err
	}
	taskList := []map[string]any{
		buildRewardTask("share_poster", "每日分享打卡", sharePosterRewardCredits, shareCount, sharePosterDailyMaxEvents, "可去完成", "/pages/day-record/index?task_mode=reward_center"),
		buildRewardTask("packaged_food_upload", "预包装零食/食物上传", packagedUploadRewardCredits, packagedCount, packagedUploadDailyMaxEvents, "可去完成", "/pages/packaged-food-edit/index?task_mode=reward_center"),
		buildRewardTask("public_food_upload", "上传公共食物/校园食堂菜品", publicFoodUploadRewardCredits, publicCount, publicFoodUploadDailyMaxEvents, "可去完成", "/pages/food-library-share/index?task_mode=reward_center&campus_mode=1"),
	}
	completed := 0
	totalWithLimit := 0
	for _, task := range taskList {
		dailyLimit, _ := task["daily_limit"].(int)
		if dailyLimit <= 0 {
			continue
		}
		totalWithLimit++
		if task["today_count"] == task["daily_limit"] {
			completed++
		}
	}
	inviteReward, err := s.buildRewardCenterInviteReward(ctx, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"earned_credits_balance": credits["earned_credits_balance"],
		"today_earned_credits":   todayEarned,
		"today_task_overview": map[string]any{
			"completed_count": completed,
			"total_count":     totalWithLimit,
		},
		"tasks":         taskList,
		"invite_reward": inviteReward,
	}, nil
}

func (s *MembershipService) buildRewardCenterInviteReward(ctx context.Context, userID string) (any, error) {
	rows, err := s.repo.ListInviteReferralsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}

	todayCN := dateOnly(time.Now().In(chinaLocation()))

	// Clean up expired pending referrals so they don't clutter the UI.
	s.cleanupExpiredPendingReferrals(ctx, rows, todayCN)

	records := make([]any, 0, len(rows))
	inviterRecords := make([]any, 0)
	var inviteeRecord map[string]any
	invitedCount := 0
	completedCount := 0
	pendingCount := 0

	for _, row := range rows {
		record := s.buildInviteRewardRecord(ctx, userID, row, todayCN)
		records = append(records, record)
		if row.InviterUserID == userID {
			invitedCount++
			if isInviteRecordActionable(row, todayCN) {
				inviterRecords = append(inviterRecords, record)
			}
			_, expired := inviteRewardProgress(row, todayCN)
			switch row.Status {
			case "reward_completed":
				completedCount++
			case "pending_qualified":
				if !expired {
					pendingCount++
				}
			}
			continue
		}
		if row.InviteeUserID == userID && inviteeRecord == nil && isInviteeRecordActionable(row) {
			inviteeRecord = record
		}
	}

	var inviterSummary any
	if invitedCount > 0 {
		inviterSummary = map[string]any{
			"invited_count":               invitedCount,
			"completed_count":             completedCount,
			"pending_count":               pendingCount,
			"estimated_credits":           pendingCount * inviteRewardCreditsOnQualify,
			"earned_credits":              completedCount * inviteRewardCreditsOnQualify,
			"reward_credits":              inviteRewardCreditsOnQualify,
			"reward_type":                 inviteRewardMembershipType,
			"reward_label":                inviteRewardMembershipLabel,
			"reward_days":                 inviteRewardMembershipGrantDays,
			"reward_plan_code":            inviteRewardMembershipPlanCode,
			"estimated_membership_grants": pendingCount,
			"earned_membership_grants":    completedCount,
			"records":                     inviterRecords,
		}
	}

	var inviteeSummary any
	if inviteeRecord != nil {
		completedDays := inviteRewardCompletedDays(inviteeRecord)
		remainingDays := maxInt(inviteRewardRequiredDays-completedDays, 0)
		inviteeSummary = map[string]any{
			"completed_days":   completedDays,
			"required_days":    inviteRewardRequiredDays,
			"remaining_days":   remainingDays,
			"reward_credits":   inviteRewardCreditsOnQualify,
			"reward_type":      inviteeRecord["reward_type"],
			"reward_label":     inviteeRecord["reward_label"],
			"reward_days":      inviteeRecord["reward_days"],
			"reward_plan_code": inviteeRecord["reward_plan_code"],
			"deadline_text":    inviteRewardDeadlineTextV2(inviteeRecord),
			"next_action_text": inviteeRecord["next_action_text"],
			"record":           inviteeRecord,
		}
	}

	if inviterSummary == nil && inviteeSummary == nil {
		return nil, nil
	}
	return map[string]any{
		"as_inviter_summary": inviterSummary,
		"as_invitee_summary": inviteeSummary,
		"records":            records,
	}, nil
}

func inviteRewardCompletedDays(record map[string]any) int {
	status, _ := record["status"].(string)
	if status == "reward_completed" {
		return inviteRewardRequiredDays
	}
	if record["first_effective_action_at"] != nil {
		return 1
	}
	return 0
}

func inviteRewardDeadlineText(record map[string]any) string {
	statusLabel, _ := record["status_label"].(string)
	if statusLabel == "已过期" {
		return "已超过有效期"
	}
	status, _ := record["status"].(string)
	switch status {
	case "reward_completed":
		return "已达标"
	case "reward_blocked":
		if label, _ := record["blocked_reason_label"].(string); label != "" {
			return label
		}
		return "奖励条件未达成"
	case "cancelled":
		return "邀请关系已取消"
	}
	createdAt := parseTime(fmt.Sprintf("%v", record["created_at"]))
	if createdAt == nil {
		return fmt.Sprintf("%d 天内完成 %d 个自然日记录", inviteRewardWindowDays, inviteRewardRequiredDays)
	}
	deadline := dateOnly(createdAt.In(chinaLocation())).AddDate(0, 0, inviteRewardWindowDays-1)
	return "有效期至 " + deadline.Format("2006-01-02")
}

func inviteRewardActionTextsV2(role string, referral domain.UserInviteReferral, recordsNeeded int, expired bool, blockedReasonLabel string, hasMembershipGrant bool) (string, string) {
	rewardText := "完成后双方各得 " + inviteRewardMembershipLabel
	if role == "inviter" {
		rewardText = "好友完成后你们各得 " + inviteRewardMembershipLabel
	}
	switch strings.TrimSpace(referral.Status) {
	case "pending_qualified":
		if expired {
			return fmt.Sprintf("注册后 %d 天内完成 %d 个不同自然日有效使用", inviteRewardWindowDays, inviteRewardRequiredDays), "已超过有效期，无法获得奖励"
		}
		if recordsNeeded <= 1 {
			return fmt.Sprintf("还需在另一个自然日再完成 1 次有效使用，%s", rewardText), "完成 1 个不同自然日的有效使用"
		}
		return fmt.Sprintf("还需完成 %d 个不同自然日的有效使用，%s", recordsNeeded, rewardText), "完成任意功能使用，先点亮第 1 个有效自然日"
	case "reward_completed":
		if hasMembershipGrant {
			return "已完成，双方已获得 " + inviteRewardMembershipLabel, "会员奖励已发放"
		}
		return fmt.Sprintf("已完成，双方各 +%d 积分", inviteRewardCreditsOnQualify), "奖励已进入奖励积分余额"
	case "reward_blocked":
		if blockedReasonLabel != "" {
			return blockedReasonLabel, "该邀请奖励无法继续发放"
		}
		return "奖励条件未达成", "该邀请奖励无法继续发放"
	case "reward_active":
		return "旧版邀请奖励进行中", "系统会按旧版规则处理每日奖励"
	case "cancelled":
		return "邀请关系已取消", "无需继续处理"
	default:
		return "邀请奖励状态待确认", "请根据状态字段继续排查"
	}
}

func inviteRewardDeadlineTextV2(record map[string]any) string {
	statusLabel, _ := record["status_label"].(string)
	if statusLabel == "已过期" {
		return "已超过有效期"
	}
	status, _ := record["status"].(string)
	switch status {
	case "reward_completed":
		return "已达标"
	case "reward_blocked":
		if label, _ := record["blocked_reason_label"].(string); label != "" {
			return label
		}
		return "奖励条件未达成"
	case "cancelled":
		return "邀请关系已取消"
	}
	createdAt := parseTime(fmt.Sprintf("%v", record["created_at"]))
	if createdAt == nil {
		return fmt.Sprintf("%d 天内完成 %d 个自然日有效使用", inviteRewardWindowDays, inviteRewardRequiredDays)
	}
	deadline := dateOnly(createdAt.In(chinaLocation())).AddDate(0, 0, inviteRewardWindowDays-1)
	return "有效期至 " + deadline.Format("2006-01-02")
}

// cleanupExpiredPendingReferrals marks any expired pending_qualified referrals as reward_blocked
// so they don't accumulate and clutter the reward center UI over time.
func (s *MembershipService) cleanupExpiredPendingReferrals(ctx context.Context, rows []domain.UserInviteReferral, todayCN time.Time) {
	for _, row := range rows {
		if row.Status != "pending_qualified" {
			continue
		}
		_, expired := inviteRewardProgress(row, todayCN)
		if !expired {
			continue
		}
		if _, err := s.repo.UpdateInviteReferral(ctx, row.ID, map[string]any{
			"status":         "reward_blocked",
			"blocked_reason": "qualification_window_expired",
		}); err != nil {
			slog.Warn("cleanupExpiredPendingReferrals: failed to update referral", "id", row.ID, "err", err)
		}
	}
}

// isInviteRecordActionable returns true if the referral should be shown in the inviter's friend list.
// Expired/blocked/cancelled records are hidden to prevent UI clutter.
func isInviteRecordActionable(row domain.UserInviteReferral, todayCN time.Time) bool {
	switch row.Status {
	case "reward_completed", "pending_qualified":
		return true
	case "reward_active":
		return true
	default:
		return false
	}
}

// isInviteeRecordActionable returns true if the invitee card should be shown.
// Pending (in progress) and completed referrals are shown; expired ones are cleaned up
// elsewhere and won't appear as pending_qualified.
func isInviteeRecordActionable(row domain.UserInviteReferral) bool {
	switch row.Status {
	case "pending_qualified", "reward_completed":
		return true
	default:
		return false
	}
}

func (s *MembershipService) AwardPackagedUpload(ctx context.Context, userID, sourceTaskID, packagedFoodID string, meta map[string]any) (map[string]any, error) {
	return s.awardRewardTask(ctx, rewardTaskAwardInput{
		UserID:         userID,
		TaskType:       "packaged_food_upload",
		RewardCredits:  packagedUploadRewardCredits,
		DailyMaxEvents: packagedUploadDailyMaxEvents,
		SourceTaskID:   sourceTaskID,
		PackagedFoodID: packagedFoodID,
		Meta:           meta,
	})
}

func (s *MembershipService) AwardPublicFoodUpload(ctx context.Context, userID, publicFoodItemID string, meta map[string]any) (map[string]any, error) {
	return s.awardRewardTask(ctx, rewardTaskAwardInput{
		UserID:           userID,
		TaskType:         "public_food_upload",
		RewardCredits:    publicFoodUploadRewardCredits,
		DailyMaxEvents:   publicFoodUploadDailyMaxEvents,
		PublicFoodItemID: publicFoodItemID,
		Meta:             meta,
	})
}

type rewardTaskAwardInput struct {
	UserID           string
	TaskType         string
	RewardCredits    int
	DailyMaxEvents   int
	SourceTaskID     string
	PackagedFoodID   string
	PublicFoodItemID string
	Meta             map[string]any
}

func (s *MembershipService) awardRewardTask(ctx context.Context, input rewardTaskAwardInput) (map[string]any, error) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	sourceKey := rewardTaskSourceKey(input.TaskType, firstNonEmpty(input.SourceTaskID, input.PackagedFoodID, input.PublicFoodItemID))
	if sourceKey == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "奖励任务缺少来源标识", HTTPStatus: 400}
	}
	existing, err := s.repo.GetRewardTaskUploadBySourceKey(ctx, input.UserID, sourceKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && strings.TrimSpace(existing.Status) == "succeeded" {
		center, err := s.GetRewardCenter(ctx, input.UserID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"awarded":         false,
			"already_claimed": true,
			"reward_task":     existing,
			"reward_center":   center,
		}, nil
	}
	count, err := s.repo.CountRewardTaskUploads(ctx, input.UserID, input.TaskType, today, "succeeded")
	if err != nil {
		return nil, err
	}
	if input.DailyMaxEvents > 0 && count >= input.DailyMaxEvents {
		now := time.Now()
		if existing == nil {
			existing = &domain.RewardTaskUpload{
				UserID:        input.UserID,
				TaskType:      input.TaskType,
				BonusDate:     today,
				Status:        "failed",
				RewardCredits: input.RewardCredits,
				SourceKey:     &sourceKey,
				Meta:          input.Meta,
				CreatedAt:     &now,
				UpdatedAt:     &now,
			}
			if input.SourceTaskID != "" {
				existing.SourceTaskID = &input.SourceTaskID
			}
			if input.PackagedFoodID != "" {
				existing.PackagedFoodID = &input.PackagedFoodID
			}
			if input.PublicFoodItemID != "" {
				existing.PublicFoodItemID = &input.PublicFoodItemID
			}
			failure := "daily_limit_reached"
			existing.FailureReason = &failure
			if err := s.repo.CreateRewardTaskUpload(ctx, existing); err != nil {
				return nil, err
			}
		}
		center, err := s.GetRewardCenter(ctx, input.UserID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"awarded":             false,
			"daily_limit_reached": true,
			"reward_task":         existing,
			"reward_center":       center,
		}, nil
	}
	if existing == nil {
		row := &domain.RewardTaskUpload{
			UserID:        input.UserID,
			TaskType:      input.TaskType,
			BonusDate:     today,
			Status:        "pending",
			RewardCredits: input.RewardCredits,
			SourceKey:     &sourceKey,
			Meta:          input.Meta,
		}
		if input.SourceTaskID != "" {
			row.SourceTaskID = &input.SourceTaskID
		}
		if input.PackagedFoodID != "" {
			row.PackagedFoodID = &input.PackagedFoodID
		}
		if input.PublicFoodItemID != "" {
			row.PublicFoodItemID = &input.PublicFoodItemID
		}
		if err := s.repo.CreateRewardTaskUpload(ctx, row); err != nil {
			return nil, err
		}
		existing = row
	}
	reason := input.TaskType + "_reward"
	_, _, err = s.repo.ChangeEarnedCredits(ctx, input.UserID, input.RewardCredits, reason, sourceKey, today, input.Meta)
	if err != nil {
		return nil, err
	}
	existing, err = s.repo.UpdateRewardTaskUploadBySourceKey(ctx, input.UserID, sourceKey, map[string]any{
		"status":         "succeeded",
		"failure_reason": nil,
	})
	if err != nil {
		return nil, err
	}
	center, err := s.GetRewardCenter(ctx, input.UserID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"awarded":        true,
		"reward_credits": input.RewardCredits,
		"reward_task":    existing,
		"reward_center":  center,
	}, nil
}

func buildRewardTask(actionType, name string, rewardAmount, todayCount, dailyLimit int, defaultStatus, actionPath string) map[string]any {
	status := defaultStatus
	var dailyLimitValue any = dailyLimit
	if dailyLimit <= 0 {
		dailyLimitValue = nil
	} else if todayCount >= dailyLimit {
		status = "今日已满"
	}
	return map[string]any{
		"action_type":   actionType,
		"name":          name,
		"reward_amount": rewardAmount,
		"today_count":   todayCount,
		"daily_limit":   dailyLimitValue,
		"status":        status,
		"action_path":   actionPath,
	}
}

func rewardTaskSourceKey(taskType, rawID string) string {
	rawID = strings.TrimSpace(rawID)
	if rawID == "" {
		return ""
	}
	return taskType + ":" + rawID
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *MembershipService) shareRewardResponse(ctx context.Context, userID string, claimed, alreadyClaimed, dailyCapReached bool, claimsToday, credits int, message string) (map[string]any, error) {
	user, _ := s.repo.GetUser(ctx, userID)
	membership, _ := s.getEffectiveMembership(ctx, userID)
	base := formatMembershipResponse(membership)
	creditsInfo, _ := s.computeDailyCreditsStatus(ctx, userID, boolValue(base["is_pro"]), membership, user, "")
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

func (s *MembershipService) ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string, units ...int) (map[string]any, error) {
	mode := normalizeFoodExecutionMode(executionMode)
	cost := creditCostStandardFoodAnalysis
	analysisLabel := "食物分析"
	if mode == "strict" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "精准分析"
	} else if mode == "strict_separate" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "精准分项分析"
	} else if mode == "strict_web_search" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "联网精准分析"
	} else if mode == "fast" {
		analysisLabel = "快速分析"
	} else if mode == "fast_web_search" {
		analysisLabel = "快速联网分析"
	} else if mode == "standard_web_search" {
		analysisLabel = "联网分析"
	} else if mode == "standard_packaged_experiment" {
		analysisLabel = "零食库试验分析"
	} else if mode == "experimental" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "试验分析"
	} else if mode == "gemini35_flash" {
		analysisLabel = "Gemini 3.5 Flash 分析"
	} else if mode == "gemini35_flash_grouped" {
		cost = creditCostPrecisionFoodAnalysis
		analysisLabel = "Gemini 3.5 分组分析"
	} else if mode == "standard_correction" {
		cost = creditCostStandardCorrection
		analysisLabel = "食物纠错"
	} else if mode == "strict_correction" {
		cost = creditCostPrecisionCorrection
		analysisLabel = "精准纠错"
	}
	cost *= normalizeCreditUnits(units...)
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if (mode == "strict" || mode == "strict_separate" || mode == "strict_web_search" || mode == "experimental" || mode == "gemini35_flash_grouped" || mode == "strict_correction") && !canUsePrecisionMode(membership) {
		return nil, &commonerrors.AppError{Code: 10005, Message: "精准模式仅对标准版和进阶版开放，请升级或开通后再试。", HTTPStatus: 402}
	}
	return s.validateCredits(ctx, userID, cost, analysisLabel, recordedOn, membership, user)
}

func normalizeCreditUnits(units ...int) int {
	if len(units) == 0 || units[0] <= 0 {
		return 1
	}
	return units[0]
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

func (s *MembershipService) ValidateDietRecommendationCredits(ctx context.Context, userID string) (map[string]any, error) {
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.validateCredits(ctx, userID, creditCostDietRecommendation, "推荐吃什么", "", membership, user)
}

func (s *MembershipService) ValidateStatsInsightCredits(ctx context.Context, userID string) (map[string]any, error) {
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.validateCredits(ctx, userID, creditCostStatsInsight, "AI 风险解读", "", membership, user)
}

func (s *MembershipService) ValidateUsageCredits(ctx context.Context, userID string, cost int, label string) (map[string]any, error) {
	membership, err := s.getEffectiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = "AI 用量服务"
	}
	return s.validateCredits(ctx, userID, maxInt(cost, 1), label, "", membership, user)
}

func (s *MembershipService) validateCredits(ctx context.Context, userID string, cost int, label, recordedOn string, membership *domain.UserMembership, user *membershiprepo.User) (map[string]any, error) {
	targetDate, err := normalizeChinaDate(recordedOn)
	if err != nil {
		return nil, err
	}
	isPro := membership != nil && formatMembershipResponse(membership)["is_pro"] == true
	creditsInfo, err := s.computeDailyCreditsStatus(ctx, userID, isPro, membership, user, "")
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
	trialEntitlement, err := s.repo.GetTrialEntitlementByUserID(ctx, userID)
	if err != nil {
		return 0, err
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, userID, trialEntitlement)
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
	policy := s.resolveUserTrialPolicy(trialEntitlement, meta)
	if policy.ExpiresAt == nil || policy.StartAt == nil {
		return 0, nil
	}
	createdDate := dateOnly(policy.StartAt.In(chinaLocation()))
	targetDate := dateOnly(target.In(chinaLocation()))
	trialEndDate := dateOnly(policy.ExpiresAt.In(chinaLocation()))
	if !targetDate.Before(createdDate) && !targetDate.After(trialEndDate) {
		return trialDailyCredits, nil
	}
	return 0, nil
}

func (s *MembershipService) ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	if strings.TrimSpace(sourceKey) != "" {
		meta["credit_charge_source_key"] = sourceKey
	}
	earned := earnedCreditsToConsume(creditsInfo, cost)
	systemReason, systemSourceKey, relatedDate, systemMeta, hasSystem := s.buildSystemCreditUsageLedger(creditsInfo, reason, sourceKey, meta)
	if earned <= 0 && !hasSystem {
		return nil
	}
	if hasSystem {
		return s.repo.ChangeCreditsWithSystemUsage(ctx, userID, -earned, reason, sourceKey, systemReason, systemSourceKey, relatedDate, meta, systemMeta)
	}
	return s.ConsumeEarnedCreditsOnTaskCreated(ctx, userID, creditsInfo, cost, reason, sourceKey, meta)
}

func (s *MembershipService) ConsumeEarnedCreditsOnTaskCreated(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
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

func (s *MembershipService) recordSystemCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, reason, sourceKey string, meta map[string]any) error {
	systemReason, systemSourceKey, relatedDate, ledgerMeta, ok := s.buildSystemCreditUsageLedger(creditsInfo, reason, sourceKey, meta)
	if !ok {
		return nil
	}
	_, _, err := s.repo.ChangeEarnedCredits(ctx, userID, 0, systemReason, systemSourceKey, relatedDate, ledgerMeta)
	return err
}

func (s *MembershipService) buildSystemCreditUsageLedger(creditsInfo map[string]any, reason, sourceKey string, meta map[string]any) (string, string, string, map[string]any, bool) {
	sourceKey = strings.TrimSpace(sourceKey)
	if sourceKey == "" {
		return "", "", "", nil, false
	}
	if creditsInfo == nil {
		return "", "", "", nil, false
	}
	plan, ok := creditsInfo["credit_spend_plan"].(map[string]any)
	if !ok || len(plan) == 0 {
		return "", "", "", nil, false
	}
	systemByDate, ok := plan["system_by_date"].(map[string]any)
	if !ok || len(systemByDate) == 0 {
		return "", "", "", nil, false
	}
	relatedDate := time.Now().In(chinaLocation()).Format("2006-01-02")
	if value := strings.TrimSpace(fmt.Sprintf("%v", plan["recorded_on"])); value != "" && value != "<nil>" {
		relatedDate = value
	}
	systemUnits := intFromAny(systemByDate[relatedDate])
	if systemUnits <= 0 {
		return "", "", "", nil, false
	}
	ledgerMeta := copyMeta(meta)
	if sourceKey != "" {
		ledgerMeta["credit_charge_source_key"] = sourceKey
	}
	ledgerMeta["credit_usage"] = plan
	ledgerMeta["system_units"] = systemUnits
	ledgerMeta["ledger_role"] = "system_credit_usage"
	systemReason := strings.TrimSpace(reason) + "_system"
	systemSourceKey := sourceKey + ":system"
	return systemReason, systemSourceKey, relatedDate, ledgerMeta, true
}

func (s *MembershipService) RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error {
	earned := earnedCreditsToConsume(creditsInfo, cost)
	if earned <= 0 {
		return nil
	}
	spend, err := s.repo.GetEarnedCreditLedgerBySource(ctx, userID, spendReason, spendSourceKey)
	if err != nil || spend == nil {
		return err
	}
	relatedDate := time.Now().In(chinaLocation()).Format("2006-01-02")
	if plan, ok := creditsInfo["credit_spend_plan"].(map[string]any); ok {
		if value := strings.TrimSpace(fmt.Sprintf("%v", plan["recorded_on"])); value != "" && value != "<nil>" {
			relatedDate = value
		}
	}
	_, _, err = s.repo.ChangeEarnedCredits(ctx, userID, earned, refundReason, refundSourceKey, relatedDate, meta)
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
	trialEntitlement, err := s.repo.GetTrialEntitlementByUserID(ctx, payment.UserID)
	if err != nil {
		return nil, err
	}
	meta, err := s.resolveEarlyUserMembershipMeta(ctx, payment.UserID, trialEntitlement)
	if err != nil {
		return nil, err
	}
	var start, expires, first time.Time
	if terms, ok := paymentTermsFromExtra(payment.Extra); ok && terms.Mode == "prorated_current_period_upgrade" {
		start = terms.TargetPeriodStart
		expires = terms.TargetExpiresAt
		first = timeOr(membershipFirstActivatedAt(membership), paidAt)
	} else if membership != nil && membership.Status == "active" && membership.ExpiresAt != nil && membership.ExpiresAt.After(paidAt) {
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

func (s *MembershipService) resolveEarlyUserMembershipMeta(ctx context.Context, userID string, trialEntitlement *domain.UserTrialEntitlement) (*earlyUserMembershipMeta, error) {
	meta := &earlyUserMembershipMeta{
		EarlyUserLimit:      earlyUserTrialLimit,
		EarlyPaidUserLimit:  earlyPaidUserLimit,
		PaidBonusMultiplier: 1,
	}
	if trialEntitlement != nil && trialEntitlement.EarlyUserRank != nil && *trialEntitlement.EarlyUserRank > 0 {
		meta.EarlyUserRank = intPtr(*trialEntitlement.EarlyUserRank)
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

func (s *MembershipService) resolveUserTrialPolicy(entitlement *domain.UserTrialEntitlement, meta *earlyUserMembershipMeta) trialPolicy {
	if entitlement == nil || entitlement.FirstRegisteredAt == nil {
		return trialPolicy{}
	}
	created := *entitlement.FirstRegisteredAt
	trialDays := entitlement.TrialDaysTotal
	if trialDays <= 0 {
		trialDays = regularUserTrialDays
	}
	policy := any(strings.TrimSpace(entitlement.TrialPolicy))
	if policy == "" {
		policy = "regular_new_user"
	}
	if meta != nil && meta.EarlyUserRank != nil && policy == "regular_new_user" {
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
		StartAt:   &created,
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

func (s *MembershipService) queryWechatOrder(ctx context.Context, orderNo string) (map[string]any, error) {
	payCfg, err := s.wechatPayConfig()
	if err != nil {
		return nil, err
	}
	canonicalURL := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(orderNo) + "?mchid=" + url.QueryEscape(payCfg.MchID)
	auth, err := buildWechatPayAuthorization(payCfg.MchID, payCfg.SerialNo, payCfg.PrivateKey, http.MethodGet, canonicalURL, "")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(wechatPayAPIBaseURL, "/")+canonicalURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "food-link/1.0")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, &commonerrors.AppError{Code: 10000, Message: "微信查单失败: " + parseWechatErrorMessage(respBody), HTTPStatus: 502}
	}
	var wxResp map[string]any
	if err := json.Unmarshal(respBody, &wxResp); err != nil {
		return nil, err
	}
	return wxResp, nil
}

func (s *MembershipService) markPaymentPaidFromWechatState(ctx context.Context, payment *domain.MembershipPayment, state map[string]any, notifyMeta map[string]any) error {
	if payment == nil {
		return commonerrors.ErrNotFound
	}
	paidAt := parseTime(fmt.Sprintf("%v", state["success_time"]))
	if paidAt == nil {
		now := time.Now()
		paidAt = &now
	}
	transactionID := stringPtrFromAny(state["transaction_id"])
	bankType := stringPtrFromAny(state["bank_type"])
	payload := map[string]any{
		"resource_decrypted": state,
	}
	for key, value := range notifyMeta {
		payload[key] = value
	}
	if err := s.repo.UpdatePaymentByOrderNo(ctx, payment.OrderNo, map[string]any{
		"status":            "paid",
		"wx_transaction_id": wxString(transactionID),
		"wx_bank_type":      wxString(bankType),
		"paid_at":           *paidAt,
		"notify_payload":    payload,
	}); err != nil {
		return err
	}
	payment.Status = "paid"
	payment.PaidAt = paidAt
	payment.WxTransactionID = transactionID
	payment.WxBankType = bankType
	_, err := s.activateMembershipFromPayment(ctx, payment, *paidAt)
	return err
}

func paidTotalFromWechatState(state map[string]any) int {
	amount, _ := state["amount"].(map[string]any)
	paidTotal := intFromAny(amount["payer_total"])
	if paidTotal == 0 {
		paidTotal = intFromAny(amount["total"])
	}
	return paidTotal
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

func copyMeta(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

func membershipMatchesPaidTruth(membership *domain.UserMembership, planCode, status string, periodStart, expiresAt, lastPaidAt time.Time, dailyCredits int) bool {
	if membership == nil {
		return false
	}
	if strings.TrimSpace(fmt.Sprintf("%v", stringValue(membership.CurrentPlanCode))) != strings.TrimSpace(planCode) {
		return false
	}
	if strings.TrimSpace(membership.Status) != status {
		return false
	}
	if !timeMatches(membership.CurrentPeriodStart, periodStart) || !timeMatches(membership.ExpiresAt, expiresAt) || !timeMatches(membership.LastPaidAt, lastPaidAt) {
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
	MiniProgramAppID string
	AppPayAppID      string
	MchID            string
	NotifyURL        string
	SerialNo         string
	APIV3Key         string
	PrivateKey       string
	PublicKey        string
}

func (s *MembershipService) wechatPayConfig() (*wechatPayConfig, error) {
	if s.cfg == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少微信支付配置", HTTPStatus: 500}
	}
	pay := s.cfg.ResolvedWechatPay()
	cfg := &wechatPayConfig{
		MiniProgramAppID: strings.TrimSpace(s.cfg.WechatMiniProgramAppID()),
		AppPayAppID:      strings.TrimSpace(pay.AppPayAppID),
		MchID:            strings.TrimSpace(pay.MchID),
		NotifyURL:        strings.TrimSpace(pay.NotifyURL),
		SerialNo:         strings.TrimSpace(pay.SerialNo),
		APIV3Key:         strings.TrimSpace(pay.APIV3Key),
		PrivateKey:       normalizePEMValue(pay.PrivateKey),
		PublicKey:        normalizePEMValue(pay.PublicKey),
	}
	if cfg.AppPayAppID == "" {
		cfg.AppPayAppID = strings.TrimSpace(pay.AppID)
	}
	if cfg.AppPayAppID == "" {
		cfg.AppPayAppID = strings.TrimSpace(s.cfg.WechatMobileAppID())
	}
	missing := []string{}
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

func (cfg *wechatPayConfig) appIDForTradeType(tradeType string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(tradeType)) {
	case "APP":
		if cfg.AppPayAppID == "" {
			return "", &commonerrors.AppError{Code: 10000, Message: "缺少微信 APP 支付 AppID 配置：wechat.mobile_app.app_id", HTTPStatus: 500}
		}
		return cfg.AppPayAppID, nil
	default:
		if cfg.MiniProgramAppID == "" {
			return "", &commonerrors.AppError{Code: 10000, Message: "缺少微信小程序支付 AppID 配置：wechat.mini_program.app_id", HTTPStatus: 500}
		}
		return cfg.MiniProgramAppID, nil
	}
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

func roundMoney(amount float64) float64 {
	return math.Round(amount*100) / 100
}

func paymentTermsFromExtra(extra map[string]any) (*membershipPaymentTerms, bool) {
	if extra == nil {
		return nil, false
	}
	rawTerms, _ := extra["upgrade_terms"].(map[string]any)
	if rawTerms == nil {
		return nil, false
	}
	mode := strings.TrimSpace(fmt.Sprintf("%v", rawTerms["mode"]))
	start := timeFromAny(rawTerms["target_period_start"])
	expires := timeFromAny(rawTerms["target_expires_at"])
	if mode == "" || start == nil || expires == nil {
		return nil, false
	}
	return &membershipPaymentTerms{
		Mode:              mode,
		TargetPeriodStart: *start,
		TargetExpiresAt:   *expires,
	}, true
}

func timeFromAny(value any) *time.Time {
	switch v := value.(type) {
	case time.Time:
		return &v
	case *time.Time:
		return v
	default:
		return parseTime(fmt.Sprintf("%v", value))
	}
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

func buildWechatPayParams(tradeType, appID, mchID, prepayID, privateKeyPEM string) (map[string]string, error) {
	if strings.ToUpper(strings.TrimSpace(tradeType)) == "APP" {
		return buildAppPayParams(appID, mchID, prepayID, privateKeyPEM)
	}
	return buildMiniProgramPayParams(appID, prepayID, privateKeyPEM)
}

func buildAppPayParams(appID, mchID, prepayID, privateKeyPEM string) (map[string]string, error) {
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	nonce := randomHex(16)
	message := appID + "\n" + timestamp + "\n" + nonce + "\n" + prepayID + "\n"
	signature, err := signWithRSASHA256(message, privateKeyPEM)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"appId":        appID,
		"partnerId":    mchID,
		"prepayId":     prepayID,
		"package":      "Sign=WXPay",
		"packageValue": "Sign=WXPay",
		"nonceStr":     nonce,
		"timeStamp":    timestamp,
		"sign":         signature,
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

func datePtrValue(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.In(chinaLocation()).Format("2006-01-02")
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

func membershipFirstActivatedAt(membership *domain.UserMembership) *time.Time {
	if membership == nil {
		return nil
	}
	return membership.FirstActivatedAt
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
		code == domain.PaymentTestPlanCode ||
		strings.HasPrefix(code, "light_") ||
		strings.HasPrefix(code, "standard_") ||
		strings.HasPrefix(code, "advanced_")
}

func normalizeFoodExecutionMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "lite", "lightweight":
		return "lite"
	case "fast", "qwen_fast", "qwen-fast", "quick":
		return "fast"
	case "fast_web_search", "fast-web-search", "qwen_fast_web_search", "qwen-fast-web-search", "quick_web_search":
		return "fast_web_search"
	case "standard_web_search", "web_search", "standard-web-search":
		return "standard_web_search"
	case "standard_packaged_experiment", "packaged_experiment", "standard-packaged-experiment":
		return "standard_packaged_experiment"
	case "strict_separate", "precision_separate", "strict-separate":
		return "strict_separate"
	case "strict", "precision":
		return "strict"
	case "strict_web_search", "precision_web_search", "strict-web-search":
		return "strict_web_search"
	case "experimental", "experiment":
		return "experimental"
	case "gemini35_flash", "gemini35", "gemini_35_flash":
		return "gemini35_flash"
	case "gemini35_flash_grouped", "gemini35_grouped", "gemini_35_flash_grouped":
		return "gemini35_flash_grouped"
	case "standard_correction", "correction":
		return "standard_correction"
	case "strict_correction", "precision_correction":
		return "strict_correction"
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

func enforceMinorPaymentLimit(user *membershiprepo.User, amount float64) error {
	if user == nil || user.Birthday == nil || strings.TrimSpace(*user.Birthday) == "" {
		return nil
	}
	birthday, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(*user.Birthday), chinaLocation())
	if err != nil {
		return nil
	}
	now := time.Now().In(chinaLocation())
	age := now.Year() - birthday.Year()
	if now.YearDay() < birthday.YearDay() {
		age--
	}
	switch {
	case age < 8:
		return &commonerrors.AppError{Code: 10003, Message: "users under 8 cannot make payments", HTTPStatus: 403}
	case age < 16 && amount > 50:
		return &commonerrors.AppError{Code: 10003, Message: "single payment for users under 16 cannot exceed 50 CNY", HTTPStatus: 403}
	case age < 18 && amount > 100:
		return &commonerrors.AppError{Code: 10003, Message: "single payment for users under 18 cannot exceed 100 CNY", HTTPStatus: 403}
	default:
		return nil
	}
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
