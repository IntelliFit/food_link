package do

import (
	"time"

	"gorm.io/datatypes"
)

// WechatTransferBillDO is one WeChat Pay merchant transfer (商家转账) to a
// user's wallet, for any business that pays users; the business row keeps
// only its id. out_bill_no is fixed when the row is created and every retry
// reuses it, which is what keeps a retry from paying twice. state holds
// WeChat's own bill state, or CREATED until WeChat has acknowledged the bill.
type WechatTransferBillDO struct {
	ID                 string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	BizType            string         `gorm:"column:biz_type;type:text;not null;uniqueIndex:uk_wechat_transfer_bills_biz,priority:1;check:wechat_transfer_bills_biz_type_valid,biz_type IN ('promoter_withdrawal','canteen_collector_withdrawal')"`
	BizID              string         `gorm:"column:biz_id;type:uuid;not null;uniqueIndex:uk_wechat_transfer_bills_biz,priority:2"`
	OutBillNo          string         `gorm:"column:out_bill_no;type:text;not null;uniqueIndex:uk_wechat_transfer_bills_out_bill_no;check:wechat_transfer_bills_out_bill_no_format,out_bill_no ~ '^[0-9A-Za-z]{1,32}$'"`
	MchID              string         `gorm:"column:mch_id;type:text;not null"`
	AppID              string         `gorm:"column:appid;type:text;not null"`
	OpenID             string         `gorm:"column:openid;type:text;not null;check:wechat_transfer_bills_openid_valid,char_length(openid) BETWEEN 1 AND 64"`
	TransferSceneID    string         `gorm:"column:transfer_scene_id;type:text;not null"`
	TransferAmount     int64          `gorm:"column:transfer_amount_cents;type:bigint;not null;check:wechat_transfer_bills_amount_valid,transfer_amount_cents > 0"`
	TransferRemark     string         `gorm:"column:transfer_remark;type:text;not null;check:wechat_transfer_bills_remark_valid,char_length(transfer_remark) BETWEEN 1 AND 32"`
	UserRecvPerception string         `gorm:"column:user_recv_perception;type:text;not null;default:''"`
	ReportInfos        datatypes.JSON `gorm:"column:report_infos;type:jsonb;not null"`
	State              string         `gorm:"column:state;type:text;not null;default:'CREATED';index:idx_wechat_transfer_bills_state_updated,priority:1;check:wechat_transfer_bills_state_valid,state IN ('CREATED','ACCEPTED','PROCESSING','WAIT_USER_CONFIRM','TRANSFERING','SUCCESS','FAIL','CANCELING','CANCELLED')"`
	TransferBillNo     string         `gorm:"column:transfer_bill_no;type:text;not null;default:''"`
	PackageInfo        string         `gorm:"column:package_info;type:text;not null;default:''"`
	FailReason         string         `gorm:"column:fail_reason;type:text;not null;default:''"`
	LastError          string         `gorm:"column:last_error;type:text;not null;default:''"`
	WechatCreatedAt    *time.Time     `gorm:"column:wechat_created_at;type:timestamptz"`
	WechatUpdatedAt    *time.Time     `gorm:"column:wechat_updated_at;type:timestamptz"`
	QueryAttempts      int            `gorm:"column:query_attempts;type:integer;not null;default:0"`
	LastQueriedAt      *time.Time     `gorm:"column:last_queried_at;type:timestamptz"`
	NotifyPayload      datatypes.JSON `gorm:"column:notify_payload;type:jsonb"`
	FinishedAt         *time.Time     `gorm:"column:finished_at;type:timestamptz"`
	CreatedAt          *time.Time     `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at;type:timestamptz;not null;default:now();index:idx_wechat_transfer_bills_state_updated,priority:2"`
}

func (WechatTransferBillDO) TableName() string { return "wechat_transfer_bills" }

func WechatTransferModels() []any {
	return []any{&WechatTransferBillDO{}}
}
