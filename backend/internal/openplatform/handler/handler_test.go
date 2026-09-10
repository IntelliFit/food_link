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
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	healthservice "food_link/backend/internal/health/service"
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
	summaries   analyzeservice.TaskSummaryListPage
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

func (f *fakeTaskService) ListTaskSummariesPage(context.Context, string, string, string, int, int) (analyzeservice.TaskSummaryListPage, error) {
	return f.summaries, nil
}

type fakeFoodRecordReader struct {
	records []foodrecorddomain.FoodRecord
}

func (f fakeFoodRecordReader) ListPage(context.Context, string, string, int, int) ([]foodrecorddomain.FoodRecord, bool, int, error) {
	return f.records, true, len(f.records), nil
}

type fakeStatsSummaryReader struct {
	summary *healthservice.StatsSummary
}

func (f fakeStatsSummaryReader) GetSummary(context.Context, string, string, int, int) (*healthservice.StatsSummary, error) {
	return f.summary, nil
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
			"items": []any{map[string]any{
				"name":                      "米饭",
				"provider":                  "hidden-provider",
				"ediblePortionSource":       "hidden-edible-source",
				"micronutrient_source":      "hidden-micronutrient-source",
				"nutrition_source":          "ai_direct",
				"nutrition_source_category": "database",
			}},
			"modelName":          "hidden-model",
			"base_model":         "hidden-base-model",
			"reviewModel":        "hidden-review-model",
			"planner_modelName":  "hidden-planner-model",
			"modelAgreement":     "hidden-model-agreement",
			"providerRoute":      "hidden-provider-route",
			"analysisEngineName": "hidden-engine",
			"prompt_version":     "hidden-prompt-version",
		},
		ErrorMessage: func() *string { value := "gemini model request failed"; return &value }(),
		CreatedAt:    &now,
		UpdatedAt:    &now,
	}}
	tasks.summaries = analyzeservice.TaskSummaryListPage{
		Tasks: []analyzeservice.TaskSummary{{
			ID: "task-text", TaskType: "food_text", Status: "done", TextPreview: "一碗米饭",
			ExecutionMode: "precision", MealType: "lunch", RecordedOn: "2026-09-10",
			ResultSummary: &analyzeservice.TaskResultSummary{FirstItemName: "米饭", ItemCount: 1, TotalCalories: 116},
			CreatedAt:     &now, UpdatedAt: &now,
		}},
		HasMore: true, NextOffset: 1,
	}
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
	require.NotContains(t, w.Body.String(), "hidden-base-model")
	require.NotContains(t, w.Body.String(), "hidden-review-model")
	require.NotContains(t, w.Body.String(), "hidden-planner-model")
	require.NotContains(t, w.Body.String(), "hidden-model-agreement")
	require.NotContains(t, w.Body.String(), "hidden-provider-route")
	require.NotContains(t, w.Body.String(), "hidden-engine")
	require.NotContains(t, w.Body.String(), "hidden-provider")
	require.NotContains(t, w.Body.String(), "hidden-edible-source")
	require.NotContains(t, w.Body.String(), "hidden-micronutrient-source")
	require.NotContains(t, w.Body.String(), "hidden-prompt-version")
	require.NotContains(t, w.Body.String(), "gemini model request failed")
	require.Contains(t, w.Body.String(), `"error_message":"分析任务处理失败"`)
	require.Contains(t, w.Body.String(), `"nutrition_source":"ai_direct"`)
	require.Contains(t, w.Body.String(), `"nutrition_source_category":"database"`)
	require.Contains(t, w.Body.String(), `"status":"completed"`)
}

func TestOpenPlatformListsApplicationAnalysisHistoryWithoutInternalExecutionFields(t *testing.T) {
	engine, material, _ := newTestOpenPlatform(t)
	req := httptest.NewRequest(http.MethodGet, "/open/v1/food-analyses?limit=1&offset=0", nil)
	req.Header.Set("X-API-Key", material.Secret)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"task_id":"task-text"`)
	require.Contains(t, w.Body.String(), `"input_type":"text"`)
	require.Contains(t, w.Body.String(), `"status":"completed"`)
	require.Contains(t, w.Body.String(), `"has_more":true`)
	require.NotContains(t, w.Body.String(), "execution_mode")
	require.NotContains(t, w.Body.String(), "task_type")
}

func TestOpenPlatformOwnerCanReadOwnRecordsAndHealthWithExplicitScopes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &openplatformdomain.App{}, &openplatformdomain.APIKey{}, &openplatformdomain.Request{}, &openplatformdomain.UsageLedger{}))
	repository := openrepo.New(db)
	platform := openservice.New(repository, &fakeTaskService{}, fakeNutritionService{}, nil)
	created, err := platform.CreateDeveloperApp(context.Background(), "owner-user-1", "个人健康 Agent")
	require.NoError(t, err)
	key, err := platform.CreateDeveloperKey(context.Background(), "owner-user-1", created.App.ID, "个人数据只读", []string{openservice.ScopeRecordsRead, openservice.ScopeHealthRead})
	require.NoError(t, err)
	now := time.Now()
	platform.ConfigureUserData(
		fakeFoodRecordReader{records: []foodrecorddomain.FoodRecord{{
			ID: "record-1", UserID: "owner-user-1", MealType: "lunch", TotalCalories: 520,
			Items:      []foodrecorddomain.FoodItem{{Name: "鸡胸肉", Weight: 150, Nutrients: foodrecorddomain.FoodItemNutrients{Calories: 248, Protein: 46}}},
			RecordTime: &now, CreatedAt: &now,
		}}},
		fakeStatsSummaryReader{summary: &healthservice.StatsSummary{
			Range: "week", RecordedDays: 5, TotalCalories: 7800,
			HealthIndex: &healthservice.HealthIndex{HasEnoughData: true, OverallScore: 86},
		}},
	)
	engine := gin.New()
	openhandler.New(platform).RegisterRoutes(engine)

	recordsReq := httptest.NewRequest(http.MethodGet, "/open/v1/me/food-records?limit=1&offset=0", nil)
	recordsReq.Header.Set("X-API-Key", key.Secret)
	recordsWriter := httptest.NewRecorder()
	engine.ServeHTTP(recordsWriter, recordsReq)
	require.Equal(t, http.StatusOK, recordsWriter.Code, recordsWriter.Body.String())
	require.Contains(t, recordsWriter.Body.String(), `"id":"record-1"`)
	require.Contains(t, recordsWriter.Body.String(), `"name":"鸡胸肉"`)
	require.Contains(t, recordsWriter.Body.String(), `"has_more":true`)
	require.Contains(t, recordsWriter.Body.String(), `"next_offset":1`)
	require.NotContains(t, recordsWriter.Body.String(), "owner-user-1")

	healthReq := httptest.NewRequest(http.MethodGet, "/open/v1/me/health-summary?range=week", nil)
	healthReq.Header.Set("X-API-Key", key.Secret)
	healthWriter := httptest.NewRecorder()
	engine.ServeHTTP(healthWriter, healthReq)
	require.Equal(t, http.StatusOK, healthWriter.Code, healthWriter.Body.String())
	require.Contains(t, healthWriter.Body.String(), `"overall_score":86`)

	forbiddenReq := httptest.NewRequest(http.MethodGet, "/open/v1/me/health-summary", nil)
	forbiddenReq.Header.Set("X-API-Key", created.Secret)
	forbiddenWriter := httptest.NewRecorder()
	engine.ServeHTTP(forbiddenWriter, forbiddenReq)
	require.Equal(t, http.StatusForbidden, forbiddenWriter.Code, forbiddenWriter.Body.String())
}

func TestOpenPlatformRejectsMissingAPIKey(t *testing.T) {
	engine, _, _ := newTestOpenPlatform(t)
	req := httptest.NewRequest(http.MethodGet, "/open/v1/account", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestOpenPlatformUnownedBetaAppCannotReadPersonalData(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &openplatformdomain.App{}, &openplatformdomain.APIKey{}, &openplatformdomain.Request{}, &openplatformdomain.UsageLedger{}))
	platform := openservice.New(openrepo.New(db), &fakeTaskService{}, fakeNutritionService{}, nil)
	material, err := platform.CreateBetaApp(context.Background(), "unowned-beta", 0, []string{openservice.ScopeRecordsRead})
	require.NoError(t, err)
	platform.ConfigureUserData(fakeFoodRecordReader{}, nil)
	engine := gin.New()
	openhandler.New(platform).RegisterRoutes(engine)
	req := httptest.NewRequest(http.MethodGet, "/open/v1/me/food-records", nil)
	req.Header.Set("X-API-Key", material.Secret)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
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
