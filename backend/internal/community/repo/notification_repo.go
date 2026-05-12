package repo

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/community/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type NotificationRepo struct {
	db *gorm.DB
}

func NewNotificationRepo(db *gorm.DB) *NotificationRepo {
	return &NotificationRepo{db: db}
}

func (r *NotificationRepo) CreateNotification(ctx context.Context, n *domain.FeedInteractionNotification) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(n).Error
}

func (r *NotificationRepo) FindRecentDuplicate(ctx context.Context, recipientUserID, notificationType string, actorUserID, recordID, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error) {
	q := r.db.WithContext(ctx).
		Where("recipient_user_id = ? AND notification_type = ?", recipientUserID, notificationType).
		Order("created_at DESC").
		Limit(10)
	if actorUserID != nil {
		q = q.Where("actor_user_id = ?", *actorUserID)
	}
	if recordID != nil {
		q = q.Where("record_id = ?", *recordID)
	}

	var rows []domain.FeedInteractionNotification
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}

	normalizedPreview := strings.TrimSpace(strPtr(contentPreview))
	now := time.Now().UTC()
	for i := range rows {
		existing := &rows[i]
		if !ptrEqual(existing.ParentCommentID, parentCommentID) {
			continue
		}
		if strings.TrimSpace(strPtr(existing.ContentPreview)) != normalizedPreview {
			continue
		}
		existingCommentID := strPtr(existing.CommentID)
		currentCommentID := strPtr(commentID)
		if existing.CreatedAt == nil {
			continue
		}
		delta := now.Sub(*existing.CreatedAt).Seconds()
		if currentCommentID != "" && existingCommentID == currentCommentID && delta <= 3600 {
			return existing, nil
		}
		if delta <= 45 {
			return existing, nil
		}
	}
	return nil, nil
}

func (r *NotificationRepo) ListNotifications(ctx context.Context, userID string, limit int) ([]domain.FeedInteractionNotification, error) {
	var rows []domain.FeedInteractionNotification
	err := r.db.WithContext(ctx).
		Where("recipient_user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *NotificationRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.FeedInteractionNotification{}).
		Where("recipient_user_id = ? AND is_read = ?", userID, false).
		Count(&count).Error
	return count, err
}

func (r *NotificationRepo) MarkRead(ctx context.Context, userID string, notificationIDs []string) (int64, error) {
	q := r.db.WithContext(ctx).Model(&domain.FeedInteractionNotification{}).
		Where("recipient_user_id = ? AND is_read = ?", userID, false)
	if len(notificationIDs) > 0 {
		q = q.Where("id IN ?", notificationIDs)
	}
	result := q.Update("is_read", true)
	return result.RowsAffected, result.Error
}

func (r *NotificationRepo) ListCommentTasksByUser(ctx context.Context, userID, commentType string, limit int) ([]domain.CommentTask, error) {
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if commentType != "" {
		q = q.Where("comment_type = ?", commentType)
	}
	var rows []domain.CommentTask
	err := q.Order("created_at DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func strPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
