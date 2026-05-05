package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) (*repo.ExpiryRepo, *repo.TaskRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.ExpiryItem{}, &analyzedomain.AnalysisTask{}))
	return repo.NewExpiryRepo(db), repo.NewTaskRepo(db)
}

func TestExpiryService_Dashboard(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	today := time.Now()
	soon := today.AddDate(0, 0, 3)
	far := today.AddDate(0, 0, 10)

	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "a", Status: "active", ExpiryDate: &today}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "b", Status: "active", ExpiryDate: &soon}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "c", Status: "active", ExpiryDate: &far}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "d", Status: "consumed"}))

	dash, err := svc.Dashboard(ctx, "u1")
	require.NoError(t, err)
	assert.Equal(t, 3, dash.ActiveCount)
	assert.Equal(t, 1, dash.ConsumedCount)
	assert.Len(t, dash.ExpiringSoon, 2)
}

func TestExpiryService_CreateItem(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item, err := svc.CreateItem(ctx, "u1", CreateItemInput{Name: "milk"})
	require.NoError(t, err)
	assert.Equal(t, "milk", item.Name)
	assert.Equal(t, "active", item.Status)

	_, err = svc.CreateItem(ctx, "u1", CreateItemInput{Name: ""})
	require.Error(t, err)
}

func TestExpiryService_GetItem(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", Name: "egg", Status: "active"}
	require.NoError(t, expiryRepo.Create(ctx, item))

	found, err := svc.GetItem(ctx, "u1", item.ID)
	require.NoError(t, err)
	assert.Equal(t, "egg", found.Name)

	_, err = svc.GetItem(ctx, "u1", "nonexistent")
	require.Error(t, err)

	_, err = svc.GetItem(ctx, "u2", item.ID)
	require.Error(t, err)
}

func TestExpiryService_UpdateItem(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", Name: "bread", Status: "active"}
	require.NoError(t, expiryRepo.Create(ctx, item))

	newName := "sourdough"
	updated, err := svc.UpdateItem(ctx, "u1", item.ID, UpdateItemInput{Name: &newName})
	require.NoError(t, err)
	assert.Equal(t, "sourdough", updated.Name)

	emptyName := ""
	_, err = svc.UpdateItem(ctx, "u1", item.ID, UpdateItemInput{Name: &emptyName})
	require.Error(t, err)

	_, err = svc.UpdateItem(ctx, "u1", item.ID, UpdateItemInput{})
	require.Error(t, err)
}

func TestExpiryService_UpdateStatus(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", Name: "yogurt", Status: "active"}
	require.NoError(t, expiryRepo.Create(ctx, item))

	updated, err := svc.UpdateStatus(ctx, "u1", item.ID, "consumed")
	require.NoError(t, err)
	assert.Equal(t, "consumed", updated.Status)

	_, err = svc.UpdateStatus(ctx, "u1", item.ID, "")
	require.Error(t, err)
}

func TestExpiryService_Subscribe(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", Name: "cheese", Status: "active"}
	require.NoError(t, expiryRepo.Create(ctx, item))

	res, err := svc.Subscribe(ctx, "u1", item.ID)
	require.NoError(t, err)
	assert.True(t, res.Subscribed)

	_, err = svc.Subscribe(ctx, "u2", item.ID)
	require.Error(t, err)
}

func TestExpiryService_Recognize(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	_, err := svc.Recognize(ctx, "u1", nil)
	require.Error(t, err)

	res, err := svc.Recognize(ctx, "u1", []string{"https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotEmpty(t, res.TaskID)
}
