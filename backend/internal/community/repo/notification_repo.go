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

type NotificationCounts struct {
	LikeCount    int64
	CommentCount int64
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
	return r.FindRecentDuplicateForTarget(ctx, recipientUserID, notificationType, actorUserID, FeedTargetFoodRecord, recordID, parentCommentID, commentID, contentPreview)
}

func (r *NotificationRepo) FindRecentDuplicateForTarget(ctx context.Context, recipientUserID, notificationType string, actorUserID *string, targetType string, targetID *string, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error) {
	q := r.db.WithContext(ctx).
		Where("recipient_user_id = ? AND notification_type = ?", recipientUserID, notificationType).
		Order("created_at DESC").
		Limit(10)
	if actorUserID != nil {
		q = q.Where("actor_user_id = ?", *actorUserID)
	}
	if targetID != nil {
		targetType = NormalizeTargetType(targetType)
		if targetType == FeedTargetFoodRecord {
			q = q.Where("(target_type = ? AND target_id = ?) OR record_id = ?", targetType, *targetID, *targetID)
		} else {
			q = q.Where("target_type = ? AND target_id = ?", targetType, *targetID)
		}
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

func (r *NotificationRepo) ListNotifications(ctx context.Context, userID, notificationType string, limit, offset int) ([]domain.FeedInteractionNotification, error) {
	var rows []domain.FeedInteractionNotification
	q := r.visibleNotificationsQuery(ctx, userID)
	if notificationType == "comment" {
		q = q.Where("notification_type IN ?", []string{"comment_received", "reply_received", "comment_rejected"})
	} else if notificationType != "" {
		q = q.Where("notification_type = ?", notificationType)
	}
	err := q.Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&rows).Error
	return rows, err
}

func (r *NotificationRepo) CountNotifications(ctx context.Context, userID string) (NotificationCounts, error) {
	var counts NotificationCounts
	err := r.visibleNotificationsQuery(ctx, userID).
		Select(`
			COALESCE(SUM(CASE WHEN notification_type = 'like_received' THEN 1 ELSE 0 END), 0) AS like_count,
			COALESCE(SUM(CASE WHEN notification_type IN ('comment_received', 'reply_received', 'comment_rejected') THEN 1 ELSE 0 END), 0) AS comment_count
		`).
		Scan(&counts).Error
	return counts, err
}

func (r *NotificationRepo) visibleNotificationsQuery(ctx context.Context, userID string) *gorm.DB {
	return r.db.WithContext(ctx).
		Model(&domain.FeedInteractionNotification{}).
		Where("recipient_user_id = ?", userID).
		Where("(actor_user_id IS NULL OR actor_user_id != recipient_user_id)").
		Where(`NOT EXISTS (
			SELECT 1 FROM user_blocks ub
			WHERE actor_user_id IS NOT NULL
			  AND (
				(ub.blocker_user_id = ? AND ub.blocked_user_id = actor_user_id)
				OR (ub.blocker_user_id = actor_user_id AND ub.blocked_user_id = ?)
			  )
		)`, userID, userID)
}

func (r *NotificationRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.FeedInteractionNotification{}).
		Where("recipient_user_id = ? AND is_read = ?", userID, false).
		Where(`NOT EXISTS (
			SELECT 1 FROM user_blocks ub
			WHERE actor_user_id IS NOT NULL
			  AND (
				(ub.blocker_user_id = ? AND ub.blocked_user_id = actor_user_id)
				OR (ub.blocker_user_id = actor_user_id AND ub.blocked_user_id = ?)
			  )
		)`, userID, userID).
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
