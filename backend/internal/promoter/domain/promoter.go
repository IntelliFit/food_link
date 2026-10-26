// Package domain holds the promoter commission models. Amounts are in fen.
package domain

import "time"

const (
	StatusPendingReview = "pending_review"
	StatusActive        = "active"
	StatusSuspended     = "suspended"
	StatusTerminated    = "terminated"
	StatusRejected      = "rejected"

	BindingActive  = "active"
	BindingRevoked = "revoked"

	CommissionPending   = "pending"
	CommissionAvailable = "available"
	CommissionCancelled = "cancelled"
	CommissionReversed  = "reversed"

	SourcePromoCode = "promo_code"
	SourceShareLink = "share_link"
	SourceQR        = "qr"
)

// CommissionPayChannels are the membership payment channels that earn
// commission. Virtual payments settle to another merchant after a platform
// fee and manual_admin orders are not real sales, so neither is listed.
var CommissionPayChannels = []string{"wechat_mini_program", "wechat_app", "alipay_app", "wechat_papay"}

type Promoter struct {
	ID                string     `gorm:"column:id;primaryKey" json:"id"`
	UserID            string     `gorm:"column:user_id" json:"user_id"`
	PromoCode         string     `gorm:"column:promo_code" json:"promo_code"`
	Status            string     `gorm:"column:status" json:"status"`
	CommissionRateBps *int       `gorm:"column:commission_rate_bps" json:"commission_rate_bps,omitempty"`
	ApplyNote         string     `gorm:"column:apply_note" json:"apply_note"`
	RealNameConfirmed bool       `gorm:"column:real_name_confirmed" json:"real_name_confirmed"`
	AgreementVersion  string     `gorm:"column:agreement_version" json:"agreement_version"`
	AgreementSignedAt *time.Time `gorm:"column:agreement_signed_at" json:"agreement_signed_at,omitempty"`
	ReviewNote        string     `gorm:"column:review_note" json:"review_note"`
	ReviewedBy        string     `gorm:"column:reviewed_by" json:"reviewed_by"`
	ReviewedAt        *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	CreatedAt         *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt         *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (Promoter) TableName() string { return "promoters" }

type Binding struct {
	ID            string     `gorm:"column:id;primaryKey" json:"id"`
	InviteeUserID string     `gorm:"column:invitee_user_id" json:"invitee_user_id"`
	PromoterID    string     `gorm:"column:promoter_id" json:"promoter_id"`
	PromoCode     string     `gorm:"column:promo_code" json:"promo_code"`
	Source        string     `gorm:"column:source" json:"source"`
	Status        string     `gorm:"column:status" json:"status"`
	BoundAt       time.Time  `gorm:"column:bound_at" json:"bound_at"`
	ExpiresAt     *time.Time `gorm:"column:expires_at" json:"expires_at,omitempty"`
	RevokedAt     *time.Time `gorm:"column:revoked_at" json:"revoked_at,omitempty"`
	RevokeReason  string     `gorm:"column:revoke_reason" json:"revoke_reason"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt     *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (Binding) TableName() string { return "promoter_bindings" }

// Summary is a promoter's balance, derived from commission and withdrawal
// rows rather than stored, so it cannot drift from them.
type Summary struct {
	AvailableCents   int64 `json:"available_cents"`
	PendingCents     int64 `json:"pending_cents"`
	TotalEarnedCents int64 `json:"total_earned_cents"`
	WithdrawingCents int64 `json:"withdrawing_cents"`
	WithdrawnCents   int64 `json:"withdrawn_cents"`
	InviteeCount     int64 `json:"invitee_count"`
	PaidOrderCount   int64 `json:"paid_order_count"`
}

// CommissionItem is one commission row as the promoter sees it; the invitee
// is shown by a masked nickname only.
type CommissionItem struct {
	ID               string     `json:"id"`
	InviteeNickname  string     `json:"invitee_nickname"`
	PlanCode         string     `json:"plan_code"`
	OrderAmountCents int64      `json:"order_amount_cents"`
	RateBps          int        `json:"rate_bps"`
	CommissionCents  int64      `json:"commission_cents"`
	Status           string     `json:"status"`
	PaidAt           time.Time  `json:"paid_at"`
	SettleAt         time.Time  `json:"settle_at"`
	SettledAt        *time.Time `json:"settled_at,omitempty"`
}

// SyncResult counts the rows one commission sync pass changed. Stuck is not
// a change: it counts due commissions held back by an unknown order status.
type SyncResult struct {
	Accrued   int64 `json:"accrued"`
	Cancelled int64 `json:"cancelled"`
	Reversed  int64 `json:"reversed"`
	Settled   int64 `json:"settled"`
	Stuck     int64 `json:"stuck"`
}

func (r SyncResult) Changed() bool {
	return r.Accrued+r.Cancelled+r.Reversed+r.Settled > 0
}

// AdminPromoter is a promoter row with the account nickname and running
// totals for the review list.
type AdminPromoter struct {
	Promoter
	Nickname string  `json:"nickname"`
	Summary  Summary `json:"summary"`
}
