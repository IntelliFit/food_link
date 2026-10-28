package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/promoter/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fixture struct {
	db  *gorm.DB
	svc *PromoterService
	now time.Time
}

func newFixture(t *testing.T, enabled bool) *fixture {
	t.Helper()
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, db.AutoMigrate(&migrationdo.UserDO{}, &migrationdo.MembershipPaymentDO{}))
	require.NoError(t, migration.MigratePromoterCommission(ctx, db, "public"))
	require.NoError(t, migration.MigrateWechatTransfer(ctx, db, "public"))
	f := &fixture{db: db, now: time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)}
	f.svc = NewPromoterService(repo.NewPromoterRepo(db), RulesFromConfig(config.PromoterConfig{Enabled: enabled}))
	f.svc.now = func() time.Time { return f.now }
	return f
}

func (f *fixture) user(t *testing.T, nickname string, registered time.Time) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, f.db.Exec(`INSERT INTO weapp_user (id, openid, nickname, create_time) VALUES (?, ?, ?, ?)`,
		id, "openid-"+id, nickname, registered).Error)
	return id
}

func (f *fixture) payment(t *testing.T, userID, channel string, amount float64, paidAt time.Time) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, f.db.Exec(`INSERT INTO pro_membership_payment_records (id, user_id, plan_code, order_no, amount, pay_channel, status, paid_at)
VALUES (?, ?, 'light_monthly', ?, ?, ?, 'paid', ?)`, id, userID, "order-"+id, amount, channel, paidAt).Error)
	return id
}

// activePromoter applies and approves a promoter, returning its id and code.
func (f *fixture) activePromoter(t *testing.T, userID string) (string, string) {
	t.Helper()
	ctx := context.Background()
	_, err := f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v1", AgreementAccepted: true})
	require.NoError(t, err)
	row, err := f.svc.repo.GetByUser(ctx, userID)
	require.NoError(t, err)
	_, err = f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: true, RealNameConfirmed: true})
	require.NoError(t, err)
	return row.ID, row.PromoCode
}

func requireStatus(t *testing.T, err error, status int) {
	t.Helper()
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr), "want AppError, got %v", err)
	require.Equal(t, status, appErr.HTTPStatus)
}

func TestApplyAndReviewLifecycle(t *testing.T) {
	ctx := context.Background()
	disabled := newFixture(t, false)
	_, err := disabled.svc.Apply(ctx, disabled.user(t, "甲", disabled.now), ApplyInput{AgreementVersion: "v1", AgreementAccepted: true})
	requireStatus(t, err, http.StatusForbidden)

	f := newFixture(t, true)
	userID := f.user(t, "推广员甲", f.now.Add(-30*24*time.Hour))
	_, err = f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v0", AgreementAccepted: true})
	requireStatus(t, err, http.StatusBadRequest)

	me, err := f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v1", AgreementAccepted: true, ApplyNote: "校园推广"})
	require.NoError(t, err)
	require.Equal(t, domain.StatusPendingReview, me.Status)
	require.Empty(t, me.PromoCode, "code is hidden until approved")
	require.Nil(t, me.Summary)

	again, err := f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v1", AgreementAccepted: true})
	require.NoError(t, err)
	require.Equal(t, domain.StatusPendingReview, again.Status)

	row, err := f.svc.repo.GetByUser(ctx, userID)
	require.NoError(t, err)
	require.Regexp(t, `^[A-HJ-NP-Z2-9]{8}$`, row.PromoCode)

	_, err = f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: false})
	requireStatus(t, err, http.StatusBadRequest)
	_, err = f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: false, Note: "请补充推广渠道"})
	require.NoError(t, err)
	me, err = f.svc.Me(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusRejected, me.Status)
	require.Equal(t, "请补充推广渠道", me.ReviewNote)

	me, err = f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v1", AgreementAccepted: true})
	require.NoError(t, err)
	require.Equal(t, domain.StatusPendingReview, me.Status)

	_, err = f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: true})
	requireStatus(t, err, http.StatusBadRequest)
	rate := 3000
	approved, err := f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: true, RealNameConfirmed: true, RateBps: &rate})
	require.NoError(t, err)
	require.Equal(t, domain.StatusActive, approved.Status)
	_, err = f.svc.Review(ctx, "ops", row.ID, ReviewInput{Approve: true, RealNameConfirmed: true})
	requireStatus(t, err, http.StatusConflict)

	me, err = f.svc.Me(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, row.PromoCode, me.PromoCode)
	require.Equal(t, 3000, me.RateBps)
	require.NotNil(t, me.Summary)

	_, err = f.svc.ChangeStatus(ctx, "ops", row.ID, StatusInput{Status: domain.StatusPendingReview})
	requireStatus(t, err, http.StatusBadRequest)
	_, err = f.svc.ChangeStatus(ctx, "ops", row.ID, StatusInput{Status: domain.StatusTerminated})
	require.NoError(t, err)
	_, err = f.svc.ChangeStatus(ctx, "ops", row.ID, StatusInput{Status: domain.StatusActive})
	requireStatus(t, err, http.StatusConflict)
	_, err = f.svc.Apply(ctx, userID, ApplyInput{AgreementVersion: "v1", AgreementAccepted: true})
	requireStatus(t, err, http.StatusForbidden)
}

func TestBindOnlyNewUsersOnce(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	_, code := f.activePromoter(t, promoterUser)

	bind := func(userID, code string) string {
		t.Helper()
		result, err := f.svc.Bind(ctx, userID, BindInput{PromoCode: code})
		require.NoError(t, err)
		return result.Reason
	}
	newUser := f.user(t, "新用户", f.now.Add(-time.Hour))
	require.Equal(t, BindInvalidCode, bind(newUser, "bad-code"))
	require.Equal(t, BindInvalidCode, bind(newUser, "ZZZZZZZZ"))
	require.Equal(t, BindSelf, bind(promoterUser, code))
	require.Equal(t, BindBound, bind(newUser, " "+lower(code)+" "))
	require.Equal(t, BindAlreadyBound, bind(newUser, code))

	oldUser := f.user(t, "老用户", f.now.Add(-48*time.Hour))
	require.Equal(t, BindNotNewUser, bind(oldUser, code))

	payingUser := f.user(t, "已付费", f.now.Add(-time.Hour))
	f.payment(t, payingUser, "wechat_mini_program", 19.9, f.now.Add(-30*time.Minute))
	require.Equal(t, BindNotNewUser, bind(payingUser, code))

	_, err := f.svc.Bind(ctx, f.user(t, "来源错误", f.now), BindInput{PromoCode: code, Source: "poster"})
	requireStatus(t, err, http.StatusBadRequest)

	disabled := newFixture(t, false)
	result, err := disabled.svc.Bind(ctx, disabled.user(t, "乙", disabled.now), BindInput{PromoCode: code})
	require.NoError(t, err)
	require.Equal(t, BindDisabled, result.Reason)
}

func TestSyncAccruesSettlesAndReverses(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	promoterUser := f.user(t, "推广员", f.now.Add(-60*24*time.Hour))
	promoterID, code := f.activePromoter(t, promoterUser)
	invitee := f.user(t, "小明同学", f.now.Add(-time.Hour))
	result, err := f.svc.Bind(ctx, invitee, BindInput{PromoCode: code})
	require.NoError(t, err)
	require.True(t, result.Bound)

	f.payment(t, invitee, "wechat_mini_program", 19.9, f.now.Add(-2*time.Hour)) // before binding
	paid := f.payment(t, invitee, "wechat_mini_program", 19.9, f.now.Add(time.Minute))
	f.payment(t, invitee, "wechat_virtual_payment", 19.9, f.now.Add(2*time.Minute))
	refundedEarly := f.payment(t, invitee, "wechat_papay", 9.9, f.now.Add(3*time.Minute))
	f.now = f.now.Add(10 * time.Minute)

	sync := func() domain.SyncResult {
		t.Helper()
		out, skipped, err := f.svc.SyncCommissions(ctx)
		require.NoError(t, err)
		require.False(t, skipped)
		return out
	}
	require.Equal(t, domain.SyncResult{Accrued: 2}, sync())
	require.Equal(t, domain.SyncResult{}, sync(), "second pass changes nothing")

	var commission struct {
		CommissionCents int64
		Status          string
	}
	require.NoError(t, f.db.Raw(`SELECT commission_cents, status FROM promoter_commissions WHERE payment_id = ?`, paid).Scan(&commission).Error)
	require.Equal(t, int64(398), commission.CommissionCents, "20% of 19.90")
	require.Equal(t, domain.CommissionPending, commission.Status)

	require.NoError(t, f.db.Exec(`UPDATE pro_membership_payment_records SET status = 'refunded', refunded_at = now() WHERE id = ?`, refundedEarly).Error)
	require.Equal(t, domain.SyncResult{Cancelled: 1}, sync())

	f.now = f.now.Add(7 * 24 * time.Hour)
	require.Equal(t, domain.SyncResult{Settled: 1}, sync())
	me, err := f.svc.Me(ctx, promoterUser)
	require.NoError(t, err)
	require.Equal(t, domain.Summary{AvailableCents: 398, TotalEarnedCents: 398, InviteeCount: 1, PaidOrderCount: 1}, *me.Summary)

	page, err := f.svc.Commissions(ctx, promoterUser, 1, 20)
	require.NoError(t, err)
	require.Equal(t, int64(2), page.Total)
	require.Equal(t, "小**", page.Items[0].InviteeNickname)

	require.NoError(t, f.db.Exec(`UPDATE pro_membership_payment_records SET status = 'refunded', refunded_at = now() WHERE id = ?`, paid).Error)
	require.Equal(t, domain.SyncResult{Reversed: 1}, sync())
	me, err = f.svc.Me(ctx, promoterUser)
	require.NoError(t, err)
	require.Equal(t, int64(0), me.Summary.AvailableCents)

	rate := 5000
	_, err = f.svc.SetRate(ctx, "ops", promoterID, RateInput{RateBps: &rate})
	require.NoError(t, err)
	f.payment(t, invitee, "wechat_app", 30, f.now.Add(time.Minute))
	require.Equal(t, domain.SyncResult{Accrued: 1}, sync())
	require.NoError(t, f.db.Raw(`SELECT commission_cents, status FROM promoter_commissions WHERE pay_channel = 'wechat_app'`).Scan(&commission).Error)
	require.Equal(t, int64(1500), commission.CommissionCents)

	require.NoError(t, f.db.Exec(`UPDATE promoter_bindings SET status = 'revoked' WHERE invitee_user_id = ?`, invitee).Error)
	require.Equal(t, domain.SyncResult{Cancelled: 1}, sync(), "revoked binding drops pending commission")

	_, err = f.svc.ChangeStatus(ctx, "ops", promoterID, StatusInput{Status: domain.StatusTerminated})
	require.NoError(t, err)
	require.NoError(t, f.db.Exec(`UPDATE promoter_bindings SET status = 'active' WHERE invitee_user_id = ?`, invitee).Error)
	f.payment(t, invitee, "wechat_app", 30, f.now.Add(2*time.Minute))
	require.Equal(t, domain.SyncResult{}, sync(), "terminated promoters stop earning")
}

func TestSyncKeepsFreezeForLateOrdersAndFlagsStuckOnes(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	_, code := f.activePromoter(t, f.user(t, "推广员", f.now.Add(-60*24*time.Hour)))
	invitee := f.user(t, "新用户", f.now.Add(-time.Hour))
	result, err := f.svc.Bind(ctx, invitee, BindInput{PromoCode: code})
	require.NoError(t, err)
	require.True(t, result.Bound)

	// Paid in the same second as binding, and only seen by the sync ten
	// days later (outage, or a payment confirmed late with its old time).
	late := f.payment(t, invitee, "wechat_mini_program", 19.9, f.now.Truncate(time.Second))
	expiredAfterPay := f.payment(t, invitee, "wechat_mini_program", 9.9, f.now.Add(time.Minute))
	f.now = f.now.Add(10 * 24 * time.Hour)
	out, _, err := f.svc.SyncCommissions(ctx)
	require.NoError(t, err)
	require.Equal(t, domain.SyncResult{Accrued: 2}, out, "late orders still wait out the freeze")

	var settleAt time.Time
	require.NoError(t, f.db.Raw(`SELECT settle_at FROM promoter_commissions WHERE payment_id = ?`, late).Scan(&settleAt).Error)
	require.WithinDuration(t, f.now.Add(7*24*time.Hour), settleAt, time.Second)

	require.NoError(t, f.db.Exec(`UPDATE pro_membership_payment_records SET status = 'expired' WHERE id = ?`, expiredAfterPay).Error)
	f.now = f.now.Add(8 * 24 * time.Hour)
	out, _, err = f.svc.SyncCommissions(ctx)
	require.NoError(t, err)
	require.Equal(t, domain.SyncResult{Settled: 1, Stuck: 1}, out)
}

func TestBindTreatsMissingRegistrationTimeAsNotNew(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	_, code := f.activePromoter(t, f.user(t, "推广员", f.now.Add(-60*24*time.Hour)))
	userID := f.user(t, "无注册时间", f.now)
	require.NoError(t, f.db.Exec(`UPDATE weapp_user SET create_time = NULL WHERE id = ?`, userID).Error)
	result, err := f.svc.Bind(ctx, userID, BindInput{PromoCode: code})
	require.NoError(t, err)
	require.Equal(t, BindNotNewUser, result.Reason)
}

func TestAdminActionsRejectMalformedIDs(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	_, err := f.svc.Review(ctx, "ops", "not-a-uuid", ReviewInput{Approve: true, RealNameConfirmed: true})
	requireStatus(t, err, http.StatusNotFound)
	_, err = f.svc.ChangeStatus(ctx, "ops", "not-a-uuid", StatusInput{Status: domain.StatusSuspended})
	requireStatus(t, err, http.StatusNotFound)
	_, err = f.svc.SetRate(ctx, "ops", uuid.NewString(), RateInput{})
	requireStatus(t, err, http.StatusNotFound)
}

func TestSyncSkipsWhileAnotherReplicaHoldsTheLock(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t, true)
	holder := f.db.Begin()
	defer holder.Rollback()
	require.NoError(t, holder.Exec(`SELECT pg_advisory_xact_lock(hashtext('food-link:promoter-commission-sync'))`).Error)
	_, skipped, err := f.svc.SyncCommissions(ctx)
	require.NoError(t, err)
	require.True(t, skipped)
}

func TestRulesFromConfigDefaults(t *testing.T) {
	rules := RulesFromConfig(config.PromoterConfig{DefaultRateBps: 20000})
	require.Equal(t, 2000, rules.DefaultRateBps)
	require.Equal(t, 7*24*time.Hour, rules.SettleDelay)
	require.Equal(t, 365*24*time.Hour, rules.BindingValidity)
	require.Equal(t, 24*time.Hour, rules.BindWindow)
	require.Equal(t, "v1", rules.AgreementVersion)
	require.Equal(t, 10*time.Minute, rules.SyncInterval)
}

func TestMaskNickname(t *testing.T) {
	require.Equal(t, "食探用户", maskNickname("  "))
	require.Equal(t, "小**", maskNickname("小明同学"))
	require.Equal(t, "A**", maskNickname("Alice"))
}

func lower(s string) string {
	out := []byte(s)
	for i, c := range out {
		if c >= 'A' && c <= 'Z' {
			out[i] = c + 32
		}
	}
	return string(out)
}
