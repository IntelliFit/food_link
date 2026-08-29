package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/repo"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDB(t *testing.T) (*repo.ExpiryRepo, *repo.TaskRepo) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.ExpiryItem{}, &domain.ExpiryNotificationJob{}, &analyzedomain.AnalysisTask{}))
	return repo.NewExpiryRepo(db), repo.NewTaskRepo(db)
}

func TestExpiryService_Dashboard(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	today := time.Now()
	soon := today.AddDate(0, 0, 3)
	far := today.AddDate(0, 0, 10)

	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", FoodName: "a", Status: "active", ExpireDate: today}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", FoodName: "b", Status: "active", ExpireDate: soon}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", FoodName: "c", Status: "active", ExpireDate: far}))
	require.NoError(t, expiryRepo.Create(ctx, &domain.ExpiryItem{UserID: "u1", FoodName: "d", Status: "consumed", ExpireDate: far}))

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

	expireDate := time.Now().AddDate(0, 0, 3)
	item, err := svc.CreateItem(ctx, "u1", CreateItemInput{Name: "milk", ExpireDate: &expireDate})
	require.NoError(t, err)
	assert.Equal(t, "milk", item.FoodName)
	assert.Equal(t, "active", item.Status)

	_, err = svc.CreateItem(ctx, "u1", CreateItemInput{Name: "", ExpireDate: &expireDate})
	require.Error(t, err)
}

func TestExpiryService_GetItem(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", FoodName: "egg", Status: "active", ExpireDate: time.Now()}
	require.NoError(t, expiryRepo.Create(ctx, item))

	found, err := svc.GetItem(ctx, "u1", item.ID)
	require.NoError(t, err)
	assert.Equal(t, "egg", found.FoodName)

	_, err = svc.GetItem(ctx, "u1", "nonexistent")
	require.Error(t, err)

	_, err = svc.GetItem(ctx, "u2", item.ID)
	require.Error(t, err)
}

func TestExpiryService_UpdateItem(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", FoodName: "bread", Status: "active", ExpireDate: time.Now()}
	require.NoError(t, expiryRepo.Create(ctx, item))

	newName := "sourdough"
	updated, err := svc.UpdateItem(ctx, "u1", item.ID, UpdateItemInput{Name: &newName})
	require.NoError(t, err)
	assert.Equal(t, "sourdough", updated.FoodName)

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

	item := &domain.ExpiryItem{UserID: "u1", FoodName: "yogurt", Status: "active", ExpireDate: time.Now()}
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

	item := &domain.ExpiryItem{UserID: "u1", FoodName: "cheese", Status: "active", ExpireDate: time.Now()}
	require.NoError(t, expiryRepo.Create(ctx, item))

	svc.ConfigureNotificationTemplate("template-id")
	res, err := svc.SubscribeWithContext(ctx, "u1", item.ID, "openid-1", "accept", "")
	require.NoError(t, err)
	assert.True(t, res.Subscribed)

	_, err = svc.SubscribeWithContext(ctx, "u2", item.ID, "openid-2", "accept", "")
	require.Error(t, err)
}

func TestBuildNotificationPayloadUsesCurrentWechatTemplateKeywords(t *testing.T) {
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	item := &domain.ExpiryItem{
		FoodName:    "冷藏牛奶",
		StorageType: "refrigerated",
		ExpireDate:  time.Date(2026, 8, 22, 0, 0, 0, 0, china),
	}

	payload := buildNotificationPayload(item)

	assert.Equal(t, map[string]any{
		"thing12": map[string]any{"value": "冷藏牛奶"},
		"time1":   map[string]any{"value": "2026-08-22 09:00"},
		"thing4":  map[string]any{"value": "今天到期，请优先处理"},
		"thing17": map[string]any{"value": "冷藏"},
	}, payload)
	assert.NotContains(t, payload, "thing1")
	assert.NotContains(t, payload, "time2")
	assert.NotContains(t, payload, "character_string5")
}

func TestBuildNotificationPayloadTruncatesThingValues(t *testing.T) {
	item := &domain.ExpiryItem{
		FoodName:    "这是一个超过微信订阅消息二十字符限制的超长食物名称",
		StorageType: "refrigerated",
		ExpireDate:  time.Date(2026, 8, 22, 0, 0, 0, 0, time.UTC),
	}

	payload := buildNotificationPayload(item)
	name := payload["thing12"].(map[string]any)["value"].(string)

	assert.Len(t, []rune(name), 20)
}

func TestExpiryService_Recognize(t *testing.T) {
	expiryRepo, taskRepo := setupTestDB(t)
	svc := NewExpiryService(expiryRepo, taskRepo)
	ctx := context.Background()

	_, err := svc.Recognize(ctx, "u1", nil)
	require.Error(t, err)

	_, err = svc.Recognize(ctx, "u1", []string{"https://example.com/img.jpg"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "保质期识别服务未初始化")
}
