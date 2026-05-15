package testutil

import (
	"github.com/gin-gonic/gin"
	authmw "food_link/backend/internal/auth"
)

// JinhuiUserID 锦恢的固定 user_id
const JinhuiUserID = "8826bc8d-81ad-40a4-bc42-6cc30506b8c3"

// TestOpenID 锦恢的测试 openid
const TestOpenID = "test-openid-jinhui"

// TestUnionID 锦恢的测试 unionid
const TestUnionID = "test-unionid-jinhui"

// InjectJinhui 注入锦恢的身份到 gin context
func InjectJinhui() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(authmw.ContextUserIDKey, JinhuiUserID)
		c.Set(authmw.ContextOpenIDKey, TestOpenID)
		c.Set(authmw.ContextUnionIDKey, TestUnionID)
		c.Next()
	}
}

// InjectUser 注入任意用户身份
func InjectUser(userID, openID, unionID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(authmw.ContextUserIDKey, userID)
		c.Set(authmw.ContextOpenIDKey, openID)
		c.Set(authmw.ContextUnionIDKey, unionID)
		c.Next()
	}
}
