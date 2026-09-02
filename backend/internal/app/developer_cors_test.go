package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestDeveloperPortalCORSAllowsExplicitlyConfiguredWebsite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(developerPortalCORS("https://healthymax.cn", "production"))
	engine.POST("/api/app/login/sms", func(c *gin.Context) { c.Status(http.StatusOK) })
	req := httptest.NewRequest(http.MethodOptions, "/api/app/login/sms", nil)
	req.Header.Set("Origin", "https://healthymax.cn")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusNoContent, w.Code)
	require.Equal(t, "https://healthymax.cn", w.Header().Get("Access-Control-Allow-Origin"))
}

func TestDeveloperPortalCORSRejectsUnknownOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(developerPortalCORS("", "production"))
	req := httptest.NewRequest(http.MethodOptions, "/api/developer/apps", nil)
	req.Header.Set("Origin", "https://malicious.example")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestDeveloperPortalCORSDoesNotAffectOpenAPIRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(developerPortalCORS("", "production"))
	engine.GET("/open/v1/account", func(c *gin.Context) { c.Status(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/open/v1/account", nil)
	req.Header.Set("Origin", "https://malicious.example")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
}

func TestOpenPlatformWechatPayNotifyURL(t *testing.T) {
	require.Equal(t, "https://dev.api.healthymax.cn/api/developer/payment/wechat/notify", openPlatformWechatPayNotifyURL("development", ""))
	require.Equal(t, "https://api.healthymax.cn/api/developer/payment/wechat/notify", openPlatformWechatPayNotifyURL("production", ""))
	require.Equal(t, "https://callback.example/pay", openPlatformWechatPayNotifyURL("development", " https://callback.example/pay "))
}
