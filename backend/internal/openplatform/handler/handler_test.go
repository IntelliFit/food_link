package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	openplatformdomain "food_link/backend/internal/openplatform/domain"
	openhandler "food_link/backend/internal/openplatform/handler"
	openratelimit "food_link/backend/internal/openplatform/ratelimit"
	openrepo "food_link/backend/internal/openplatform/repo"
	openservice "food_link/backend/internal/openplatform/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type denyLimiter struct{}

func (denyLimiter) Allow(context.Context, string, int, time.Duration) (openratelimit.Decision, error) {
	return openratelimit.Decision{Allowed: false, Limit: 120, Remaining: 0, ResetAt: time.Now().Add(time.Minute)}, nil
}

type fakeTaskService struct {
	submitCalls int
	task        *analyzedomain.AnalysisTask
}

func (f *fakeTaskService) SubmitOpenAnalyzeTask(context.Context, string, analyzeservice.SubmitTaskInput) (string, error) {
	f.submitCalls++
	return "task-image", nil
}

func (f *fakeTaskService) SubmitOpenTextTask(_ context.Context, _ string, input analyzeservice.SubmitTaskInput) (string, error) {
	f.submitCalls++
	if input.ExtraPayload["open_api"] != true {
		return "", context.Canceled
	}
	return "task-text", nil
}

func (f *fakeTaskService) GetTask(context.Context, string, string) (*analyzedomain.AnalysisTask, error) {
	return f.task, nil
}

type fakeNutritionService struct{}

func (fakeNutritionService) Search(context.Context, string, int) ([]map[string]any, error) {
	return []map[string]any{{"canonical_name": "鸡胸肉"}}, nil
}

func newTestOpenPlatform(t *testing.T) (*gin.Engine, *openservice.KeyMaterial, *fakeTaskService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&authrepo.User{},
		&openplatformdomain.App{},
		&openplatformdomain.APIKey{},
		&openplatformdomain.Request{},
		&openplatformdomain.UsageLedger{},
	))
	now := time.Now()
	tasks := &fakeTaskService{task: &analyzedomain.AnalysisTask{
		ID:       "task-text",
		TaskType: "food_text",
		Status:   "done",
		Result: map[string]any{
			"items":     []any{map[string]any{"name": "米饭", "provider": "hidden-provider"}},
			"modelName": "hidden-model",
		},
		CreatedAt: &now,
		UpdatedAt: &now,
	}}
	repository := openrepo.New(db)
	platform := openservice.New(repository, tasks, fakeNutritionService{}, nil)
	material, err := platform.CreateBetaApp(context.Background(), "workbuddy-test", 100, nil)
	require.NoError(t, err)
	engine := gin.New()
	openhandler.New(platform).RegisterRoutes(engine)
	return engine, material, tasks
}

func TestOpenPlatformTextAnalysisCanBeCalledAndRetriedIdempotently(t *testing.T) {
	engine, material, tasks := newTestOpenPlatform(t)
	body := []byte(`{"text":"一碗米饭和一个鸡蛋","mode":"standard"}`)

	call := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/open/v1/food-analyses", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Key", material.Secret)
		req.Header.Set("Idempotency-Key", "meal-20260901-1")
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w
	}

	first := call()
	require.Equal(t, http.StatusAccepted, first.Code, first.Body.String())
	second := call()
	require.Equal(t, http.StatusAccepted, second.Code, second.Body.String())
	require.Equal(t, 1, tasks.submitCalls)

	var submitted map[string]any
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &submitted))
	data := submitted["data"].(map[string]any)
	require.Equal(t, "task-text", data["task_id"])
	require.Equal(t, true, data["idempotent"])

	req := httptest.NewRequest(http.MethodGet, "/open/v1/food-analyses/task-text", nil)
	req.Header.Set("Authorization", "Bearer "+material.Secret)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "hidden-model")
	require.NotContains(t, w.Body.String(), "hidden-provider")
	require.Contains(t, w.Body.String(), `"status":"completed"`)
}

func TestOpenPlatformRejectsMissingAPIKey(t *testing.T) {
	engine, _, _ := newTestOpenPlatform(t)
	req := httptest.NewRequest(http.MethodGet, "/open/v1/account", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestOpenPlatformRateLimitReturns429AndRetryHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &openplatformdomain.App{}, &openplatformdomain.APIKey{}, &openplatformdomain.Request{}, &openplatformdomain.UsageLedger{}))
	repository := openrepo.New(db)
	platform := openservice.New(repository, &fakeTaskService{}, fakeNutritionService{}, nil)
	material, err := platform.CreateBetaApp(context.Background(), "limited", 100, nil)
	require.NoError(t, err)
	handler := openhandler.New(platform)
	handler.ConfigureRateLimiter(denyLimiter{})
	engine := gin.New()
	handler.RegisterRoutes(engine)
	req := httptest.NewRequest(http.MethodGet, "/open/v1/account", nil)
	req.Header.Set("X-API-Key", material.Secret)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusTooManyRequests, w.Code, w.Body.String())
	require.Equal(t, "120", w.Header().Get("X-RateLimit-Limit"))
	require.Equal(t, "0", w.Header().Get("X-RateLimit-Remaining"))
	require.NotEmpty(t, w.Header().Get("Retry-After"))
}
