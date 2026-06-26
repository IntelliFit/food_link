package service

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"
	"food_link/backend/pkg/logger"

	voucherdomain "food_link/backend/internal/voucher/domain"
	voucherrepo "food_link/backend/internal/voucher/repo"

	"gorm.io/gorm"
)

const defaultVoucherValidityDays = 30

// MessageSender is implemented by message service for sending system messages with actions.
type MessageSender interface {
	SendSystemMessageWithAction(ctx context.Context, receiverID, content, actionText string, extraData map[string]any) error
}

type VoucherService struct {
	voucherRepo     *voucherrepo.VoucherRepo
	membershipRepo  *membershiprepo.MembershipRepo
	userRepo        *authrepo.UserRepo
	messageSender   MessageSender
}

func NewVoucherService(
	voucherRepo *voucherrepo.VoucherRepo,
	membershipRepo *membershiprepo.MembershipRepo,
	userRepo *authrepo.UserRepo,
) *VoucherService {
	return &VoucherService{
		voucherRepo:    voucherRepo,
		membershipRepo: membershipRepo,
		userRepo:       userRepo,
	}
}

func (s *VoucherService) ConfigureMessageSender(sender MessageSender) {
	s.messageSender = sender
}

// IssueRegistrationTrialVoucher creates a voucher for new user trial entitlement.
func (s *VoucherService) IssueRegistrationTrialVoucher(ctx context.Context, userID, openID, unionID string, createdAt *time.Time, trialDays int, policy string, earlyRank *int) (*voucherdomain.UserVoucher, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	sourceType := voucherdomain.VoucherSourceTypeRegistration
	sourceKey := fmt.Sprintf("%s:%s", sourceType, userID)

	existing, err := s.voucherRepo.FindVoucherBySource(ctx, userID, sourceType, sourceKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	validEndAt := time.Now().AddDate(0, 0, defaultVoucherValidityDays)
	voucher := &voucherdomain.UserVoucher{
		UserID:      userID,
		VoucherType: voucherdomain.VoucherTypeRegistrationTrial,
		Status:      voucherdomain.VoucherStatusPending,
		Title:       "新用户试用卡",
		Description: strPtr(fmt.Sprintf("赠送 %d 天会员试用权益", trialDays)),
		RewardPayload: map[string]any{
			"trial_days":    trialDays,
			"trial_policy":  policy,
			"early_user_rank": intPtrValue(earlyRank),
		},
		SourceType:   sourceType,
		SourceKey:    sourceKey,
		ValidStartAt: nil,
		ValidEndAt:   &validEndAt,
	}
	created, err := s.voucherRepo.CreateVoucher(ctx, voucher)
	if err != nil {
		return nil, err
	}

	s.notifyUserAboutVoucher(ctx, created)
	return created, nil
}

// IssueInviteRewardVouchers creates invite reward vouchers for both inviter and invitee.
func (s *VoucherService) IssueInviteRewardVouchers(ctx context.Context, referral *domain.UserInviteReferral) (*voucherdomain.UserVoucher, *voucherdomain.UserVoucher, error) {
	if referral == nil {
		return nil, nil, fmt.Errorf("referral is nil")
	}
	now := time.Now()
	validEndAt := now.AddDate(0, 0, defaultVoucherValidityDays)

	makeVoucher := func(userID, role string) (*voucherdomain.UserVoucher, error) {
		sourceType := voucherdomain.VoucherSourceTypeInviteReferral
		sourceKey := fmt.Sprintf("%s:%s:%s", sourceType, referral.ID, role)
		existing, err := s.voucherRepo.FindVoucherBySource(ctx, userID, sourceType, sourceKey)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
		voucher := &voucherdomain.UserVoucher{
			UserID:      userID,
			VoucherType: voucherdomain.VoucherTypeInviteLightWeek,
			Status:      voucherdomain.VoucherStatusPending,
			Title:       "一周轻度版会员",
			Description: strPtr("邀请好友达标奖励，点击即可领取 7 天轻度版会员"),
			RewardPayload: map[string]any{
				"plan_code":  "light_monthly",
				"grant_days": 7,
				"referral_id": referral.ID,
				"role":        role,
			},
			SourceType:   sourceType,
			SourceKey:    sourceKey,
			ValidStartAt: nil,
			ValidEndAt:   &validEndAt,
		}
		created, err := s.voucherRepo.CreateVoucher(ctx, voucher)
		if err != nil {
			return nil, err
		}
		s.notifyUserAboutVoucher(ctx, created)
		return created, nil
	}

	inviterVoucher, err := makeVoucher(referral.InviterUserID, "inviter")
	if err != nil {
		return nil, nil, err
	}
	inviteeVoucher, err := makeVoucher(referral.InviteeUserID, "invitee")
	if err != nil {
		return nil, nil, err
	}
	return inviterVoucher, inviteeVoucher, nil
}

// IssueAdminPointsVoucher creates a points voucher from admin manual reward.
func (s *VoucherService) IssueAdminPointsVoucher(ctx context.Context, adminUserID, targetUserID string, points int, note string) (*voucherdomain.UserVoucher, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, fmt.Errorf("目标用户 ID 不能为空")
	}
	if points <= 0 {
		return nil, fmt.Errorf("积分必须大于 0")
	}

	sourceType := voucherdomain.VoucherSourceTypeAdminManual
	sourceKey := fmt.Sprintf("%s:%s:%d:%d", sourceType, targetUserID, points, time.Now().UnixNano())
	validEndAt := time.Now().AddDate(0, 0, defaultVoucherValidityDays)

	description := "管理员赠送积分奖励"
	if note != "" {
		description = note
	}

	voucher := &voucherdomain.UserVoucher{
		UserID:      targetUserID,
		VoucherType: voucherdomain.VoucherTypeAdminPoints,
		Status:      voucherdomain.VoucherStatusPending,
		Title:       fmt.Sprintf("%d 积分奖励", points),
		Description: &description,
		RewardPayload: map[string]any{
			"points":    points,
			"admin_id":  adminUserID,
			"note":      note,
		},
		SourceType:   sourceType,
		SourceKey:    sourceKey,
		ValidStartAt: nil,
		ValidEndAt:   &validEndAt,
	}
	created, err := s.voucherRepo.CreateVoucher(ctx, voucher)
	if err != nil {
		return nil, err
	}
	s.notifyUserAboutVoucher(ctx, created)
	return created, nil
}

// ListMyVouchers returns vouchers for a user, optionally filtered by status.
func (s *VoucherService) ListMyVouchers(ctx context.Context, userID, status string, offset, limit int) ([]voucherdomain.UserVoucher, error) {
	// Lazily expire stale pending vouchers for this user before listing.
	_, _ = s.voucherRepo.ExpirePendingVouchers(ctx, time.Now())
	return s.voucherRepo.ListVouchers(ctx, userID, status, offset, limit)
}

// CountMyVouchers returns the count of vouchers for a user by status.
func (s *VoucherService) CountMyVouchers(ctx context.Context, userID, status string) (int64, error) {
	return s.voucherRepo.CountVouchers(ctx, userID, status)
}

// GetVoucherDetail returns a voucher belonging to the user.
func (s *VoucherService) GetVoucherDetail(ctx context.Context, userID, voucherID string) (*voucherdomain.UserVoucher, error) {
	return s.voucherRepo.GetVoucherByID(ctx, voucherID, userID)
}

// UseVoucher redeems a voucher and applies the reward atomically.
func (s *VoucherService) UseVoucher(ctx context.Context, userID, voucherID string) error {
	userID = strings.TrimSpace(userID)
	voucherID = strings.TrimSpace(voucherID)
	if userID == "" || voucherID == "" {
		return fmt.Errorf("用户 ID 和礼券 ID 不能为空")
	}

	voucher, err := s.voucherRepo.GetVoucherByID(ctx, voucherID, userID)
	if err != nil {
		return err
	}
	if voucher == nil {
		return fmt.Errorf("礼券不存在")
	}
	if !voucher.IsUsable() {
		return fmt.Errorf("礼券不可用或已过期")
	}

	return s.voucherRepo.WithTransaction(ctx, func(tx *gorm.DB) error {
		txRepo := voucherrepo.NewVoucherRepo(tx)
		txUserRepo := authrepo.NewUserRepo(tx)
		txMembershipRepo := membershiprepo.NewMembershipRepo(tx)
		if err := txRepo.MarkVoucherUsed(ctx, voucherID, userID); err != nil {
			return err
		}
		switch voucher.VoucherType {
		case voucherdomain.VoucherTypeRegistrationTrial:
			return s.applyRegistrationTrial(ctx, txUserRepo, userID, voucher)
		case voucherdomain.VoucherTypeInviteLightWeek:
			return s.applyInviteLightWeek(ctx, txMembershipRepo, userID, voucher)
		case voucherdomain.VoucherTypeAdminPoints:
			return s.applyAdminPoints(ctx, txMembershipRepo, userID, voucher)
		default:
			return fmt.Errorf("未知的礼券类型: %s", voucher.VoucherType)
		}
	})
}

func (s *VoucherService) applyRegistrationTrial(ctx context.Context, userRepo *authrepo.UserRepo, userID string, voucher *voucherdomain.UserVoucher) error {
	payload := voucher.RewardPayload
	trialDays, _ := strconv.Atoi(fmt.Sprintf("%v", payload["trial_days"]))
	policy := fmt.Sprintf("%v", payload["trial_policy"])
	if trialDays <= 0 {
		trialDays = 3
	}
	if policy == "" || policy == "<nil>" {
		policy = "regular_new_user"
	}

	user, err := userRepo.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return fmt.Errorf("用户不存在")
	}

	openID := user.OpenID
	var unionID *string
	if user.UnionID != nil && strings.TrimSpace(*user.UnionID) != "" {
		unionID = user.UnionID
	}

	ent, err := userRepo.FindTrialEntitlementByIdentity(ctx, openID, derefString(unionID))
	if err != nil {
		return err
	}
	if ent != nil {
		// Already has trial entitlement; just mark voucher as used and return.
		return nil
	}

	earlyRank := 0
	if r, ok := payload["early_user_rank"].(int); ok && r > 0 {
		earlyRank = r
	}
	var earlyRankPtr *int
	if earlyRank > 0 {
		earlyRankPtr = &earlyRank
	}

	now := time.Now()
	registeredAt := user.CreatedAt
	if registeredAt == nil {
		registeredAt = &now
	}
	return userRepo.CreateTrialEntitlement(ctx, &authrepo.UserTrialEntitlement{
		FirstUserID:       &userID,
		OpenID:            openID,
		UnionID:           unionID,
		FirstRegisteredAt: registeredAt,
		EarlyUserRank:     earlyRankPtr,
		TrialDaysTotal:    trialDays,
		TrialPolicy:       policy,
	})
}

func (s *VoucherService) applyInviteLightWeek(ctx context.Context, membershipRepo *membershiprepo.MembershipRepo, userID string, voucher *voucherdomain.UserVoucher) error {
	payload := voucher.RewardPayload
	planCode := fmt.Sprintf("%v", payload["plan_code"])
	grantDays, _ := strconv.Atoi(fmt.Sprintf("%v", payload["grant_days"]))
	referralID := fmt.Sprintf("%v", payload["referral_id"])
	role := fmt.Sprintf("%v", payload["role"])
	if planCode == "" || planCode == "<nil>" {
		planCode = "light_monthly"
	}
	if grantDays <= 0 {
		grantDays = 7
	}

	plan, err := membershipRepo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return err
	}
	dailyCredits := 8
	if plan != nil && plan.DailyCredits > 0 {
		dailyCredits = plan.DailyCredits
	}

	sourceKey := fmt.Sprintf("invite_voucher:%s:%s:%s", referralID, role, voucher.ID)
	_, _, _, err = membershipRepo.GrantMembership(ctx, domain.MembershipGrantInput{
		UserID:       userID,
		SourceType:   "invite_qualified_reward",
		SourceKey:    sourceKey,
		PlanCode:     planCode,
		DailyCredits: dailyCredits,
		GrantDays:    grantDays,
		ReferralID:   referralID,
		Role:         role,
		Meta: map[string]any{
			"voucher_id":  voucher.ID,
			"referral_id": referralID,
			"role":        role,
		},
	})
	return err
}

func (s *VoucherService) applyAdminPoints(ctx context.Context, membershipRepo *membershiprepo.MembershipRepo, userID string, voucher *voucherdomain.UserVoucher) error {
	payload := voucher.RewardPayload
	points, _ := strconv.Atoi(fmt.Sprintf("%v", payload["points"]))
	if points <= 0 {
		return fmt.Errorf("积分必须大于 0")
	}
	sourceKey := fmt.Sprintf("admin_voucher:%s", voucher.ID)
	_, _, err := membershipRepo.ChangeEarnedCredits(ctx, userID, points, "admin_voucher_reward", sourceKey, "", map[string]any{
		"voucher_id": voucher.ID,
		"admin_id":   payload["admin_id"],
		"note":       payload["note"],
	})
	return err
}

func (s *VoucherService) notifyUserAboutVoucher(ctx context.Context, voucher *voucherdomain.UserVoucher) {
	if s.messageSender == nil || voucher == nil {
		return
	}
	content := fmt.Sprintf("恭喜你获得「%s」，点击前往「我的礼券」查看并使用。", voucher.Title)
	if voucher.Description != nil && strings.TrimSpace(*voucher.Description) != "" {
		content = fmt.Sprintf("恭喜你获得「%s」，%s，点击前往「我的礼券」查看并使用。", voucher.Title, *voucher.Description)
	}
	extra := map[string]any{
		"path":   "/pages/my-vouchers/index",
		"target": "my-vouchers",
	}
	if err := s.messageSender.SendSystemMessageWithAction(ctx, voucher.UserID, content, "去使用", extra); err != nil {
		logger.Warn(ctx, "礼券系统消息通知失败",
			slog.String("user_id", voucher.UserID),
			slog.String("voucher_id", voucher.ID),
			logger.Err(err),
		)
	}
}

func strPtr(s string) *string { return &s }

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func intPtrValue(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}
