package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
)

const publicationWaitLimit = 8 * time.Second

// CheckPublication waits for the shared image ticket before permitting a write.
// The whole check is bounded to leave room within the client's 10-second timeout.
// Analysis workers keep using CheckDocument for their independent async lifecycle.
func (s *Service) CheckPublication(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	waitCtx, cancel := context.WithTimeout(ctx, publicationWaitLimit)
	defer cancel()
	started := time.Now()
	waiting := false
	for {
		err := s.CheckDocument(waitCtx, userID, scene, doc, store)
		if waitCtx.Err() != nil {
			logger.Warn(ctx, "发布内容审核等待结束，未执行写入", slog.String("user_id", userID), slog.Int("scene", scene), slog.Int64("wait_ms", time.Since(started).Milliseconds()))
			if !waiting && !errors.Is(err, ErrPending) {
				return ErrUnavailable
			}
			return ErrPending
		}
		if !errors.Is(err, ErrPending) {
			if err == nil && waiting {
				logger.Info(ctx, "发布图片审核通过，继续提交", slog.String("user_id", userID), slog.Int("scene", scene), slog.Int64("wait_ms", time.Since(started).Milliseconds()))
			}
			return err
		}
		if !waiting {
			logger.Info(ctx, "发布图片等待审核回调", slog.String("user_id", userID), slog.Int("scene", scene))
			waiting = true
		}
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-waitCtx.Done():
			timer.Stop()
			logger.Warn(ctx, "发布内容审核等待结束，未执行写入", slog.String("user_id", userID), slog.Int("scene", scene), slog.Int64("wait_ms", time.Since(started).Milliseconds()))
			return ErrPending
		case <-timer.C:
		}
	}
}
