package service

import (
	"context"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"
)

type MembershipRepo interface {
	ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error)
	GetPlanByID(ctx context.Context, planID string) (*domain.MembershipPlan, error)
	GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error)
	CreateMembership(ctx context.Context, um *domain.UserMembership) error
	UpdateMembership(ctx context.Context, id string, updates map[string]any) error
	CreatePayment(ctx context.Context, p *domain.MembershipPayment) error
	GetPaymentByID(ctx context.Context, id string) (*domain.MembershipPayment, error)
	UpdatePaymentStatus(ctx context.Context, id string, status string) error
	CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error)
	HasShareReward(ctx context.Context, userID, recordID string) (bool, error)
	CreateShareReward(ctx context.Context, reward *domain.MembershipShareReward) error
}

type MembershipService struct {
	repo MembershipRepo
}

func NewMembershipService(repo MembershipRepo) *MembershipService {
	return &MembershipService{repo: repo}
}

// ListPlans returns all active membership plans.
func (s *MembershipService) ListPlans(ctx context.Context) ([]map[string]any, error) {
	plans, err := s.repo.ListActivePlans(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		out = append(out, map[string]any{
			"id":            p.ID,
			"name":          p.Name,
			"price_cents":   p.PriceCents,
			"duration_days": p.DurationDays,
			"description":   p.Description,
			"benefits":      p.Benefits,
		})
	}
	return out, nil
}

// GetMyMembership returns the current user's membership status with daily usage stats.
func (s *MembershipService) GetMyMembership(ctx context.Context, userID string) (map[string]any, error) {
	membership, err := s.repo.GetActiveMembership(ctx, userID)
	if err != nil {
		return nil, err
	}

	planName := ""
	planDescription := ""
	var dailyLimit int64 = 10 // default limit

	if membership != nil {
		plan, err := s.repo.GetPlanByID(ctx, membership.PlanID)
		if err != nil {
			return nil, err
		}
		if plan != nil {
			planName = plan.Name
			planDescription = plan.Description
			dailyLimit = int64(getDailyLimit(plan.Name))
		}
	}

	usedToday, err := s.repo.CountAnalysisTasksToday(ctx, userID)
	if err != nil {
		return nil, err
	}

	status := "none"
	var expiresAt *time.Time
	var startedAt *time.Time
	if membership != nil {
		status = membership.Status
		expiresAt = membership.ExpiresAt
		startedAt = membership.StartedAt
	}

	return map[string]any{
		"status":           status,
		"plan_name":        planName,
		"plan_description": planDescription,
		"started_at":       startedAt,
		"expires_at":       expiresAt,
		"daily_limit":      dailyLimit,
		"used_today":       usedToday,
		"remaining_today":  max(0, dailyLimit-usedToday),
	}, nil
}

// CreatePayment creates a WeChat Pay order (stubbed).
func (s *MembershipService) CreatePayment(ctx context.Context, userID, planID string) (map[string]any, error) {
	plan, err := s.repo.GetPlanByID(ctx, planID)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, commonerrors.ErrNotFound
	}

	prepayID := "mock_prepay_" + planID
	payment := &domain.MembershipPayment{
		UserID:         userID,
		PlanID:         planID,
		AmountCents:    plan.PriceCents,
		Status:         "pending",
		WechatPrepayID: &prepayID,
	}
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, err
	}

	return map[string]any{
		"payment_id": payment.ID,
		"prepay_params": map[string]string{
			"appId":     "wx_mock_appid",
			"timeStamp": time.Now().Format("20060102150405"),
			"nonceStr":  "mock_nonce_str",
			"package":   "prepay_id=" + prepayID,
			"signType":  "RSA",
			"paySign":   "mock_pay_sign",
		},
	}, nil
}

// WechatNotify handles WeChat Pay callback (stubbed verification).
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

	if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "paid"); err != nil {
		return err
	}

	// Activate or extend membership
	membership, err := s.repo.GetActiveMembership(ctx, payment.UserID)
	if err != nil {
		return err
	}

	plan, err := s.repo.GetPlanByID(ctx, payment.PlanID)
	if err != nil {
		return err
	}
	if plan == nil {
		return commonerrors.ErrNotFound
	}

	now := time.Now()
	if membership != nil {
		// Extend existing membership
		var newExpires time.Time
		if membership.ExpiresAt != nil && membership.ExpiresAt.After(now) {
			newExpires = membership.ExpiresAt.Add(time.Duration(plan.DurationDays) * 24 * time.Hour)
		} else {
			newExpires = now.Add(time.Duration(plan.DurationDays) * 24 * time.Hour)
		}
		return s.repo.UpdateMembership(ctx, membership.ID, map[string]any{
			"expires_at": newExpires,
			"status":     "active",
		})
	}

	// Create new membership
	expiresAt := now.Add(time.Duration(plan.DurationDays) * 24 * time.Hour)
	um := &domain.UserMembership{
		UserID:    payment.UserID,
		PlanID:    payment.PlanID,
		Status:    "active",
		StartedAt: &now,
		ExpiresAt: &expiresAt,
	}
	return s.repo.CreateMembership(ctx, um)
}

// ClaimSharePosterReward claims a reward for sharing a poster.
func (s *MembershipService) ClaimSharePosterReward(ctx context.Context, userID, recordID string) (map[string]any, error) {
	if recordID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "record_id required", HTTPStatus: 400}
	}

	claimed, err := s.repo.HasShareReward(ctx, userID, recordID)
	if err != nil {
		return nil, err
	}
	if claimed {
		return nil, &commonerrors.AppError{Code: 10002, Message: "already claimed", HTTPStatus: 400}
	}

	reward := &domain.MembershipShareReward{
		UserID:   userID,
		RecordID: recordID,
	}
	if err := s.repo.CreateShareReward(ctx, reward); err != nil {
		return nil, err
	}

	return map[string]any{
		"success":   true,
		"reward_id": reward.ID,
	}, nil
}

func getDailyLimit(planName string) int {
	if strings.Contains(strings.ToLower(planName), "pro") {
		return 100
	}
	return 10
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
