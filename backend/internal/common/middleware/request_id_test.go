package middleware

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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
		if hostName := strings.TrimSpace(c.GetString("host_name")); hostName != "" {
			assert.Equal(t, expectedHostName(t), hostName)
		}
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Len(t, w.Header().Get(HeaderTraceID), 32)
	assert.NotEqual(t, "no-trace-id", w.Header().Get(HeaderTraceID))
	assert.NotEmpty(t, w.Header().Get(HeaderRequestID))
	if hostName := expectedHostName(t); hostName != "" {
		assert.Equal(t, hostName, w.Header().Get(HeaderHostName))
	}
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

func expectedHostName(t *testing.T) string {
	t.Helper()
	hostName, err := os.Hostname()
	require.NoError(t, err)
	return strings.TrimSpace(hostName)
}
