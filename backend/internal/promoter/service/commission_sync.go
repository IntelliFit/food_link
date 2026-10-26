package service

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/pkg/logger"
)

const syncPassTimeout = 2 * time.Minute

// RunSync runs the commission sync every SyncInterval until ctx ends. Every
// replica runs it; the database lock lets only one pass through at a time.
func (s *PromoterService) RunSync(ctx context.Context) {
	if !s.rules.Enabled {
		return
	}
	logger.Info(ctx, "推广佣金同步已启动", slog.Duration("interval", s.rules.SyncInterval))
	s.syncOnce(ctx)
	ticker := time.NewTicker(s.rules.SyncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Info(context.Background(), "推广佣金同步已停止")
			return
		case <-ticker.C:
			s.syncOnce(ctx)
		}
	}
}

func (s *PromoterService) syncOnce(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, syncPassTimeout)
	defer cancel()
	result, skipped, err := s.SyncCommissions(ctx)
	if err != nil {
		if parent.Err() == nil {
			logger.Error(ctx, "推广佣金同步失败", err)
		}
		return
	}
	if skipped {
		return
	}
	if result.Stuck > 0 {
		logger.Warn(ctx, "推广佣金有到期未结算的记录，对应订单状态不是已支付，请人工核对",
			slog.Int64("stuck", result.Stuck))
	}
	if !result.Changed() {
		return
	}
	logger.Info(ctx, "推广佣金同步完成",
		slog.Int64("accrued", result.Accrued),
		slog.Int64("cancelled", result.Cancelled),
		slog.Int64("reversed", result.Reversed),
		slog.Int64("settled", result.Settled),
	)
}
