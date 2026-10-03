package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/repo"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
)

type ownCommentRepository interface {
	ListOwnComments(context.Context, string, int, *repo.CommentHistoryCursor) ([]domain.FeedComment, error)
}

type OwnCommentItem struct {
	ID              string     `json:"id"`
	Content         string     `json:"content"`
	CreatedAt       *time.Time `json:"created_at"`
	ParentCommentID *string    `json:"parent_comment_id,omitempty"`
	TargetType      string     `json:"target_type"`
	TargetID        string     `json:"target_id"`
	TargetAvailable bool       `json:"target_available"`
	TargetPreview   string     `json:"target_preview,omitempty"`
}

type OwnCommentPage struct {
	List       []OwnCommentItem `json:"list"`
	HasMore    bool             `json:"has_more"`
	NextCursor string           `json:"next_cursor,omitempty"`
}

func (s *CommunityService) ListOwnComments(ctx context.Context, userID, cursor string, limit int) (*OwnCommentPage, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	limit = normalizeCommunityListLimit(limit, 20)
	var before *repo.CommentHistoryCursor
	if cursor != "" {
		if len(cursor) > 512 {
			return nil, commonerrors.ErrBadRequest
		}
		data, err := base64.RawURLEncoding.DecodeString(cursor)
		before = &repo.CommentHistoryCursor{}
		if err != nil || json.Unmarshal(data, before) != nil || before.At.IsZero() {
			return nil, commonerrors.ErrBadRequest
		}
		if _, err := uuid.Parse(before.ID); err != nil {
			return nil, commonerrors.ErrBadRequest
		}
	}
	r, ok := s.feedRepo.(ownCommentRepository)
	if !ok {
		return nil, commonerrors.ErrInternal
	}
	rows, err := r.ListOwnComments(ctx, userID, limit+1, before)
	if err != nil {
		logger.Error(ctx, "查询本人评论历史失败", err, slog.String("user_id", userID))
		return nil, err
	}
	out := &OwnCommentPage{List: []OwnCommentItem{}, HasMore: len(rows) > limit}
	if out.HasMore {
		rows = rows[:limit]
	}
	contexts := map[string]OwnCommentItem{}
	for _, comment := range rows {
		item := OwnCommentItem{ID: comment.ID, Content: comment.Content, CreatedAt: comment.CreatedAt,
			ParentCommentID: comment.ParentCommentID, TargetType: commentTargetType(comment), TargetID: commentTargetID(comment)}
		key := item.TargetType + ":" + item.TargetID
		if cached, found := contexts[key]; found {
			item.TargetAvailable, item.TargetPreview = cached.TargetAvailable, cached.TargetPreview
			out.List = append(out.List, item)
			continue
		}
		target, err := s.feedRepo.GetFeedTargetByID(ctx, item.TargetType, item.TargetID)
		if err != nil {
			logger.Error(ctx, "查询评论原动态失败", err, slog.String("user_id", userID), slog.String("comment_id", comment.ID))
			return nil, err
		}
		access, err := s.getFeedRecordInteractionContext(ctx, userID, target)
		if err != nil {
			logger.Error(ctx, "检查评论原动态权限失败", err, slog.String("user_id", userID), slog.String("comment_id", comment.ID))
			return nil, err
		}
		item.TargetAvailable = access.Allowed
		if access.Allowed {
			var description string
			if target.Description != nil {
				description = *target.Description
			}
			preview := []rune(strings.TrimSpace(description))
			if len(preview) > 120 {
				preview = preview[:120]
			}
			item.TargetPreview = string(preview)
		}
		contexts[key] = item
		out.List = append(out.List, item)
	}
	if out.HasMore && len(rows) > 0 && rows[len(rows)-1].CreatedAt != nil {
		last := rows[len(rows)-1]
		data, err := json.Marshal(repo.CommentHistoryCursor{At: *last.CreatedAt, ID: last.ID})
		if err != nil {
			return nil, err
		}
		out.NextCursor = base64.RawURLEncoding.EncodeToString(data)
	}
	logger.Info(ctx, "本人评论历史查询完成", slog.String("user_id", userID), slog.Int("comment_count", len(out.List)), slog.Bool("has_more", out.HasMore))
	return out, nil
}
