package stub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/common/routes"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestHandler(t *testing.T) {
	spec := routes.Spec{Method: "GET", Path: "/api/test", DocRef: "test.md"}
	handler := Handler(spec)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/test", handler)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotImplemented, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(10004), resp["code"])
	assert.Contains(t, resp["message"], "已注册但尚未迁移")
	assert.Equal(t, "test.md", resp["doc"])
}

func TestHandlerPost(t *testing.T) {
	spec := routes.Spec{Method: "POST", Path: "/api/test", DocRef: "test.md"}
	handler := Handler(spec)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/test", handler)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotImplemented, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Contains(t, resp["message"], "POST /api/test 已注册但尚未迁移")
}
