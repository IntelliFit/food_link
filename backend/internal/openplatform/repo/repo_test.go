package repo_test

import (
	"context"
	"testing"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/openplatform/domain"
	openrepo "food_link/backend/internal/openplatform/repo"
	openservice "food_link/backend/internal/openplatform/service"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOpenPlatformRepo(t *testing.T) (*openrepo.Repository, *openservice.Service) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&authrepo.User{},
		&domain.App{},
		&domain.APIKey{},
		&domain.Request{},
		&domain.UsageLedger{},
		&domain.CreditPackage{},
		&domain.PaymentOrder{},
	))
	repository := openrepo.New(db)
	return repository, openservice.New(repository, nil, nil, nil)
}

func TestDeveloperAppOwnershipAndKeyRevocation(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)
	material, err := platform.CreateDeveloperApp(ctx, "owner-1", "我的 Agent")
	require.NoError(t, err)
	require.NotEmpty(t, material.Secret)
	require.Equal(t, int64(100), material.App.BalanceUnits)

	apps, err := platform.ListDeveloperApps(ctx, "owner-1")
	require.NoError(t, err)
	require.Len(t, apps, 1)
	require.Len(t, apps[0].Keys, 1)
	require.Empty(t, apps[0].Keys[0].SecretHash)

	key, err := platform.CreateDeveloperKey(ctx, "owner-1", material.App.ID, "硬件网关", []string{openservice.ScopeFoodAnalyze})
	require.NoError(t, err)
	require.Equal(t, []string{openservice.ScopeFoodAnalyze}, key.APIKey.Scopes)
	require.NoError(t, platform.RevokeDeveloperKey(ctx, "owner-1", material.App.ID, key.APIKey.ID))
	_, err = repository.Authenticate(ctx, openservice.HashAPIKey(key.Secret))
	require.ErrorIs(t, err, openrepo.ErrInvalidCredential)
}

func TestDeveloperWelcomeGrantIsLimitedToFirstAppPerOwner(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)

	first, err := platform.CreateDeveloperApp(ctx, "owner-welcome", "第一个 Agent")
	require.NoError(t, err)
	require.Equal(t, int64(100), first.App.BalanceUnits)

	second, err := platform.CreateDeveloperApp(ctx, "owner-welcome", "第二个 Agent")
	require.NoError(t, err)
	require.Zero(t, second.App.BalanceUnits)

	apps, err := repository.ListAppsByOwner(ctx, "owner-welcome")
	require.NoError(t, err)
	require.Len(t, apps, 2)
	require.Equal(t, int64(100), apps[0].BalanceUnits+apps[1].BalanceUnits)

	firstLedger, err := repository.ListLedger(ctx, first.App.ID, 10)
	require.NoError(t, err)
	require.Len(t, firstLedger, 1)
	require.Equal(t, "developer-welcome:owner-welcome", firstLedger[0].ReferenceKey)
	require.Equal(t, int64(100), firstLedger[0].DeltaUnits)

	secondLedger, err := repository.ListLedger(ctx, second.App.ID, 10)
	require.NoError(t, err)
	require.Empty(t, secondLedger)

	anotherOwner, err := platform.CreateDeveloperApp(ctx, "owner-welcome-2", "另一个账号")
	require.NoError(t, err)
	require.Equal(t, int64(100), anotherOwner.App.BalanceUnits)
}

func TestPaidOrderCreditsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)
	material, err := platform.CreateDeveloperApp(ctx, "owner-pay", "支付测试")
	require.NoError(t, err)
	order := &domain.PaymentOrder{OrderNo: "OA-TEST-1", OwnerUserID: "owner-pay", AppID: material.App.ID, PackageCode: "starter", Units: 1000, AmountFen: 2900, PayChannel: "wechat_native"}
	require.NoError(t, repository.CreatePaymentOrder(ctx, order))

	paidAt := time.Now()
	paid, credited, err := repository.MarkPaymentPaidAndTopUp(ctx, order.OrderNo, "wx-tx-1", paidAt, map[string]any{"source": "test"})
	require.NoError(t, err)
	require.True(t, credited)
	require.Equal(t, domain.PaymentOrderPaid, paid.Status)

	_, credited, err = repository.MarkPaymentPaidAndTopUp(ctx, order.OrderNo, "wx-tx-1", paidAt, map[string]any{"source": "duplicate"})
	require.NoError(t, err)
	require.False(t, credited)

	apps, err := repository.ListAppsByOwner(ctx, "owner-pay")
	require.NoError(t, err)
	require.Equal(t, int64(1100), apps[0].BalanceUnits)
}

func TestReserveIsIdempotentAndRefundsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)
	material, err := platform.CreateBetaApp(ctx, "integration-test", 20, nil)
	require.NoError(t, err)

	principal, err := repository.Authenticate(ctx, openservice.HashAPIKey(material.Secret))
	require.NoError(t, err)
	require.Equal(t, int64(20), principal.App.BalanceUnits)

	first, err := repository.Reserve(ctx, principal.App.ID, "same-request", openservice.OperationFoodAnalysis, 5, nil)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	require.Equal(t, int64(15), first.Balance)

	second, err := repository.Reserve(ctx, principal.App.ID, "same-request", openservice.OperationFoodAnalysis, 5, nil)
	require.NoError(t, err)
	require.True(t, second.Duplicate)
	require.Equal(t, first.Request.ID, second.Request.ID)
	require.Equal(t, int64(15), second.Balance)

	balance, refunded, err := repository.Refund(ctx, first.Request.ID, "upstream failed")
	require.NoError(t, err)
	require.True(t, refunded)
	require.Equal(t, int64(20), balance)

	balance, refunded, err = repository.Refund(ctx, first.Request.ID, "duplicate refund")
	require.NoError(t, err)
	require.False(t, refunded)
	require.Equal(t, int64(20), balance)
}

func TestReserveRejectsInsufficientBalanceAndOperationConflict(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)
	material, err := platform.CreateBetaApp(ctx, "low-balance", 3, nil)
	require.NoError(t, err)

	_, err = repository.Reserve(ctx, material.App.ID, "too-expensive", openservice.OperationFoodAnalysis, 5, nil)
	require.ErrorIs(t, err, openrepo.ErrInsufficientBalance)

	_, err = repository.Reserve(ctx, material.App.ID, "one-key", openservice.OperationFoodAnalysis, 2, nil)
	require.NoError(t, err)
	_, err = repository.Reserve(ctx, material.App.ID, "one-key", "another.operation", 2, nil)
	require.ErrorIs(t, err, openrepo.ErrIdempotencyConflict)
}

func TestTopUpReferenceIsIdempotent(t *testing.T) {
	ctx := context.Background()
	repository, platform := newOpenPlatformRepo(t)
	material, err := platform.CreateBetaApp(ctx, "top-up", 10, nil)
	require.NoError(t, err)

	balance, created, err := repository.TopUp(ctx, material.App.ID, 50, "payment:order-1", "测试充值", nil)
	require.NoError(t, err)
	require.True(t, created)
	require.Equal(t, int64(60), balance)

	balance, created, err = repository.TopUp(ctx, material.App.ID, 50, "payment:order-1", "重复通知", nil)
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, int64(60), balance)
}
