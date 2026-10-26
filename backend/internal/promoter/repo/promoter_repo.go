package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/promoter/domain"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrPromoCodeTaken is returned when a generated promo code collides with an
// existing one; the caller retries with a new code.
var ErrPromoCodeTaken = errors.New("promo code already taken")

// ErrPromoterExists is returned when the user already has a promoter row.
var ErrPromoterExists = errors.New("promoter already exists for user")

// syncLockKey keeps the commission sync to one replica at a time; every
// statement is idempotent anyway, the lock only saves duplicate work.
const syncLockKey = "food-link:promoter-commission-sync"

type PromoterRepo struct {
	db *gorm.DB
}

func NewPromoterRepo(db *gorm.DB) *PromoterRepo {
	return &PromoterRepo{db: db}
}

func (r *PromoterRepo) GetByUser(ctx context.Context, userID string) (*domain.Promoter, error) {
	return r.first(ctx, "user_id = ?", userID)
}

func (r *PromoterRepo) GetByID(ctx context.Context, id string) (*domain.Promoter, error) {
	return r.first(ctx, "id = ?", id)
}

func (r *PromoterRepo) GetByCode(ctx context.Context, code string) (*domain.Promoter, error) {
	return r.first(ctx, "promo_code = ?", code)
}

func (r *PromoterRepo) first(ctx context.Context, query string, arg any) (*domain.Promoter, error) {
	var row domain.Promoter
	err := r.db.WithContext(ctx).Where(query, arg).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *PromoterRepo) Create(ctx context.Context, row *domain.Promoter) error {
	err := r.db.WithContext(ctx).Create(row).Error
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if pgErr.ConstraintName == "uk_promoters_promo_code" {
			return ErrPromoCodeTaken
		}
		return ErrPromoterExists
	}
	return err
}

// UpdateIfStatus applies updates only while the row is still in one of the
// given statuses, so two reviewers cannot both act on the same row. It
// returns nil when the row had already moved on.
func (r *PromoterRepo) UpdateIfStatus(ctx context.Context, id string, statuses []string, updates map[string]any) (*domain.Promoter, error) {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.Promoter{}).
		Where("id = ? AND status IN ?", id, statuses).
		Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetByID(ctx, id)
}

func (r *PromoterRepo) List(ctx context.Context, status string, limit, offset int) ([]domain.Promoter, int64, error) {
	q := r.db.WithContext(ctx).Model(&domain.Promoter{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.Promoter
	err := q.Order("created_at DESC, id").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

func (r *PromoterRepo) GetBindingByInvitee(ctx context.Context, userID string) (*domain.Binding, error) {
	var row domain.Binding
	err := r.db.WithContext(ctx).Where("invitee_user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// CreateBinding inserts the binding unless the user is already bound, in
// which case it reports false and leaves the existing binding untouched.
func (r *PromoterRepo) CreateBinding(ctx context.Context, row *domain.Binding) (bool, error) {
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "invitee_user_id"}}, DoNothing: true}).
		Create(row)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// UserCreatedAt returns when the account was registered, or nil if the user
// does not exist.
func (r *PromoterRepo) UserCreatedAt(ctx context.Context, userID string) (*time.Time, error) {
	var rows []struct {
		CreateTime *time.Time `gorm:"column:create_time"`
	}
	err := r.db.WithContext(ctx).Table("weapp_user").Select("create_time").Where("id = ?", userID).Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0].CreateTime, nil
}

func (r *PromoterRepo) HasPaidMembership(ctx context.Context, userID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Table("pro_membership_payment_records").
		Where("user_id = ? AND status = ?", userID, "paid").
		Limit(1).Count(&count).Error
	return count > 0, err
}

func (r *PromoterRepo) Summary(ctx context.Context, promoterID string) (domain.Summary, error) {
	var s domain.Summary
	err := r.db.WithContext(ctx).Raw(`
SELECT
  COALESCE(SUM(commission_cents) FILTER (WHERE status = 'available'), 0) AS total_earned_cents,
  COALESCE(SUM(commission_cents) FILTER (WHERE status = 'pending'), 0) AS pending_cents,
  COUNT(*) FILTER (WHERE status IN ('pending','available')) AS paid_order_count
FROM promoter_commissions WHERE promoter_id = ?`, promoterID).Scan(&s).Error
	if err != nil {
		return s, err
	}
	var w struct {
		WithdrawingCents int64
		WithdrawnCents   int64
	}
	err = r.db.WithContext(ctx).Raw(`
SELECT
  COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('reviewing','approved','transferring')), 0) AS withdrawing_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0) AS withdrawn_cents
FROM promoter_withdrawals WHERE promoter_id = ?`, promoterID).Scan(&w).Error
	if err != nil {
		return s, err
	}
	s.WithdrawingCents, s.WithdrawnCents = w.WithdrawingCents, w.WithdrawnCents
	// A refund after payout reverses the commission, so this can go negative;
	// later commissions then pay the difference back first.
	s.AvailableCents = s.TotalEarnedCents - s.WithdrawingCents - s.WithdrawnCents
	err = r.db.WithContext(ctx).Model(&domain.Binding{}).
		Where("promoter_id = ? AND status = ?", promoterID, domain.BindingActive).
		Count(&s.InviteeCount).Error
	return s, err
}

func (r *PromoterRepo) ListCommissions(ctx context.Context, promoterID string, limit, offset int) ([]domain.CommissionItem, int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Table("promoter_commissions").Where("promoter_id = ?", promoterID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []domain.CommissionItem
	err := r.db.WithContext(ctx).Raw(`
SELECT c.id, COALESCE(u.nickname, '') AS invitee_nickname, COALESCE(p.plan_code, '') AS plan_code,
       c.order_amount_cents, c.rate_bps, c.commission_cents, c.status, c.paid_at, c.settle_at, c.settled_at
FROM promoter_commissions c
LEFT JOIN weapp_user u ON u.id = c.invitee_user_id
LEFT JOIN pro_membership_payment_records p ON p.id = c.payment_id
WHERE c.promoter_id = ?
ORDER BY c.paid_at DESC, c.id
LIMIT ? OFFSET ?`, promoterID, limit, offset).Scan(&items).Error
	return items, total, err
}

func (r *PromoterRepo) Nicknames(ctx context.Context, userIDs []string) (map[string]string, error) {
	out := make(map[string]string, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		ID       string
		Nickname *string
	}
	if err := r.db.WithContext(ctx).Table("weapp_user").Select("id, nickname").Where("id IN ?", userIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.Nickname != nil {
			out[row.ID] = *row.Nickname
		}
	}
	return out, nil
}

// SyncCommissions brings commissions in line with the membership orders:
// it accrues new paid orders of bound users, cancels or reverses refunded
// ones, and releases pending ones whose freeze period has passed. Reading
// the orders instead of hooking the payment code means a missed callback or
// a replica restart is caught up on the next pass.
func (r *PromoterRepo) SyncCommissions(ctx context.Context, now time.Time, defaultRateBps int, settleDelay time.Duration) (domain.SyncResult, bool, error) {
	var result domain.SyncResult
	acquired := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw("SELECT pg_try_advisory_xact_lock(hashtext(?))", syncLockKey).Scan(&acquired).Error; err != nil {
			return err
		}
		if !acquired {
			return nil
		}
		accrue := tx.Exec(`
INSERT INTO promoter_commissions (promoter_id, binding_id, payment_id, invitee_user_id, pay_channel,
  order_amount_cents, rate_bps, commission_cents, status, paid_at, settle_at)
SELECT b.promoter_id, b.id, p.id, p.user_id, p.pay_channel,
  c.amount_cents, c.rate_bps, c.amount_cents * c.rate_bps / 10000, 'pending', p.paid_at,
  GREATEST(p.paid_at, ?::timestamptz) + make_interval(secs => ?)
FROM pro_membership_payment_records p
JOIN promoter_bindings b ON b.invitee_user_id = p.user_id AND b.status = 'active'
JOIN promoters pr ON pr.id = b.promoter_id AND pr.status IN ('active','suspended')
CROSS JOIN LATERAL (
  SELECT round(p.amount * 100)::bigint AS amount_cents, COALESCE(pr.commission_rate_bps, ?) AS rate_bps
) c
WHERE p.status = 'paid' AND p.refunded_at IS NULL AND p.paid_at IS NOT NULL
  AND p.pay_channel IN ?
  AND p.paid_at >= date_trunc('second', b.bound_at) AND (b.expires_at IS NULL OR p.paid_at < b.expires_at)
  AND p.user_id <> pr.user_id
  AND c.amount_cents * c.rate_bps / 10000 > 0
  AND NOT EXISTS (SELECT 1 FROM promoter_commissions x WHERE x.payment_id = p.id)
ON CONFLICT (payment_id) DO NOTHING`, now, settleDelay.Seconds(), defaultRateBps, domain.CommissionPayChannels)
		if accrue.Error != nil {
			return accrue.Error
		}
		result.Accrued = accrue.RowsAffected

		var undone []string
		err := tx.Raw(`
UPDATE promoter_commissions c
SET status = CASE WHEN c.status = 'pending' THEN 'cancelled' ELSE 'reversed' END,
    reversed_at = ?, reverse_reason = 'order_refunded', updated_at = ?
FROM pro_membership_payment_records p
WHERE p.id = c.payment_id AND c.status IN ('pending','available')
  AND (p.refunded_at IS NOT NULL OR p.status IN ('refunded','closed','revoked'))
RETURNING c.status`, now, now).Scan(&undone).Error
		if err != nil {
			return err
		}
		for _, status := range undone {
			if status == domain.CommissionCancelled {
				result.Cancelled++
			} else {
				result.Reversed++
			}
		}

		revoked := tx.Exec(`
UPDATE promoter_commissions c
SET status = 'cancelled', reversed_at = ?, reverse_reason = 'binding_revoked', updated_at = ?
FROM promoter_bindings b
WHERE b.id = c.binding_id AND b.status = 'revoked' AND c.status = 'pending'`, now, now)
		if revoked.Error != nil {
			return revoked.Error
		}
		result.Cancelled += revoked.RowsAffected

		settle := tx.Exec(`
UPDATE promoter_commissions c
SET status = 'available', settled_at = ?, updated_at = ?
FROM pro_membership_payment_records p
WHERE p.id = c.payment_id AND c.status = 'pending' AND c.settle_at <= ?
  AND p.status = 'paid' AND p.refunded_at IS NULL`, now, now, now)
		if settle.Error != nil {
			return settle.Error
		}
		result.Settled = settle.RowsAffected

		// Due commissions whose order left "paid" for a status the rules
		// above do not know stay pending; count them so ops can look.
		return tx.Raw(`
SELECT COUNT(*) FROM promoter_commissions c
JOIN pro_membership_payment_records p ON p.id = c.payment_id
WHERE c.status = 'pending' AND c.settle_at <= ? AND p.status <> 'paid'`, now).Scan(&result.Stuck).Error
	})
	return result, acquired, err
}
