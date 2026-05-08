package domain

import "time"

// MembershipPlan — table: membership_plan_config
type MembershipPlan struct {
	Code           string     `gorm:"column:code;primaryKey" json:"code"`
	Name           string     `gorm:"column:name" json:"name"`
	Description    *string    `gorm:"column:description" json:"description,omitempty"`
	Amount         float64    `gorm:"column:amount" json:"amount"`
	DurationMonths int        `gorm:"column:duration_months" json:"duration_months"`
	IsActive       bool       `gorm:"column:is_active" json:"is_active"`
	Tier           *string    `gorm:"column:tier" json:"tier,omitempty"`
	Period         *string    `gorm:"column:period" json:"period,omitempty"`
	DailyCredits   int        `gorm:"column:daily_credits" json:"daily_credits"`
	OriginalAmount *float64   `gorm:"column:original_amount" json:"original_amount,omitempty"`
	SortOrder      int        `gorm:"column:sort_order" json:"sort_order"`
	CreatedAt      *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (MembershipPlan) TableName() string { return "membership_plan_config" }

// UserMembership — table: user_pro_memberships
type UserMembership struct {
	ID                 string     `gorm:"column:id;primaryKey" json:"id"`
	UserID             string     `gorm:"column:user_id" json:"user_id"`
	CurrentPlanCode    *string    `gorm:"column:current_plan_code" json:"current_plan_code,omitempty"`
	Status             string     `gorm:"column:status" json:"status"`
	FirstActivatedAt   *time.Time `gorm:"column:first_activated_at" json:"first_activated_at,omitempty"`
	CurrentPeriodStart *time.Time `gorm:"column:current_period_start" json:"current_period_start,omitempty"`
	ExpiresAt          *time.Time `gorm:"column:expires_at" json:"expires_at,omitempty"`
	LastPaidAt         *time.Time `gorm:"column:last_paid_at" json:"last_paid_at,omitempty"`
	AutoRenew          bool       `gorm:"column:auto_renew" json:"auto_renew"`
	DailyCredits       int        `gorm:"column:daily_credits" json:"daily_credits"`
	CreatedAt          *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt          *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserMembership) TableName() string { return "user_pro_memberships" }

// MembershipPayment — table: pro_membership_payment_records
type MembershipPayment struct {
	ID              string         `gorm:"column:id;primaryKey" json:"id"`
	UserID          string         `gorm:"column:user_id" json:"user_id"`
	PlanCode        string         `gorm:"column:plan_code" json:"plan_code"`
	OrderNo         string         `gorm:"column:order_no" json:"order_no"`
	Amount          float64        `gorm:"column:amount" json:"amount"`
	Currency        string         `gorm:"column:currency" json:"currency"`
	DurationMonths  int            `gorm:"column:duration_months" json:"duration_months"`
	PayChannel      string         `gorm:"column:pay_channel" json:"pay_channel"`
	TradeType       string         `gorm:"column:trade_type" json:"trade_type"`
	Status          string         `gorm:"column:status" json:"status"`
	WxOpenID        *string        `gorm:"column:wx_openid" json:"wx_openid,omitempty"`
	WxPrepayID      *string        `gorm:"column:wx_prepay_id" json:"wx_prepay_id,omitempty"`
	WxTransactionID *string        `gorm:"column:wx_transaction_id" json:"wx_transaction_id,omitempty"`
	WxBankType      *string        `gorm:"column:wx_bank_type" json:"wx_bank_type,omitempty"`
	PaidAt          *time.Time     `gorm:"column:paid_at" json:"paid_at,omitempty"`
	NotifyPayload   map[string]any `gorm:"column:notify_payload;serializer:json" json:"notify_payload,omitempty"`
	Extra           map[string]any `gorm:"column:extra;serializer:json" json:"extra,omitempty"`
	CreatedAt       *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt       *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (MembershipPayment) TableName() string { return "pro_membership_payment_records" }

// UserCreditBonusEvent — table: user_credit_bonus_events
type UserCreditBonusEvent struct {
	ID             string         `gorm:"column:id;primaryKey" json:"id"`
	UserID         string         `gorm:"column:user_id" json:"user_id"`
	BonusType      string         `gorm:"column:bonus_type" json:"bonus_type"`
	BonusDate      string         `gorm:"column:bonus_date" json:"bonus_date"`
	Credits        int            `gorm:"column:credits" json:"credits"`
	SourceRecordID *string        `gorm:"column:source_record_id" json:"source_record_id,omitempty"`
	Meta           map[string]any `gorm:"column:meta;serializer:json" json:"meta,omitempty"`
	CreatedAt      *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserCreditBonusEvent) TableName() string { return "user_credit_bonus_events" }

// UserEarnedCreditLedger — table: user_earned_credit_ledger
type UserEarnedCreditLedger struct {
	ID           string         `gorm:"column:id;primaryKey" json:"id"`
	UserID       string         `gorm:"column:user_id" json:"user_id"`
	Delta        int            `gorm:"column:delta" json:"delta"`
	BalanceAfter int            `gorm:"column:balance_after" json:"balance_after"`
	Reason       string         `gorm:"column:reason" json:"reason"`
	SourceKey    *string        `gorm:"column:source_key" json:"source_key,omitempty"`
	RelatedDate  *string        `gorm:"column:related_date" json:"related_date,omitempty"`
	Meta         map[string]any `gorm:"column:meta;serializer:json" json:"meta,omitempty"`
	CreatedAt    *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt    *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserEarnedCreditLedger) TableName() string { return "user_earned_credit_ledger" }

// MembershipShareReward is kept for legacy tests/old code paths. The runtime
// reward table is user_credit_bonus_events.
type MembershipShareReward struct {
	ID        string     `gorm:"column:id;primaryKey"`
	UserID    string     `gorm:"column:user_id"`
	RecordID  string     `gorm:"column:record_id"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (MembershipShareReward) TableName() string { return "membership_share_rewards" }
