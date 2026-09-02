package service_test

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	authrepo "food_link/backend/internal/auth/repo"
	openplatformdomain "food_link/backend/internal/openplatform/domain"
	openrepo "food_link/backend/internal/openplatform/repo"
	openservice "food_link/backend/internal/openplatform/service"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeNativeGateway struct {
	queryCalls int
	state      map[string]any
}

func (f *fakeNativeGateway) CreateNativeOrder(string, string, int) (string, error) {
	return "weixin://wxpay/bizpayurl?pr=test", nil
}

func (f *fakeNativeGateway) QueryOrder(context.Context, string) (map[string]any, error) {
	f.queryCalls++
	return f.state, nil
}

func newReliabilityService(t *testing.T) (*gorm.DB, *openrepo.Repository, *openservice.Service) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&authrepo.User{}, &analyzedomain.AnalysisTask{},
		&openplatformdomain.App{}, &openplatformdomain.APIKey{}, &openplatformdomain.Request{}, &openplatformdomain.UsageLedger{},
		&openplatformdomain.CreditPackage{}, &openplatformdomain.PaymentOrder{},
	))
	repository := openrepo.New(db)
	return db, repository, openservice.New(repository, nil, nil, nil)
}

func TestSyncPaymentOrderActivelyQueriesAndCreditsOnce(t *testing.T) {
	ctx := context.Background()
	_, repository, platform := newReliabilityService(t)
	material, err := platform.CreateDeveloperApp(ctx, "owner-sync", "主动查单")
	require.NoError(t, err)
	require.NoError(t, repository.UpsertCreditPackage(ctx, &openplatformdomain.CreditPackage{Code: "starter", Name: "入门包", Units: 1000, AmountFen: 2900, IsActive: true}))
	gateway := &fakeNativeGateway{state: map[string]any{
		"trade_state": "SUCCESS", "transaction_id": "wx-sync-1", "success_time": "2026-09-01T08:00:00+08:00",
		"amount": map[string]any{"total": float64(2900)},
	}}
	platform.ConfigurePayment(gateway, openservice.PaymentConfig{})
	created, err := platform.CreatePaymentOrder(ctx, "owner-sync", material.App.ID, "starter")
	require.NoError(t, err)

	synced, err := platform.SyncPaymentOrder(ctx, "owner-sync", created.OrderNo)
	require.NoError(t, err)
	require.Equal(t, openplatformdomain.PaymentOrderPaid, synced.Status)
	require.Equal(t, 1, gateway.queryCalls)

	synced, err = platform.SyncPaymentOrder(ctx, "owner-sync", created.OrderNo)
	require.NoError(t, err)
	require.Equal(t, openplatformdomain.PaymentOrderPaid, synced.Status)
	require.Equal(t, 1, gateway.queryCalls, "paid order must not query or credit twice")
	apps, err := repository.ListAppsByOwner(ctx, "owner-sync")
	require.NoError(t, err)
	require.Equal(t, int64(1100), apps[0].BalanceUnits)
}

func TestReconcileUsageRefundsFailedTaskWithoutCallerPolling(t *testing.T) {
	ctx := context.Background()
	db, repository, platform := newReliabilityService(t)
	material, err := platform.CreateBetaApp(ctx, "reconcile", 20, nil)
	require.NoError(t, err)
	reserved, err := repository.Reserve(ctx, material.App.ID, "reconcile-1", openservice.OperationFoodAnalysis, 5, nil)
	require.NoError(t, err)
	now := time.Now()
	task := analyzedomain.AnalysisTask{ID: uuid.NewString(), UserID: material.App.ServiceUserID, TaskType: "food_text", Status: "failed", CreatedAt: &now, UpdatedAt: &now}
	require.NoError(t, db.Create(&task).Error)
	require.NoError(t, repository.MarkSubmitted(ctx, reserved.Request.ID, task.ID))

	summary, err := platform.ReconcileUsage(ctx, 100)
	require.NoError(t, err)
	require.Equal(t, openservice.ReconciliationSummary{Scanned: 1, Refunded: 1}, summary)
	apps, err := repository.ListAppsByOwner(ctx, "missing-owner")
	require.NoError(t, err)
	require.Empty(t, apps)
	principal, err := repository.Authenticate(ctx, openservice.HashAPIKey(material.Secret))
	require.NoError(t, err)
	require.Equal(t, int64(20), principal.App.BalanceUnits)

	summary, err = platform.ReconcileUsage(ctx, 100)
	require.NoError(t, err)
	require.Zero(t, summary.Scanned)
}

func TestReconcileUsageRefundsAbandonedReservationAfterTenMinutes(t *testing.T) {
	ctx := context.Background()
	db, repository, platform := newReliabilityService(t)
	material, err := platform.CreateBetaApp(ctx, "abandoned", 20, nil)
	require.NoError(t, err)
	reserved, err := repository.Reserve(ctx, material.App.ID, "abandoned-1", openservice.OperationFoodAnalysis, 5, nil)
	require.NoError(t, err)
	require.NoError(t, db.Model(&openplatformdomain.Request{}).Where("id = ?", reserved.Request.ID).Update("created_at", time.Now().Add(-11*time.Minute)).Error)
	summary, err := platform.ReconcileUsage(ctx, 100)
	require.NoError(t, err)
	require.Equal(t, 1, summary.Refunded)
	principal, err := repository.Authenticate(ctx, openservice.HashAPIKey(material.Secret))
	require.NoError(t, err)
	require.Equal(t, int64(20), principal.App.BalanceUnits)
}
