package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoginCheckInRewardAmount(t *testing.T) {
	tests := []struct {
		streak int
		want   int
	}{
		{streak: 1, want: 1},
		{streak: 2, want: 1},
		{streak: 3, want: 2},
		{streak: 6, want: 2},
		{streak: 7, want: 3},
		{streak: 29, want: 3},
		{streak: 30, want: 4},
		{streak: 60, want: 4},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, loginCheckInRewardAmount(tt.streak), "streak=%d", tt.streak)
	}
}

func TestMembershipService_GetLoginCheckInStatusContinuesYesterday(t *testing.T) {
	yesterday := time.Now().In(chinaLocation()).AddDate(0, 0, -1).Format("2006-01-02")
	repo := &mockMembershipRepo{ledgerByReasonSource: map[string]*domain.UserEarnedCreditLedger{
		loginCheckInRewardReason + "|" + loginCheckInSourcePrefix + yesterday: {
			UserID: "u1",
			Delta:  1,
			Meta:   map[string]any{"streak_days": 2},
		},
	}}

	status, err := NewMembershipService(repo).GetLoginCheckInStatus(context.Background(), "u1")
	require.NoError(t, err)
	assert.False(t, status.ClaimedToday)
	assert.Equal(t, 3, status.StreakDays)
	assert.Equal(t, 2, status.RewardAmount)
}

func TestMembershipService_GetLoginCheckInStatusResetsAfterBreak(t *testing.T) {
	repo := &mockMembershipRepo{ledgerByReasonSource: map[string]*domain.UserEarnedCreditLedger{}}

	status, err := NewMembershipService(repo).GetLoginCheckInStatus(context.Background(), "u1")
	require.NoError(t, err)
	assert.False(t, status.ClaimedToday)
	assert.Equal(t, 1, status.StreakDays)
	assert.Equal(t, 1, status.RewardAmount)
}

func TestMembershipService_ClaimLoginCheckInIsIdempotent(t *testing.T) {
	repo := &mockMembershipRepo{
		user:                 &membershiprepo.User{ID: "u1", EarnedCreditsBalance: 10},
		ledgerByReasonSource: map[string]*domain.UserEarnedCreditLedger{},
	}
	svc := NewMembershipService(repo)

	first, err := svc.ClaimLoginCheckIn(context.Background(), "u1")
	require.NoError(t, err)
	assert.Equal(t, true, first["applied"])
	assert.Equal(t, 1, first["reward_amount"])
	assert.Equal(t, 11, first["earned_credits_balance"])

	second, err := svc.ClaimLoginCheckIn(context.Background(), "u1")
	require.NoError(t, err)
	assert.Equal(t, false, second["applied"])
	assert.Equal(t, 11, second["earned_credits_balance"])
	assert.Equal(t, 11, repo.user.EarnedCreditsBalance)
}
