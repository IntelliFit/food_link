package service

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
)

type ProfileReviewChecker interface {
	QueueProfileReview(context.Context, string) error
	CheckProfileDocument(context.Context, string, int, map[string]any, *storage.Client) error
}

func (s *UserService) ConfigureProfileReview(checker ProfileReviewChecker) { s.profileReview = checker }

func hasProfileContentUpdate(updates map[string]any) bool {
	for _, field := range []string{"nickname", "avatar", "cover_image", "motto"} {
		if _, ok := updates[field]; ok {
			return true
		}
	}
	return false
}

func (s *UserService) profileImageForSave(field, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || s.storage == nil {
		return value, nil
	}
	if field == "avatar" && s.storage.IsSystemDefaultUserAvatar(value) {
		return "_system/default_avatar.jpg", nil
	}
	key := s.storage.ResolveObjectKey("user-avatars", value)
	if key == "" || strings.Contains(key, "..") {
		return "", &commonerrors.AppError{Code: 10002, Message: "图片地址无效，请重新选择图片后重试", HTTPStatus: 400}
	}
	return s.storage.BuildAccessURL("user-avatars", key), nil
}

// ReviewCurrentProfile runs after save. Each field receives its own verdict so a
// rejected signature cannot reset a valid nickname or photo.
func (s *UserService) ReviewCurrentProfile(ctx context.Context, userID string) error {
	if s.profileReview == nil {
		return nil
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		logger.Error(ctx, "后台审核读取用户资料失败", err, slog.String("user_id", userID))
		return contentsecurity.ErrUnavailable
	}
	if user == nil {
		return nil
	}
	sum := sha256.Sum256([]byte(userID))
	defaults := map[string]string{
		"nickname": fmt.Sprintf("食探用户_%06d", binary.BigEndian.Uint32(sum[:4])%1_000_000),
		"avatar":   "_system/default_avatar.jpg", "cover_image": "", "motto": "",
	}
	fields := []struct{ name, value string }{
		{"nickname", user.Nickname}, {"motto", user.Motto},
		{"avatar", user.Avatar}, {"cover_image", user.CoverImage},
	}
	var retry error
	for _, field := range fields {
		if ctx.Err() != nil {
			return contentsecurity.ErrUnavailable
		}
		if field.value == "" || field.value == defaults[field.name] {
			continue
		}
		if field.name == "avatar" && s.storage != nil && s.storage.IsSystemDefaultUserAvatar(field.value) {
			continue
		}
		err := s.profileReview.CheckProfileDocument(ctx, userID, 1, map[string]any{field.name: field.value}, s.storage)
		if err == nil {
			continue
		}
		if !errors.Is(err, contentsecurity.ErrRejected) {
			retry = err // Pending, transport/configuration failures never reset data.
			continue
		}
		changed, resetErr := s.users.ResetProfileFieldIfCurrent(ctx, userID, field.name, field.value, defaults[field.name])
		if resetErr != nil {
			logger.Error(ctx, "恢复违规用户资料默认值失败", resetErr, slog.String("user_id", userID), slog.String("field", field.name))
			retry = contentsecurity.ErrUnavailable
			continue
		}
		logger.Warn(ctx, "用户资料审核违规，已处理默认值恢复", slog.String("user_id", userID), slog.String("field", field.name), slog.Bool("restored", changed))
		if !changed {
			retry = contentsecurity.ErrPending
		}
	}
	return retry
}
