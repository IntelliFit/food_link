package service

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/wechattransfer"
	"food_link/backend/pkg/wechatpay"

	"github.com/stretchr/testify/require"
)

// fakeTransferClient plays WeChat: a created bill waits for the payee until
// the test sets another state.
type fakeTransferClient struct {
	mu        sync.Mutex
	requests  []wechatpay.TransferBillRequest
	createErr error
	bills     map[string]*wechatpay.TransferBill
}

func newFakeTransferClient() *fakeTransferClient {
	return &fakeTransferClient{bills: map[string]*wechatpay.TransferBill{}}
}

func (c *fakeTransferClient) CreateTransferBill(_ context.Context, req wechatpay.TransferBillRequest) (*wechatpay.TransferBill, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.requests = append(c.requests, req)
	if c.createErr != nil {
		return nil, c.createErr
	}
	bill, ok := c.bills[req.OutBillNo]
	if !ok {
		bill = &wechatpay.TransferBill{
			MchID: "1105991965", OutBillNo: req.OutBillNo, TransferBillNo: "1330" + req.OutBillNo, State: wechattransfer.StateWaitUserConfirm,
			TransferAmount: req.TransferAmount, OpenID: req.OpenID, PackageInfo: "pkg-" + req.OutBillNo,
		}
		c.bills[req.OutBillNo] = bill
	}
	// Create answers carry no amount, payee or merchant.
	return &wechatpay.TransferBill{OutBillNo: bill.OutBillNo, TransferBillNo: bill.TransferBillNo, State: bill.State, PackageInfo: bill.PackageInfo}, nil
}

func (c *fakeTransferClient) QueryTransferBill(_ context.Context, outBillNo string) (*wechatpay.TransferBill, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	bill, ok := c.bills[outBillNo]
	if !ok {
		return nil, &wechatpay.APIError{Status: http.StatusNotFound, Code: "NOT_FOUND", Message: "记录不存在"}
	}
	copied := *bill
	return &copied, nil
}

func (c *fakeTransferClient) finish(state, reason string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, bill := range c.bills {
		bill.State, bill.FailReason, bill.PackageInfo = state, reason, ""
	}
}

func (f *fixture) withTransfer(t *testing.T) *fakeTransferClient {
	t.Helper()
	client := newFakeTransferClient()
	transfer := wechattransfer.NewService(f.db, client, wechattransfer.Settings{
		MchID: "1105991965", AppID: "wx-mini", NotifyURL: "https://api.example.test/api/payment/wechat/transfer/notify",
		LeaseGap: time.Nanosecond, // the lease runs on the database clock, which the test cannot move
	})
	transfer.SetClock(func() time.Time { return f.now })
	f.svc.ConfigureTransfer(transfer)
	return client
}

func TestWechatTransferPaysWithdrawalAfterPayeeConfirms(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	client := f.withTransfer(t)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 5000, domain.CommissionAvailable)
	w, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 3000, RequestKey: "a"})
	require.NoError(t, err)

	_, err = f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: "alipay"})
	requireStatus(t, err, http.StatusBadRequest)
	approved, err := f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: domain.PayoutWechatTransfer})
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalTransferring, approved.Status)
	require.Equal(t, domain.PayoutWechatTransfer, approved.PayoutMethod)
	require.NotNil(t, approved.TransferBillID)

	require.Len(t, client.requests, 1)
	req := client.requests[0]
	require.Equal(t, "openid-"+promoterUser, req.OpenID)
	require.Equal(t, int64(3000), req.TransferAmount)
	require.Equal(t, "1005", req.TransferSceneID)
	require.Equal(t, "wx-mini", req.AppID)
	require.Equal(t, "食探推广佣金", req.TransferRemark)
	require.Equal(t, "劳务报酬", req.UserRecvPerception)
	require.Len(t, req.TransferSceneReportInfos, 2)
	require.Regexp(t, `^PW\d{8}[0-9A-F]{16}$`, req.OutBillNo)

	list, err := f.svc.Withdrawals(ctx, promoterUser, 1, 20)
	require.NoError(t, err)
	require.NotNil(t, list.Items[0].Receive)
	require.Equal(t, domain.ReceiveInfo{MchID: "1105991965", AppID: "wx-mini", Package: "pkg-" + req.OutBillNo}, *list.Items[0].Receive)
	summary := f.summary(t, promoterUser)
	require.Equal(t, int64(2000), summary.AvailableCents)
	require.Equal(t, int64(3000), summary.WithdrawingCents)
	_, err = f.svc.RecordManualPayout(ctx, "ops", w.ID, WithdrawalPayoutInput{Succeeded: true})
	requireStatus(t, err, http.StatusConflict)

	client.finish(wechattransfer.StateSuccess, "")
	f.now = f.now.Add(time.Minute)
	item, err := f.svc.RefreshWithdrawal(ctx, promoterUser, w.ID)
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalSucceeded, item.Status)
	require.Nil(t, item.Receive)
	require.NotNil(t, item.FinishedAt)
	require.Equal(t, int64(3000), f.summary(t, promoterUser).WithdrawnCents)

	_, err = f.svc.RefreshWithdrawal(ctx, f.user(t, "别人", f.now), w.ID)
	require.Error(t, err, "only the owner can refresh")
}

func TestWechatTransferRetriesThenFailsAndReleasesBalance(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	client := f.withTransfer(t)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 5000, domain.CommissionAvailable)
	w, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 5000, RequestKey: "a"})
	require.NoError(t, err)

	client.createErr = &wechatpay.APIError{Status: http.StatusInternalServerError, Code: "SYSTEM_ERROR", Message: "系统繁忙"}
	approved, err := f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: domain.PayoutWechatTransfer})
	require.NoError(t, err, "a failed send leaves the approval in place")
	require.Equal(t, domain.WithdrawalTransferring, approved.Status)
	page, err := f.svc.AdminWithdrawals(ctx, "", 1, 20)
	require.NoError(t, err)
	require.True(t, page.TransferEnabled)
	require.Equal(t, wechattransfer.StateCreated, page.Items[0].TransferState)
	require.Contains(t, page.Items[0].TransferLastError, "SYSTEM_ERROR")

	client.createErr = nil
	f.now = f.now.Add(time.Minute)
	view, err := f.svc.AdminSyncTransfer(ctx, "ops", w.ID)
	require.NoError(t, err)
	require.Equal(t, wechattransfer.StateWaitUserConfirm, view.TransferState)
	require.Len(t, client.requests, 2)
	require.Equal(t, client.requests[0].OutBillNo, client.requests[1].OutBillNo, "a retry keeps the bill number")

	client.finish(wechattransfer.StateFail, "REAL_NAME_CHECK_FAIL")
	f.now = f.now.Add(time.Minute)
	view, err = f.svc.AdminSyncTransfer(ctx, "ops", w.ID)
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalFailed, view.Status)
	require.Equal(t, int64(5000), f.summary(t, promoterUser).AvailableCents)
	list, err := f.svc.Withdrawals(ctx, promoterUser, 1, 20)
	require.NoError(t, err)
	require.Equal(t, "你的微信还没有完成实名认证", list.Items[0].Note)
}

func TestWechatTransferGivesUpOnABillWeChatNeverAccepted(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	client := f.withTransfer(t)
	client.createErr = &wechatpay.APIError{Status: http.StatusForbidden, Code: "NO_AUTH", Message: "商户无权限"}
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 2000, domain.CommissionAvailable)
	w, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 2000, RequestKey: "a"})
	require.NoError(t, err)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: domain.PayoutWechatTransfer})
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		f.now = f.now.Add(10 * time.Minute)
		_, err = f.svc.AdminSyncTransfer(ctx, "ops", w.ID)
		requireStatus(t, err, http.StatusBadGateway)
	}
	f.now = f.now.Add(10 * time.Minute)
	view, err := f.svc.AdminSyncTransfer(ctx, "ops", w.ID)
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalFailed, view.Status)
	require.Equal(t, "微信转账没有发起成功", view.FailReason)
	require.Equal(t, int64(2000), f.summary(t, promoterUser).AvailableCents)
	require.Len(t, client.requests, 6, "the first send and one per sync before giving up")
}

func TestWechatTransferNeedsItToBeOnAndAPayee(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, _ := f.activePromoter(t, promoterUser)
	f.commission(t, promoterID, 2000, domain.CommissionAvailable)
	w, err := f.svc.Withdraw(ctx, promoterUser, WithdrawInput{AmountCents: 2000, RequestKey: "a"})
	require.NoError(t, err)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: domain.PayoutWechatTransfer})
	requireStatus(t, err, http.StatusConflict)

	f.withTransfer(t)
	require.NoError(t, f.db.Exec(`UPDATE weapp_user SET openid = '' WHERE id = ?`, promoterUser).Error)
	_, err = f.svc.ReviewWithdrawal(ctx, "ops", w.ID, WithdrawalReviewInput{Approve: true, PayoutMethod: domain.PayoutWechatTransfer})
	requireStatus(t, err, http.StatusConflict)
	var bills int64
	require.NoError(t, f.db.Table("wechat_transfer_bills").Count(&bills).Error)
	require.Zero(t, bills, "a refused approval leaves no bill behind")
	row, err := f.svc.repo.GetWithdrawal(ctx, w.ID)
	require.NoError(t, err)
	require.Equal(t, domain.WithdrawalReviewing, row.Status)
}
