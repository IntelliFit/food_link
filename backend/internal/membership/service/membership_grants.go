package service

import (
	"context"
	"log/slog"
	"time"

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
