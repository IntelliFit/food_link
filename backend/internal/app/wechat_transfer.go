package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/wechattransfer"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/wechatpay"

	"gorm.io/gorm"
)

const wechatTransferNotifyPath = "/api/payment/wechat/transfer/notify"

// newWechatTransferService builds the merchant transfer service from
// wechat_transfer and wechat.pay, or returns nil when transfers are off.
func newWechatTransferService(cfg *config.Config, db *gorm.DB) (*wechattransfer.Service, error) {
	if !cfg.WechatTransfer.Enabled {
		return nil, nil
	}
	pay := cfg.ResolvedWechatPay()
	settings := wechattransfer.Settings{
		MchID:         strings.TrimSpace(pay.MchID),
		AppID:         strings.TrimSpace(cfg.WechatTransfer.AppID),
		NotifyURL:     strings.TrimSpace(cfg.WechatTransfer.NotifyURL),
		APIV3Key:      strings.TrimSpace(pay.APIV3Key),
		PublicKey:     transferPEM(pay.PublicKey),
		QueryInterval: time.Duration(cfg.WechatTransfer.QueryIntervalSecs) * time.Second,
	}
	if settings.AppID == "" {
		settings.AppID = strings.TrimSpace(cfg.WechatMiniProgramAppID())
	}
	if settings.NotifyURL == "" {
		host := "https://dev.api.healthymax.cn"
		if strings.EqualFold(strings.TrimSpace(cfg.App.Env), "production") {
			host = "https://api.healthymax.cn"
		}
		settings.NotifyURL = host + wechatTransferNotifyPath
	}
	privateKey := transferPEM(pay.PrivateKey)
	serialNo := strings.TrimSpace(pay.SerialNo)
	if settings.MchID == "" || settings.AppID == "" || settings.APIV3Key == "" || settings.PublicKey == "" || privateKey == "" || serialNo == "" {
		return nil, fmt.Errorf("wechat_transfer.enabled 需要完整的 wechat.pay 商户号、证书序列号、私钥、平台公钥、APIv3 密钥和小程序 AppID")
	}
	client := wechatpay.NewClient(settings.MchID, serialNo, settings.AppID, settings.NotifyURL, privateKey)
	return wechattransfer.NewService(db, client, settings), nil
}

func transferPEM(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), `\n`, "\n")
}

func (a *App) startWechatTransferPoller(svc *wechattransfer.Service) {
	if svc == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.transferPollCancel = cancel
	a.transferPollDone = make(chan struct{})
	go func() { defer close(a.transferPollDone); svc.RunPoller(ctx) }()
}

func (a *App) stopWechatTransferPoller(ctx context.Context) {
	if a.transferPollCancel == nil {
		return
	}
	a.transferPollCancel()
	select {
	case <-a.transferPollDone:
	case <-ctx.Done():
		logger.Warn(context.Background(), "商家转账查单关闭超时", logger.Err(ctx.Err()))
	}
}
