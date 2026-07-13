package domain

import "time"

const (
	VoucherTypeRegistrationTrial = "registration_trial"
	VoucherTypeInviteLightWeek   = "invite_light_week"
	VoucherTypeAdminPoints       = "admin_points"
)

const (
	VoucherStatusPending   = "pending"
	VoucherStatusUsed      = "used"
	VoucherStatusExpired   = "expired"
	VoucherStatusCancelled = "cancelled"
)

const (
	VoucherSourceTypeRegistration  = "registration"
	VoucherSourceTypeInviteReferral = "invite_referral"
	VoucherSourceTypeAdminManual   = "admin_manual"
)

// UserVoucher — table: user_vouchers
type UserVoucher struct {
	ID            string         `gorm:"column:id;primaryKey" json:"id"`
	UserID        string         `gorm:"column:user_id" json:"user_id"`
	VoucherType   string         `gorm:"column:voucher_type" json:"voucher_type"`
	Status        string         `gorm:"column:status" json:"status"`
	Title         string         `gorm:"column:title" json:"title"`
	Description   *string        `gorm:"column:description" json:"description,omitempty"`
	RewardPayload map[string]any `gorm:"column:reward_payload;serializer:json" json:"reward_payload,omitempty"`
	SourceType    string         `gorm:"column:source_type" json:"source_type"`
	SourceKey     string         `gorm:"column:source_key" json:"source_key"`
	ValidStartAt  *time.Time     `gorm:"column:valid_start_at" json:"valid_start_at,omitempty"`
	ValidEndAt    *time.Time     `gorm:"column:valid_end_at" json:"valid_end_at,omitempty"`
	UsedAt        *time.Time     `gorm:"column:used_at" json:"used_at,omitempty"`
	CreatedAt     *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt     *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserVoucher) TableName() string { return "user_vouchers" }

// IsUsable returns true if the voucher is pending and within its validity window.
func (v *UserVoucher) IsUsable() bool {
	if v == nil || v.Status != VoucherStatusPending {
		return false
	}
	now := time.Now()
	if v.ValidStartAt != nil && now.Before(*v.ValidStartAt) {
		return false
	}
	if v.ValidEndAt != nil && now.After(*v.ValidEndAt) {
		return false
	}
	return true
}
