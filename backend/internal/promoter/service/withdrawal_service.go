package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/promoter/repo"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

const (
	defaultWithdrawMinCents = 1000
	defaultWithdrawMaxCents = 20000
	defaultWithdrawPerDay   = 1
	requestKeyMaxLength     = 80
	adminNoteMaxRunes       = 200
)

// withdrawDayZone is the calendar the daily withdrawal limit counts in.
var withdrawDayZone = time.FixedZone("Asia/Shanghai", 8*60*60)

type WithdrawInput struct {
	AmountCents int64  `json:"amount_cents"`
	RequestKey  string `json:"request_key"`
}

// Withdraw asks to cash out part of the available balance. The amount is
// held from now on and paid by hand after review until WeChat transfers
// ship. Sending the same request key again returns the first request.
func (s *PromoterService) Withdraw(ctx context.Context, userID string, input WithdrawInput) (*domain.WithdrawalItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if !s.rules.Enabled {
		return nil, appError(http.StatusForbidden, "推广功能暂未开放")
	}
	key := strings.TrimSpace(input.RequestKey)
	if key == "" || len(key) > requestKeyMaxLength {
		return nil, appError(http.StatusBadRequest, "提现请求无效，请刷新后重试")
	}
	promoter, err := s.repo.GetByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if promoter == nil {
		return nil, appError(http.StatusForbidden, "你还不是推广员")
	}
	now := s.now()
	row := &domain.Withdrawal{
		ID: uuid.NewString(), PromoterID: promoter.ID, RequestKey: key, AmountCents: input.AmountCents,
		NetAmountCents: input.AmountCents, Status: domain.WithdrawalReviewing, PayoutMethod: domain.PayoutManual,
		CreatedAt: &now, UpdatedAt: &now,
	}
	y, m, d := now.In(withdrawDayZone).Date()
	dayStart := time.Date(y, m, d, 0, 0, 0, 0, withdrawDayZone)
	saved, existing, err := s.repo.CreateWithdrawal(ctx, row, dayStart, func(state repo.WithdrawalState) error {
		return s.checkWithdrawal(state, input.AmountCents)
	})
	if errors.Is(err, repo.ErrWithdrawalInFlight) {
		return nil, appError(http.StatusConflict, "上一笔提现还在处理中，完成后再来提现")
	}
	if err != nil {
		return nil, err
	}
	if !existing {
		logger.Info(ctx, "推广员发起提现",
			slog.String("promoter_id", promoter.ID), slog.String("withdrawal_id", saved.ID), slog.Int64("amount_cents", saved.AmountCents))
	}
	item := withdrawalItem(*saved)
	return &item, nil
}

func (s *PromoterService) checkWithdrawal(state repo.WithdrawalState, amount int64) error {
	switch {
	case state.PromoterStatus == domain.StatusSuspended:
		return appError(http.StatusForbidden, "推广资格已暂停，暂时不能提现，如有疑问请联系客服")
	case state.PromoterStatus != domain.StatusActive:
		return appError(http.StatusForbidden, "推广资格未生效，暂时不能提现")
	case state.InFlight > 0:
		return appError(http.StatusConflict, "上一笔提现还在处理中，完成后再来提现")
	case amount < s.rules.WithdrawMinCents:
		return appError(http.StatusBadRequest, fmt.Sprintf("满 %s 元才能提现", yuan(s.rules.WithdrawMinCents)))
	case amount > s.rules.WithdrawMaxCents:
		return appError(http.StatusBadRequest, fmt.Sprintf("单笔最多提现 %s 元", yuan(s.rules.WithdrawMaxCents)))
	case amount > state.AvailableCents:
		return appError(http.StatusBadRequest, "可提现余额不足")
	case state.CountSince >= int64(s.rules.WithdrawPerDay):
		return appError(http.StatusTooManyRequests, "今天的提现次数已用完，明天再来")
	}
	return nil
}

type WithdrawalPage struct {
	Items []domain.WithdrawalItem `json:"items"`
	Total int64                   `json:"total"`
}

func (s *PromoterService) Withdrawals(ctx context.Context, userID string, page, size int) (*WithdrawalPage, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	limit, offset := pageBounds(page, size)
	promoter, err := s.repo.GetByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if promoter == nil {
		return &WithdrawalPage{Items: []domain.WithdrawalItem{}}, nil
	}
	rows, total, err := s.repo.ListWithdrawals(ctx, promoter.ID, limit, offset)
	if err != nil {
		return nil, err
	}
	items := make([]domain.WithdrawalItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, withdrawalItem(row))
	}
	return &WithdrawalPage{Items: items, Total: total}, nil
}

// withdrawalItem keeps reviewer names and internal ids from the promoter;
// the note is why it was rejected or failed, which they need to see.
func withdrawalItem(row domain.Withdrawal) domain.WithdrawalItem {
	note := ""
	switch row.Status {
	case domain.WithdrawalRejected:
		note = row.ReviewNote
	case domain.WithdrawalFailed:
		note = row.FailReason
	}
	return domain.WithdrawalItem{
		ID: row.ID, AmountCents: row.AmountCents, NetAmountCents: row.NetAmountCents, Status: row.Status,
		Note: note, CreatedAt: row.CreatedAt, FinishedAt: row.FinishedAt,
	}
}

type AdminWithdrawalPage struct {
	Items []domain.AdminWithdrawal `json:"items"`
	Total int64                    `json:"total"`
}

func (s *PromoterService) AdminWithdrawals(ctx context.Context, status string, page, size int) (*AdminWithdrawalPage, error) {
	limit, offset := pageBounds(page, size)
	rows, total, err := s.repo.AdminListWithdrawals(ctx, strings.TrimSpace(status), limit, offset)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []domain.AdminWithdrawal{}
	}
	return &AdminWithdrawalPage{Items: rows, Total: total}, nil
}

type WithdrawalReviewInput struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note"`
}

// ReviewWithdrawal approves or rejects a withdrawal under review. Rejecting
// releases the amount back to the balance and needs a reason the promoter
// will see. Approval is refused while the promoter is not active or when a
// refund taken back after the request has left the balance short.
func (s *PromoterService) ReviewWithdrawal(ctx context.Context, admin, withdrawalID string, input WithdrawalReviewInput) (*domain.Withdrawal, error) {
	if !isUUID(withdrawalID) {
		return nil, commonerrors.ErrNotFound
	}
	note, err := adminNote(input.Note, !input.Approve, "驳回时请填写原因，推广员会看到这条说明")
	if err != nil {
		return nil, err
	}
	updates := map[string]any{"review_note": note, "reviewed_by": admin, "reviewed_at": s.now()}
	var updated *domain.Withdrawal
	if input.Approve {
		updates["status"] = domain.WithdrawalApproved
		// The balance already excludes this withdrawal, so below zero means
		// commission was taken back after the request was made.
		updated, err = s.repo.UpdateWithdrawalLocked(ctx, withdrawalID, []string{domain.WithdrawalReviewing}, updates, func(state repo.WithdrawalState) error {
			if state.PromoterStatus != domain.StatusActive {
				return appError(http.StatusConflict, "推广员当前不是正常状态，不能通过提现，请驳回或先恢复推广员")
			}
			if state.AvailableCents < 0 {
				return appError(http.StatusConflict, "推广员有退款扣回的佣金，余额已不足以支付这笔提现，请驳回")
			}
			return nil
		})
	} else {
		updates["status"] = domain.WithdrawalRejected
		updates["finished_at"] = s.now()
		updated, err = s.repo.UpdateWithdrawalIfStatus(ctx, withdrawalID, []string{domain.WithdrawalReviewing}, updates)
	}
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, s.staleWithdrawalError(ctx, withdrawalID)
	}
	logger.Info(ctx, "推广提现已审核",
		slog.String("withdrawal_id", withdrawalID), slog.String("admin", admin), slog.String("status", updated.Status))
	return updated, nil
}

type WithdrawalPayoutInput struct {
	Succeeded bool   `json:"succeeded"`
	Note      string `json:"note"`
}

// RecordManualPayout closes an approved manual withdrawal after ops paid it
// outside the system (succeeded) or could not (failed, which releases the
// amount back to the balance and needs a reason). It records what already
// happened, so it does not re-check the promoter; the admin page shows their
// status and balance before ops sends money. Who marked it and their note
// are appended to review_note, leaving the approver in reviewed_by.
func (s *PromoterService) RecordManualPayout(ctx context.Context, admin, withdrawalID string, input WithdrawalPayoutInput) (*domain.Withdrawal, error) {
	if !isUUID(withdrawalID) {
		return nil, commonerrors.ErrNotFound
	}
	note, err := adminNote(input.Note, !input.Succeeded, "标记失败时请填写原因，推广员会看到这条说明")
	if err != nil {
		return nil, err
	}
	current, err := s.repo.GetWithdrawal(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, commonerrors.ErrNotFound
	}
	if current.PayoutMethod != domain.PayoutManual {
		return nil, appError(http.StatusConflict, "这笔提现走微信转账，结果以微信通知为准，不能手工标记")
	}
	outcome := "打款成功"
	if !input.Succeeded {
		outcome = "打款失败"
	}
	record := strings.TrimSpace(fmt.Sprintf("%s（%s）%s", outcome, admin, note))
	updates := map[string]any{
		"finished_at": s.now(),
		"review_note": repo.AppendedReviewNote(record),
	}
	if input.Succeeded {
		updates["status"] = domain.WithdrawalSucceeded
	} else {
		updates["status"] = domain.WithdrawalFailed
		updates["fail_reason"] = note
	}
	updated, err := s.repo.UpdateWithdrawalIfStatus(ctx, withdrawalID, []string{domain.WithdrawalApproved}, updates)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, s.staleWithdrawalError(ctx, withdrawalID)
	}
	logger.Info(ctx, "推广提现已标记打款结果",
		slog.String("withdrawal_id", withdrawalID), slog.String("admin", admin), slog.String("status", updated.Status))
	return updated, nil
}

type AdminCommissionPage struct {
	Items []domain.AdminCommission `json:"items"`
	Total int64                    `json:"total"`
}

func (s *PromoterService) AdminCommissions(ctx context.Context, promoterID, status string, page, size int) (*AdminCommissionPage, error) {
	if !isUUID(promoterID) {
		return nil, commonerrors.ErrNotFound
	}
	limit, offset := pageBounds(page, size)
	rows, total, err := s.repo.AdminListCommissions(ctx, promoterID, strings.TrimSpace(status), limit, offset)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []domain.AdminCommission{}
	}
	return &AdminCommissionPage{Items: rows, Total: total}, nil
}

type ReverseCommissionInput struct {
	Reason string `json:"reason"`
}

type ReverseCommissionResult struct {
	Status string `json:"status"`
}

// ReverseCommission takes back one commission by hand, for refunds made in
// the WeChat Pay merchant console, which do not reach the order table.
func (s *PromoterService) ReverseCommission(ctx context.Context, admin, commissionID string, input ReverseCommissionInput) (*ReverseCommissionResult, error) {
	if !isUUID(commissionID) {
		return nil, commonerrors.ErrNotFound
	}
	reason, err := adminNote(input.Reason, true, "请填写扣回原因，例如商户平台退款单号")
	if err != nil {
		return nil, err
	}
	status, err := s.repo.ReverseCommission(ctx, commissionID, "admin: "+reason, s.now())
	if err != nil {
		return nil, err
	}
	if status == "" {
		return nil, appError(http.StatusConflict, "这笔佣金已经扣回或不存在，请刷新后重试")
	}
	logger.Info(ctx, "推广佣金已手工扣回",
		slog.String("commission_id", commissionID), slog.String("admin", admin), slog.String("status", status))
	return &ReverseCommissionResult{Status: status}, nil
}

func (s *PromoterService) staleWithdrawalError(ctx context.Context, withdrawalID string) error {
	current, err := s.repo.GetWithdrawal(ctx, withdrawalID)
	if err != nil {
		return err
	}
	if current == nil {
		return commonerrors.ErrNotFound
	}
	return appError(http.StatusConflict, "这笔提现当前状态不允许此操作，请刷新后重试")
}

func adminNote(raw string, required bool, missing string) (string, error) {
	note := strings.TrimSpace(raw)
	if required && note == "" {
		return "", appError(http.StatusBadRequest, missing)
	}
	if utf8.RuneCountInString(note) > adminNoteMaxRunes {
		return "", appError(http.StatusBadRequest, "说明不能超过 200 字")
	}
	return note, nil
}

func yuan(cents int64) string {
	if cents%100 == 0 {
		return fmt.Sprintf("%d", cents/100)
	}
	return fmt.Sprintf("%.2f", float64(cents)/100)
}
