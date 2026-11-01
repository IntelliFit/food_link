package domain

import "time"

const (
	WithdrawalReviewing    = "reviewing"
	WithdrawalApproved     = "approved"
	WithdrawalTransferring = "transferring"
	WithdrawalSucceeded    = "succeeded"
	WithdrawalRejected     = "rejected"
	WithdrawalFailed       = "failed"

	PayoutManual         = "manual"
	PayoutWechatTransfer = "wechat_transfer"
)

// Withdrawal is a promoter's request to cash out available commission, in
// fen. It holds its amount against the balance from the moment it is
// created until it is rejected or fails.
type Withdrawal struct {
	ID               string     `gorm:"column:id;primaryKey" json:"id"`
	PromoterID       string     `gorm:"column:promoter_id" json:"promoter_id"`
	RequestKey       string     `gorm:"column:request_key" json:"-"`
	AmountCents      int64      `gorm:"column:amount_cents" json:"amount_cents"`
	TaxWithheldCents int64      `gorm:"column:tax_withheld_cents" json:"tax_withheld_cents"`
	NetAmountCents   int64      `gorm:"column:net_amount_cents" json:"net_amount_cents"`
	Status           string     `gorm:"column:status" json:"status"`
	PayoutMethod     string     `gorm:"column:payout_method" json:"payout_method"`
	TransferBillID   *string    `gorm:"column:transfer_bill_id" json:"transfer_bill_id,omitempty"`
	FailReason       string     `gorm:"column:fail_reason" json:"fail_reason"`
	ReviewNote       string     `gorm:"column:review_note" json:"review_note"`
	ReviewedBy       string     `gorm:"column:reviewed_by" json:"reviewed_by"`
	ReviewedAt       *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	FinishedAt       *time.Time `gorm:"column:finished_at" json:"finished_at,omitempty"`
	CreatedAt        *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt        *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (Withdrawal) TableName() string { return "promoter_withdrawals" }

// WithdrawalView is a withdrawal with the state of its WeChat transfer, if
// it has one.
type WithdrawalView struct {
	Withdrawal         `gorm:"embedded"`
	TransferState      string `gorm:"column:transfer_state" json:"transfer_state"`
	TransferFailReason string `gorm:"column:transfer_fail_reason" json:"transfer_fail_reason"`
	TransferLastError  string `gorm:"column:transfer_last_error" json:"transfer_last_error"`
	OutBillNo          string `gorm:"column:out_bill_no" json:"out_bill_no"`
	PackageInfo        string `gorm:"column:package_info" json:"-"`
}

// WithdrawalItem is a withdrawal as the promoter sees it. Receive is set
// while a WeChat transfer waits for them to confirm it.
type WithdrawalItem struct {
	ID             string       `json:"id"`
	AmountCents    int64        `json:"amount_cents"`
	NetAmountCents int64        `json:"net_amount_cents"`
	Status         string       `json:"status"`
	Note           string       `json:"note"`
	Receive        *ReceiveInfo `json:"receive,omitempty"`
	CreatedAt      *time.Time   `json:"created_at,omitempty"`
	FinishedAt     *time.Time   `json:"finished_at,omitempty"`
}

// ReceiveInfo is what wx.requestMerchantTransfer needs to show the payee
// the confirm page.
type ReceiveInfo struct {
	MchID   string `json:"mch_id"`
	AppID   string `json:"app_id"`
	Package string `json:"package"`
}

// AdminWithdrawal is a withdrawal in the review queue, with who asked for it
// and that promoter's balance right now (which already excludes this
// withdrawal's amount).
type AdminWithdrawal struct {
	WithdrawalView `gorm:"embedded"`
	PromoCode      string `json:"promo_code"`
	PromoterStatus string `json:"promoter_status"`
	UserID         string `json:"user_id"`
	Nickname       string `json:"nickname"`
	AvailableCents int64  `json:"available_cents"`
}

// AdminCommission is one commission row with the order it came from, for
// checking refunds against the WeChat Pay merchant console.
type AdminCommission struct {
	ID               string     `json:"id"`
	PaymentID        string     `json:"payment_id"`
	OrderNo          string     `json:"order_no"`
	OrderStatus      string     `json:"order_status"`
	PayChannel       string     `json:"pay_channel"`
	PlanCode         string     `json:"plan_code"`
	InviteeUserID    string     `json:"invitee_user_id"`
	InviteeNickname  string     `json:"invitee_nickname"`
	OrderAmountCents int64      `json:"order_amount_cents"`
	RateBps          int        `json:"rate_bps"`
	CommissionCents  int64      `json:"commission_cents"`
	Status           string     `json:"status"`
	PaidAt           time.Time  `json:"paid_at"`
	SettleAt         time.Time  `json:"settle_at"`
	SettledAt        *time.Time `json:"settled_at,omitempty"`
	ReversedAt       *time.Time `json:"reversed_at,omitempty"`
	ReverseReason    string     `json:"reverse_reason"`
}
