package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"food_link/backend/internal/membership/domain"
	"food_link/backend/pkg/logger"
)

type appliedMembershipGrantExpiryReader interface {
	GetAppliedMembershipGrantExpiry(context.Context, string, string) (*time.Time, error)
}

func (s *MembershipService) paidExpiryWithAppliedGrants(ctx context.Context, userID, planCode string, paidExpiry time.Time) (time.Time, error) {
	reader, ok := s.repo.(appliedMembershipGrantExpiryReader)
	if !ok {
		return paidExpiry, nil
	}
	grantExpiry, err := reader.GetAppliedMembershipGrantExpiry(ctx, userID, planCode)
	if err != nil {
		logger.Error(ctx, "读取会员赠送有效期失败", err, slog.String("user_id", userID), slog.String("plan_code", planCode))
		return time.Time{}, err
	}
	if grantExpiry != nil && grantExpiry.After(paidExpiry) {
		return *grantExpiry, nil
	}
	return paidExpiry, nil
}

// GrantCaptureMembership extends membership bought with canteen capture
// earnings. The source key makes a retried redemption a no-op.
func (s *MembershipService) GrantCaptureMembership(ctx context.Context, userID, sourceKey, planCode string, days int, meta map[string]any) error {
	plan, err := s.repo.GetPlanByCode(ctx, planCode)
	if err != nil {
		return err
	}
	if plan == nil {
		return fmt.Errorf("membership plan %s not found", planCode)
	}
	dailyCredits := plan.DailyCredits
	if dailyCredits <= 0 {
		dailyCredits = trialDailyCredits
	}
	_, _, _, err = s.repo.GrantMembership(ctx, domain.MembershipGrantInput{
		UserID: userID, SourceType: "canteen_capture_redeem", SourceKey: sourceKey,
		PlanCode: planCode, DailyCredits: dailyCredits, GrantDays: days, Meta: meta,
	})
	return err
}
