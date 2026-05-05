package repo

import (
	"context"
	"time"

	"food_link/backend/internal/expiry/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
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
	err := q.Order("expiry_date asc, created_at desc").Find(&items).Error
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
	q := r.db.WithContext(ctx).Where("user_id = ? AND status = ? AND expiry_date <= ?", userID, "active", cutoff)
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("expiry_date asc").Find(&items).Error
	return items, err
}
