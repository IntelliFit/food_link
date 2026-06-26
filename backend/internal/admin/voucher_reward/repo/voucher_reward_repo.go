package repo

import (
	"context"
	"strings"

	"food_link/backend/internal/admin/voucher_reward/domain"

	"gorm.io/gorm"
)

type VoucherRewardRepo struct {
	db *gorm.DB
}

func NewVoucherRewardRepo(db *gorm.DB) *VoucherRewardRepo {
	return &VoucherRewardRepo{db: db}
}

func (r *VoucherRewardRepo) SearchUsers(ctx context.Context, query string, limit int) ([]domain.UserSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []domain.UserSearchResult{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	like := "%" + query + "%"
	var rows []domain.UserSearchResult
	err := r.db.WithContext(ctx).
		Table("weapp_user AS u").
		Select(`
			u.id AS user_id,
			COALESCE(u.nickname, '') AS nickname,
			COALESCE(u.avatar, '') AS avatar,
			COALESCE(u.telephone, '') AS telephone,
			COALESCE(u.openid, '') AS open_id,
			COALESCE(u.app_openid, '') AS app_open_id,
			u.create_time AS created_at
		`).
		Where(`u.id::text ILIKE ? OR u.nickname ILIKE ? OR u.telephone ILIKE ? OR u.openid ILIKE ? OR u.app_openid ILIKE ?`,
			like, like, like, like, like).
		Order("u.create_time DESC NULLS LAST").
		Order("u.id ASC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *VoucherRewardRepo) GetUserSummary(ctx context.Context, userID string) (*domain.UserSummary, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, nil
	}
	var row domain.UserSummary
	err := r.db.WithContext(ctx).
		Table("weapp_user AS u").
		Joins("LEFT JOIN user_pro_memberships AS m ON m.user_id = u.id").
		Select(`
			u.id AS user_id,
			COALESCE(u.nickname, '') AS nickname,
			COALESCE(u.telephone, '') AS telephone,
			COALESCE(u.avatar, '') AS avatar,
			u.create_time AS created_at,
			COALESCE(u.earned_credits_balance, 0) AS earned_credits_balance,
			COALESCE(m.status, '') = 'active' AND (m.expires_at IS NULL OR m.expires_at > NOW()) AS is_pro,
			COALESCE(m.current_plan_code, '') AS current_plan_code,
			COALESCE(m.daily_credits, 0) AS daily_credits,
			m.expires_at AS membership_expires_at,
			COALESCE(m.status, '') AS membership_status
		`).
		Where("u.id = ?", userID).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.UserID == "" {
		return nil, nil
	}
	return &row, nil
}
