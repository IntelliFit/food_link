package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/migration/do"
	"food_link/backend/internal/researchweight/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SampleRepo struct{ db *gorm.DB }

func NewSampleRepo(db *gorm.DB) *SampleRepo { return &SampleRepo{db: db} }

// ErrNotPending means the sample was already reviewed by someone else.
var ErrNotPending = &commonerrors.AppError{Code: 10002, Message: "该样本已审核，请刷新", HTTPStatus: 409}

// Create inserts the sample, or returns the existing row when the same user
// resubmits the same client key (a retried upload).
func (r *SampleRepo) Create(ctx context.Context, sample *domain.Sample) (*domain.Sample, bool, error) {
	if strings.TrimSpace(sample.ID) == "" {
		sample.ID = uuid.NewString()
	}
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "client_key"}},
		DoNothing: true,
	}).Create(sample)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return sample, true, nil
	}
	var existing domain.Sample
	err := r.db.WithContext(ctx).Where("user_id = ? AND client_key = ?", sample.UserID, sample.ClientKey).First(&existing).Error
	return &existing, false, err
}

func (r *SampleRepo) FindByClientKey(ctx context.Context, userID, clientKey string) (*domain.Sample, error) {
	var item domain.Sample
	err := r.db.WithContext(ctx).Where("user_id = ? AND client_key = ?", userID, clientKey).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

// UsedPhotoKeys returns which of keys already appear in this user's samples.
func (r *SampleRepo) UsedPhotoKeys(ctx context.Context, userID string, keys []string) ([]string, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	var used []string
	err := r.db.WithContext(ctx).Raw(`SELECT DISTINCT photo->>'object_key'
FROM research_weight_samples, jsonb_array_elements(photos) AS photo
WHERE user_id = ? AND photo->>'object_key' IN ?`, userID, keys).Scan(&used).Error
	return used, err
}

func (r *SampleRepo) CountSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.Sample{}).Where("user_id = ? AND created_at >= ?", userID, since).Count(&count).Error
	return count, err
}

func (r *SampleRepo) Mine(ctx context.Context, userID string, limit int) ([]domain.Sample, error) {
	var items []domain.Sample
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Limit(limit).Find(&items).Error
	return items, err
}

func (r *SampleRepo) MineSummary(ctx context.Context, userID string) (domain.MineSummary, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	err := r.db.WithContext(ctx).Model(&domain.Sample{}).Select("status, COUNT(*) AS count").
		Where("user_id = ?", userID).Group("status").Scan(&rows).Error
	summary := domain.MineSummary{}
	for _, row := range rows {
		summary.Total += row.Count
		switch row.Status {
		case domain.StatusPending:
			summary.Pending = row.Count
		case domain.StatusApproved:
			summary.Approved = row.Count
		case domain.StatusRejected:
			summary.Rejected = row.Count
		}
	}
	return summary, err
}

func (r *SampleRepo) Get(ctx context.Context, id string) (*domain.Sample, error) {
	if _, err := uuid.Parse(strings.TrimSpace(id)); err != nil {
		return nil, commonerrors.ErrNotFound
	}
	var item domain.Sample
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, commonerrors.ErrNotFound
	}
	return &item, err
}

func (r *SampleRepo) List(ctx context.Context, filter domain.ListFilter) (*domain.ListResult, error) {
	query := r.db.WithContext(ctx).Model(&domain.Sample{})
	if status := strings.TrimSpace(filter.Status); status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if mode := strings.TrimSpace(filter.WeighingMode); mode != "" {
		query = query.Where("weighing_mode = ?", mode)
	}
	if scene := strings.TrimSpace(filter.Scene); scene != "" {
		query = query.Where("scene = ?", scene)
	}
	if keyword := strings.TrimSpace(filter.Query); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("dish_name ILIKE ? OR venue_name ILIKE ? OR notes ILIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var items []domain.Sample
	err := query.Order("CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC").
		Limit(filter.Limit).Offset(filter.Offset).Find(&items).Error
	return &domain.ListResult{Items: items, Total: total}, err
}

// Review moves a pending sample to approved or rejected exactly once.
func (r *SampleRepo) Review(ctx context.Context, id string, updates map[string]any) (*domain.Sample, error) {
	updates["updated_at"] = time.Now()
	if err := autoReviewValue(updates); err != nil {
		return nil, err
	}
	result := r.db.WithContext(ctx).Model(&domain.Sample{}).
		Where("id = ? AND status = ?", id, domain.StatusPending).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		if _, err := r.Get(ctx, id); err != nil {
			return nil, err
		}
		return nil, ErrNotPending
	}
	return r.Get(ctx, id)
}

func (r *SampleRepo) MarkRewarded(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&domain.Sample{}).
		Where("id = ? AND rewarded_at IS NULL", id).Updates(map[string]any{"rewarded_at": time.Now(), "updated_at": time.Now()}).Error
}

// ErrNotPromotable means the sample is not approved or is already in the
// benchmark dataset.
var ErrNotPromotable = &commonerrors.AppError{Code: 10002, Message: "该样本已加入评测集或未通过审核", HTTPStatus: 409}

// Promote copies an approved sample into food_weight_labeled_samples and links
// it, in one transaction holding the sample row lock.
func (r *SampleRepo) Promote(ctx context.Context, id string, build func(*domain.Sample) *do.FoodWeightLabeledSampleDO) (*domain.Sample, error) {
	if _, err := uuid.Parse(strings.TrimSpace(id)); err != nil {
		return nil, commonerrors.ErrNotFound
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var sample domain.Sample
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&sample).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return commonerrors.ErrNotFound
		}
		if err != nil {
			return err
		}
		if sample.Status != domain.StatusApproved || sample.BenchmarkSampleID != nil {
			return ErrNotPromotable
		}
		labeled := build(&sample)
		if err := tx.Create(labeled).Error; err != nil {
			return err
		}
		return tx.Model(&domain.Sample{}).Where("id = ?", id).
			Updates(map[string]any{"benchmark_sample_id": labeled.ID, "updated_at": time.Now()}).Error
	})
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

// ListContainers returns the user's active saved containers, newest first.
func (r *SampleRepo) ListContainers(ctx context.Context, userID string) ([]domain.Container, error) {
	var containers []domain.Container
	err := r.db.WithContext(ctx).Where("user_id = ? AND status = ?", userID, domain.ContainerActive).
		Order("created_at DESC").Find(&containers).Error
	return containers, err
}

func (r *SampleRepo) CreateContainer(ctx context.Context, container *domain.Container) error {
	if strings.TrimSpace(container.ID) == "" {
		container.ID = uuid.NewString()
	}
	return r.db.WithContext(ctx).Create(container).Error
}

// ArchiveContainer only touches the user's own active container.
func (r *SampleRepo) ArchiveContainer(ctx context.Context, userID, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return commonerrors.ErrNotFound
	}
	result := r.db.WithContext(ctx).Model(&domain.Container{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, domain.ContainerActive).
		Updates(map[string]any{"status": domain.ContainerArchived, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	return nil
}
