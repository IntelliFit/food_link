package wechattransfer

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/wechatpay"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	notifyMaxSkew = 5 * time.Minute
	pollBatch     = 20
	// waitConfirmGap is how often a bill waiting for the payee is queried;
	// the payee has 24 hours and the notification reports the outcome.
	waitConfirmGap = 10 * time.Minute
	// pollMinAge keeps the poller off a bill its approval is still sending.
	pollMinAge = 2 * time.Minute
)

// ErrBadNotify is a notification that failed verification.
var ErrBadNotify = errors.New("invalid transfer notification")

// HandleNotify verifies and applies a MCHTRANSFER.BILL.FINISHED
// notification. A bill this service does not know is acknowledged and
// ignored.
func (s *Service) HandleNotify(ctx context.Context, headers http.Header, body []byte) error {
	signature := headers.Get("Wechatpay-Signature")
	timestamp := headers.Get("Wechatpay-Timestamp")
	nonce := headers.Get("Wechatpay-Nonce")
	if signature == "" || timestamp == "" || nonce == "" {
		return ErrBadNotify
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrBadNotify
	}
	if skew := s.now().Sub(time.Unix(seconds, 0)); skew > notifyMaxSkew || skew < -notifyMaxSkew {
		return ErrBadNotify
	}
	if err := wechatpay.VerifyRSA256(timestamp+"\n"+nonce+"\n"+string(body)+"\n", signature, s.settings.PublicKey); err != nil {
		return ErrBadNotify
	}
	var envelope struct {
		EventType string         `json:"event_type"`
		Resource  map[string]any `json:"resource"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ErrBadNotify
	}
	plain, err := wechatpay.DecryptResource(envelope.Resource, s.settings.APIV3Key)
	if err != nil {
		return ErrBadNotify
	}
	payload, err := json.Marshal(plain)
	if err != nil {
		return err
	}
	var remote wechatpay.TransferBill
	if err := json.Unmarshal(payload, &remote); err != nil {
		return ErrBadNotify
	}
	var bill Bill
	err = s.db.WithContext(ctx).Where("out_bill_no = ?", remote.OutBillNo).First(&bill).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Warn(ctx, "收到未知的商家转账通知", slog.String("out_bill_no", remote.OutBillNo), slog.String("event_type", envelope.EventType))
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.apply(ctx, bill.ID, &remote, payload, "")
	return err
}

// NotifyHandler answers WeChat in the shape it expects: 200 with an empty
// body to accept, anything else makes WeChat send the notification again.
func (s *Service) NotifyHandler(c *gin.Context) {
	body, err := c.GetRawData()
	if err == nil {
		err = s.HandleNotify(c.Request.Context(), c.Request.Header, body)
	}
	switch {
	case err == nil:
		c.Status(http.StatusOK)
	case errors.Is(err, ErrBadNotify):
		logger.Warn(c.Request.Context(), "商家转账通知验签或解密失败")
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid notification"})
	default:
		logger.Error(c.Request.Context(), "处理商家转账通知失败", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": "FAIL", "message": "retry later"})
	}
}

// RunPoller queries unfinished bills every QueryInterval until ctx ends, so
// a lost notification or a failed send still settles. Every replica runs it;
// the per-bill claim keeps them from querying the same bill together.
func (s *Service) RunPoller(ctx context.Context) {
	logger.Info(ctx, "商家转账查单已启动", slog.Duration("interval", s.settings.QueryInterval))
	ticker := time.NewTicker(s.settings.QueryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Info(context.Background(), "商家转账查单已停止")
			return
		case <-ticker.C:
			s.pollOnce(ctx)
		}
	}
}

func (s *Service) pollOnce(ctx context.Context) {
	now := s.now()
	var ids []string
	err := s.db.WithContext(ctx).Model(&Bill{}).
		Where("state NOT IN ? AND created_at < ?", []string{StateSuccess, StateFail, StateCancelled}, now.Add(-pollMinAge)).
		Where("last_queried_at IS NULL OR (state = ? AND last_queried_at < ?) OR (state <> ? AND last_queried_at < ?)",
			StateWaitUserConfirm, now.Add(-waitConfirmGap), StateWaitUserConfirm, now.Add(-s.settings.QueryInterval)).
		Order("updated_at").Limit(pollBatch).Pluck("id", &ids).Error
	if err != nil {
		if ctx.Err() == nil {
			logger.Error(ctx, "读取待查商家转账失败", err)
		}
		return
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		if _, err := s.Sync(ctx, id); err != nil {
			logger.Warn(ctx, "商家转账查单失败", slog.String("bill_id", id), logger.Err(err))
		}
	}
}
