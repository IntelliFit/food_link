package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"food_link/backend/internal/researchweight/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SavePhotoCheck records an uploaded photo's content hash. A repeated upload
// of the same object key keeps the first row.
func (r *SampleRepo) SavePhotoCheck(ctx context.Context, check *domain.PhotoCheck) error {
	if check.Readings == nil {
		check.Readings = []domain.ScaleReading{}
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(check).Error
}

// PhotoChecks returns the stored checks for the given object keys.
func (r *SampleRepo) PhotoChecks(ctx context.Context, keys []string) (map[string]domain.PhotoCheck, error) {
	result := map[string]domain.PhotoCheck{}
	if len(keys) == 0 {
		return result, nil
	}
	var rows []domain.PhotoCheck
	if err := r.db.WithContext(ctx).Where("object_key IN ?", keys).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ObjectKey] = row
	}
	return result, nil
}

// SaveReadings stores what the reading models saw for one photo, creating the
// check row for photos uploaded before hashes were recorded.
func (r *SampleRepo) SaveReadings(ctx context.Context, userID, key string, readings []domain.ScaleReading) error {
	raw, err := json.Marshal(readings)
	if err != nil {
		return fmt.Errorf("encode scale readings: %w", err)
	}
	now := time.Now()
	return r.db.WithContext(ctx).Exec(`INSERT INTO research_weight_photo_checks (object_key, user_id, content_sha256, readings, read_at, created_at, updated_at)
VALUES (?, ?, '', ?::jsonb, ?, ?, ?)
ON CONFLICT (object_key) DO UPDATE SET readings = EXCLUDED.readings, read_at = EXCLUDED.read_at, updated_at = EXCLUDED.updated_at`,
		key, userID, string(raw), now, now, now).Error
}

// CountReadsSince counts this user's photos read by the models since a time;
// it caps model spend per contributor.
func (r *SampleRepo) CountReadsSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.PhotoCheck{}).Where("user_id = ? AND read_at >= ?", userID, since).Count(&count).Error
	return count, err
}

// SameContentUploads returns other uploads (any user) whose bytes match one
// of the hashes, excluding the sample's own object keys.
func (r *SampleRepo) SameContentUploads(ctx context.Context, hashes, ownKeys []string) ([]domain.PhotoCheck, error) {
	if len(hashes) == 0 {
		return nil, nil
	}
	query := r.db.WithContext(ctx).Where("content_sha256 IN ? AND content_sha256 <> ''", hashes)
	if len(ownKeys) > 0 {
		query = query.Where("object_key NOT IN ?", ownKeys)
	}
	var rows []domain.PhotoCheck
	err := query.Order("created_at ASC").Limit(50).Find(&rows).Error
	return rows, err
}

// CountRewardedSince counts automatically or manually approved samples that
// earned credits in the window; it enforces the daily reward cap.
func (r *SampleRepo) CountRewardedSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.Sample{}).
		Where("user_id = ? AND status = ? AND reward_credits > 0 AND reviewed_at >= ?", userID, domain.StatusApproved, since).
		Count(&count).Error
	return count, err
}

// PendingForAutoReview lists pending samples submitted before the cutoff that
// no replica is reviewing and that have attempts left, oldest first.
func (r *SampleRepo) PendingForAutoReview(ctx context.Context, before time.Time, limit int) ([]domain.Sample, error) {
	var items []domain.Sample
	err := r.db.WithContext(ctx).
		Where("status = ? AND created_at <= ? AND (auto_review_lease_until IS NULL OR auto_review_lease_until < now()) AND auto_review_attempts < ?",
			domain.StatusPending, before, domain.MaxAutoReviewAttempts).
		Order("created_at ASC").Limit(limit).Find(&items).Error
	return items, err
}

// ClaimForAutoReview takes a lease on a pending sample so only one replica
// reviews it at a time. maxAttempts <= 0 ignores the attempt limit (an
// administrator re-running the review).
func (r *SampleRepo) ClaimForAutoReview(ctx context.Context, id string, lease time.Duration, maxAttempts int) (bool, error) {
	query := r.db.WithContext(ctx).Model(&domain.Sample{}).
		Where("id = ? AND status = ? AND (auto_review_lease_until IS NULL OR auto_review_lease_until < now())", id, domain.StatusPending)
	if maxAttempts > 0 {
		query = query.Where("auto_review_attempts < ?", maxAttempts)
	}
	result := query.Updates(map[string]any{
		"auto_review_lease_until": gorm.Expr("now() + ?::interval", fmt.Sprintf("%d seconds", int(lease.Seconds()))),
		"auto_review_attempts":    gorm.Expr("auto_review_attempts + 1"),
	})
	return result.RowsAffected > 0, result.Error
}

// UnpaidApproved lists approved samples whose credits were never paid (a
// failed award, a pod that died after approving), for the sweep to retry.
func (r *SampleRepo) UnpaidApproved(ctx context.Context, before time.Time, limit int) ([]domain.Sample, error) {
	var items []domain.Sample
	err := r.db.WithContext(ctx).
		Where("status = ? AND reward_credits > 0 AND rewarded_at IS NULL AND reviewed_at <= ?", domain.StatusApproved, before).
		Order("reviewed_at ASC").Limit(limit).Find(&items).Error
	return items, err
}

// autoReviewValue encodes the auto review record for a map update, which does
// not run the field serializer.
func autoReviewValue(updates map[string]any) error {
	review, ok := updates["auto_review"].(*domain.AutoReview)
	if !ok {
		return nil
	}
	raw, err := json.Marshal(review)
	if err != nil {
		return fmt.Errorf("encode auto review: %w", err)
	}
	updates["auto_review"] = gorm.Expr("?::jsonb", string(raw))
	return nil
}
