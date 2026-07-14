package domain

import "time"

const PaymentTestPlanCode = "test_one_cent_monthly"

// MembershipPlan — table: membership_plan_config
type MembershipPlan struct {
	Code           string     `gorm:"column:code;primaryKey" json:"code"`
	Name           string     `gorm:"column:name" json:"name"`
	Description    *string    `gorm:"column:description" json:"description,omitempty"`
	Amount         float64    `gorm:"column:amount" json:"amount"`
	DurationMonths int        `gorm:"column:duration_months" json:"duration_months"`
	IsActive       bool       `gorm:"column:is_active" json:"is_active"`
	IsVisible      bool       `gorm:"column:is_visible" json:"is_visible"`
	IsTestPlan     bool       `gorm:"column:is_test_plan" json:"is_test_plan"`
	Tier           *string    `gorm:"column:tier" json:"tier,omitempty"`
	Period         *string    `gorm:"column:period" json:"period,omitempty"`
	DailyCredits   int        `gorm:"column:daily_credits" json:"daily_credits"`
	OriginalAmount *float64   `gorm:"column:original_amount" json:"original_amount,omitempty"`
	SortOrder      int        `gorm:"column:sort_order" json:"sort_order"`
	CreatedAt      *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (MembershipPlan) TableName() string { return "membership_plan_config" }

type PaymentTestSetting struct {
	ID        string     `gorm:"column:id;primaryKey" json:"id"`
	Enabled   bool       `gorm:"column:enabled" json:"enabled"`
	UpdatedBy *string    `gorm:"column:updated_by" json:"updated_by,omitempty"`
	CreatedAt *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (PaymentTestSetting) TableName() string { return "membership_payment_test_settings" }

type PaymentTestUser struct {
	ID                        string         `gorm:"column:id;primaryKey" json:"id"`
	UserID                    string         `gorm:"column:user_id" json:"user_id"`
	Note                      *string        `gorm:"column:note" json:"note,omitempty"`
	CreatedBy                 *string        `gorm:"column:created_by" json:"created_by,omitempty"`
	MembershipSnapshot        map[string]any `gorm:"column:membership_snapshot;type:jsonb;serializer:json;not null;default:'{}'::jsonb" json:"membership_snapshot,omitempty"`
	MembershipSnapshotTakenAt *time.Time     `gorm:"column:membership_snapshot_taken_at" json:"membership_snapshot_taken_at,omitempty"`
	MembershipCancelledAt     *time.Time     `gorm:"column:membership_cancelled_at" json:"membership_cancelled_at,omitempty"`
	MembershipCancelledBy     *string        `gorm:"column:membership_cancelled_by" json:"membership_cancelled_by,omitempty"`
	MembershipRestoredAt      *time.Time     `gorm:"column:membership_restored_at" json:"membership_restored_at,omitempty"`
	MembershipRestoredBy      *string        `gorm:"column:membership_restored_by" json:"membership_restored_by,omitempty"`
	CreatedAt                 *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt                 *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (PaymentTestUser) TableName() string { return "membership_payment_test_users" }

type PaymentTestAccess struct {
	Enabled     bool
	UserAllowed bool
}

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

// UserMembershipGrant — table: user_membership_grants
type UserMembershipGrant struct {
	ID         string         `gorm:"column:id;primaryKey" json:"id"`
	UserID     string         `gorm:"column:user_id" json:"user_id"`
	SourceType string         `gorm:"column:source_type" json:"source_type"`
	SourceKey  string         `gorm:"column:source_key;uniqueIndex:idx_user_membership_grants_source_key" json:"source_key"`
	PlanCode   string         `gorm:"column:plan_code" json:"plan_code"`
	GrantDays  int            `gorm:"column:grant_days" json:"grant_days"`
	StartsAt   *time.Time     `gorm:"column:starts_at" json:"starts_at,omitempty"`
	ExpiresAt  *time.Time     `gorm:"column:expires_at" json:"expires_at,omitempty"`
	ReferralID *string        `gorm:"column:referral_id" json:"referral_id,omitempty"`
	Role       *string        `gorm:"column:role" json:"role,omitempty"`
	Status     string         `gorm:"column:status" json:"status"`
	Meta       map[string]any `gorm:"column:meta;serializer:json" json:"meta,omitempty"`
	CreatedAt  *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt  *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserMembershipGrant) TableName() string { return "user_membership_grants" }

type MembershipGrantInput struct {
	UserID       string
	SourceType   string
	SourceKey    string
	PlanCode     string
	DailyCredits int
	GrantDays    int
	ReferralID   string
	Role         string
	Meta         map[string]any
}

// UserTrialEntitlement — table: user_trial_entitlements
type UserTrialEntitlement struct {
	ID                string     `gorm:"column:id;primaryKey" json:"id"`
	FirstUserID       *string    `gorm:"column:first_user_id" json:"first_user_id,omitempty"`
	OpenID            string     `gorm:"column:openid" json:"openid"`
	UnionID           *string    `gorm:"column:unionid" json:"unionid,omitempty"`
	FirstRegisteredAt *time.Time `gorm:"column:first_registered_at" json:"first_registered_at,omitempty"`
	EarlyUserRank     *int       `gorm:"column:early_user_rank" json:"early_user_rank,omitempty"`
	TrialDaysTotal    int        `gorm:"column:trial_days_total" json:"trial_days_total"`
	TrialPolicy       string     `gorm:"column:trial_policy" json:"trial_policy"`
	CreatedAt         *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt         *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserTrialEntitlement) TableName() string { return "user_trial_entitlements" }

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

// PapayContract stores the merchant-side state for one WeChat delegated-payment agreement.
// A user may have only one pending or active contract at a time (enforced by migration index).
type PapayContract struct {
	ID                     string         `gorm:"column:id;primaryKey" json:"id"`
	UserID                 string         `gorm:"column:user_id" json:"user_id"`
	PlanCode               string         `gorm:"column:plan_code" json:"plan_code"`
	TemplateID             string         `gorm:"column:template_id" json:"template_id"`
	MerchantContractCode   string         `gorm:"column:merchant_contract_code" json:"merchant_contract_code"`
	WechatContractID       *string        `gorm:"column:wechat_contract_id" json:"wechat_contract_id,omitempty"`
	OpenID                 *string        `gorm:"column:openid" json:"openid,omitempty"`
	Status                 string         `gorm:"column:status" json:"status"`
	RenewalState           string         `gorm:"column:renewal_state" json:"renewal_state"`
	RequestSerial          string         `gorm:"column:request_serial" json:"request_serial"`
	NextActionAt           *time.Time     `gorm:"column:next_action_at" json:"next_action_at,omitempty"`
	RenewalDueAt           *time.Time     `gorm:"column:renewal_due_at" json:"renewal_due_at,omitempty"`
	LastOrderNo            *string        `gorm:"column:last_order_no" json:"last_order_no,omitempty"`
	LastError              *string        `gorm:"column:last_error" json:"last_error,omitempty"`
	TerminatedAt           *time.Time     `gorm:"column:terminated_at" json:"terminated_at,omitempty"`
	TerminationSource      *string        `gorm:"column:termination_source" json:"termination_source,omitempty"`
	SignNotifyPayload      map[string]any `gorm:"column:sign_notify_payload;serializer:json" json:"sign_notify_payload,omitempty"`
	TerminateNotifyPayload map[string]any `gorm:"column:terminate_notify_payload;serializer:json" json:"terminate_notify_payload,omitempty"`
	CreatedAt              *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt              *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (PapayContract) TableName() string { return "wechat_papay_contracts" }

// UserCreditBonusEvent — table: user_credit_bonus_events
type UserCreditBonusEvent struct {
	ID             string         `gorm:"column:id;primaryKey" json:"id"`
	UserID         string         `gorm:"column:user_id" json:"user_id"`
	BonusType      string         `gorm:"column:bonus_type" json:"bonus_type"`
	BonusDate      string         `gorm:"column:bonus_date" json:"bonus_date"`
	Credits        int            `gorm:"column:credits" json:"credits"`
	SourceRecordID *string        `gorm:"column:source_record_id" json:"source_record_id,omitempty"`
	SourceScope    *string        `gorm:"column:source_scope" json:"source_scope,omitempty"`
	SourceKey      *string        `gorm:"column:source_key" json:"source_key,omitempty"`
	Meta           map[string]any `gorm:"column:meta;serializer:json" json:"meta,omitempty"`
	CreatedAt      *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserCreditBonusEvent) TableName() string { return "user_credit_bonus_events" }

type RewardTaskUpload struct {
	ID               string         `gorm:"column:id;primaryKey" json:"id"`
	UserID           string         `gorm:"column:user_id" json:"user_id"`
	TaskType         string         `gorm:"column:task_type" json:"task_type"`
	BonusDate        string         `gorm:"column:bonus_date" json:"bonus_date"`
	Status           string         `gorm:"column:status" json:"status"`
	RewardCredits    int            `gorm:"column:reward_credits" json:"reward_credits"`
	SourceTaskID     *string        `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	PackagedFoodID   *string        `gorm:"column:packaged_food_id" json:"packaged_food_id,omitempty"`
	PublicFoodItemID *string        `gorm:"column:public_food_item_id" json:"public_food_item_id,omitempty"`
	SourceKey        *string        `gorm:"column:source_key" json:"source_key,omitempty"`
	FailureReason    *string        `gorm:"column:failure_reason" json:"failure_reason,omitempty"`
	Meta             map[string]any `gorm:"column:meta;serializer:json" json:"meta,omitempty"`
	CreatedAt        *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt        *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (RewardTaskUpload) TableName() string { return "reward_task_uploads" }

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

// UserInviteReferral — table: user_invite_referrals
type UserInviteReferral struct {
	ID                       string     `gorm:"column:id;primaryKey" json:"id"`
	InviterUserID            string     `gorm:"column:inviter_user_id" json:"inviter_user_id"`
	InviteeUserID            string     `gorm:"column:invitee_user_id" json:"invitee_user_id"`
	InviteCode               *string    `gorm:"column:invite_code" json:"invite_code,omitempty"`
	SourceRequestID          *string    `gorm:"column:source_request_id" json:"source_request_id,omitempty"`
	Status                   string     `gorm:"column:status" json:"status"`
	FirstEffectiveActionAt   *time.Time `gorm:"column:first_effective_action_at" json:"first_effective_action_at,omitempty"`
	FirstEffectiveActionType *string    `gorm:"column:first_effective_action_type" json:"first_effective_action_type,omitempty"`
	RewardStartDate          *time.Time `gorm:"column:reward_start_date;type:date" json:"reward_start_date,omitempty"`
	RewardEndDate            *time.Time `gorm:"column:reward_end_date;type:date" json:"reward_end_date,omitempty"`
	BlockedReason            *string    `gorm:"column:blocked_reason" json:"blocked_reason,omitempty"`
	CreatedAt                *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt                *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserInviteReferral) TableName() string { return "user_invite_referrals" }

// MembershipShareReward is kept for legacy tests/old code paths. The runtime
// reward table is user_credit_bonus_events.
type MembershipShareReward struct {
	ID        string     `gorm:"column:id;primaryKey"`
	UserID    string     `gorm:"column:user_id"`
	RecordID  string     `gorm:"column:record_id"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (MembershipShareReward) TableName() string { return "membership_share_rewards" }
