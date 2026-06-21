package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ptrTime(t time.Time) *time.Time {
	return &t
}

func strPtr(value string) *string {
	return &value
}

type mockMembershipRepo struct {
	plans                         []domain.MembershipPlan
	planByCode                    map[string]*domain.MembershipPlan
	membership                    *domain.UserMembership
	payment                       *domain.MembershipPayment
	latestPaidPayment             *domain.MembershipPayment
	user                          *membershiprepo.User
	paymentTestAccess             *domain.PaymentTestAccess
	paymentTestAccessErr          error
	trialEntitlement              *domain.UserTrialEntitlement
	analysisCountToday            int64
	usedByDate                    map[string]int
	earlyUserRank                 int
	earlyPaidRank                 int
	inviteBonusCredits            int
	shareBonusCredits             int
	inviteReferral                *domain.UserInviteReferral
	activeInviteRewards           []domain.UserInviteReferral
	shareEvents                   []domain.UserCreditBonusEvent
	completedInviteRewardsInMonth int
	foodRecordOwner               string
	foodRecordCountByDate         map[string]int
	shareClaimsToday              int
	shareClaim                    *domain.UserCreditBonusEvent
	shareClaimBySourceKey         map[string]*domain.UserCreditBonusEvent
	saveMembershipCalls           int
	ledgerByReasonSource          map[string]*domain.UserEarnedCreditLedger
	sumPositiveEarnedCredits      int
	rewardTaskUploads             map[string]*domain.RewardTaskUpload
}

const testRSAPrivateKeyPEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEoAIBAAKCAQEArK/f7m/7fObXZNK4vm9iaNaGBd+67U5cY8dx3zNUvYbl0SZM
SQ5al8szrpbcz7BbX7NRX7qEyLfwTJe9+6ZiVdhgiexXu4UPUjG6KfLIuhrVyTE0
wq0GD34LVvmXJfJN9FTgy91mPJfwwG96rA6DCx3OacTC95PNZW9ZwEvm3bpC4kHJ
9Z+vIJSqcs66ZDfR7pXs5rDrlQlYpaMXL1ZYYVBVrwlDUcszYa5qUNORVURVL74x
DpmnI+HDNv4bO3tg22/ZMVYrjmEm8LLz4MnFkKsVh3k5X0TOPNZ5C+bmSKEnOpLg
+fx1LTExOX4FZHJxL9qJ261YH9V+zlV6tXd46QIDAQABAoIBAAYvgJJuYXA+Zo2+
fI6Zt8kwkflo4623ZljOnpYTpR/q0pWUzRu6z2Triuzgi4VG+GbrqekHadU0vX9I
2i3G7nPLvd2C4TuezwcvL89r2mPMLUc5I34rq3FnnuldJFxgGwm69phm1FAsUxvZ
gmfiVzBRP4ELYr5yhWNyQyE/tsPPZp8llbp/jQ21Z3l14xIpPX2WpRXUJ3OJFdx8
BpIEZ/IJ1Y/Vd47+m9vTilHce6pTSFY0Lv3qwuwCeFGRSKF7xqawJllK4tqGFcmM
xURg1R2Rz7GENsqDaX+7se//CgQAf0WZSE576UD3AQHJ6p+9El1edKPzfgrb4Sh7
Cb0hrQcCgYEA2JZne4B8vIfpVNJHr2Xo/UTQ+SEeyzRJnuUv1hebh27gqaUeowLU
beLCVww8gJ/7SBPSAGNh/4hWctEpc/JOG81k/28F2vBNMBb99l8ZxROs7qVIRUJN
tlTs62T6DVxnNluF8UB/qMjXYbTxSgzlHYL/b1Jmw08OVy4RL8IubJ8CgYEAzBxk
fTtc5zoEPx9ezJw8cFqVKx5eIfBB8fXl6qoGnI2yLtQYmnp1H9pDrsl93w5HEhKK
uwuJkgpMaOA7CCZKUUXKLbxKTRVHWTNlZvGeZAJRKpwwl8aS34KU6QRUt+Aewc4I
T+Eoo4LNhJ8cvqaz3ZQC9hGFnTqRLA7TBKXQJXcCgYA2vazh9hOQwvkiSxN7LVK5
0I7QqKJT0Z9Z3as9fTH+BPQbbHRV1v1B2LItthYEnGqySPAm0PeP0jGnS14iw/ch
58PDG5hrQZkAso71mgu1V8e5eWTOvHdPwh8vT5Izlksv3en4k8iwLDLjqwvhH2k5
EEbnJ/h5HJ4PQsFtRLLfGQKBgA1NQGNE7h4HkuVGNxhgijPMQ3Jm7T2K+dE59Dzh
zcKAHX+dxOi0WFO2FrkaWoCh3pHX8YCVFOcWkro2+sHiNO+s+6sVXUY+v8KZbd9S
mb7sw7tiKGyLvWChkvDInnjJO1foBHSoOMzHJnuhHu9xz8D9919v7uQ7P+C+KpRf
9furAn9qGDmO3u5Fgfeo6IQpq79vNuiT4tvDypdBykI7nrCEOrjvbiYVBg/nT35w
mYLwOf5KPwTEIZpWguWOQN0I+a8YNbl42UhJs8xYPKEQXCcTMyWLB0q7/iTJVFBZ
nRvBBBKTiQK7lbjWGGHKPuaqbJj/ne4zLFO9mxLnN/HRZQBX
-----END RSA PRIVATE KEY-----`

func (m *mockMembershipRepo) ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error) {
	return m.plans, nil
}
func (m *mockMembershipRepo) GetPlanByID(ctx context.Context, planID string) (*domain.MembershipPlan, error) {
	return m.GetPlanByCode(ctx, planID)
}
func (m *mockMembershipRepo) GetPlanByCode(ctx context.Context, planCode string) (*domain.MembershipPlan, error) {
	if m.planByCode != nil {
		return m.planByCode[planCode], nil
	}
	for i := range m.plans {
		if m.plans[i].Code == planCode {
			return &m.plans[i], nil
		}
	}
	return nil, nil
}
func (m *mockMembershipRepo) GetPaymentTestAccess(ctx context.Context, userID string) (*domain.PaymentTestAccess, error) {
	if m.paymentTestAccessErr != nil {
		return nil, m.paymentTestAccessErr
	}
	if m.paymentTestAccess != nil {
		return m.paymentTestAccess, nil
	}
	return &domain.PaymentTestAccess{}, nil
}
func (m *mockMembershipRepo) GetUserProMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	return m.membership, nil
}
func (m *mockMembershipRepo) GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	if m.membership != nil && m.membership.Status == "active" {
		return m.membership, nil
	}
	return nil, nil
}
func (m *mockMembershipRepo) SaveMembership(ctx context.Context, userID string, updates map[string]any) (*domain.UserMembership, error) {
	m.saveMembershipCalls++
	if m.membership == nil {
		m.membership = &domain.UserMembership{ID: "um1", UserID: userID}
	}
	if v, ok := updates["current_plan_code"].(string); ok {
		m.membership.CurrentPlanCode = &v
	}
	if v, ok := updates["status"].(string); ok {
		m.membership.Status = v
	}
	if v, ok := updates["first_activated_at"].(time.Time); ok {
		m.membership.FirstActivatedAt = &v
	}
	if v, ok := updates["current_period_start"].(time.Time); ok {
		m.membership.CurrentPeriodStart = &v
	}
	if v, ok := updates["expires_at"].(time.Time); ok {
		m.membership.ExpiresAt = &v
	}
	if v, ok := updates["last_paid_at"].(time.Time); ok {
		m.membership.LastPaidAt = &v
	}
	if v, ok := updates["daily_credits"].(int); ok {
		m.membership.DailyCredits = v
	}
	return m.membership, nil
}
func (m *mockMembershipRepo) CreatePayment(ctx context.Context, p *domain.MembershipPayment) error {
	m.payment = p
	return nil
}
func (m *mockMembershipRepo) GetPaymentByID(ctx context.Context, id string) (*domain.MembershipPayment, error) {
	return m.payment, nil
}
func (m *mockMembershipRepo) GetPaymentByOrderNo(ctx context.Context, orderNo string) (*domain.MembershipPayment, error) {
	return m.payment, nil
}
func (m *mockMembershipRepo) GetLatestPaidMembershipPayment(ctx context.Context, userID string) (*domain.MembershipPayment, error) {
	return m.latestPaidPayment, nil
}
func (m *mockMembershipRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	if m.payment != nil {
		m.payment.Status = status
	}
	return nil
}
func (m *mockMembershipRepo) UpdatePaymentByOrderNo(ctx context.Context, orderNo string, updates map[string]any) error {
	if m.payment != nil {
		if status, ok := updates["status"].(string); ok {
			m.payment.Status = status
		}
		if paidAt, ok := updates["paid_at"].(time.Time); ok {
			m.payment.PaidAt = &paidAt
		}
		if tx, ok := updates["wx_transaction_id"].(string); ok && tx != "" {
			m.payment.WxTransactionID = &tx
		}
		if payload, ok := updates["notify_payload"].(map[string]any); ok {
			m.payment.NotifyPayload = payload
		}
	}
	return nil
}
func (m *mockMembershipRepo) ExpirePendingMembershipOrders(ctx context.Context, userID, excludeOrderNo, reason string) (int, error) {
	return 0, nil
}
func (m *mockMembershipRepo) CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error) {
	return m.analysisCountToday, nil
}
func (m *mockMembershipRepo) CountDailySystemCreditUsage(ctx context.Context, userID, chinaDate string) (int, error) {
	if m.usedByDate == nil {
		return 0, nil
	}
	return m.usedByDate[chinaDate], nil
}
func (m *mockMembershipRepo) GetFirstMembershipTrialBatchRank(ctx context.Context, userID string, limit int) (int, error) {
	return m.earlyUserRank, nil
}
func (m *mockMembershipRepo) GetTrialEntitlementByUserID(ctx context.Context, userID string) (*domain.UserTrialEntitlement, error) {
	return m.trialEntitlement, nil
}
func (m *mockMembershipRepo) GetFirstPaidMembershipUserRank(ctx context.Context, userID string, limit int) (int, error) {
	return m.earlyPaidRank, nil
}
func (m *mockMembershipRepo) CountDailyMembershipBonusCredits(ctx context.Context, userID, chinaDate string) (int, int, error) {
	return m.inviteBonusCredits, m.shareBonusCredits, nil
}
func (m *mockMembershipRepo) GetInviteReferralByInvitee(ctx context.Context, inviteeUserID string) (*domain.UserInviteReferral, error) {
	return m.inviteReferral, nil
}
func (m *mockMembershipRepo) UpdateInviteReferral(ctx context.Context, id string, updates map[string]any) (*domain.UserInviteReferral, error) {
	if m.inviteReferral == nil {
		m.inviteReferral = &domain.UserInviteReferral{ID: id}
	}
	if v, ok := updates["status"].(string); ok {
		m.inviteReferral.Status = v
	}
	if v, ok := updates["first_effective_action_at"].(time.Time); ok {
		m.inviteReferral.FirstEffectiveActionAt = &v
	}
	if v, ok := updates["first_effective_action_type"].(string); ok {
		m.inviteReferral.FirstEffectiveActionType = &v
	}
	if v, ok := updates["reward_start_date"].(time.Time); ok {
		m.inviteReferral.RewardStartDate = &v
	}
	if v, ok := updates["reward_end_date"].(time.Time); ok {
		m.inviteReferral.RewardEndDate = &v
	}
	if v, ok := updates["blocked_reason"].(string); ok {
		m.inviteReferral.BlockedReason = &v
	} else if _, ok := updates["blocked_reason"]; ok {
		m.inviteReferral.BlockedReason = nil
	}
	return m.inviteReferral, nil
}
func (m *mockMembershipRepo) CountCompletedInviteRewardsForInviterInMonth(ctx context.Context, inviterUserID, monthStart, nextMonthStart string) (int, error) {
	return m.completedInviteRewardsInMonth, nil
}
func (m *mockMembershipRepo) ListActiveInviteRewards(ctx context.Context, userID, chinaDate string) ([]domain.UserInviteReferral, error) {
	return m.activeInviteRewards, nil
}
func (m *mockMembershipRepo) ListSharePosterBonusEvents(ctx context.Context, userID, chinaDate string) ([]domain.UserCreditBonusEvent, error) {
	return m.shareEvents, nil
}
func (m *mockMembershipRepo) GetUser(ctx context.Context, userID string) (*membershiprepo.User, error) {
	return m.user, nil
}
func (m *mockMembershipRepo) GetFoodRecordOwner(ctx context.Context, recordID string) (string, error) {
	return m.foodRecordOwner, nil
}
func (m *mockMembershipRepo) CountFoodRecordsByDate(ctx context.Context, userID, chinaDate string) (int, error) {
	if m.foodRecordCountByDate == nil {
		return 0, nil
	}
	return m.foodRecordCountByDate[chinaDate], nil
}
func (m *mockMembershipRepo) CountSharePosterClaims(ctx context.Context, userID, chinaDate string) (int, error) {
	return m.shareClaimsToday, nil
}
func (m *mockMembershipRepo) GetSharePosterClaim(ctx context.Context, userID, recordID, chinaDate string) (*domain.UserCreditBonusEvent, error) {
	return m.shareClaim, nil
}
func (m *mockMembershipRepo) GetSharePosterClaimBySourceKey(ctx context.Context, userID, sourceKey, chinaDate string) (*domain.UserCreditBonusEvent, error) {
	if m.shareClaimBySourceKey == nil {
		return nil, nil
	}
	return m.shareClaimBySourceKey[sourceKey], nil
}
func (m *mockMembershipRepo) CreateSharePosterBonusEvent(ctx context.Context, userID, sourceKey, sourceScope, recordID, chinaDate string, credits int, meta map[string]any) (*domain.UserCreditBonusEvent, error) {
	event := &domain.UserCreditBonusEvent{ID: "bonus1", UserID: userID, Credits: credits, Meta: meta}
	if sourceKey != "" {
		event.SourceKey = &sourceKey
		if m.shareClaimBySourceKey == nil {
			m.shareClaimBySourceKey = map[string]*domain.UserCreditBonusEvent{}
		}
		m.shareClaimBySourceKey[sourceKey] = event
	}
	if sourceScope != "" {
		event.SourceScope = &sourceScope
	}
	if recordID != "" {
		event.SourceRecordID = &recordID
	}
	m.shareClaim = event
	return event, nil
}
func (m *mockMembershipRepo) GetEarnedCreditLedgerBySource(ctx context.Context, userID, reason, sourceKey string) (*domain.UserEarnedCreditLedger, error) {
	if m.ledgerByReasonSource == nil {
		return nil, nil
	}
	return m.ledgerByReasonSource[reason+"|"+sourceKey], nil
}
func (m *mockMembershipRepo) ChangeEarnedCredits(ctx context.Context, userID string, delta int, reason, sourceKey, relatedDate string, meta map[string]any) (*domain.UserEarnedCreditLedger, bool, error) {
	if m.user == nil {
		m.user = &membershiprepo.User{ID: userID}
	}
	if m.ledgerByReasonSource == nil {
		m.ledgerByReasonSource = map[string]*domain.UserEarnedCreditLedger{}
	}
	if existing := m.ledgerByReasonSource[reason+"|"+sourceKey]; sourceKey != "" && existing != nil {
		return existing, false, nil
	}
	m.user.EarnedCreditsBalance += delta
	entry := &domain.UserEarnedCreditLedger{ID: "ledger1", UserID: userID, Delta: delta, BalanceAfter: m.user.EarnedCreditsBalance}
	if sourceKey != "" {
		entry.SourceKey = &sourceKey
		m.ledgerByReasonSource[reason+"|"+sourceKey] = entry
	}
	return entry, true, nil
}
func (m *mockMembershipRepo) ChangeCreditsWithSystemUsage(ctx context.Context, userID string, earnedDelta int, earnedReason, earnedSourceKey, systemReason, systemSourceKey, relatedDate string, earnedMeta, systemMeta map[string]any) error {
	if earnedDelta != 0 {
		_, _, err := m.ChangeEarnedCredits(ctx, userID, earnedDelta, earnedReason, earnedSourceKey, relatedDate, earnedMeta)
		if err != nil {
			return err
		}
	}
	if systemReason != "" {
		_, _, err := m.ChangeEarnedCredits(ctx, userID, 0, systemReason, systemSourceKey, relatedDate, systemMeta)
		return err
	}
	return nil
}
func (m *mockMembershipRepo) SumPositiveEarnedCreditsByDate(ctx context.Context, userID, chinaDate string) (int, error) {
	return m.sumPositiveEarnedCredits, nil
}
func (m *mockMembershipRepo) CountRewardTaskUploads(ctx context.Context, userID, taskType, chinaDate, status string) (int, error) {
	count := 0
	for _, row := range m.rewardTaskUploads {
		if row == nil || row.UserID != userID || row.TaskType != taskType || row.BonusDate != chinaDate {
			continue
		}
		if status != "" && row.Status != status {
			continue
		}
		count++
	}
	return count, nil
}
func (m *mockMembershipRepo) GetRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string) (*domain.RewardTaskUpload, error) {
	if m.rewardTaskUploads == nil {
		return nil, nil
	}
	return m.rewardTaskUploads[sourceKey], nil
}
func (m *mockMembershipRepo) CreateRewardTaskUpload(ctx context.Context, row *domain.RewardTaskUpload) error {
	if m.rewardTaskUploads == nil {
		m.rewardTaskUploads = map[string]*domain.RewardTaskUpload{}
	}
	if row.SourceKey != nil {
		m.rewardTaskUploads[*row.SourceKey] = row
	}
	return nil
}
func (m *mockMembershipRepo) UpdateRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string, updates map[string]any) (*domain.RewardTaskUpload, error) {
	if m.rewardTaskUploads == nil {
		return nil, nil
	}
	row := m.rewardTaskUploads[sourceKey]
	if row == nil {
		return nil, nil
	}
	if status, ok := updates["status"].(string); ok {
		row.Status = status
	}
	if failure, ok := updates["failure_reason"].(*string); ok {
		row.FailureReason = failure
	}
	return row, nil
}

func TestMembershipService_ListPlans(t *testing.T) {
	desc := "标准套餐"
	original := 129.0
	svc := NewMembershipService(&mockMembershipRepo{
		plans: []domain.MembershipPlan{{
			Code:           "standard_monthly",
			Name:           "标准版",
			Description:    &desc,
			Amount:         99,
			OriginalAmount: &original,
			DurationMonths: 1,
			DailyCredits:   40,
			IsActive:       true,
		}},
	})

	plans, err := svc.ListPlans(context.Background())
	require.NoError(t, err)
	require.Len(t, plans, 1)
	assert.Equal(t, "standard_monthly", plans[0]["code"])
	assert.Equal(t, float64(30), plans[0]["savings"])
}

func TestMembershipService_GetMyMembership_NoMembershipTrial(t *testing.T) {
	now := time.Now()
	today := now.In(chinaLocation()).Format("2006-01-02")
	svc := NewMembershipService(&mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1", CreatedAt: &now},
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			TrialDaysTotal:    regularUserTrialDays,
			TrialPolicy:       "regular_new_user",
		},
		usedByDate: map[string]int{today: 3},
	})

	data, err := svc.GetMyMembership(context.Background(), "u1", "")
	require.NoError(t, err)
	assert.Equal(t, "inactive", data["status"])
	assert.Equal(t, trialDailyCredits, data["daily_credits_max"])
	assert.Equal(t, 5, data["system_credits_remaining"])
	assert.Equal(t, 5, data["total_credits_available"])
}

func TestMembershipService_GetMyMembership_EarlyTop500TrialMeta(t *testing.T) {
	now := time.Now()
	today := now.In(chinaLocation()).Format("2006-01-02")
	svc := NewMembershipService(&mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1", CreatedAt: &now, EarnedCreditsBalance: 2},
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			EarlyUserRank:     intPtr(42),
			TrialDaysTotal:    earlyUserTop500TrialDays,
			TrialPolicy:       "founding_top_500_bonus_month",
		},
		usedByDate: map[string]int{today: 1},
	})

	data, err := svc.GetMyMembership(context.Background(), "u1", "")
	require.NoError(t, err)
	assert.Equal(t, trialDailyCredits, data["daily_credits_max"])
	assert.Equal(t, 7, data["system_credits_remaining"])
	assert.Equal(t, 9, data["total_credits_available"])
	assert.Equal(t, true, data["trial_active"])
	assert.Equal(t, earlyUserTop500TrialDays, data["trial_days_total"])
	assert.Equal(t, "founding_top_500_bonus_month", data["trial_policy"])
	assert.Equal(t, 42, data["early_user_rank"])
	assert.Equal(t, earlyUserPaidCreditsMultiplier, data["early_user_paid_bonus_multiplier"])
	assert.Equal(t, true, data["early_user_paid_bonus_eligible"])
	assert.Equal(t, "registration_top_1000", data["early_user_paid_bonus_source"])
}

func TestMembershipService_TrialDoesNotDependOnCurrentUserCreatedAt(t *testing.T) {
	now := time.Now()
	today := now.In(chinaLocation()).Format("2006-01-02")
	svc := NewMembershipService(&mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			TrialDaysTotal:    regularUserTrialDays,
			TrialPolicy:       "regular_new_user",
		},
		usedByDate: map[string]int{today: 0},
	})

	data, err := svc.GetMyMembership(context.Background(), "u1", "")
	require.NoError(t, err)
	assert.Equal(t, true, data["trial_active"])
	assert.Equal(t, trialDailyCredits, data["daily_credits_max"])
}

func TestMembershipService_GetMyMembership_EarlyPaidDoublesPlanCreditsAndBonusBreakdown(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	code := "standard_monthly"
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	svc := NewMembershipService(&mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{
			code: &domain.MembershipPlan{Code: code, Name: "标准版", DailyCredits: 40, IsActive: true},
		},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &code,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    40,
		},
		user:               &membershiprepo.User{ID: "u1", EarnedCreditsBalance: 3},
		usedByDate:         map[string]int{today: 5},
		earlyPaidRank:      7,
		inviteBonusCredits: 15,
		shareBonusCredits:  2,
	})

	data, err := svc.GetMyMembership(context.Background(), "u1", "")
	require.NoError(t, err)
	assert.Equal(t, 80, data["daily_credits_max"])
	assert.Equal(t, 75, data["system_credits_remaining"])
	assert.Equal(t, 78, data["total_credits_available"])
	assert.Equal(t, 17, data["daily_bonus_credits"])
	assert.Equal(t, 15, data["invite_bonus_credits"])
	assert.Equal(t, 2, data["share_bonus_credits"])
	assert.Equal(t, 7, data["early_paid_user_rank"])
	assert.Equal(t, true, data["early_user_paid_bonus_active"])
	assert.Equal(t, "paid_top_100", data["early_user_paid_bonus_source"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_UsesEarnedAfterSystem(t *testing.T) {
	now := time.Now()
	today := now.In(chinaLocation()).Format("2006-01-02")
	user := &membershiprepo.User{ID: "u1", CreatedAt: &now, EarnedCreditsBalance: 5}
	svc := NewMembershipService(&mockMembershipRepo{
		user: user,
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			TrialDaysTotal:    regularUserTrialDays,
			TrialPolicy:       "regular_new_user",
		},
		usedByDate: map[string]int{today: 7},
	})

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "standard", today)
	require.NoError(t, err)
	plan := credits["credit_spend_plan"].(map[string]any)
	assert.Equal(t, 1, intFromAny(plan["system_units_total"]))
	assert.Equal(t, 1, intFromAny(plan["earned_units"]))

	err = svc.ConsumeEarnedCreditsOnTaskCreated(context.Background(), "u1", credits, 2, "food_analysis_reward_spend", "food_analysis:g1", nil)
	require.NoError(t, err)
	assert.Equal(t, 4, user.EarnedCreditsBalance)

	err = svc.RefundEarnedCreditsAfterTaskFailure(context.Background(), "u1", credits, 2, "food_analysis_reward_spend", "food_analysis:g1", "food_analysis_reward_refund", "food_analysis_refund:g1", nil)
	require.NoError(t, err)
	assert.Equal(t, 5, user.EarnedCreditsBalance)

	err = svc.RefundEarnedCreditsAfterTaskFailure(context.Background(), "u1", credits, 2, "food_analysis_reward_spend", "food_analysis:g1", "food_analysis_reward_refund", "food_analysis_refund:g1", nil)
	require.NoError(t, err)
	assert.Equal(t, 5, user.EarnedCreditsBalance)
}

func TestMembershipService_ValidateFoodAnalysisCredits_StrictRequiresStandardTierAndUsesPrecisionCost(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)
	_, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict", "")
	assert.Error(t, err)

	standard := "standard_monthly"
	mockRepo.membership.CurrentPlanCode = &standard
	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_StrictSeparateRequiresStandardTierAndUsesPrecisionCost(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)
	_, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_separate", "")
	assert.Error(t, err)

	standard := "standard_monthly"
	mockRepo.membership.CurrentPlanCode = &standard
	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_separate", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_WebSearchModeCosts(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "standard_web_search", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardFoodAnalysis, credits["credit_cost"])

	_, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_web_search", "")
	assert.Error(t, err)

	standard := "standard_monthly"
	mockRepo.membership.CurrentPlanCode = &standard
	credits, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_web_search", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_FastModesUseStandardCost(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "fast", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardFoodAnalysis, credits["credit_cost"])

	credits, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "fast_web_search", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_PackagedExperimentUsesStandardCost(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "standard_packaged_experiment", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_ExperimentalUsesPrecisionCostAndTier(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)
	_, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "experimental", "")
	assert.Error(t, err)

	standard := "standard_monthly"
	mockRepo.membership.CurrentPlanCode = &standard
	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "experimental", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_Gemini35Modes(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	}
	svc := NewMembershipService(mockRepo)

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "gemini35_flash", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardFoodAnalysis, credits["credit_cost"])

	_, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "gemini35_flash_grouped", "")
	assert.Error(t, err)

	standard := "standard_monthly"
	mockRepo.membership.CurrentPlanCode = &standard
	credits, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "gemini35_flash_grouped", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionFoodAnalysis, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_CorrectionCosts(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	user := &membershiprepo.User{ID: "u1"}
	standard := "standard_monthly"
	svc := NewMembershipService(&mockMembershipRepo{
		user: user,
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &standard,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	})

	credits, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "standard_correction", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostStandardCorrection, credits["credit_cost"])

	credits, err = svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_correction", "")
	require.NoError(t, err)
	assert.Equal(t, creditCostPrecisionCorrection, credits["credit_cost"])
}

func TestMembershipService_ValidateStatsInsightCredits(t *testing.T) {
	now := time.Now()
	repo := &mockMembershipRepo{
		membership: &domain.UserMembership{
			Status:    "active",
			ExpiresAt: ptrTime(now.AddDate(0, 1, 0)),
		},
		user: &membershiprepo.User{ID: "u1", CreatedAt: &now},
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			TrialDaysTotal:    regularUserTrialDays,
			TrialPolicy:       "regular_new_user",
		},
	}
	svc := NewMembershipService(repo, nil)

	credits, err := svc.ValidateStatsInsightCredits(context.Background(), "u1")
	require.NoError(t, err)
	assert.Equal(t, creditCostStatsInsight, credits["credit_cost"])
}

func TestMembershipService_ValidateFoodAnalysisCredits_StrictCorrectionRequiresStandardTier(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	light := "light_monthly"
	svc := NewMembershipService(&mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1"},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "u1",
			CurrentPlanCode: &light,
			Status:          "active",
			ExpiresAt:       &future,
			DailyCredits:    20,
		},
	})

	_, err := svc.ValidateFoodAnalysisCredits(context.Background(), "u1", "strict_correction", "")
	assert.Error(t, err)
}

func TestMembershipService_ActivateInviteReferralRecordsFirstValidUse(t *testing.T) {
	created := time.Now().Add(-24 * time.Hour)
	repo := &mockMembershipRepo{
		inviteReferral: &domain.UserInviteReferral{
			ID:            "ref1",
			InviterUserID: "inviter",
			InviteeUserID: "invitee",
			Status:        "pending_qualified",
			CreatedAt:     &created,
		},
	}
	svc := NewMembershipService(repo)

	ref, err := svc.ActivatePendingInviteReferralOnFirstValidUse(context.Background(), "invitee", "food_record")
	require.NoError(t, err)
	require.NotNil(t, ref)
	assert.Equal(t, "pending_qualified", ref.Status)
	require.NotNil(t, ref.FirstEffectiveActionAt)
	require.NotNil(t, ref.FirstEffectiveActionType)
	assert.Equal(t, "food_record", *ref.FirstEffectiveActionType)
}

func TestMembershipService_ActivateInviteReferralSecondDayAwardsBothSides(t *testing.T) {
	first := time.Now().AddDate(0, 0, -1)
	created := time.Now().AddDate(0, 0, -2)
	repo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "invitee"},
		inviteReferral: &domain.UserInviteReferral{
			ID:                     "ref1",
			InviterUserID:          "inviter",
			InviteeUserID:          "invitee",
			Status:                 "pending_qualified",
			FirstEffectiveActionAt: &first,
			CreatedAt:              &created,
		},
	}
	svc := NewMembershipService(repo)

	ref, err := svc.ActivatePendingInviteReferralOnFirstValidUse(context.Background(), "invitee", "exercise_log")
	require.NoError(t, err)
	require.NotNil(t, ref)
	assert.Equal(t, "reward_completed", ref.Status)
	assert.NotNil(t, ref.RewardStartDate)
}

func TestMembershipService_GetMyMembershipMaterializesLegacyInviteAndShareRewards(t *testing.T) {
	now := time.Now()
	today := now.In(chinaLocation()).Format("2006-01-02")
	recordID := "rec1"
	repo := &mockMembershipRepo{
		user: &membershiprepo.User{ID: "u1", CreatedAt: &now},
		trialEntitlement: &domain.UserTrialEntitlement{
			FirstUserID:       strPtr("u1"),
			OpenID:            "openid-u1",
			FirstRegisteredAt: &now,
			TrialDaysTotal:    regularUserTrialDays,
			TrialPolicy:       "regular_new_user",
		},
		activeInviteRewards: []domain.UserInviteReferral{{
			ID:            "ref1",
			InviterUserID: "u1",
			InviteeUserID: "u2",
			Status:        "reward_active",
		}},
		shareEvents: []domain.UserCreditBonusEvent{{
			ID:             "bonus1",
			UserID:         "u1",
			BonusType:      "share_poster",
			BonusDate:      today,
			Credits:        1,
			SourceRecordID: &recordID,
		}},
	}
	svc := NewMembershipService(repo)

	data, err := svc.GetMyMembership(context.Background(), "u1", "")
	require.NoError(t, err)
	assert.Equal(t, 6, data["earned_credits_balance"])
	assert.Equal(t, 14, data["total_credits_available"])
}

func TestMembershipService_ClaimSharePosterRewardRecordIDCompat(t *testing.T) {
	repo := &mockMembershipRepo{
		user:            &membershiprepo.User{ID: "u1"},
		foodRecordOwner: "u1",
	}
	svc := NewMembershipService(repo)

	data, err := svc.ClaimSharePosterReward(context.Background(), "u1", SharePosterRewardClaimInput{RecordID: "rec1"})
	require.NoError(t, err)
	assert.Equal(t, true, data["claimed"])
	assert.Equal(t, 1, data["credits"])
	require.NotNil(t, repo.shareClaim)
	require.NotNil(t, repo.shareClaim.SourceKey)
	require.NotNil(t, repo.shareClaim.SourceScope)
	assert.Equal(t, "meal_record:rec1", *repo.shareClaim.SourceKey)
	assert.Equal(t, "meal_record", *repo.shareClaim.SourceScope)
}

func TestMembershipService_ClaimSharePosterRewardDailyFood(t *testing.T) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	repo := &mockMembershipRepo{
		user:                  &membershiprepo.User{ID: "u1"},
		foodRecordCountByDate: map[string]int{today: 2},
	}
	svc := NewMembershipService(repo)

	data, err := svc.ClaimSharePosterReward(context.Background(), "u1", SharePosterRewardClaimInput{
		ShareScope: "daily_food",
		ShareDate:  today,
	})
	require.NoError(t, err)
	assert.Equal(t, true, data["claimed"])
	require.NotNil(t, repo.shareClaim)
	require.NotNil(t, repo.shareClaim.SourceKey)
	assert.Equal(t, "daily_food:"+today, *repo.shareClaim.SourceKey)
	assert.Nil(t, repo.shareClaim.SourceRecordID)
}

func TestMembershipService_ClaimSharePosterRewardDailyFoodRequiresRecords(t *testing.T) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	repo := &mockMembershipRepo{user: &membershiprepo.User{ID: "u1"}, foodRecordCountByDate: map[string]int{today: 0}}
	svc := NewMembershipService(repo)

	_, err := svc.ClaimSharePosterReward(context.Background(), "u1", SharePosterRewardClaimInput{
		ShareScope: "daily_food",
		ShareDate:  today,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "当天没有饮食记录")
}

func TestMembershipService_ClaimSharePosterRewardDailySummaryDedupesBySourceKey(t *testing.T) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	sourceKey := "daily_summary:" + today
	repo := &mockMembershipRepo{
		user:                  &membershiprepo.User{ID: "u1"},
		foodRecordCountByDate: map[string]int{today: 1},
		shareClaimsToday:      1,
		shareClaimBySourceKey: map[string]*domain.UserCreditBonusEvent{sourceKey: {ID: "bonus1"}},
	}
	svc := NewMembershipService(repo)

	data, err := svc.ClaimSharePosterReward(context.Background(), "u1", SharePosterRewardClaimInput{
		ShareScope: "daily_summary",
		ShareDate:  today,
	})
	require.NoError(t, err)
	assert.Equal(t, false, data["claimed"])
	assert.Equal(t, true, data["already_claimed"])
	assert.Equal(t, 1, data["share_poster_claims_today"])
}

func TestMembershipService_ClaimSharePosterRewardDailyCap(t *testing.T) {
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	repo := &mockMembershipRepo{
		user:                  &membershiprepo.User{ID: "u1"},
		foodRecordCountByDate: map[string]int{today: 1},
		shareClaimsToday:      sharePosterDailyMaxEvents,
	}
	svc := NewMembershipService(repo)

	data, err := svc.ClaimSharePosterReward(context.Background(), "u1", SharePosterRewardClaimInput{
		ShareScope: "daily_food",
		ShareDate:  today,
	})
	require.NoError(t, err)
	assert.Equal(t, false, data["claimed"])
	assert.Equal(t, true, data["daily_cap_reached"])
	assert.Equal(t, sharePosterDailyMaxEvents, data["share_poster_claims_today"])
}

func TestMembershipService_WechatNotify_ActivatesMembership(t *testing.T) {
	plan := &domain.MembershipPlan{Code: "standard_monthly", Name: "标准版", Amount: 99, DurationMonths: 1, DailyCredits: 40, IsActive: true}
	mockRepo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{"standard_monthly": plan},
		payment:    &domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanCode: "standard_monthly", Status: "pending", DurationMonths: 1},
		user:       &membershiprepo.User{ID: "u1"},
	}
	svc := NewMembershipService(mockRepo)

	err := svc.WechatNotify(context.Background(), "pay1")
	require.NoError(t, err)
	require.NotNil(t, mockRepo.membership)
	assert.Equal(t, "active", mockRepo.membership.Status)
	assert.Equal(t, 40, mockRepo.membership.DailyCredits)
}

func TestMembershipService_WechatNotify_EarlyPaidRankDoublesDailyCredits(t *testing.T) {
	plan := &domain.MembershipPlan{Code: "standard_monthly", Name: "标准版", Amount: 99, DurationMonths: 1, DailyCredits: 40, IsActive: true}
	mockRepo := &mockMembershipRepo{
		planByCode:    map[string]*domain.MembershipPlan{"standard_monthly": plan},
		payment:       &domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanCode: "standard_monthly", Status: "pending", DurationMonths: 1},
		user:          &membershiprepo.User{ID: "u1"},
		earlyPaidRank: 3,
	}
	svc := NewMembershipService(mockRepo)

	err := svc.WechatNotify(context.Background(), "pay1")
	require.NoError(t, err)
	require.NotNil(t, mockRepo.membership)
	assert.Equal(t, "active", mockRepo.membership.Status)
	assert.Equal(t, 80, mockRepo.membership.DailyCredits)
}

func TestMembershipService_SyncWechatPayment_ActivatesPaidOrderFromQuery(t *testing.T) {
	oldBaseURL := wechatPayAPIBaseURL
	defer func() { wechatPayAPIBaseURL = oldBaseURL }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Contains(t, r.URL.Path, "/v3/pay/transactions/out-trade-no/PM1")
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"out_trade_no":   "PM1",
			"trade_state":    "SUCCESS",
			"transaction_id": "4200000000000001",
			"success_time":   "2026-06-02T00:38:44+08:00",
			"amount":         map[string]any{"payer_total": 990, "total": 990},
		})
	}))
	defer server.Close()
	wechatPayAPIBaseURL = server.URL

	plan := &domain.MembershipPlan{Code: "light_monthly", Name: "轻度版", Amount: 9.9, DurationMonths: 1, DailyCredits: 8, IsActive: true}
	mockRepo := &mockMembershipRepo{
		planByCode:    map[string]*domain.MembershipPlan{"light_monthly": plan},
		payment:       &domain.MembershipPayment{ID: "pay1", UserID: "u1", OrderNo: "PM1", PlanCode: "light_monthly", Status: "pending", Amount: 9.9, DurationMonths: 1},
		user:          &membershiprepo.User{ID: "u1"},
		earlyPaidRank: 18,
	}
	cfg := &config.Config{
		External: config.ExternalConfig{AppID: "wx-app"},
		WechatPay: config.WechatPayConfig{
			MchID:      "1100000000",
			NotifyURL:  "https://api.healthymax.cn/api/payment/wechat/notify/membership",
			SerialNo:   "SERIAL",
			APIV3Key:   "12345678901234567890123456789012",
			PrivateKey: testRSAPrivateKeyPEM,
		},
	}
	svc := NewMembershipService(mockRepo, cfg)

	data, err := svc.SyncWechatPayment(context.Background(), "u1", "PM1")
	require.NoError(t, err)
	assert.Equal(t, true, data["synced"])
	assert.Equal(t, "paid", mockRepo.payment.Status)
	require.NotNil(t, mockRepo.payment.PaidAt)
	require.NotNil(t, mockRepo.payment.WxTransactionID)
	assert.Equal(t, "4200000000000001", *mockRepo.payment.WxTransactionID)
	require.NotNil(t, mockRepo.membership)
	assert.Equal(t, "active", mockRepo.membership.Status)
	assert.Equal(t, "light_monthly", *mockRepo.membership.CurrentPlanCode)
	assert.Equal(t, 16, mockRepo.membership.DailyCredits)
}

func TestMembershipService_CreatePaymentWithInput_ReturnsMobilePaymentUnavailable(t *testing.T) {
	oldBaseURL := wechatPayAPIBaseURL
	defer func() { wechatPayAPIBaseURL = oldBaseURL }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v3/pay/transactions/app", r.URL.Path)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		assert.Equal(t, "wx-app-pay", payload["appid"])
		assert.Equal(t, "1100000000", payload["mchid"])
		assert.NotEmpty(t, payload["out_trade_no"])
		_, hasPayer := payload["payer"]
		assert.False(t, hasPayer, "APP payment must not send JSAPI payer.openid")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"prepay_id": "wx-app-prepay"})
	}))
	defer server.Close()
	wechatPayAPIBaseURL = server.URL

	plan := &domain.MembershipPlan{Code: "standard_monthly", Name: "Standard", Amount: 19.9, DurationMonths: 1, DailyCredits: 20, IsActive: true}
	mockRepo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{"standard_monthly": plan},
		user:       &membershiprepo.User{ID: "u1"},
	}
	cfg := &config.Config{
		WechatPay: config.WechatPayConfig{
			AppPayAppID: "wx-app-pay",
			MchID:       "1100000000",
			NotifyURL:   "https://api.healthymax.cn/api/payment/wechat/notify/membership",
			SerialNo:    "SERIAL",
			APIV3Key:    "12345678901234567890123456789012",
			PrivateKey:  testRSAPrivateKeyPEM,
		},
	}
	svc := NewMembershipService(mockRepo, cfg)

	data, err := svc.CreatePaymentWithInput(context.Background(), "u1", CreateMembershipPaymentInput{
		PlanCode:   "standard_monthly",
		PayChannel: "wechat",
		TradeType:  "APP",
		Client:     "mobile_app",
	})
	require.Error(t, err)
	assert.Nil(t, data)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusNotImplemented, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "App 支付暂未开放")
	assert.Nil(t, mockRepo.payment)
}

func TestMembershipService_CreatePaymentWithInput_BlocksDisabledPaymentTestPlan(t *testing.T) {
	plan := &domain.MembershipPlan{Code: domain.PaymentTestPlanCode, Name: "Pay Test", Amount: 0.01, DurationMonths: 1, DailyCredits: 8, IsActive: true, IsTestPlan: true}
	mockRepo := &mockMembershipRepo{
		planByCode:        map[string]*domain.MembershipPlan{domain.PaymentTestPlanCode: plan},
		paymentTestAccess: &domain.PaymentTestAccess{Enabled: false, UserAllowed: true},
	}
	svc := NewMembershipService(mockRepo)

	data, err := svc.CreatePaymentWithInput(context.Background(), "u1", CreateMembershipPaymentInput{PlanCode: domain.PaymentTestPlanCode})
	require.Error(t, err)
	assert.Nil(t, data)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusForbidden, appErr.HTTPStatus)
	assert.Nil(t, mockRepo.payment)
}

func TestMembershipService_CreatePaymentWithInput_BlocksUnlistedPaymentTestUser(t *testing.T) {
	plan := &domain.MembershipPlan{Code: domain.PaymentTestPlanCode, Name: "Pay Test", Amount: 0.01, DurationMonths: 1, DailyCredits: 8, IsActive: true, IsTestPlan: true}
	mockRepo := &mockMembershipRepo{
		planByCode:        map[string]*domain.MembershipPlan{domain.PaymentTestPlanCode: plan},
		paymentTestAccess: &domain.PaymentTestAccess{Enabled: true, UserAllowed: false},
	}
	svc := NewMembershipService(mockRepo)

	data, err := svc.CreatePaymentWithInput(context.Background(), "u1", CreateMembershipPaymentInput{PlanCode: domain.PaymentTestPlanCode})
	require.Error(t, err)
	assert.Nil(t, data)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusForbidden, appErr.HTTPStatus)
	assert.Nil(t, mockRepo.payment)
}

func TestMembershipService_CreatePaymentWithInput_AllowsListedPaymentTestUserPastGate(t *testing.T) {
	plan := &domain.MembershipPlan{Code: domain.PaymentTestPlanCode, Name: "Pay Test", Amount: 0.01, DurationMonths: 1, DailyCredits: 8, IsActive: true, IsTestPlan: true}
	mockRepo := &mockMembershipRepo{
		planByCode:        map[string]*domain.MembershipPlan{domain.PaymentTestPlanCode: plan},
		paymentTestAccess: &domain.PaymentTestAccess{Enabled: true, UserAllowed: true},
		user:              &membershiprepo.User{ID: "u1"},
	}
	svc := NewMembershipService(mockRepo)

	data, err := svc.CreatePaymentWithInput(context.Background(), "u1", CreateMembershipPaymentInput{
		PlanCode: domain.PaymentTestPlanCode,
		Client:   "mobile_app",
	})
	require.Error(t, err)
	assert.Nil(t, data)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusNotImplemented, appErr.HTTPStatus)
	assert.Nil(t, mockRepo.payment)
}

func TestMembershipService_CreatePaymentBlocksAppOnlyOpenIDDefaultJSAPI(t *testing.T) {
	plan := &domain.MembershipPlan{Code: "standard_monthly", Name: "Standard", Amount: 19.9, DurationMonths: 1, DailyCredits: 20, IsActive: true}
	mockRepo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{"standard_monthly": plan},
		user:       &membershiprepo.User{ID: "u1", OpenID: "app-wx:mobile-openid"},
	}
	cfg := &config.Config{
		External: config.ExternalConfig{AppID: "wx-mini-program"},
		WechatPay: config.WechatPayConfig{
			MchID:      "1100000000",
			NotifyURL:  "https://api.healthymax.cn/api/payment/wechat/notify/membership",
			SerialNo:   "SERIAL",
			APIV3Key:   "12345678901234567890123456789012",
			PrivateKey: testRSAPrivateKeyPEM,
		},
	}
	svc := NewMembershipService(mockRepo, cfg)

	data, err := svc.CreatePaymentWithInput(context.Background(), "u1", CreateMembershipPaymentInput{
		PlanCode: "standard_monthly",
	})
	require.Error(t, err)
	assert.Nil(t, data)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusNotImplemented, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "App 支付暂未开放")
	assert.Nil(t, mockRepo.payment)
}

func TestMembershipService_GetMyMembership_ManualUpgradeKeepsHigherTierOnReconcile(t *testing.T) {
	paidAt := time.Now().Add(-2 * time.Hour)
	existingExpires := time.Now().Add(30 * 24 * time.Hour)
	advanced := "advanced_monthly"
	light := "light_monthly"
	mockRepo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{
			advanced: &domain.MembershipPlan{Code: advanced, Name: "进阶版", DailyCredits: 80, IsActive: true},
			light:    &domain.MembershipPlan{Code: light, Name: "轻享版", DailyCredits: 20, IsActive: true},
		},
		membership: &domain.UserMembership{
			ID:              "um1",
			UserID:          "cafa4614-9453-4eb0-bf60-51f442ce0f4a",
			CurrentPlanCode: &advanced,
			Status:          "active",
			ExpiresAt:       &existingExpires,
			DailyCredits:    200,
		},
		latestPaidPayment: &domain.MembershipPayment{
			ID:             "pay1",
			UserID:         "cafa4614-9453-4eb0-bf60-51f442ce0f4a",
			PlanCode:       light,
			Status:         "paid",
			DurationMonths: 1,
			PaidAt:         &paidAt,
		},
		user: &membershiprepo.User{ID: "cafa4614-9453-4eb0-bf60-51f442ce0f4a"},
	}
	svc := NewMembershipService(mockRepo)

	data, err := svc.GetMyMembership(context.Background(), "cafa4614-9453-4eb0-bf60-51f442ce0f4a", "")
	require.NoError(t, err)
	assert.Equal(t, advanced, *mockRepo.membership.CurrentPlanCode)
	assert.Equal(t, 200, mockRepo.membership.DailyCredits)
	assert.Equal(t, 200, data["daily_credits_max"])
}

func TestMembershipService_BuildPaymentTermsProratesUpgradeFromOriginalPeriodStart(t *testing.T) {
	start := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	now := start.AddDate(0, 0, 5)
	currentExpires := addMonths(start, 1)
	light := "light_monthly"
	standardYearly := "standard_yearly"
	repo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{
			light:          &domain.MembershipPlan{Code: light, Name: "轻度版月卡", Amount: 19.9, DurationMonths: 1, DailyCredits: 8, IsActive: true},
			standardYearly: &domain.MembershipPlan{Code: standardYearly, Name: "标准版年卡", Amount: 299, DurationMonths: 12, DailyCredits: 20, IsActive: true},
		},
	}
	svc := NewMembershipService(repo)
	membership := &domain.UserMembership{
		ID:                 "um1",
		UserID:             "u1",
		CurrentPlanCode:    &light,
		Status:             "active",
		CurrentPeriodStart: &start,
		ExpiresAt:          &currentExpires,
		DailyCredits:       8,
	}

	terms, err := svc.buildMembershipPaymentTerms(context.Background(), repo.planByCode[standardYearly], membership, now)
	require.NoError(t, err)
	assert.Equal(t, "prorated_current_period_upgrade", terms.Mode)
	assert.True(t, timeMatches(&terms.TargetPeriodStart, start))
	assert.True(t, timeMatches(&terms.TargetExpiresAt, addMonths(start, 12)))
	assert.Less(t, terms.ChargeAmount, repo.planByCode[standardYearly].Amount)
	assert.Greater(t, terms.ChargeAmount, 270.0)
}

func TestMembershipService_ActivateMembershipUsesProratedUpgradeTargetPeriod(t *testing.T) {
	start := time.Now().AddDate(0, 0, -5)
	currentExpires := addMonths(start, 1)
	targetExpires := addMonths(start, 12)
	standard := "standard_monthly"
	mockRepo := &mockMembershipRepo{
		planByCode: map[string]*domain.MembershipPlan{
			standard: &domain.MembershipPlan{Code: standard, Name: "标准版", DailyCredits: 20, IsActive: true},
		},
		membership: &domain.UserMembership{
			ID:                 "um1",
			UserID:             "u1",
			CurrentPlanCode:    &standard,
			Status:             "active",
			CurrentPeriodStart: &start,
			ExpiresAt:          &currentExpires,
			DailyCredits:       8,
		},
		user: &membershiprepo.User{ID: "u1"},
	}
	svc := NewMembershipService(mockRepo)
	payment := &domain.MembershipPayment{
		ID:             "pay1",
		UserID:         "u1",
		PlanCode:       standard,
		Status:         "paid",
		DurationMonths: 12,
		Extra: map[string]any{
			"upgrade_terms": map[string]any{
				"mode":                "prorated_current_period_upgrade",
				"target_period_start": start.Format(time.RFC3339),
				"target_expires_at":   targetExpires.Format(time.RFC3339),
			},
		},
	}

	updated, err := svc.activateMembershipFromPayment(context.Background(), payment, time.Now())
	require.NoError(t, err)
	require.NotNil(t, updated.ExpiresAt)
	assert.True(t, timeMatches(updated.CurrentPeriodStart, start))
	assert.True(t, timeMatches(updated.ExpiresAt, targetExpires))
}
