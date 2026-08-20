package repo

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/supplement/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SupplementRepo struct {
	db *gorm.DB
}

func NewSupplementRepo(db *gorm.DB) *SupplementRepo { return &SupplementRepo{db: db} }

func (r *SupplementRepo) ListCatalog(ctx context.Context, query string) ([]domain.SupplementCatalogItem, error) {
	var items []domain.SupplementCatalogItem
	q := r.db.WithContext(ctx).Where("status = ?", "active")
	if normalized := strings.ToLower(strings.TrimSpace(query)); normalized != "" {
		pattern := "%" + normalized + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(search_terms) LIKE ?", pattern, pattern, pattern)
	}
	err := q.Order("sort_order asc, name asc").Limit(100).Find(&items).Error
	return items, err
}

func (r *SupplementRepo) Create(ctx context.Context, item *domain.UserSupplement) error {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *SupplementRepo) List(ctx context.Context, userID, status string) ([]domain.UserSupplement, error) {
	var items []domain.UserSupplement
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if strings.TrimSpace(status) != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Order("schedule_time asc nulls last, created_at desc").Find(&items).Error
	return items, err
}

func (r *SupplementRepo) Get(ctx context.Context, userID, itemID string) (*domain.UserSupplement, error) {
	var item domain.UserSupplement
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", itemID, userID).First(&item).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &item, err
}

func (r *SupplementRepo) Update(ctx context.Context, userID, itemID string, updates map[string]any) (*domain.UserSupplement, error) {
	updates["updated_at"] = time.Now()
	res := r.db.WithContext(ctx).Model(&domain.UserSupplement{}).
		Where("id = ? AND user_id = ?", itemID, userID).
		Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, nil
	}
	return r.Get(ctx, userID, itemID)
}

func (r *SupplementRepo) CreateIntake(ctx context.Context, intake *domain.SupplementIntake) error {
	if intake.ID == "" {
		intake.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(intake).Error
}

func (r *SupplementRepo) FindIntakeByIdempotencyKey(ctx context.Context, userID, key string) (*domain.SupplementIntake, error) {
	if strings.TrimSpace(key) == "" {
		return nil, nil
	}
	var intake domain.SupplementIntake
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND idempotency_key = ?", userID, key).
		First(&intake).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &intake, err
}

func (r *SupplementRepo) ListIntakes(ctx context.Context, userID string, start, end time.Time) ([]domain.SupplementIntake, error) {
	var rows []domain.SupplementIntake
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND taken_at >= ? AND taken_at < ?", userID, start, end).
		Order("taken_at desc, created_at desc").
		Find(&rows).Error
	return rows, err
}

func (r *SupplementRepo) DeleteIntake(ctx context.Context, userID, intakeID string) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", intakeID, userID).
		Delete(&domain.SupplementIntake{})
	return res.RowsAffected > 0, res.Error
}
