package clienterror

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/client-errors", NewHandler().Submit)
	return r
}

func post(r *gin.Engine, body string) int {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/client-errors", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w.Code
}

func TestSubmitValidatesReports(t *testing.T) {
	r := newRouter()
	for _, c := range []struct {
		name, body string
		want       int
	}{
		{"render crash", `{"kind":"error","message":"boom","route":"pages/index/index","app_version":"4.6.18","page_blank":true}`, http.StatusOK},
		{"rejection without route", `{"kind":"rejection","message":"boom","app_version":"4.6.18"}`, http.StatusOK},
		{"unknown kind", `{"kind":"other","message":"boom","app_version":"4.6.18"}`, http.StatusBadRequest},
		{"empty message", `{"kind":"error","message":"  ","app_version":"4.6.18"}`, http.StatusBadRequest},
		{"bad version", `{"kind":"error","message":"boom","app_version":"latest"}`, http.StatusBadRequest},
		{"not json", `boom`, http.StatusBadRequest},
		{"too large", `{"kind":"error","app_version":"4.6.18","message":"` + strings.Repeat("x", maxBodyBytes) + `"}`, http.StatusBadRequest},
	} {
		t.Run(c.name, func(t *testing.T) {
			require.Equal(t, c.want, post(r, c.body))
		})
	}
}

func TestSubmitLimitsReportsPerClient(t *testing.T) {
	r := newRouter()
	body := `{"kind":"error","message":"boom","app_version":"4.6.18"}`
	for i := 0; i < reportsPerMinute; i++ {
		require.Equal(t, http.StatusOK, post(r, body))
	}
	require.Equal(t, http.StatusTooManyRequests, post(r, body))
}

func TestLimiterStartsOverEachMinuteAndCountsPerClient(t *testing.T) {
	l := newLimiter()
	now := time.Date(2026, 10, 30, 21, 0, 0, 0, time.UTC)
	for i := 0; i < reportsPerMinute; i++ {
		require.True(t, l.allow("a", now))
	}
	require.False(t, l.allow("a", now))
	require.True(t, l.allow("b", now))
	require.True(t, l.allow("a", now.Add(time.Minute)))
}

func TestClipKeepsWholeCharacters(t *testing.T) {
	clipped := clip(strings.Repeat("空", maxMessageRunes+5), maxMessageRunes)
	require.True(t, utf8.ValidString(clipped))
	require.Equal(t, maxMessageRunes, utf8.RuneCountInString(clipped))
	require.Equal(t, "短", clip("短", maxMessageRunes))
}
