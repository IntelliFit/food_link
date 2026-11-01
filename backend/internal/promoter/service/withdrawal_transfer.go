package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/promoter/repo"
	"food_link/backend/internal/wechattransfer"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/wechatpay"

	"gorm.io/gorm"
)

const (
	transferOutPrefix  = "PW"
	transferRemark     = "食探推广佣金"
	transferPerception = "劳务报酬"
	// transferRealNameCents is where WeChat starts requiring the payee's
	// real name, which promoters have not given us.
	transferRealNameCents = 200000
)

var transferReportInfos = []wechatpay.TransferSceneReportInfo{
	{InfoType: "岗位类型", InfoContent: "推广员"},
	{InfoType: "报酬说明", InfoContent: "食探会员推广佣金"},
}

// transferFailNotes turns WeChat fail_reason codes the promoter can act on
// into words; anything else gets a generic note with the code.
var transferFailNotes = map[string]string{
	"CREATE_FAILED":               "微信转账没有发起成功",
	"ACCOUNT_FROZEN":              "你的微信账户已被冻结",
	"ACCOUNT_NOT_EXIST":           "收款的微信账户不存在",
	"REAL_NAME_CHECK_FAIL":        "你的微信还没有完成实名认证",
	"NAME_NOT_CORRECT":            "收款人姓名校验不通过",
	"OPENID_INVALID":              "收款账户无效",
	"TRANSFER_QUOTA_EXCEED":       "超出微信单笔转账限额",
	"DAY_RECEIVED_QUOTA_EXCEED":   "超出你今天在微信的收款限额",
	"MONTH_RECEIVED_QUOTA_EXCEED": "超出你本月在微信的收款限额",
	"DAY_RECEIVED_COUNT_EXCEED":   "超出你今天在微信的收款次数",
	"TRANSFER_RISK":               "这笔转账被微信风控拦截",
	"OVERDUE_CLOSE":               "超过 24 小时没有确认收款",
}

// ConfigureTransfer turns on WeChat transfers for withdrawals and has
// finished transfers close their withdrawal.
func (s *PromoterService) ConfigureTransfer(transfer *wechattransfer.Service) {
	s.transfer = transfer
	transfer.Register(wechattransfer.BizPromoterWithdrawal, s.onTransfer)
}

// approveForTransfer approves a withdrawal and records its WeChat transfer
// in the same transaction, then sends it. A failed send leaves the bill for
// the poller, so the approval stands either way.
func (s *PromoterService) approveForTransfer(ctx context.Context, withdrawalID string, updates map[string]any) (*domain.Withdrawal, error) {
	if s.transfer == nil {
		return nil, appError(http.StatusConflict, "微信转账未开启，请选择线下打款")
	}
	updates["status"] = domain.WithdrawalTransferring
	updates["payout_method"] = domain.PayoutWechatTransfer
	updated, err := s.repo.UpdateWithdrawalLocked(ctx, withdrawalID, []string{domain.WithdrawalReviewing}, updates, s.checkApproval,
		func(tx *gorm.DB, w domain.Withdrawal) (map[string]any, error) {
			if w.NetAmountCents >= transferRealNameCents {
				return nil, appError(http.StatusConflict, "2000 元及以上的微信转账需要实名信息，请选择线下打款")
			}
			openID, err := repo.PayeeOpenID(tx, w.PromoterID)
			if err != nil {
				return nil, err
			}
			if openID == "" {
				return nil, appError(http.StatusConflict, "推广员没有小程序账号，不能微信转账，请选择线下打款")
			}
			bill, err := s.transfer.Insert(tx, wechattransfer.NewBill{
				BizType: wechattransfer.BizPromoterWithdrawal, BizID: w.ID, OutPrefix: transferOutPrefix, OpenID: openID,
				AmountCents: w.NetAmountCents, Remark: transferRemark, Perception: transferPerception, ReportInfos: transferReportInfos,
			})
			if err != nil {
				return nil, err
			}
			return map[string]any{"transfer_bill_id": bill.ID}, nil
		})
	if err != nil || updated == nil || updated.TransferBillID == nil {
		return updated, err
	}
	if _, err := s.transfer.Submit(ctx, *updated.TransferBillID); err != nil {
		logger.Warn(ctx, "推广提现微信转账待重试", slog.String("withdrawal_id", withdrawalID), logger.Err(err))
	}
	return s.repo.GetWithdrawal(ctx, withdrawalID)
}

// onTransfer closes a withdrawal when its transfer finishes: paid, or
// failed with the amount released back to the balance.
func (s *PromoterService) onTransfer(ctx context.Context, tx *gorm.DB, bill wechattransfer.Bill) error {
	now := s.now()
	var updates map[string]any
	switch bill.State {
	case wechattransfer.StateSuccess:
		updates = map[string]any{"status": domain.WithdrawalSucceeded, "finished_at": now}
	case wechattransfer.StateFail, wechattransfer.StateCancelled:
		updates = map[string]any{"status": domain.WithdrawalFailed, "fail_reason": transferFailNote(bill), "finished_at": now}
	default:
		return nil
	}
	updated, err := repo.NewPromoterRepo(tx).UpdateWithdrawalIfStatus(ctx, bill.BizID, []string{domain.WithdrawalTransferring}, updates)
	if err != nil {
		return err
	}
	if updated == nil {
		logger.Warn(ctx, "微信转账结束时提现已不在转账中", slog.String("withdrawal_id", bill.BizID), slog.String("state", bill.State))
		return nil
	}
	logger.Info(ctx, "推广提现微信转账已结束",
		slog.String("withdrawal_id", bill.BizID), slog.String("state", bill.State), slog.String("fail_reason", bill.FailReason))
	return nil
}

func transferFailNote(bill wechattransfer.Bill) string {
	reason := transferFailNotes[bill.FailReason]
	switch {
	case reason != "":
	case bill.State == wechattransfer.StateCancelled:
		reason = "微信转账已撤销"
	case bill.FailReason != "":
		reason = fmt.Sprintf("微信转账未成功（%s）", bill.FailReason)
	default:
		reason = "微信转账未成功"
	}
	return reason
}

// RefreshWithdrawal re-reads one of the promoter's withdrawals, asking
// WeChat first while its transfer is under way; the mini program calls it
// after the confirm page closes.
func (s *PromoterService) RefreshWithdrawal(ctx context.Context, userID, withdrawalID string) (*domain.WithdrawalItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if !isUUID(withdrawalID) {
		return nil, commonerrors.ErrNotFound
	}
	promoter, err := s.repo.GetByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	view, err := s.repo.GetWithdrawalView(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}
	if promoter == nil || view == nil || view.PromoterID != promoter.ID {
		return nil, commonerrors.ErrNotFound
	}
	if view, err = s.syncTransfer(ctx, view); err != nil {
		logger.Warn(ctx, "推广员刷新提现时查询微信转账失败", slog.String("withdrawal_id", withdrawalID), logger.Err(err))
		if view, err = s.repo.GetWithdrawalView(ctx, withdrawalID); err != nil {
			return nil, err
		}
	}
	item := s.withdrawalItem(*view)
	return &item, nil
}

// AdminSyncTransfer asks WeChat for a withdrawal's transfer right away.
func (s *PromoterService) AdminSyncTransfer(ctx context.Context, admin, withdrawalID string) (*domain.WithdrawalView, error) {
	if !isUUID(withdrawalID) {
		return nil, commonerrors.ErrNotFound
	}
	view, err := s.repo.GetWithdrawalView(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}
	if view == nil {
		return nil, commonerrors.ErrNotFound
	}
	if view.TransferBillID == nil {
		return nil, appError(http.StatusConflict, "这笔提现没有微信转账")
	}
	if s.transfer == nil {
		return nil, appError(http.StatusConflict, "微信转账未开启，无法查询")
	}
	view, err = s.syncTransfer(ctx, view)
	if err != nil {
		return nil, appError(http.StatusBadGateway, "查询微信转账失败："+err.Error())
	}
	logger.Info(ctx, "管理员查询推广提现微信转账", slog.String("withdrawal_id", withdrawalID), slog.String("admin", admin),
		slog.String("state", view.TransferState))
	return view, nil
}

func (s *PromoterService) syncTransfer(ctx context.Context, view *domain.WithdrawalView) (*domain.WithdrawalView, error) {
	if s.transfer == nil || view.TransferBillID == nil || view.Status != domain.WithdrawalTransferring {
		return view, nil
	}
	if _, err := s.transfer.Sync(ctx, *view.TransferBillID); err != nil {
		return view, err
	}
	return s.repo.GetWithdrawalView(ctx, view.ID)
}
