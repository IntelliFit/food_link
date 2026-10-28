package wechattransfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/wechatpay"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// SceneCommission is WeChat's 佣金报酬 transfer scene.
	SceneCommission = "1005"
	// callTimeout bounds one WeChat Pay request.
	callTimeout = 15 * time.Second
	// defaultLeaseGap is how long a sync owns a bill: it must cover a query
	// plus a create, so two replicas never send for the same bill at once.
	defaultLeaseGap = 45 * time.Second
	// giveUpAttempts and giveUpAfter decide when a bill WeChat never
	// accepted is closed as failed. Each attempt queried first and found no
	// bill, and every earlier create has long returned, so none can still
	// land.
	giveUpAttempts = 5
	giveUpAfter    = 30 * time.Minute
	// stuckAfter is when a bill WeChat keeps erroring on needs a person.
	stuckAfter     = 72 * time.Hour
	createFailed   = "CREATE_FAILED"
	lastErrorRunes = 500
)

// ErrNotFound is returned for a bill id that does not exist.
var ErrNotFound = errors.New("transfer bill not found")

// Client is the part of the WeChat Pay client this package uses.
type Client interface {
	CreateTransferBill(ctx context.Context, req wechatpay.TransferBillRequest) (*wechatpay.TransferBill, error)
	QueryTransferBill(ctx context.Context, outBillNo string) (*wechatpay.TransferBill, error)
}

// Settings are the merchant and callback details every bill uses.
type Settings struct {
	MchID         string
	AppID         string
	NotifyURL     string
	APIV3Key      string
	PublicKey     string
	QueryInterval time.Duration
	// LeaseGap is how long one sync owns a bill; zero means 45 seconds.
	LeaseGap time.Duration
}

// Hook runs in the transaction that moves a bill to a new state, so the
// business row moves with it or not at all.
type Hook func(ctx context.Context, tx *gorm.DB, bill Bill) error

type Service struct {
	db       *gorm.DB
	client   Client
	settings Settings
	hooks    map[string]Hook
	now      func() time.Time
}

func NewService(db *gorm.DB, client Client, settings Settings) *Service {
	if settings.QueryInterval <= 0 {
		settings.QueryInterval = time.Minute
	}
	if settings.LeaseGap <= 0 {
		settings.LeaseGap = defaultLeaseGap
	}
	return &Service{db: db, client: client, settings: settings, hooks: map[string]Hook{}, now: time.Now}
}

// Register sets the hook for one business type. Call it before serving.
func (s *Service) Register(bizType string, hook Hook) { s.hooks[bizType] = hook }

// SetClock replaces the clock; tests use it to step past leases and give-up
// windows.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

func (s *Service) MchID() string { return s.settings.MchID }
func (s *Service) AppID() string { return s.settings.AppID }

// NewBill is what a business supplies for one transfer.
type NewBill struct {
	BizType     string
	BizID       string
	OutPrefix   string
	OpenID      string
	AmountCents int64
	Remark      string
	Perception  string
	ReportInfos []wechatpay.TransferSceneReportInfo
}

// Insert records a bill as CREATED inside the caller's transaction. Send it
// with Submit after that transaction commits.
func (s *Service) Insert(tx *gorm.DB, in NewBill) (*Bill, error) {
	if in.OpenID == "" || in.AmountCents <= 0 || in.Remark == "" || utf8.RuneCountInString(in.Remark) > 32 {
		return nil, fmt.Errorf("invalid transfer bill for %s %s", in.BizType, in.BizID)
	}
	now := s.now()
	outBillNo, err := newOutBillNo(in.OutPrefix, now)
	if err != nil {
		return nil, err
	}
	infos, err := json.Marshal(in.ReportInfos)
	if err != nil {
		return nil, err
	}
	bill := &Bill{
		ID: uuid.NewString(), BizType: in.BizType, BizID: in.BizID, OutBillNo: outBillNo,
		MchID: s.settings.MchID, AppID: s.settings.AppID, OpenID: in.OpenID, TransferSceneID: SceneCommission,
		TransferAmount: in.AmountCents, TransferRemark: in.Remark, UserRecvPerception: in.Perception,
		ReportInfos: datatypes.JSON(infos), State: StateCreated, CreatedAt: &now, UpdatedAt: &now,
	}
	if err := tx.Create(bill).Error; err != nil {
		return nil, err
	}
	return bill, nil
}

// Submit sends a CREATED bill to WeChat. An error leaves the bill CREATED
// with the error recorded; the poller queries it and sends it again under
// the same out_bill_no, which WeChat treats as the same transfer.
func (s *Service) Submit(ctx context.Context, billID string) (*Bill, error) {
	bill, err := s.Get(ctx, billID)
	if err != nil {
		return nil, err
	}
	if bill.State != StateCreated {
		return bill, nil
	}
	var infos []wechatpay.TransferSceneReportInfo
	if err := json.Unmarshal(bill.ReportInfos, &infos); err != nil {
		return nil, fmt.Errorf("decode report infos: %w", err)
	}
	callCtx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	remote, err := s.client.CreateTransferBill(callCtx, wechatpay.TransferBillRequest{
		AppID: bill.AppID, OutBillNo: bill.OutBillNo, TransferSceneID: bill.TransferSceneID, OpenID: bill.OpenID,
		TransferAmount: bill.TransferAmount, TransferRemark: bill.TransferRemark, NotifyURL: s.settings.NotifyURL,
		UserRecvPerception: bill.UserRecvPerception, TransferSceneReportInfos: infos,
	})
	if err != nil {
		s.recordError(ctx, bill.ID, err)
		logger.Warn(ctx, "微信商家转账发起失败，稍后查单重试",
			slog.String("bill_id", bill.ID), slog.String("out_bill_no", bill.OutBillNo), logger.Err(err))
		return bill, err
	}
	return s.apply(ctx, bill.ID, remote, nil, "")
}

// Sync asks WeChat for a bill's state and applies it. A bill WeChat has no
// record of is sent again, or closed as failed after giveUpAttempts over
// giveUpAfter. It does nothing while another sync holds the bill.
func (s *Service) Sync(ctx context.Context, billID string) (*Bill, error) {
	bill, claimed, err := s.claim(ctx, billID)
	if err != nil || !claimed {
		return bill, err
	}
	callCtx, cancel := context.WithTimeout(ctx, callTimeout)
	remote, err := s.client.QueryTransferBill(callCtx, bill.OutBillNo)
	cancel()
	switch {
	case wechatpay.IsNotFound(err) && bill.State == StateCreated:
		if bill.QueryAttempts >= giveUpAttempts && bill.CreatedAt != nil && s.now().Sub(*bill.CreatedAt) > giveUpAfter {
			return s.giveUp(ctx, bill)
		}
		return s.Submit(ctx, bill.ID)
	case err != nil:
		s.recordError(ctx, bill.ID, err)
		if bill.CreatedAt != nil && s.now().Sub(*bill.CreatedAt) > stuckAfter {
			logger.Error(ctx, "商家转账长时间查不到结果，请到商户平台核对后处理", err,
				slog.String("bill_id", bill.ID), slog.String("out_bill_no", bill.OutBillNo), slog.String("biz_id", bill.BizID))
		}
		return bill, err
	}
	return s.apply(ctx, bill.ID, remote, nil, "")
}

func (s *Service) Get(ctx context.Context, billID string) (*Bill, error) {
	var bill Bill
	err := s.db.WithContext(ctx).Where("id = ?", billID).First(&bill).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return &bill, err
}

// claim marks a bill as being synced now unless it is final or another sync
// took it within LeaseGap. The lease uses the database clock so replicas
// with drifting clocks cannot both hold it. It returns the bill as it was
// before the claim.
func (s *Service) claim(ctx context.Context, billID string) (*Bill, bool, error) {
	bill, err := s.Get(ctx, billID)
	if err != nil || IsFinal(bill.State) {
		return bill, false, err
	}
	result := s.db.WithContext(ctx).Model(&Bill{}).
		Where("id = ? AND state NOT IN ? AND (last_queried_at IS NULL OR last_queried_at < now() - make_interval(secs => ?))",
			billID, []string{StateSuccess, StateFail, StateCancelled}, s.settings.LeaseGap.Seconds()).
		Updates(map[string]any{"last_queried_at": gorm.Expr("now()"), "query_attempts": gorm.Expr("query_attempts + 1")})
	if result.Error != nil {
		return bill, false, result.Error
	}
	return bill, result.RowsAffected == 1, nil
}

// apply moves a bill to WeChat's state. Answers about another bill, amount,
// payee or merchant are refused; a final bill and a stale, earlier state are
// left alone, and with onlyFrom set so is a bill no longer in that state. The
// business hook runs when the state changes.
func (s *Service) apply(ctx context.Context, billID string, remote *wechatpay.TransferBill, payload []byte, onlyFrom string) (*Bill, error) {
	var out *Bill
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var bill Bill
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", billID).First(&bill).Error; err != nil {
			return err
		}
		out = &bill
		previous := bill.State
		if err := matches(bill, remote); err != nil {
			return err
		}
		if bill.State == StateFail && bill.FailReason == createFailed && remote.State != StateFail && remote.FailReason != createFailed {
			// We closed it as never sent, but WeChat has it: the payee may be
			// paid while their balance was released.
			logger.Error(ctx, "商家转账已按发起失败关闭，但微信有这笔单据，请立即核对资金", nil,
				slog.String("bill_id", bill.ID), slog.String("out_bill_no", bill.OutBillNo), slog.String("biz_id", bill.BizID),
				slog.String("wechat_state", remote.State))
			return tx.Model(&Bill{}).Where("id = ?", billID).
				Update("last_error", "微信实际状态 "+remote.State+"，本地已按发起失败关闭，需人工核对").Error
		}
		if IsFinal(bill.State) || stateRank[remote.State] < stateRank[bill.State] || (onlyFrom != "" && bill.State != onlyFrom) {
			return nil
		}
		now := s.now()
		updates := map[string]any{"state": remote.State, "last_error": "", "updated_at": now}
		if remote.TransferBillNo != "" {
			updates["transfer_bill_no"] = remote.TransferBillNo
		}
		if remote.State == StateWaitUserConfirm && remote.PackageInfo != "" {
			updates["package_info"] = remote.PackageInfo
		}
		if remote.FailReason != "" {
			updates["fail_reason"] = remote.FailReason
		}
		if t := parseTime(remote.CreateTime); t != nil {
			updates["wechat_created_at"] = t
		}
		if t := parseTime(remote.UpdateTime); t != nil {
			updates["wechat_updated_at"] = t
		}
		if payload != nil {
			updates["notify_payload"] = datatypes.JSON(payload)
		}
		if IsFinal(remote.State) {
			updates["finished_at"] = now
			updates["package_info"] = ""
		}
		if err := tx.Model(&Bill{}).Where("id = ?", billID).Updates(updates).Error; err != nil {
			return err
		}
		var updated Bill
		if err := tx.Where("id = ?", billID).First(&updated).Error; err != nil {
			return err
		}
		out = &updated
		if hook := s.hooks[updated.BizType]; hook != nil && updated.State != previous {
			if err := hook(ctx, tx, updated); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if IsFinal(out.State) {
		logger.Info(ctx, "微信商家转账已结束", slog.String("bill_id", out.ID), slog.String("biz_type", out.BizType),
			slog.String("biz_id", out.BizID), slog.String("state", out.State), slog.String("fail_reason", out.FailReason))
	}
	return out, nil
}

func matches(bill Bill, remote *wechatpay.TransferBill) error {
	if _, ok := stateRank[remote.State]; !ok || remote.State == StateCreated {
		return fmt.Errorf("unknown transfer state %q for %s", remote.State, bill.OutBillNo)
	}
	switch {
	case remote.OutBillNo != "" && remote.OutBillNo != bill.OutBillNo,
		remote.TransferAmount != 0 && remote.TransferAmount != bill.TransferAmount,
		remote.OpenID != "" && remote.OpenID != bill.OpenID,
		remote.MchID != "" && remote.MchID != bill.MchID:
		return fmt.Errorf("transfer answer does not match bill %s", bill.OutBillNo)
	}
	return nil
}

// giveUp closes a bill WeChat never accepted, so its business can release
// the money. fail_reason says it was ours, not WeChat's.
func (s *Service) giveUp(ctx context.Context, bill *Bill) (*Bill, error) {
	logger.Warn(ctx, "微信商家转账多次发起未成功，按失败关闭",
		slog.String("bill_id", bill.ID), slog.String("out_bill_no", bill.OutBillNo), slog.String("last_error", bill.LastError))
	return s.apply(ctx, bill.ID, &wechatpay.TransferBill{State: StateFail, FailReason: createFailed}, nil, StateCreated)
}

func (s *Service) recordError(ctx context.Context, billID string, cause error) {
	text := cause.Error()
	if utf8.RuneCountInString(text) > lastErrorRunes {
		text = string([]rune(text)[:lastErrorRunes])
	}
	if err := s.db.WithContext(ctx).Model(&Bill{}).Where("id = ?", billID).
		Updates(map[string]any{"last_error": text, "updated_at": s.now()}).Error; err != nil {
		logger.Error(ctx, "记录商家转账错误失败", err, slog.String("bill_id", billID))
	}
}

func parseTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &t
}
