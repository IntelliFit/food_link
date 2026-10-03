package repo

import (
	"context"
	"time"

	"food_link/backend/internal/community/domain"
)

type CommentHistoryCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func (r *FeedRepo) ListOwnComments(ctx context.Context, userID string, limit int, before *CommentHistoryCursor) ([]domain.FeedComment, error) {
	rows := []domain.FeedComment{}
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if before != nil {
		q = q.Where("created_at < ? OR (created_at = ? AND id < ?)", before.At, before.At, before.ID)
	}
	err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}
