package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"food_link/backend/internal/voucher/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type VoucherRepo struct {
	db *gorm.DB
}

func NewVoucherRepo(db *gorm.DB) *VoucherRepo {
	return &VoucherRepo{db: db}
}

func (r *VoucherRepo) CreateVoucher(ctx context.Context, voucher *domain.UserVoucher) (*domain.UserVoucher, error) {
	if voucher.ID == "" {
		voucher.ID = uuid.New().String()
	}
	now := time.Now()
	if voucher.CreatedAt == nil {
		voucher.CreatedAt = &now
	}
	if voucher.UpdatedAt == nil {
		voucher.UpdatedAt = &now
	}
	if voucher.Status == "" {
		voucher.Status = domain.VoucherStatusPending
	}
	if err := r.db.WithContext(ctx).Create(voucher).Error; err != nil {
		return nil, err
	}
	return voucher, nil
}

func (r *VoucherRepo) GetVoucherByID(ctx context.Context, voucherID, userID string) (*domain.UserVoucher, error) {
	var row domain.UserVoucher
	query := r.db.WithContext(ctx).Where("id = ?", voucherID)
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	err := query.First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *VoucherRepo) FindVoucherBySource(ctx context.Context, userID, sourceType, sourceKey string) (*domain.UserVoucher, error) {
	if userID == "" || sourceType == "" || sourceKey == "" {
		return nil, nil
	}
	var row domain.UserVoucher
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND source_type = ? AND source_key = ?", userID, sourceType, sourceKey).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *VoucherRepo) ListVouchers(ctx context.Context, userID, status string, offset, limit int) ([]domain.UserVoucher, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	query := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var rows []domain.UserVoucher
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, err
}

func (r *VoucherRepo) CountVouchers(ctx context.Context, userID, status string) (int64, error) {
	query := r.db.WithContext(ctx).Model(&domain.UserVoucher{}).Where("user_id = ?", userID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var count int64
	err := query.Count(&count).Error
	return count, err
}

func (r *VoucherRepo) MarkVoucherUsed(ctx context.Context, voucherID, userID string) error {
	now := time.Now()
	result := r.db.WithContext(ctx).
		Model(&domain.UserVoucher{}).
		Where("id = ? AND user_id = ? AND status = ?", voucherID, userID, domain.VoucherStatusPending).
		Updates(map[string]any{
			"status":     domain.VoucherStatusUsed,
			"used_at":    now,
			"updated_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("礼券不可用或已使用")
	}
	return nil
}

func (r *VoucherRepo) UpdateVoucherStatus(ctx context.Context, voucherID, status string) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&domain.UserVoucher{}).
		Where("id = ?", voucherID).
		Updates(map[string]any{
			"status":     status,
			"updated_at": now,
		}).Error
}

// ExpirePendingVouchers marks all pending vouchers past their valid_end_at as expired.
func (r *VoucherRepo) ExpirePendingVouchers(ctx context.Context, before time.Time) (int64, error) {
	result := r.db.WithContext(ctx).
		Model(&domain.UserVoucher{}).
		Where("status = ? AND valid_end_at IS NOT NULL AND valid_end_at < ?", domain.VoucherStatusPending, before).
		Updates(map[string]any{
			"status":     domain.VoucherStatusExpired,
			"updated_at": time.Now(),
		})
	return result.RowsAffected, result.Error
}

// WithTransaction runs the given function inside a database transaction.
func (r *VoucherRepo) WithTransaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return r.db.WithContext(ctx).Transaction(fn)
}
