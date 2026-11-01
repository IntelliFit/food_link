package service

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/promoter/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// commission inserts a commission row directly, skipping the order sync.
func (f *fixture) commission(t *testing.T, promoterID string, cents int64, status string) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, f.db.Exec(`INSERT INTO promoter_commissions (id, promoter_id, binding_id, payment_id, invitee_user_id,
  pay_channel, order_amount_cents, rate_bps, commission_cents, status, paid_at, settle_at)
VALUES (?, ?, ?, ?, ?, 'wechat_mini_program', ?, 2000, ?, ?, ?, ?)`,
		id, promoterID, uuid.NewString(), uuid.NewString(), uuid.NewString(), cents*5, cents, status,
		f.now.Add(-8*24*time.Hour), f.now.Add(-24*time.Hour)).Error)
	return id
}

func (f *fixture) summary(t *testing.T, userID string) domain.Summary {
	t.Helper()
	me, err := f.svc.Me(context.Background(), userID)
	require.NoError(t, err)
	require.NotNil(t, me.Summary)
	return *me.Summary
}

func TestWithdrawHoldsBalanceThroughReviewAndPayout(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 1500, domain.CommissionAvailable)
	f.commission(t, promoterID, 2500, domain.CommissionAvailable)
	f.commission(t, promoterID, 800, domain.CommissionPending)

	withdraw := func(key string, cents int64) (*domain.WithdrawalItem, error) {
		return f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: cents, RequestKey: key})
	}
	_, err := withdraw("", 3000)
	requireStatus(t, err, http.StatusBadRequest)
	_, err = withdraw("k0", 999)
	requireStatus(t, err, http.StatusBadRequest)
	_, err = withdraw("k0", 20001)
	requireStatus(t, err, http.StatusBadRequest)
	_, err = withdraw("k0", 4001)
	requireStatus(t, err, http.StatusBadRequest)
	_, err = f.svc.Withdraw(ctx, f.user(t, "路人", f.now), WithdrawInput{AmountCents: 1000, RequestKey: "k0"})
	requireStatus(t, err, http.StatusForbidden)

	first, err := withdraw("k1", 3000)
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalReviewing, first.Status)
	again, err := withdraw("k1", 3000)
	require.NoError(t, err)
	require.Equal(t, first.ID, again.ID, "same request key returns the first request")
	require.Equal(t, int64(1000), f.summary(t, promoterUser).AvailableCents)
	require.Equal(t, int64(3000), f.summary(t, promoterUser).WithdrawingCents)

	_, err = withdraw("k2", 1000)
	requireStatus(t, err, http.StatusConflict) // one in flight at a time, reported before the daily limit

	_, err = f.svc.ReviewWithdrawal(ctx, "ops", first.ID, WithdrawalReviewInput{})
	requireStatus(t, err, http.StatusBadRequest)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", "not-a-uuid", WithdrawalReviewInput{Approve: true})
	require.ErrorIs(t, err, commonerrors.ErrNotFound)
	rejected, err := f.svc.ReviewWithdrawal(ctx, "ops", first.ID, WithdrawalReviewInput{Note: "请先补充实名信息"})
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalRejected, rejected.Status)
	require.NotNil(t, rejected.FinishedAt)
	require.Equal(t, int64(4000), f.summary(t, promoterUser).AvailableCents, "rejecting releases the amount")
	list, err := f.svc.Withdrawals(ctx, promoterUser, 1, 20)
	require.NoError(t, err)
	require.Equal(t, "请先补充实名信息", list.Items[0].Note)

	second, err := withdraw("k3", 4000)
	require.NoError(t, err, "a rejected request does not use up the day")
	_, err = f.svc.RecordManualPayout(ctx, "ops", second.ID, WithdrawalPayoutInput{Succeeded: true})
	requireStatus(t, err, http.StatusConflict)
	approved, err := f.svc.ReviewWithdrawal(ctx, "ops", second.ID, WithdrawalReviewInput{Approve: true, Note: "已核对"})
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalApproved, approved.Status)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", second.ID, WithdrawalReviewInput{Approve: true})
	requireStatus(t, err, http.StatusConflict)

	_, err = f.svc.RecordManualPayout(ctx, "ops", second.ID, WithdrawalPayoutInput{})
	requireStatus(t, err, http.StatusBadRequest)
	paid, err := f.svc.RecordManualPayout(ctx, "finance", second.ID, WithdrawalPayoutInput{Succeeded: true, Note: "转账单 1330000"})
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalSucceeded, paid.Status)
	require.Equal(t, "ops", paid.ReviewedBy, "the approver is kept")
	require.Equal(t, "已核对；打款成功（finance）转账单 1330000", paid.ReviewNote)
	summary := f.summary(t, promoterUser)
	require.Equal(t, int64(0), summary.AvailableCents)
	require.Equal(t, int64(4000), summary.WithdrawnCents)
	require.Equal(t, int64(800), summary.PendingCents)

	f.commission(t, promoterID, 1200, domain.CommissionAvailable)
	_, err = withdraw("k4", 1200)
	require.Equal(t, http.StatusTooManyRequests, httpStatus(t, err))
	f.now = f.now.Add(14 * time.Hour) // the next calendar day in Shanghai
	third, err := withdraw("k4", 1200)
	require.NoError(t, err)

	_, err = f.svc.ChangeStatus(ctx, "ops", promoterID, StatusInput{Status: domain.StatusSuspended})
	require.NoError(t, err)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", third.ID, WithdrawalReviewInput{Approve: true})
	requireStatus(t, err, http.StatusConflict)
	f.commission(t, promoterID, 1000, domain.CommissionAvailable)
	f.now = f.now.Add(24 * time.Hour)
	_, err = withdraw("k5", 1000)
	requireStatus(t, err, http.StatusForbidden)

	page, err := f.svc.AdminWithdrawals(ctx, domain.WithdrawalReviewing, 1, 20)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, third.ID, page.Items[0].ID)
	require.Equal(t, "推广员", page.Items[0].Nickname)
	require.Equal(t, domain.StatusSuspended, page.Items[0].PromoterStatus)
	require.Equal(t, int64(1000), page.Items[0].AvailableCents)
}

func TestManualReverseCanLeaveBalanceNegative(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	paidOut := f.commission(t, promoterID, 3000, domain.CommissionAvailable)
	pending := f.commission(t, promoterID, 500, domain.CommissionPending)

	w, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 3000, RequestKey: "a"})
	require.NoError(t, err)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true})
	require.NoError(t, err)
	_, err = f.svc.RecordManualPayout(ctx, "ops", w.ID, WithdrawalPayoutInput{Succeeded: true})
	require.NoError(t, err)

	_, err = f.svc.ReverseCommission(ctx, "ops", paidOut, ReverseCommissionInput{})
	requireStatus(t, err, http.StatusBadRequest)
	out, err := f.svc.ReverseCommission(ctx, "ops", paidOut, ReverseCommissionInput{Reason: "商户平台退款 50300"})
	require.NoError(t, err)
	require.Equal(t, domain.CommissionReversed, out.Status)
	_, err = f.svc.ReverseCommission(ctx, "ops", paidOut, ReverseCommissionInput{Reason: "again"})
	requireStatus(t, err, http.StatusConflict)
	out, err = f.svc.ReverseCommission(ctx, "ops", pending, ReverseCommissionInput{Reason: "退款"})
	require.NoError(t, err)
	require.Equal(t, domain.CommissionCancelled, out.Status)
	require.Equal(t, int64(-3000), f.summary(t, promoterUser).AvailableCents, "the payout stays; later commission pays it back")

	f.commission(t, promoterID, 5000, domain.CommissionAvailable)
	_, err = f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 2001, RequestKey: "b"})
	requireStatus(t, err, http.StatusBadRequest)
	f.now = f.now.Add(24 * time.Hour)
	late, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 2000, RequestKey: "c"})
	require.NoError(t, err)
	f.commission(t, promoterID, 1000, domain.CommissionAvailable)
	commissions, err := f.svc.AdminCommissions(ctx, promoterID, domain.CommissionAvailable, 1, 20)
	require.NoError(t, err)
	require.Len(t, commissions.Items, 2)
	_, err = f.svc.ReverseCommission(ctx, "ops", commissions.Items[0].ID, ReverseCommissionInput{Reason: "退款"})
	require.NoError(t, err)
	_, err = f.svc.ReverseCommission(ctx, "ops", commissions.Items[1].ID, ReverseCommissionInput{Reason: "退款"})
	require.NoError(t, err)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", late.ID, WithdrawalReviewInput{Approve: true})
	requireStatus(t, err, http.StatusConflict)

	reversed, err := f.svc.AdminCommissions(ctx, promoterID, domain.CommissionReversed, 1, 20)
	require.NoError(t, err)
	require.Len(t, reversed.Items, 3)
	require.Contains(t, []string{reversed.Items[0].ReverseReason, reversed.Items[1].ReverseReason, reversed.Items[2].ReverseReason}, "admin: 商户平台退款 50300")
	_, err = f.svc.AdminCommissions(ctx, "bad", "", 1, 20)
	require.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestConcurrentWithdrawalsCannotOverdraw(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	f.svc.rules.WithdrawPerDay = 10
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 5000, domain.CommissionAvailable)

	const attempts = 6
	errs := make([]error, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 5000, RequestKey: uuid.NewString()})
		}(i)
	}
	wg.Wait()
	succeeded := 0
	for _, err := range errs {
		if err == nil {
			succeeded++
			continue
		}
		require.Contains(t, []int{http.StatusBadRequest, http.StatusConflict}, httpStatus(t, err))
	}
	require.Equal(t, 1, succeeded)
	require.Equal(t, int64(0), f.summary(t, promoterUser).AvailableCents)
}

func httpStatus(t *testing.T, err error) int {
	t.Helper()
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	return appErr.HTTPStatus
}
