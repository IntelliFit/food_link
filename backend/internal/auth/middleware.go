package auth

import (
	"net/http"
	"strings"

	authservice "food_link/backend/internal/auth/service"

	"github.com/gin-gonic/gin"
)

const (
	ContextUserIDKey  = "user_id"
	ContextOpenIDKey  = "openid"
	ContextUnionIDKey = "unionid"
)

func RequireJWT(jwt *authservice.JWTService) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "缺少 Authorization"})
			c.Abort()
			return
		}
		claims, err := jwt.Parse(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "登录状态无效"})
			c.Abort()
			return
		}
		c.Set(ContextUserIDKey, claims.UserID)
		c.Set(ContextOpenIDKey, claims.OpenID)
		c.Set(ContextUnionIDKey, claims.UnionID)
		c.Next()
	}
}

func OptionalJWT(jwt *authservice.JWTService) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			c.Next()
			return
		}
		claims, err := jwt.Parse(token)
		if err == nil {
			c.Set(ContextUserIDKey, claims.UserID)
			c.Set(ContextOpenIDKey, claims.OpenID)
			c.Set(ContextUnionIDKey, claims.UnionID)
		}
		c.Next()
	}
}

func RequireTestBackendCookie() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := c.Cookie("test_backend_token"); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "缺少测试后台登录态"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if header == "" || !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}
