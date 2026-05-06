package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func setupSystemRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", h.Root)
	r.GET("/health", h.Health)
	r.GET("/map-picker", h.MapPicker)
	r.GET("/test-backend", h.TestBackendPage)
	r.GET("/test-backend/login", h.TestBackendLoginPage)
	return r
}

func TestSystemHandler_Root(t *testing.T) {
	h := New()
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
	h := New()
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "ok", resp["status"])
}

func TestSystemHandler_MapPicker(t *testing.T) {
	h := New()
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/map-picker", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "map-picker migrated to Go backend")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}

func TestSystemHandler_TestBackendPage(t *testing.T) {
	h := New()
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-backend", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "test-backend")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}

func TestSystemHandler_TestBackendLoginPage(t *testing.T) {
	h := New()
	r := setupSystemRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-backend/login", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "test-backend login")
	assert.Equal(t, "text/html; charset=utf-8", w.Header().Get("Content-Type"))
}
