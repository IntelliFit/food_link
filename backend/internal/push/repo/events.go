package repo

import (
	"context"
	"time"

	"food_link/backend/internal/push/domain"
	"gorm.io/gorm"
)

// Durable business rows are the source of truth. The planner can replay scans
// after a restart without losing an in-memory callback or duplicating a delivery.
func (r *Repository) eventQuery(ctx context.Context, userID, kind string, since, now time.Time) *gorm.DB {
	q := r.db.WithContext(ctx)
	switch kind {
	case domain.PrivateMessageEvent:
		return q.Table("private_messages AS e").
			Select("e.id, e.sender_id AS actor_id, e.created_at AS occurred_at").
			Where("e.receiver_id = ? AND e.sender_id <> ? AND e.sender_id <> ?", userID, userID, "00000000-0000-0000-0000-000000000000").
			Where("e.content_type IN ('text','image') AND NOT e.is_read AND e.deleted_at IS NULL").
			Where("e.created_at >= ? AND e.created_at > ? AND e.created_at <= ?", since, now.Add(-domain.EventLifetime), now).
			Where(`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
			 (b.blocker_user_id = e.sender_id AND b.blocked_user_id = e.receiver_id)
			 OR (b.blocker_user_id = e.receiver_id AND b.blocked_user_id = e.sender_id))`)
	case domain.AnalysisCompletedEvent:
		// updated_at also changes on ordinary edits, so it cannot define a
		// completion deadline. Bound this notification to 24h from submission.
		return q.Table("analysis_tasks AS e").Select("e.id, e.created_at AS occurred_at").
			Where("e.user_id = ? AND e.task_type IN ('food','food_text') AND e.status = 'done' AND NOT e.is_violated", userID).
			Where("e.created_at >= ? AND e.created_at > ? AND e.created_at <= ?", since, now.Add(-domain.EventLifetime), now).
			Where("e.result IS NOT NULL AND e.result <> 'null'::jsonb").
			Where("COALESCE(e.result->>'userActionRequired', 'false') <> 'true' AND COALESCE(e.result->>'user_action_required', 'false') <> 'true'").
			Where("COALESCE(e.result->>'precisionStatus', '') NOT IN ('needs_user_input', 'needs_retake') AND COALESCE(e.result->>'precision_status', '') NOT IN ('needs_user_input', 'needs_retake')")
	}
	return nil
}

func EventKey(userID, deviceID, kind, resourceID string) string {
	return userID + ":" + deviceID + ":" + kind + ":" + resourceID
}

func (r *Repository) PendingEvents(ctx context.Context, userID, deviceID, kind string, since, now time.Time) ([]domain.Event, error) {
	if since.IsZero() {
		return nil, nil
	}
	q := r.eventQuery(ctx, userID, kind, since, now)
	if q == nil {
		return nil, nil
	}
	var rows []domain.Event
	err := q.Where("NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.dedupe_key = ? || e.id::text)", EventKey(userID, deviceID, kind, "")).
		Order("occurred_at ASC, e.id ASC").Limit(50).Scan(&rows).Error
	return rows, err
}

func (r *Repository) EligibleEvent(ctx context.Context, userID, kind, id string, since, now time.Time) (*domain.Event, error) {
	if since.IsZero() {
		return nil, nil
	}
	q := r.eventQuery(ctx, userID, kind, since, now)
	if q == nil {
		return nil, nil
	}
	var rows []domain.Event
	if err := q.Where("e.id = ?", id).Limit(1).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}
