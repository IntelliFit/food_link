package service

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/pkg/logger"
)

const (
	newUserGrace         = 72 * time.Hour
	activeRecordWindow   = 14 * 24 * time.Hour
	activeRecordDays     = 7
	promptHistoryWindow  = 30 * 24 * time.Hour
	minPromptsForHistory = 3
	contributorUploads   = 3
)

// cohortOf decides how much a user may be asked. New users and occasional
// loggers are only asked for the dish; users who log most days and usually
// answer may get one extra question; those who already contribute dishes
// are contributors.
func cohortOf(signals repo.UserSignals, now time.Time) string {
	if signals.RegisteredAt == nil || now.Sub(*signals.RegisteredAt) < newUserGrace {
		return domain.CohortRegular
	}
	if signals.RecordDays < activeRecordDays {
		return domain.CohortRegular
	}
	// Someone who keeps skipping the dish question should not get more.
	if signals.Prompts >= minPromptsForHistory && signals.AnsweredPrompts*3 < signals.Prompts {
		return domain.CohortRegular
	}
	if signals.PublishedUploads >= contributorUploads || signals.Captures > 0 {
		return domain.CohortContributor
	}
	return domain.CohortActive
}

func (s *Service) cohortFor(ctx context.Context, userID string) string {
	now := s.now()
	signals, err := s.repo.UserSignals(ctx, userID, now.Add(-activeRecordWindow), now.Add(-promptHistoryWindow))
	if err != nil {
		logger.Warn(ctx, "读取用户分层信号失败，按普通用户处理", slog.String("user_id", userID), logger.Err(err))
		return domain.CohortRegular
	}
	return cohortOf(signals, now)
}
