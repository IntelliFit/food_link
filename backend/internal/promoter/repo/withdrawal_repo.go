package repo

import (
	"context"
	"errors"
	"maps"
	"slices"
	"time"

	"food_link/backend/internal/promoter/domain"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrWithdrawalInFlight is returned when the promoter already has a
// withdrawal that is not finished; uk_promoter_withdrawals_in_flight allows
// only one.
var ErrWithdrawalInFlight = errors.New("promoter has a withdrawal in flight")

// availableCentsExpr is a promoter's withdrawable balance for the promoters
// row aliased p: settled commission minus every withdrawal still holding or
// already paid out money. It matches Summary.AvailableCents.
const availableCentsExpr = `(SELECT COALESCE(SUM(c.commission_cents), 0) FROM promoter_commissions c
   WHERE c.promoter_id = p.id AND c.status = 'available')
 - (SELECT COALESCE(SUM(w.amount_cents), 0) FROM promoter_withdrawals w
   WHERE w.promoter_id = p.id AND w.status IN ('reviewing','approved','transferring','succeeded'))`

// WithdrawalState is what a new withdrawal is checked against, read inside
// the transaction that inserts it while the promoter row is locked.
type WithdrawalState struct {
	PromoterStatus string
	AvailableCents int64
	InFlight       int64
	CountSince     int64
}

// inFlightStatuses are the withdrawal statuses uk_promoter_withdrawals_in_flight
// allows only one of per promoter.
var inFlightStatuses = []string{domain.WithdrawalReviewing, domain.WithdrawalApproved, domain.WithdrawalTransferring}

// CreateWithdrawal locks the promoter row, re-reads the balance and the
// number of withdrawals since dayStart, lets check reject the request, and
// inserts it, all in one transaction so two taps cannot overdraw. A request
// key seen before returns the earlier withdrawal with existing = true.
func (r *PromoterRepo) CreateWithdrawal(ctx context.Context, row *domain.Withdrawal, dayStart time.Time, check func(WithdrawalState) error) (*domain.Withdrawal, bool, error) {
	var out *domain.Withdrawal
	existing := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var state WithdrawalState
		// The lock comes first in its own statement: under READ COMMITTED a
		// later statement takes a fresh snapshot and so sees any withdrawal a
		// concurrent request committed while this one waited for the lock.
		if err := lockPromoter(tx, row.PromoterID, &state.PromoterStatus); err != nil {
			return err
		}
		var prior []domain.Withdrawal
		if err := tx.Where("promoter_id = ? AND request_key = ?", row.PromoterID, row.RequestKey).Limit(1).Find(&prior).Error; err != nil {
			return err
		}
		if len(prior) > 0 {
			out, existing = &prior[0], true
			return nil
		}
		if err := tx.Raw(`SELECT `+availableCentsExpr+` FROM promoters p WHERE p.id = ?`, row.PromoterID).Scan(&state.AvailableCents).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Withdrawal{}).
			Where("promoter_id = ? AND status IN ?", row.PromoterID, inFlightStatuses).
			Count(&state.InFlight).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Withdrawal{}).
			Where("promoter_id = ? AND created_at >= ? AND status NOT IN ?", row.PromoterID, dayStart,
				[]string{domain.WithdrawalRejected, domain.WithdrawalFailed}).
			Count(&state.CountSince).Error; err != nil {
			return err
		}
		if err := check(state); err != nil {
			return err
		}
		if err := tx.Create(row).Error; err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uk_promoter_withdrawals_in_flight" {
				return ErrWithdrawalInFlight
			}
			return err
		}
		out = row
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return out, existing, nil
}

func (r *PromoterRepo) GetWithdrawal(ctx context.Context, id string) (*domain.Withdrawal, error) {
	var row domain.Withdrawal
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// withdrawalViewColumns selects a withdrawal aliased w0 with its transfer
// bill aliased b.
const withdrawalViewColumns = `w0.*, COALESCE(b.state, '') AS transfer_state, COALESCE(b.fail_reason, '') AS transfer_fail_reason,
       COALESCE(b.last_error, '') AS transfer_last_error, COALESCE(b.out_bill_no, '') AS out_bill_no,
       COALESCE(b.package_info, '') AS package_info`

const withdrawalBillJoin = `LEFT JOIN wechat_transfer_bills b ON b.id = w0.transfer_bill_id`

func (r *PromoterRepo) ListWithdrawals(ctx context.Context, promoterID string, limit, offset int) ([]domain.WithdrawalView, int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Model(&domain.Withdrawal{}).Where("promoter_id = ?", promoterID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.WithdrawalView
	err := r.db.WithContext(ctx).Raw(`SELECT `+withdrawalViewColumns+` FROM promoter_withdrawals w0 `+withdrawalBillJoin+`
WHERE w0.promoter_id = ? ORDER BY w0.created_at DESC, w0.id LIMIT ? OFFSET ?`, promoterID, limit, offset).Scan(&rows).Error
	return rows, total, err
}

func (r *PromoterRepo) GetWithdrawalView(ctx context.Context, id string) (*domain.WithdrawalView, error) {
	var rows []domain.WithdrawalView
	err := r.db.WithContext(ctx).Raw(`SELECT `+withdrawalViewColumns+` FROM promoter_withdrawals w0 `+withdrawalBillJoin+`
WHERE w0.id = ?`, id).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

// PayeeOpenID is the mini program openid of a promoter's user, which WeChat
// transfers pay to.
func PayeeOpenID(tx *gorm.DB, promoterID string) (string, error) {
	var openIDs []string
	err := tx.Raw(`SELECT COALESCE(u.openid, '') FROM promoters p LEFT JOIN weapp_user u ON u.id = p.user_id WHERE p.id = ?`, promoterID).
		Scan(&openIDs).Error
	if err != nil || len(openIDs) == 0 {
		return "", err
	}
	return openIDs[0], nil
}

// UpdateWithdrawalIfStatus applies updates only while the withdrawal is still
// in one of the given statuses and returns nil when it had moved on, so two
// reviewers cannot both act on it.
func (r *PromoterRepo) UpdateWithdrawalIfStatus(ctx context.Context, id string, statuses []string, updates map[string]any) (*domain.Withdrawal, error) {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.Withdrawal{}).
		Where("id = ? AND status IN ?", id, statuses).
		Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetWithdrawal(ctx, id)
}

// UpdateWithdrawalLocked moves a withdrawal on like UpdateWithdrawalIfStatus,
// but first locks its promoter row and re-reads the promoter's status and
// balance for check, in the same transaction as the update; new withdrawals
// and manual reversals for that promoter wait for it. prepare, when set, runs
// after check in the same transaction and may add updates. It returns nil
// when the withdrawal does not exist or has moved on.
func (r *PromoterRepo) UpdateWithdrawalLocked(ctx context.Context, id string, statuses []string, updates map[string]any,
	check func(WithdrawalState) error, prepare func(tx *gorm.DB, w domain.Withdrawal) (map[string]any, error)) (*domain.Withdrawal, error) {
	var out *domain.Withdrawal
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current []domain.Withdrawal
		if err := tx.Where("id = ?", id).Limit(1).Find(&current).Error; err != nil || len(current) == 0 {
			return err
		}
		var state WithdrawalState
		if err := lockPromoter(tx, current[0].PromoterID, &state.PromoterStatus); err != nil {
			return err
		}
		if err := tx.Raw(`SELECT `+availableCentsExpr+` FROM promoters p WHERE p.id = ?`, current[0].PromoterID).Scan(&state.AvailableCents).Error; err != nil {
			return err
		}
		if err := check(state); err != nil {
			return err
		}
		// Re-read under a row lock so what prepare sees is what gets updated.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Find(&current).Error; err != nil {
			return err
		}
		if !slices.Contains(statuses, current[0].Status) {
			return nil
		}
		if prepare != nil {
			extra, err := prepare(tx, current[0])
			if err != nil {
				return err
			}
			maps.Copy(updates, extra)
		}
		updates["updated_at"] = time.Now()
		result := tx.Model(&domain.Withdrawal{}).Where("id = ? AND status IN ?", id, statuses).Updates(updates)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		var row domain.Withdrawal
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		out = &row
		return nil
	})
	return out, err
}

// AppendedReviewNote is an update value that adds text to a withdrawal's
// review_note after anything already there.
func AppendedReviewNote(text string) any {
	return gorm.Expr("CASE WHEN review_note = '' THEN ? ELSE review_note || '；' || ? END", text, text)
}

// lockPromoter takes the row lock that serialises everything which changes
// or checks one promoter's balance, and reads the promoter's status.
func lockPromoter(tx *gorm.DB, promoterID string, status *string) error {
	return tx.Raw(`SELECT status FROM promoters WHERE id = ? FOR UPDATE`, promoterID).Scan(status).Error
}

func (r *PromoterRepo) AdminListWithdrawals(ctx context.Context, status string, limit, offset int) ([]domain.AdminWithdrawal, int64, error) {
	where, args := "TRUE", []any{}
	if status != "" {
		where, args = "w0.status = ?", append(args, status)
	}
	var total int64
	if err := r.db.WithContext(ctx).Table("promoter_withdrawals w0").Where(where, args...).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.AdminWithdrawal
	err := r.db.WithContext(ctx).Raw(`
SELECT `+withdrawalViewColumns+`, p.promo_code, p.status AS promoter_status, p.user_id, COALESCE(u.nickname, '') AS nickname,
       `+availableCentsExpr+` AS available_cents
FROM promoter_withdrawals w0
JOIN promoters p ON p.id = w0.promoter_id
LEFT JOIN weapp_user u ON u.id = p.user_id
`+withdrawalBillJoin+`
WHERE `+where+`
ORDER BY w0.created_at DESC, w0.id
LIMIT ? OFFSET ?`, append(args, limit, offset)...).Scan(&rows).Error
	return rows, total, err
}

func (r *PromoterRepo) AdminListCommissions(ctx context.Context, promoterID, status string, limit, offset int) ([]domain.AdminCommission, int64, error) {
	where, args := "c.promoter_id = ?", []any{promoterID}
	if status != "" {
		where, args = where+" AND c.status = ?", append(args, status)
	}
	var total int64
	if err := r.db.WithContext(ctx).Table("promoter_commissions c").Where(where, args...).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.AdminCommission
	err := r.db.WithContext(ctx).Raw(`
SELECT c.id, c.payment_id, COALESCE(pm.order_no, '') AS order_no, COALESCE(pm.status, '') AS order_status,
       c.pay_channel, COALESCE(pm.plan_code, '') AS plan_code, c.invitee_user_id, COALESCE(u.nickname, '') AS invitee_nickname,
       c.order_amount_cents, c.rate_bps, c.commission_cents, c.status, c.paid_at, c.settle_at, c.settled_at,
       c.reversed_at, c.reverse_reason
FROM promoter_commissions c
LEFT JOIN pro_membership_payment_records pm ON pm.id = c.payment_id
LEFT JOIN weapp_user u ON u.id = c.invitee_user_id
WHERE `+where+`
ORDER BY c.paid_at DESC, c.id
LIMIT ? OFFSET ?`, append(args, limit, offset)...).Scan(&rows).Error
	return rows, total, err
}

// ReverseCommission undoes one commission by hand, for a refund made in the
// WeChat Pay merchant console that never reached the order table: pending
// becomes cancelled, available becomes reversed. It returns the new status,
// or "" when the commission was already undone or does not exist.
func (r *PromoterRepo) ReverseCommission(ctx context.Context, id, reason string, now time.Time) (string, error) {
	var statuses []string
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var promoterIDs []string
		if err := tx.Raw(`SELECT promoter_id FROM promoter_commissions WHERE id = ?`, id).Scan(&promoterIDs).Error; err != nil || len(promoterIDs) == 0 {
			return err
		}
		// Lowers the balance that withdrawal approval checks under this lock.
		var promoterStatus string
		if err := lockPromoter(tx, promoterIDs[0], &promoterStatus); err != nil {
			return err
		}
		return tx.Raw(`
UPDATE promoter_commissions
SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE 'reversed' END,
    reversed_at = ?, reverse_reason = ?, updated_at = ?
WHERE id = ? AND status IN ('pending','available')
RETURNING status`, now, reason, now, id).Scan(&statuses).Error
	})
	if err != nil || len(statuses) == 0 {
		return "", err
	}
	return statuses[0], nil
}
