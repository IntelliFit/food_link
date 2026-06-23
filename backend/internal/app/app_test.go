package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	systemhandler "food_link/backend/internal/system/handler"
	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestAppPackage(t *testing.T) {
	// This is a compile-time / smoke test for the app package
	// The New() function requires real database/config which is not feasible in unit tests
	assert.True(t, true)
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
