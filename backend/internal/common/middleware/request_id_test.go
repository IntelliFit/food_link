package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestIDAddsTraceAndRequestHeadersWithoutOTel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestID())
	r.GET("/ping", func(c *gin.Context) {
		assert.NotEmpty(t, c.GetString("trace_id"))
		assert.NotEmpty(t, c.GetString("request_id"))
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Len(t, w.Header().Get(HeaderTraceID), 32)
	assert.NotEqual(t, "no-trace-id", w.Header().Get(HeaderTraceID))
	assert.NotEmpty(t, w.Header().Get(HeaderRequestID))
}

func TestRequestIDIgnoresNoTraceIDPlaceholder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestID())
	r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set(HeaderTraceID, "no-trace-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Len(t, w.Header().Get(HeaderTraceID), 32)
	assert.NotEqual(t, "no-trace-id", w.Header().Get(HeaderTraceID))
}
