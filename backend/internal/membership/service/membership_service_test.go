package service

import (
	"context"
	"errors"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/membership/domain"

	"github.com/stretchr/testify/assert"
)

type mockMembershipRepo struct {
	listActivePlans             []domain.MembershipPlan
	listActivePlansErr          error
	getPlanByID                 *domain.MembershipPlan
	getPlanByIDErr              error
	getActiveMembership         *domain.UserMembership
	getActiveMembershipErr      error
	createMembershipErr         error
	updateMembershipErr         error
	createPaymentErr            error
	getPaymentByID              *domain.MembershipPayment
	getPaymentByIDErr           error
	updatePaymentStatusErr      error
	countAnalysisTasksToday     int64
	countAnalysisTasksTodayErr  error
	hasShareReward              bool
	hasShareRewardErr           error
	createShareRewardErr        error
}

func (m *mockMembershipRepo) ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error) {
	return m.listActivePlans, m.listActivePlansErr
}
func (m *mockMembershipRepo) GetPlanByID(ctx context.Context, planID string) (*domain.MembershipPlan, error) {
	return m.getPlanByID, m.getPlanByIDErr
}
func (m *mockMembershipRepo) GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	return m.getActiveMembership, m.getActiveMembershipErr
}
func (m *mockMembershipRepo) CreateMembership(ctx context.Context, um *domain.UserMembership) error {
	return m.createMembershipErr
}
func (m *mockMembershipRepo) UpdateMembership(ctx context.Context, id string, updates map[string]any) error {
	return m.updateMembershipErr
}
func (m *mockMembershipRepo) CreatePayment(ctx context.Context, p *domain.MembershipPayment) error {
	if p.ID == "" {
		p.ID = "mock-payment-id"
	}
	return m.createPaymentErr
}
func (m *mockMembershipRepo) GetPaymentByID(ctx context.Context, id string) (*domain.MembershipPayment, error) {
	return m.getPaymentByID, m.getPaymentByIDErr
}
func (m *mockMembershipRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	return m.updatePaymentStatusErr
}
func (m *mockMembershipRepo) CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error) {
	return m.countAnalysisTasksToday, m.countAnalysisTasksTodayErr
}
func (m *mockMembershipRepo) HasShareReward(ctx context.Context, userID, recordID string) (bool, error) {
	return m.hasShareReward, m.hasShareRewardErr
}
func (m *mockMembershipRepo) CreateShareReward(ctx context.Context, reward *domain.MembershipShareReward) error {
	return m.createShareRewardErr
}

func TestMembershipService_ListPlans(t *testing.T) {
	mockRepo := &mockMembershipRepo{
		listActivePlans: []domain.MembershipPlan{
			{ID: "p1", Name: "Basic", PriceCents: 100, DurationDays: 30, Benefits: []string{"b1"}},
		},
	}
	svc := NewMembershipService(mockRepo)
	plans, err := svc.ListPlans(context.Background())
	assert.NoError(t, err)
	assert.Len(t, plans, 1)
	assert.Equal(t, "Basic", plans[0]["name"])
}

func TestMembershipService_GetMyMembership_NoMembership(t *testing.T) {
	mockRepo := &mockMembershipRepo{
		getActiveMembership:     nil,
		countAnalysisTasksToday: 3,
	}
	svc := NewMembershipService(mockRepo)
	data, err := svc.GetMyMembership(context.Background(), "u1")
	assert.NoError(t, err)
	assert.Equal(t, "none", data["status"])
	assert.Equal(t, int64(10), data["daily_limit"])
	assert.Equal(t, int64(3), data["used_today"])
	assert.Equal(t, int64(7), data["remaining_today"])
}

func TestMembershipService_GetMyMembership_WithProPlan(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	mockRepo := &mockMembershipRepo{
		getActiveMembership: &domain.UserMembership{
			ID: "um1", UserID: "u1", PlanID: "p1", Status: "active", ExpiresAt: &future,
		},
		getPlanByID: &domain.MembershipPlan{
			ID: "p1", Name: "Pro Plan",
		},
		countAnalysisTasksToday: 50,
	}
	svc := NewMembershipService(mockRepo)
	data, err := svc.GetMyMembership(context.Background(), "u1")
	assert.NoError(t, err)
	assert.Equal(t, "active", data["status"])
	assert.Equal(t, "Pro Plan", data["plan_name"])
	assert.Equal(t, int64(100), data["daily_limit"])
	assert.Equal(t, int64(50), data["used_today"])
	assert.Equal(t, int64(50), data["remaining_today"])
}

func TestMembershipService_CreatePayment_PlanNotFound(t *testing.T) {
	mockRepo := &mockMembershipRepo{getPlanByID: nil}
	svc := NewMembershipService(mockRepo)
	_, err := svc.CreatePayment(context.Background(), "u1", "p1")
	assert.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestMembershipService_CreatePayment_Success(t *testing.T) {
	mockRepo := &mockMembershipRepo{
		getPlanByID: &domain.MembershipPlan{ID: "p1", Name: "Basic", PriceCents: 100},
	}
	svc := NewMembershipService(mockRepo)
	data, err := svc.CreatePayment(context.Background(), "u1", "p1")
	assert.NoError(t, err)
	assert.NotEmpty(t, data["payment_id"])
	prepay := data["prepay_params"].(map[string]string)
	assert.NotEmpty(t, prepay["appId"])
}

func TestMembershipService_WechatNotify_MissingID(t *testing.T) {
	svc := NewMembershipService(&mockMembershipRepo{})
	err := svc.WechatNotify(context.Background(), "")
	assert.Error(t, err)
}

func TestMembershipService_WechatNotify_PaymentNotFound(t *testing.T) {
	mockRepo := &mockMembershipRepo{getPaymentByID: nil}
	svc := NewMembershipService(mockRepo)
	err := svc.WechatNotify(context.Background(), "pay1")
	assert.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestMembershipService_WechatNotify_AlreadyPaid(t *testing.T) {
	mockRepo := &mockMembershipRepo{
		getPaymentByID: &domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanID: "p1", Status: "paid"},
	}
	svc := NewMembershipService(mockRepo)
	err := svc.WechatNotify(context.Background(), "pay1")
	assert.NoError(t, err)
}

func TestMembershipService_WechatNotify_NewMembership(t *testing.T) {
	mockRepo := &mockMembershipRepo{
		getPaymentByID:      &domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanID: "p1", Status: "pending"},
		getActiveMembership: nil,
		getPlanByID:         &domain.MembershipPlan{ID: "p1", Name: "Basic", DurationDays: 30},
	}
	svc := NewMembershipService(mockRepo)
	err := svc.WechatNotify(context.Background(), "pay1")
	assert.NoError(t, err)
}

func TestMembershipService_WechatNotify_ExtendMembership(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	mockRepo := &mockMembershipRepo{
		getPaymentByID: &domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanID: "p1", Status: "pending"},
		getActiveMembership: &domain.UserMembership{
			ID: "um1", UserID: "u1", PlanID: "p1", Status: "active", ExpiresAt: &future,
		},
		getPlanByID: &domain.MembershipPlan{ID: "p1", Name: "Basic", DurationDays: 30},
	}
	svc := NewMembershipService(mockRepo)
	err := svc.WechatNotify(context.Background(), "pay1")
	assert.NoError(t, err)
}

func TestMembershipService_ClaimSharePosterReward_MissingRecordID(t *testing.T) {
	svc := NewMembershipService(&mockMembershipRepo{})
	_, err := svc.ClaimSharePosterReward(context.Background(), "u1", "")
	assert.Error(t, err)
}

func TestMembershipService_ClaimSharePosterReward_AlreadyClaimed(t *testing.T) {
	mockRepo := &mockMembershipRepo{hasShareReward: true}
	svc := NewMembershipService(mockRepo)
	_, err := svc.ClaimSharePosterReward(context.Background(), "u1", "r1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already claimed")
}

func TestMembershipService_ClaimSharePosterReward_Success(t *testing.T) {
	mockRepo := &mockMembershipRepo{hasShareReward: false}
	svc := NewMembershipService(mockRepo)
	data, err := svc.ClaimSharePosterReward(context.Background(), "u1", "r1")
	assert.NoError(t, err)
	assert.True(t, data["success"].(bool))
}

func TestMembershipService_ListPlans_Error(t *testing.T) {
	mockRepo := &mockMembershipRepo{listActivePlansErr: errors.New("db error")}
	svc := NewMembershipService(mockRepo)
	_, err := svc.ListPlans(context.Background())
	assert.Error(t, err)
}

func TestMembershipService_GetMyMembership_Error(t *testing.T) {
	mockRepo := &mockMembershipRepo{getActiveMembershipErr: errors.New("db error")}
	svc := NewMembershipService(mockRepo)
	_, err := svc.GetMyMembership(context.Background(), "u1")
	assert.Error(t, err)
}
