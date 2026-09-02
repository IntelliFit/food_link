package domain

import "time"

const (
	AppStatusActive   = "active"
	AppStatusDisabled = "disabled"

	KeyStatusActive  = "active"
	KeyStatusRevoked = "revoked"

	RequestStatusReserved  = "reserved"
	RequestStatusSubmitted = "submitted"
	RequestStatusRefunded  = "refunded"
	RequestStatusFailed    = "failed"
)

type App struct {
	ID            string     `json:"id" gorm:"column:id"`
	OwnerUserID   *string    `json:"-" gorm:"column:owner_user_id"`
	Name          string     `json:"name" gorm:"column:name"`
	Status        string     `json:"status" gorm:"column:status"`
	ServiceUserID string     `json:"-" gorm:"column:service_user_id"`
	BalanceUnits  int64      `json:"balance_units" gorm:"column:balance_units"`
	CreatedAt     *time.Time `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (App) TableName() string { return "open_api_apps" }

type APIKey struct {
	ID         string     `json:"id" gorm:"column:id"`
	AppID      string     `json:"app_id" gorm:"column:app_id"`
	Name       string     `json:"name" gorm:"column:name"`
	KeyPrefix  string     `json:"key_prefix" gorm:"column:key_prefix"`
	SecretHash string     `json:"-" gorm:"column:secret_hash"`
	Scopes     []string   `json:"scopes" gorm:"column:scopes;serializer:json"`
	Status     string     `json:"status" gorm:"column:status"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty" gorm:"column:last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty" gorm:"column:expires_at"`
	CreatedAt  *time.Time `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (APIKey) TableName() string { return "open_api_keys" }

type Request struct {
	ID             string         `json:"id" gorm:"column:id"`
	AppID          string         `json:"app_id" gorm:"column:app_id"`
	IdempotencyKey string         `json:"idempotency_key" gorm:"column:idempotency_key"`
	Operation      string         `json:"operation" gorm:"column:operation"`
	Status         string         `json:"status" gorm:"column:status"`
	CostUnits      int64          `json:"cost_units" gorm:"column:cost_units"`
	TaskID         *string        `json:"task_id,omitempty" gorm:"column:task_id"`
	ErrorMessage   *string        `json:"error_message,omitempty" gorm:"column:error_message"`
	Metadata       map[string]any `json:"metadata,omitempty" gorm:"column:metadata;serializer:json"`
	CreatedAt      *time.Time     `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt      *time.Time     `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (Request) TableName() string { return "open_api_requests" }

type UsageLedger struct {
	ID           string         `json:"id" gorm:"column:id"`
	AppID        string         `json:"app_id" gorm:"column:app_id"`
	RequestID    *string        `json:"request_id,omitempty" gorm:"column:request_id"`
	EntryType    string         `json:"entry_type" gorm:"column:entry_type"`
	DeltaUnits   int64          `json:"delta_units" gorm:"column:delta_units"`
	BalanceAfter int64          `json:"balance_after" gorm:"column:balance_after"`
	ReferenceKey string         `json:"reference_key" gorm:"column:reference_key;uniqueIndex:idx_open_api_usage_ledger_reference_key"`
	Description  string         `json:"description" gorm:"column:description"`
	Metadata     map[string]any `json:"metadata,omitempty" gorm:"column:metadata;serializer:json"`
	CreatedAt    *time.Time     `json:"created_at,omitempty" gorm:"column:created_at"`
}

func (UsageLedger) TableName() string { return "open_api_usage_ledger" }

const (
	PaymentOrderPending = "pending"
	PaymentOrderPaid    = "paid"
	PaymentOrderFailed  = "failed"
	PaymentOrderClosed  = "closed"
)

type CreditPackage struct {
	Code        string     `json:"code" gorm:"column:code;primaryKey"`
	Name        string     `json:"name" gorm:"column:name"`
	Description string     `json:"description" gorm:"column:description"`
	Units       int64      `json:"units" gorm:"column:units"`
	AmountFen   int        `json:"amount_fen" gorm:"column:amount_fen"`
	IsActive    bool       `json:"is_active" gorm:"column:is_active"`
	SortOrder   int        `json:"sort_order" gorm:"column:sort_order"`
	CreatedAt   *time.Time `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (CreditPackage) TableName() string { return "open_api_credit_packages" }

type PaymentOrder struct {
	ID                  string         `json:"id" gorm:"column:id"`
	OrderNo             string         `json:"order_no" gorm:"column:order_no"`
	OwnerUserID         string         `json:"owner_user_id" gorm:"column:owner_user_id"`
	AppID               string         `json:"app_id" gorm:"column:app_id"`
	PackageCode         string         `json:"package_code" gorm:"column:package_code"`
	Units               int64          `json:"units" gorm:"column:units"`
	AmountFen           int            `json:"amount_fen" gorm:"column:amount_fen"`
	Status              string         `json:"status" gorm:"column:status"`
	PayChannel          string         `json:"pay_channel" gorm:"column:pay_channel"`
	CodeURL             *string        `json:"code_url,omitempty" gorm:"column:code_url"`
	WechatTransactionID *string        `json:"wechat_transaction_id,omitempty" gorm:"column:wechat_transaction_id"`
	PaidAt              *time.Time     `json:"paid_at,omitempty" gorm:"column:paid_at"`
	ExpiresAt           *time.Time     `json:"expires_at,omitempty" gorm:"column:expires_at"`
	NotifyPayload       map[string]any `json:"-" gorm:"column:notify_payload;serializer:json"`
	CreatedAt           *time.Time     `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt           *time.Time     `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (PaymentOrder) TableName() string { return "open_api_payment_orders" }

type Principal struct {
	App    App
	KeyID  string
	Scopes map[string]struct{}
}

func (p Principal) HasScope(scope string) bool {
	_, ok := p.Scopes[scope]
	return ok
}
