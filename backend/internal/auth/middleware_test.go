package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	authservice "food_link/backend/internal/auth/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

const testJWTSecret = "test-secret-key-for-testing-only-min-32-chars-min-length"

func newTestJWTService() *authservice.JWTService {
	return authservice.NewJWTService(testJWTSecret, 3600, 7200)
}

func testAuthHeader() string {
	svc := newTestJWTService()
	token, _ := svc.IssueAccess("user-1", "openid-1", "unionid-1")
	return "Bearer " + token
}

func TestRequireJWT_MissingHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", RequireJWT(jwtSvc), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireJWT_InvalidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", RequireJWT(jwtSvc), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireJWT_ValidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", RequireJWT(jwtSvc), func(c *gin.Context) {
		userID, _ := c.Get(ContextUserIDKey)
		c.JSON(200, gin.H{"user_id": userID})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", testAuthHeader())
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestOptionalJWT_NoToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", OptionalJWT(jwtSvc), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestOptionalJWT_InvalidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", OptionalJWT(jwtSvc), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestOptionalJWT_ValidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jwtSvc := newTestJWTService()
	r := gin.New()
	r.GET("/test", OptionalJWT(jwtSvc), func(c *gin.Context) {
		userID, exists := c.Get(ContextUserIDKey)
		if exists {
			c.JSON(200, gin.H{"user_id": userID})
			return
		}
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", testAuthHeader())
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequireTestBackendCookie_Missing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", RequireTestBackendCookie(), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireTestBackendCookie_Present(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", RequireTestBackendCookie(), func(c *gin.Context) {
		c.String(200, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.AddCookie(&http.Cookie{Name: "test_backend_token", Value: "test"})
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestBearerToken(t *testing.T) {
	assert.Equal(t, "token123", bearerToken("Bearer token123"))
	assert.Equal(t, "token123", bearerToken("bearer token123"))
	assert.Equal(t, "token123", bearerToken("  Bearer token123  "))
	assert.Equal(t, "", bearerToken(""))
	assert.Equal(t, "", bearerToken("Basic token123"))
	assert.Equal(t, "", bearerToken("Bearer"))
	assert.Equal(t, "", bearerToken("token123"))
}
