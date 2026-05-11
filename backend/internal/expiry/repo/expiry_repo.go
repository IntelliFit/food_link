package repo

import (
	"context"
	"time"

	"food_link/backend/internal/expiry/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ExpiryRepo struct {
	db *gorm.DB
}

func NewExpiryRepo(db *gorm.DB) *ExpiryRepo {
	return &ExpiryRepo{db: db}
}

func (r *ExpiryRepo) Create(ctx context.Context, item *domain.ExpiryItem) error {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *ExpiryRepo) ListByUser(ctx context.Context, userID, status string, limit int) ([]domain.ExpiryItem, error) {
	var items []domain.ExpiryItem
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("expire_date asc, created_at desc").Find(&items).Error
	return items, err
}

func (r *ExpiryRepo) GetByID(ctx context.Context, itemID string) (*domain.ExpiryItem, error) {
	var item domain.ExpiryItem
	if err := r.db.WithContext(ctx).Where("id = ?", itemID).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *ExpiryRepo) Update(ctx context.Context, userID, itemID string, updates map[string]any) (*domain.ExpiryItem, error) {
	result := r.db.WithContext(ctx).Model(&domain.ExpiryItem{}).Where("id = ? AND user_id = ?", itemID, userID).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetByID(ctx, itemID)
}

func (r *ExpiryRepo) CountByStatus(ctx context.Context, userID string) (map[string]int, error) {
	var rows []struct {
		Status string
		Count  int
	}
	if err := r.db.WithContext(ctx).Model(&domain.ExpiryItem{}).
		Select("status, COUNT(*) as count").
		Where("user_id = ?", userID).
		Group("status").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int)
	for _, r := range rows {
		out[r.Status] = r.Count
	}
	return out, nil
}

func (r *ExpiryRepo) ListExpiringSoon(ctx context.Context, userID string, days int, limit int) ([]domain.ExpiryItem, error) {
	var items []domain.ExpiryItem
	cutoff := time.Now().AddDate(0, 0, days)
	q := r.db.WithContext(ctx).Where("user_id = ? AND status = ? AND expire_date <= ?", userID, "active", cutoff)
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("expire_date asc").Find(&items).Error
	return items, err
}

func (r *ExpiryRepo) ListNotificationJobsByItem(ctx context.Context, itemID string) ([]domain.ExpiryNotificationJob, error) {
	var jobs []domain.ExpiryNotificationJob
	err := r.db.WithContext(ctx).
		Where("expiry_item_id = ?", itemID).
		Order("created_at DESC").
		Find(&jobs).Error
	return jobs, err
}

func (r *ExpiryRepo) UpsertNotificationJob(ctx context.Context, job *domain.ExpiryNotificationJob) (*domain.ExpiryNotificationJob, error) {
	var existing domain.ExpiryNotificationJob
	err := r.db.WithContext(ctx).
		Where("expiry_item_id = ? AND template_id = ? AND status <> ?", job.ExpiryItemID, job.TemplateID, "sent").
		Order("created_at DESC").
		First(&existing).Error
	now := time.Now()
	updates := map[string]any{
		"user_id":          job.UserID,
		"expiry_item_id":   job.ExpiryItemID,
		"template_id":      job.TemplateID,
		"openid":           job.OpenID,
		"status":           "pending",
		"scheduled_at":     job.ScheduledAt,
		"sent_at":          nil,
		"last_error":       nil,
		"retry_count":      0,
		"max_retry_count":  job.MaxRetryCount,
		"payload_snapshot": job.PayloadSnapshot,
		"updated_at":       now,
	}
	if err == nil {
		if err := r.db.WithContext(ctx).Model(&domain.ExpiryNotificationJob{}).
			Where("id = ?", existing.ID).
			Updates(updates).Error; err != nil {
			return nil, err
		}
		return r.GetNotificationJobByID(ctx, existing.ID)
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	if job.ID == "" {
		job.ID = uuid.New().String()
	}
	job.Status = "pending"
	job.SentAt = nil
	job.LastError = nil
	job.RetryCount = 0
	if job.MaxRetryCount <= 0 {
		job.MaxRetryCount = 3
	}
	job.CreatedAt = now
	job.UpdatedAt = now
	if err := r.db.WithContext(ctx).Create(job).Error; err != nil {
		return nil, err
	}
	return job, nil
}

func (r *ExpiryRepo) GetNotificationJobByID(ctx context.Context, jobID string) (*domain.ExpiryNotificationJob, error) {
	var job domain.ExpiryNotificationJob
	err := r.db.WithContext(ctx).Where("id = ?", jobID).First(&job).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &job, err
}

func (r *ExpiryRepo) CancelNotificationJobsByItem(ctx context.Context, itemID string) (int64, error) {
	res := r.db.WithContext(ctx).Model(&domain.ExpiryNotificationJob{}).
		Where("expiry_item_id = ? AND status IN ?", itemID, []string{"pending", "processing", "failed"}).
		Updates(map[string]any{"status": "cancelled", "last_error": nil, "updated_at": time.Now()})
	return res.RowsAffected, res.Error
}

func (r *ExpiryRepo) ClaimNextPendingNotificationJob(ctx context.Context) (*domain.ExpiryNotificationJob, error) {
	var claimed *domain.ExpiryNotificationJob
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var job domain.ExpiryNotificationJob
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND scheduled_at <= ?", "pending", time.Now()).
			Order("scheduled_at ASC, created_at ASC").
			Limit(1).
			First(&job).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		res := tx.Model(&domain.ExpiryNotificationJob{}).
			Where("id = ? AND status = ?", job.ID, "pending").
			Updates(map[string]any{
				"status":     "processing",
				"last_error": nil,
				"updated_at": time.Now(),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return nil
		}
		job.Status = "processing"
		job.LastError = nil
		claimed = &job
		return nil
	})
	return claimed, err
}

func (r *ExpiryRepo) RecoverStaleNotificationJobs(ctx context.Context, staleAfter time.Duration) (int64, error) {
	if staleAfter <= 0 {
		staleAfter = 10 * time.Minute
	}
	now := time.Now()
	res := r.db.WithContext(ctx).Model(&domain.ExpiryNotificationJob{}).
		Where("status = ? AND updated_at < ?", "processing", now.Add(-staleAfter)).
		Updates(map[string]any{
			"status":       "pending",
			"scheduled_at": now,
			"last_error":   "recovered stale processing notification job",
			"updated_at":   now,
		})
	return res.RowsAffected, res.Error
}

func (r *ExpiryRepo) UpdateNotificationJob(ctx context.Context, jobID string, updates map[string]any) (*domain.ExpiryNotificationJob, error) {
	if len(updates) == 0 {
		return r.GetNotificationJobByID(ctx, jobID)
	}
	updates["updated_at"] = time.Now()
	if err := r.db.WithContext(ctx).Model(&domain.ExpiryNotificationJob{}).Where("id = ?", jobID).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.GetNotificationJobByID(ctx, jobID)
}
