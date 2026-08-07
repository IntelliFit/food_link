package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	campuscatalogservice "food_link/backend/internal/campuscatalog/service"
	systemhandler "food_link/backend/internal/system/handler"
	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type recordingCampusNutritionBackfiller struct {
	called   chan int
	repaired chan int
}

func (f *recordingCampusNutritionBackfiller) SubmitPublishedNutritionBackfill(_ context.Context, limit int) (int, error) {
	f.called <- limit
	return 1, nil
}

func (f *recordingCampusNutritionBackfiller) RepairLegacyAnalysisTasks(_ context.Context, limit int) (campuscatalogservice.LegacyAnalysisRepairSummary, error) {
	f.repaired <- limit
	return campuscatalogservice.LegacyAnalysisRepairSummary{Scanned: 1, Retried: 1}, nil
}

func TestAppPackage(t *testing.T) {
	// This is a compile-time / smoke test for the app package
	// The New() function requires real database/config which is not feasible in unit tests
	assert.True(t, true)
}

func TestStartCampusCatalogNutritionBackfillRunsImmediately(t *testing.T) {
	app := &App{}
	backfiller := &recordingCampusNutritionBackfiller{called: make(chan int, 1), repaired: make(chan int, 1)}
	app.startCampusCatalogNutritionBackfill(backfiller)
	t.Cleanup(func() {
		app.catalogBackfillCancel()
		<-app.catalogBackfillDone
	})

	select {
	case limit := <-backfiller.called:
		assert.Equal(t, 100, limit)
	case <-time.After(time.Second):
		t.Fatal("历史校园菜品营养补分析未立即执行")
	}
	select {
	case limit := <-backfiller.repaired:
		assert.Equal(t, 20, limit)
	case <-time.After(time.Second):
		t.Fatal("旧版校园菜品分析任务未立即对账")
	}
}

func TestShouldTraceHTTPRequestSkipsHealthCheck(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/health", nil)
	assert.NoError(t, err)
	assert.False(t, shouldTraceHTTPRequest(req))
}

func TestShouldTraceHTTPRequestTracesOtherRoutes(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/membership/me", nil)
	assert.NoError(t, err)
	assert.True(t, shouldTraceHTTPRequest(req))
	assert.True(t, shouldTraceHTTPRequest(nil))
}

func TestRegisterPublicConfigRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	handler := systemhandler.New(&config.Config{
		App: config.AppConfig{AllowDebugRegister: true},
	})
	registerPublicConfigRoutes(engine, handler)

	for _, path := range []string{"/api/app/public-config", "/api/public-config"} {
		w := httptest.NewRecorder()
		req, err := http.NewRequest(http.MethodGet, path, nil)
		assert.NoError(t, err)

		engine.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code, path)
		var resp map[string]any
		assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, true, resp["allow_debug_register"], path)
	}
}

func TestResolvePixelAvatarAPIKeyPrefersDedicatedKey(t *testing.T) {
	external := config.ExternalConfig{
		PixelAvatarAPIKey:  " pixel-key ",
		OfoxAIAPIKey:       "shared-key",
		PixelAvatarBaseURL: "https://maas-openapi.wanjiedata.com/api/v1",
		OfoxAIBaseURL:      "https://maas-openapi.wanjiedata.com/api/v1",
	}
	assert.Equal(t, "pixel-key", resolvePixelAvatarAPIKey(external))
}

func TestResolvePixelAvatarAPIKeyFallsBackToSameWanjieAccount(t *testing.T) {
	external := config.ExternalConfig{
		OfoxAIAPIKey:       " shared-key ",
		PixelAvatarBaseURL: "https://maas-openapi.wanjiedata.com/api/v1",
		OfoxAIBaseURL:      "https://maas-openapi.wanjiedata.com/api/v1",
	}
	assert.Equal(t, "shared-key", resolvePixelAvatarAPIKey(external))
}

func TestResolvePixelAvatarAPIKeyDoesNotCrossProviders(t *testing.T) {
	external := config.ExternalConfig{
		OfoxAIAPIKey:       "other-provider-key",
		PixelAvatarBaseURL: "https://maas-openapi.wanjiedata.com/api/v1",
		OfoxAIBaseURL:      "https://example.com/api/v1",
	}
	assert.Empty(t, resolvePixelAvatarAPIKey(external))
}
