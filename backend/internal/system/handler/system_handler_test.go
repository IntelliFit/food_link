package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSystemRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", h.Root)
	r.GET("/health", h.Health)
	r.GET("/public-config", h.PublicConfig)
	r.GET("/map-picker", h.MapPicker)
	r.GET("/test-backend", h.TestBackendPage)
	r.GET("/test-backend/login", h.TestBackendLoginPage)
	return r
}

func TestSystemHandler_Root(t *testing.T) {
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "food_link backend (go)", resp["service"])
	assert.Equal(t, "ok", resp["status"])
}

func TestSystemHandler_Health(t *testing.T) {
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "ok", resp["status"])
}

func TestSystemHandler_PublicConfig(t *testing.T) {
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/public-config", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, false, resp["allow_debug_register"])
}

func TestSystemHandler_MapPicker(t *testing.T) {
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/map-picker", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "map-picker migrated to Go backend")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}

func chdirToBackendRoot(t *testing.T) {
	t.Helper()
	wd, err := os.Getwd()
	require.NoError(t, err)
	root := filepath.Join(wd, "..", "..", "..")
	require.NoError(t, os.Chdir(root))
	t.Cleanup(func() { _ = os.Chdir(wd) })
}

func TestSystemHandler_TestBackendPage(t *testing.T) {
	chdirToBackendRoot(t)
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-backend", nil)
	req.AddCookie(&http.Cookie{Name: "test_backend_token", Value: "token"})
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "测试后台")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}

func TestSystemHandler_TestBackendLoginPage(t *testing.T) {
	chdirToBackendRoot(t)
	h := New(nil)
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-backend/login", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "测试后台登录")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}
