package do

import "time"

// PromoterDO is a user approved to earn cash commission by promoting the
// mini program. One row per user; promo_code is printed on posters.
type PromoterDO struct {
	ID                string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID            string     `gorm:"column:user_id;type:uuid;not null;uniqueIndex:uk_promoters_user"`
	PromoCode         string     `gorm:"column:promo_code;type:text;not null;uniqueIndex:uk_promoters_promo_code;check:promoters_promo_code_format,promo_code ~ '^[A-Z0-9]{6,12}$'"`
	Status            string     `gorm:"column:status;type:text;not null;default:'pending_review';index:idx_promoters_status_created,priority:1;check:promoters_status_valid,status IN ('pending_review','active','suspended','terminated','rejected')"`
	CommissionRateBps *int       `gorm:"column:commission_rate_bps;type:integer;check:promoters_rate_valid,commission_rate_bps IS NULL OR commission_rate_bps BETWEEN 0 AND 10000"`
	ApplyNote         string     `gorm:"column:apply_note;type:text;not null;default:''"`
	RealNameConfirmed bool       `gorm:"column:real_name_confirmed;type:boolean;not null;default:false"`
	AgreementVersion  string     `gorm:"column:agreement_version;type:text;not null;default:''"`
	AgreementSignedAt *time.Time `gorm:"column:agreement_signed_at;type:timestamptz"`
	ReviewNote        string     `gorm:"column:review_note;type:text;not null;default:''"`
	ReviewedBy        string     `gorm:"column:reviewed_by;type:text;not null;default:''"`
	ReviewedAt        *time.Time `gorm:"column:reviewed_at;type:timestamptz"`
	CreatedAt         *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_promoters_status_created,priority:2,sort:desc"`
	UpdatedAt         *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PromoterDO) TableName() string { return "promoters" }

// PromoterBindingDO attributes a new user to the promoter whose code they
// registered with. A user is bound at most once and never re-bound.
type PromoterBindingDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	InviteeUserID string     `gorm:"column:invitee_user_id;type:uuid;not null;uniqueIndex:uk_promoter_bindings_invitee"`
	PromoterID    string     `gorm:"column:promoter_id;type:uuid;not null;index:idx_promoter_bindings_promoter_bound,priority:1"`
	PromoCode     string     `gorm:"column:promo_code;type:text;not null"`
	Source        string     `gorm:"column:source;type:text;not null;default:'promo_code';check:promoter_bindings_source_valid,source IN ('promo_code','share_link','qr')"`
	Status        string     `gorm:"column:status;type:text;not null;default:'active';check:promoter_bindings_status_valid,status IN ('active','revoked')"`
	BoundAt       time.Time  `gorm:"column:bound_at;type:timestamptz;not null;default:now();index:idx_promoter_bindings_promoter_bound,priority:2,sort:desc"`
	ExpiresAt     *time.Time `gorm:"column:expires_at;type:timestamptz"`
	RevokedAt     *time.Time `gorm:"column:revoked_at;type:timestamptz"`
	RevokeReason  string     `gorm:"column:revoke_reason;type:text;not null;default:''"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt     *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PromoterBindingDO) TableName() string { return "promoter_bindings" }

// PromoterCommissionDO is the commission earned on one paid membership order,
// in fen. The order amount and rate are snapshots taken when it was created.
type PromoterCommissionDO struct {
	ID               string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	PromoterID       string     `gorm:"column:promoter_id;type:uuid;not null;index:idx_promoter_commissions_promoter_status,priority:1;index:idx_promoter_commissions_promoter_created,priority:1"`
	BindingID        string     `gorm:"column:binding_id;type:uuid;not null"`
	PaymentID        string     `gorm:"column:payment_id;type:uuid;not null;uniqueIndex:uk_promoter_commissions_payment"`
	InviteeUserID    string     `gorm:"column:invitee_user_id;type:uuid;not null"`
	PayChannel       string     `gorm:"column:pay_channel;type:text;not null"`
	OrderAmountCents int64      `gorm:"column:order_amount_cents;type:bigint;not null;check:promoter_commissions_order_amount_valid,order_amount_cents > 0"`
	RateBps          int        `gorm:"column:rate_bps;type:integer;not null;check:promoter_commissions_rate_valid,rate_bps BETWEEN 0 AND 10000"`
	CommissionCents  int64      `gorm:"column:commission_cents;type:bigint;not null;check:promoter_commissions_amount_valid,commission_cents >= 0 AND commission_cents <= order_amount_cents"`
	Status           string     `gorm:"column:status;type:text;not null;default:'pending';index:idx_promoter_commissions_promoter_status,priority:2;index:idx_promoter_commissions_status_settle,priority:1;check:promoter_commissions_status_valid,status IN ('pending','available','cancelled','reversed')"`
	PaidAt           time.Time  `gorm:"column:paid_at;type:timestamptz;not null"`
	SettleAt         time.Time  `gorm:"column:settle_at;type:timestamptz;not null;index:idx_promoter_commissions_status_settle,priority:2"`
	SettledAt        *time.Time `gorm:"column:settled_at;type:timestamptz"`
	ReversedAt       *time.Time `gorm:"column:reversed_at;type:timestamptz"`
	ReverseReason    string     `gorm:"column:reverse_reason;type:text;not null;default:''"`
	CreatedAt        *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_promoter_commissions_promoter_created,priority:2,sort:desc"`
	UpdatedAt        *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PromoterCommissionDO) TableName() string { return "promoter_commissions" }

// PromoterWithdrawalDO is a promoter's request to cash out available
// commission, in fen. Until WeChat transfers ship it is paid by hand
// (payout_method = manual); transfer_bill_id is filled once they do.
type PromoterWithdrawalDO struct {
	ID               string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	PromoterID       string     `gorm:"column:promoter_id;type:uuid;not null;uniqueIndex:uk_promoter_withdrawals_request,priority:1;index:idx_promoter_withdrawals_promoter_created,priority:1"`
	RequestKey       string     `gorm:"column:request_key;type:text;not null;uniqueIndex:uk_promoter_withdrawals_request,priority:2;check:promoter_withdrawals_request_key_valid,length(request_key) BETWEEN 1 AND 80"`
	AmountCents      int64      `gorm:"column:amount_cents;type:bigint;not null;check:promoter_withdrawals_amount_valid,amount_cents > 0"`
	TaxWithheldCents int64      `gorm:"column:tax_withheld_cents;type:bigint;not null;default:0;check:promoter_withdrawals_tax_valid,tax_withheld_cents >= 0 AND tax_withheld_cents < amount_cents"`
	NetAmountCents   int64      `gorm:"column:net_amount_cents;type:bigint;not null;check:promoter_withdrawals_net_valid,net_amount_cents = amount_cents - tax_withheld_cents"`
	Status           string     `gorm:"column:status;type:text;not null;default:'reviewing';index:idx_promoter_withdrawals_status_created,priority:1;check:promoter_withdrawals_status_valid,status IN ('reviewing','approved','transferring','succeeded','rejected','failed')"`
	PayoutMethod     string     `gorm:"column:payout_method;type:text;not null;default:'manual';check:promoter_withdrawals_payout_method_valid,payout_method IN ('manual','wechat_transfer')"`
	TransferBillID   *string    `gorm:"column:transfer_bill_id;type:uuid"`
	FailReason       string     `gorm:"column:fail_reason;type:text;not null;default:''"`
	ReviewNote       string     `gorm:"column:review_note;type:text;not null;default:''"`
	ReviewedBy       string     `gorm:"column:reviewed_by;type:text;not null;default:''"`
	ReviewedAt       *time.Time `gorm:"column:reviewed_at;type:timestamptz"`
	FinishedAt       *time.Time `gorm:"column:finished_at;type:timestamptz"`
	CreatedAt        *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_promoter_withdrawals_promoter_created,priority:2,sort:desc;index:idx_promoter_withdrawals_status_created,priority:2"`
	UpdatedAt        *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PromoterWithdrawalDO) TableName() string { return "promoter_withdrawals" }

func PromoterCommissionModels() []any {
	return []any{&PromoterDO{}, &PromoterBindingDO{}, &PromoterCommissionDO{}, &PromoterWithdrawalDO{}}
}
