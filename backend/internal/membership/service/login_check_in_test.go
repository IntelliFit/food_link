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

func TestWeeklyCheckInReward(t *testing.T) {
	for _, all := range []bool{true, false} {
		repo := &mockMembershipRepo{user: &membershiprepo.User{ID: "u1", EarnedCreditsBalance: 10}, ledgerByReasonSource: map[string]*domain.UserEarnedCreditLedger{}}
		first, _ := time.ParseInLocation("2006-01-02", "2026-09-14", chinaLocation())
		for i := 0; i < 7; i++ {
			if !all && i == 2 {
				continue
			}
			date := first.AddDate(0, 0, i).Format("2006-01-02")
			repo.ledgerByReasonSource[loginCheckInRewardReason+"|"+loginCheckInSourcePrefix+date] = &domain.UserEarnedCreditLedger{UserID: "u1", Delta: 1}
		}
		svc := NewMembershipService(repo)
		result, err := svc.ClaimWeeklyCheckInReward(context.Background(), "u1", "2026-09-14")
		if !all {
			require.Error(t, err)
			assert.Equal(t, 10, repo.user.EarnedCreditsBalance)
			continue
		}
		require.NoError(t, err)
		assert.Equal(t, true, result["applied"])
		assert.Equal(t, 17, repo.user.EarnedCreditsBalance)
		again, err := svc.ClaimWeeklyCheckInReward(context.Background(), "u1", "2026-09-14")
		require.NoError(t, err)
		assert.Equal(t, false, again["applied"])
		assert.Equal(t, 17, repo.user.EarnedCreditsBalance)
		_, err = svc.ClaimWeeklyCheckInReward(context.Background(), "u1", "2026-09-15")
		require.Error(t, err)
		_, err = svc.ClaimWeeklyCheckInReward(context.Background(), "u1", "2099-01-05")
		require.Error(t, err)
	}
}
