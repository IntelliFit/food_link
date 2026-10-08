package repo

import (
	"context"
	"time"
)

// GetAppliedMembershipGrantExpiry returns the already accumulated grant end,
// rather than adding grant days again during paid-order reconciliation.
func (r *MembershipRepo) GetAppliedMembershipGrantExpiry(ctx context.Context, userID, planCode string) (*time.Time, error) {
	var row struct {
		ExpiresAt *time.Time `gorm:"column:expires_at"`
	}
	err := r.db.WithContext(ctx).Table("user_membership_grants").
		Select("MAX(expires_at) AS expires_at").
		Where("user_id = ? AND plan_code = ? AND status = ?", userID, planCode, "applied").
		Where("grant_days > 0 AND starts_at IS NOT NULL AND expires_at > starts_at").
		Scan(&row).Error
	return row.ExpiresAt, err
}
