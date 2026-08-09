package service

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/pkg/logger"
)

const (
	loginCheckInRewardReason = "login_streak_reward"
	loginCheckInSourcePrefix = "login_streak:"
)

type LoginCheckInStatus struct {
	ClaimedToday bool   `json:"claimed_today"`
	StreakDays   int    `json:"streak_days"`
	RewardAmount int    `json:"reward_amount"`
	Today        string `json:"today"`
}

func (s *MembershipService) GetLoginCheckInStatus(ctx context.Context, userID string) (LoginCheckInStatus, error) {
	todayTime := time.Now().In(chinaLocation())
	today := todayTime.Format("2006-01-02")
	current, err := s.repo.GetEarnedCreditLedgerBySource(ctx, userID, loginCheckInRewardReason, loginCheckInSourcePrefix+today)
	if err != nil {
		return LoginCheckInStatus{}, err
	}
	if current != nil {
		streakDays := maxInt(intFromAny(current.Meta["streak_days"]), 1)
		return LoginCheckInStatus{ClaimedToday: true, StreakDays: streakDays, RewardAmount: current.Delta, Today: today}, nil
	}

	yesterday := todayTime.AddDate(0, 0, -1).Format("2006-01-02")
	previous, err := s.repo.GetEarnedCreditLedgerBySource(ctx, userID, loginCheckInRewardReason, loginCheckInSourcePrefix+yesterday)
	if err != nil {
		return LoginCheckInStatus{}, err
	}
	streakDays := 1
	if previous != nil {
		streakDays = maxInt(intFromAny(previous.Meta["streak_days"]), 1) + 1
	}
	return LoginCheckInStatus{ClaimedToday: false, StreakDays: streakDays, RewardAmount: loginCheckInRewardAmount(streakDays), Today: today}, nil
}

func (s *MembershipService) ClaimLoginCheckIn(ctx context.Context, userID string) (map[string]any, error) {
	status, err := s.GetLoginCheckInStatus(ctx, userID)
	if err != nil {
		return nil, err
	}
	if status.ClaimedToday {
		current, err := s.repo.GetEarnedCreditLedgerBySource(ctx, userID, loginCheckInRewardReason, loginCheckInSourcePrefix+status.Today)
		if err != nil {
			return nil, err
		}
		balance := 0
		if current != nil {
			balance = current.BalanceAfter
		}
		return loginCheckInResult(status, balance, false), nil
	}

	entry, applied, err := s.repo.ChangeEarnedCredits(ctx, userID, status.RewardAmount, loginCheckInRewardReason, loginCheckInSourcePrefix+status.Today, status.Today, map[string]any{
		"streak_days":   status.StreakDays,
		"reward_amount": status.RewardAmount,
		"reward_date":   status.Today,
	})
	if err != nil {
		logger.Error(ctx, "每日签到积分发放失败", err,
			slog.String("user_id", userID),
			slog.String("reward_date", status.Today),
			slog.Int("streak_days", status.StreakDays),
		)
		return nil, err
	}
	if entry == nil {
		entry, err = s.repo.GetEarnedCreditLedgerBySource(ctx, userID, loginCheckInRewardReason, loginCheckInSourcePrefix+status.Today)
		if err != nil {
			return nil, err
		}
	}
	balance := 0
	if entry != nil {
		balance = entry.BalanceAfter
		status.RewardAmount = entry.Delta
		status.StreakDays = maxInt(intFromAny(entry.Meta["streak_days"]), status.StreakDays)
	}
	status.ClaimedToday = true
	logger.Info(ctx, "每日签到积分发放完成",
		slog.String("user_id", userID),
		slog.String("reward_date", status.Today),
		slog.Int("streak_days", status.StreakDays),
		slog.Int("reward_amount", status.RewardAmount),
		slog.Bool("applied", applied),
	)
	return loginCheckInResult(status, balance, applied), nil
}

func loginCheckInRewardAmount(streakDays int) int {
	switch {
	case streakDays >= 30:
		return 4
	case streakDays >= 7:
		return 3
	case streakDays >= 3:
		return 2
	default:
		return 1
	}
}

func loginCheckInResult(status LoginCheckInStatus, balance int, applied bool) map[string]any {
	return map[string]any{
		"claimed_today":          status.ClaimedToday,
		"streak_days":            status.StreakDays,
		"reward_amount":          status.RewardAmount,
		"today":                  status.Today,
		"applied":                applied,
		"earned_credits_balance": balance,
	}
}
