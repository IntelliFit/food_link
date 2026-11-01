// Package wechattransfer pays users through WeChat Pay merchant transfers
// (商家转账). It owns the wechat_transfer_bills table; a business that pays
// someone inserts a bill in its own transaction and registers a hook that
// moves its own row on when the bill finishes.
package wechattransfer

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"gorm.io/datatypes"
)

// Bill states: CREATED until WeChat has acknowledged the bill, then WeChat's
// own state.
const (
	StateCreated         = "CREATED"
	StateAccepted        = "ACCEPTED"
	StateProcessing      = "PROCESSING"
	StateWaitUserConfirm = "WAIT_USER_CONFIRM"
	StateTransfering     = "TRANSFERING"
	StateSuccess         = "SUCCESS"
	StateFail            = "FAIL"
	StateCanceling       = "CANCELING"
	StateCancelled       = "CANCELLED"
)

// stateRank orders states so a stale answer cannot move a bill backwards.
var stateRank = map[string]int{
	StateCreated:         0,
	StateAccepted:        1,
	StateProcessing:      2,
	StateWaitUserConfirm: 3,
	StateTransfering:     4,
	StateCanceling:       4,
	StateSuccess:         9,
	StateFail:            9,
	StateCancelled:       9,
}

// IsFinal reports whether WeChat will not change a bill in this state again.
func IsFinal(state string) bool {
	return state == StateSuccess || state == StateFail || state == StateCancelled
}

// Business types that may own a bill; the table's check constraint lists the
// same values.
const (
	BizPromoterWithdrawal = "promoter_withdrawal"
)

type Bill struct {
	ID                 string         `gorm:"column:id;primaryKey" json:"id"`
	BizType            string         `gorm:"column:biz_type" json:"biz_type"`
	BizID              string         `gorm:"column:biz_id" json:"biz_id"`
	OutBillNo          string         `gorm:"column:out_bill_no" json:"out_bill_no"`
	MchID              string         `gorm:"column:mch_id" json:"mch_id"`
	AppID              string         `gorm:"column:appid" json:"appid"`
	OpenID             string         `gorm:"column:openid" json:"-"`
	TransferSceneID    string         `gorm:"column:transfer_scene_id" json:"transfer_scene_id"`
	TransferAmount     int64          `gorm:"column:transfer_amount_cents" json:"transfer_amount_cents"`
	TransferRemark     string         `gorm:"column:transfer_remark" json:"transfer_remark"`
	UserRecvPerception string         `gorm:"column:user_recv_perception" json:"user_recv_perception"`
	ReportInfos        datatypes.JSON `gorm:"column:report_infos" json:"-"`
	State              string         `gorm:"column:state" json:"state"`
	TransferBillNo     string         `gorm:"column:transfer_bill_no" json:"transfer_bill_no"`
	PackageInfo        string         `gorm:"column:package_info" json:"-"`
	FailReason         string         `gorm:"column:fail_reason" json:"fail_reason"`
	LastError          string         `gorm:"column:last_error" json:"last_error"`
	WechatCreatedAt    *time.Time     `gorm:"column:wechat_created_at" json:"wechat_created_at,omitempty"`
	WechatUpdatedAt    *time.Time     `gorm:"column:wechat_updated_at" json:"wechat_updated_at,omitempty"`
	QueryAttempts      int            `gorm:"column:query_attempts" json:"query_attempts"`
	LastQueriedAt      *time.Time     `gorm:"column:last_queried_at" json:"last_queried_at,omitempty"`
	NotifyPayload      datatypes.JSON `gorm:"column:notify_payload" json:"-"`
	FinishedAt         *time.Time     `gorm:"column:finished_at" json:"finished_at,omitempty"`
	CreatedAt          *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (Bill) TableName() string { return "wechat_transfer_bills" }

// newOutBillNo is prefix + Shanghai date + 16 random hex digits, which fits
// WeChat's 32 alphanumeric characters with a prefix of up to 8.
func newOutBillNo(prefix string, now time.Time) (string, error) {
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	date := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("20060102")
	return prefix + date + strings.ToUpper(hex.EncodeToString(random)), nil
}
