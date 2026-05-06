package testutil

import (
	"fmt"

	authservice "food_link/backend/internal/auth/service"
)

// TestJWTSecret 测试用 JWT 密钥（与生产环境解耦）
const TestJWTSecret = "test-secret-key-for-testing-only-min-32-chars-min-length"

// NewTestJWTService 创建测试用的 JWT Service
func NewTestJWTService() *authservice.JWTService {
	return authservice.NewJWTService(TestJWTSecret, 3600, 7200)
}

// GenerateToken 为指定用户生成 access token
func GenerateToken(userID, openID, unionID string) string {
	svc := NewTestJWTService()
	token, _ := svc.IssueAccess(userID, openID, unionID)
	return token
}

// AuthHeader 生成可直接塞入 http.Header 的 Authorization 值
func AuthHeader(userID, openID, unionID string) string {
	return fmt.Sprintf("Bearer %s", GenerateToken(userID, openID, unionID))
}

// JinhuiAuthHeader 锦恢的 Authorization header
func JinhuiAuthHeader() string {
	return AuthHeader(JinhuiUserID, TestOpenID, TestUnionID)
}
