package domain

import "time"

// MembershipPlan — table: membership_plans
type MembershipPlan struct {
	ID           string   `gorm:"column:id;primaryKey"`
	Name         string   `gorm:"column:name"`
	PriceCents   int      `gorm:"column:price_cents"`
	DurationDays int      `gorm:"column:duration_days"`
	Description  string   `gorm:"column:description"`
	Benefits     []string `gorm:"column:benefits;serializer:json"`
	IsActive     bool     `gorm:"column:is_active"`
}

func (MembershipPlan) TableName() string { return "membership_plans" }

// UserMembership — table: user_memberships
type UserMembership struct {
	ID        string     `gorm:"column:id;primaryKey"`
	UserID    string     `gorm:"column:user_id"`
	PlanID    string     `gorm:"column:plan_id"`
	Status    string     `gorm:"column:status"` // active, expired, cancelled
	StartedAt *time.Time `gorm:"column:started_at"`
	ExpiresAt *time.Time `gorm:"column:expires_at"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (UserMembership) TableName() string { return "user_memberships" }

// MembershipPayment — table: membership_payments
type MembershipPayment struct {
	ID             string     `gorm:"column:id;primaryKey"`
	UserID         string     `gorm:"column:user_id"`
	PlanID         string     `gorm:"column:plan_id"`
	AmountCents    int        `gorm:"column:amount_cents"`
	Status         string     `gorm:"column:status"` // pending, paid, failed
	WechatPrepayID *string    `gorm:"column:wechat_prepay_id"`
	CreatedAt      *time.Time `gorm:"column:created_at"`
}

func (MembershipPayment) TableName() string { return "membership_payments" }

// MembershipShareReward — table: membership_share_rewards
type MembershipShareReward struct {
	ID        string     `gorm:"column:id;primaryKey"`
	UserID    string     `gorm:"column:user_id"`
	RecordID  string     `gorm:"column:record_id"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (MembershipShareReward) TableName() string { return "membership_share_rewards" }
