package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/logger"
)

func (s *ExerciseService) ConfigureContentSecurity(checker *contentsecurity.Service) {
	s.contentSecurity = checker
}

func (s *ExerciseService) startExerciseContentSecurity(ctx context.Context, userID, desc, imageURL, breakdown string, payload map[string]any) error {
	if s.contentSecurity == nil {
		return nil
	}
	doc := map[string]any{"exercise_desc": desc, "image_url": imageURL, "exercise_breakdown": breakdown}
	if err := s.contentSecurity.StartDocument(ctx, userID, 4, doc, s.storage); err != nil {
		s.logExerciseContentSecurityError(ctx, userID, err)
		return err
	}
	payload["content_security_input"] = doc
	logger.Info(ctx, "运动记录输入审核已启动", logger.UserID(userID), slog.Bool("has_image", imageURL != ""))
	return nil
}

func (s *ExerciseService) awaitExerciseContentSecurity(ctx context.Context, userID, desc, imageURL string, payload map[string]any) error {
	if s.contentSecurity == nil {
		return ctx.Err()
	}
	doc, ok := payload["content_security_input"].(map[string]any)
	if !ok {
		// Previously queued tasks have no persisted security document.
		details := mapFromAny(payload["precision_details"])
		doc = map[string]any{"exercise_desc": desc, "image_url": imageURL, "exercise_breakdown": details["breakdown"]}
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	for {
		if err := ctx.Err(); err != nil {
			return contentsecurity.ErrUnavailable
		}
		err := s.contentSecurity.CheckDocument(ctx, userID, 4, doc, s.storage)
		if err == nil {
			logger.Info(ctx, "运动记录输入审核通过", logger.UserID(userID))
			return nil
		}
		if !errors.Is(err, contentsecurity.ErrPending) {
			s.logExerciseContentSecurityError(ctx, userID, err)
			return err
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return contentsecurity.ErrUnavailable
		case <-timer.C:
		}
	}
}

func (s *ExerciseService) logExerciseContentSecurityError(ctx context.Context, userID string, err error) {
	if errors.Is(err, contentsecurity.ErrUnavailable) {
		logger.Error(ctx, "运动记录内容审核服务不可用", err, logger.UserID(userID))
		return
	}
	logger.Warn(ctx, "运动记录内容审核未通过", logger.UserID(userID), slog.String("reason", err.Error()))
}
