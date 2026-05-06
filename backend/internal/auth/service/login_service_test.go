package service

import (
	"context"
	"testing"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupLoginTestDB(t *testing.T) (*gorm.DB, *repo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&repo.User{}))
	return db, repo.NewUserRepo(db)
}

func TestLoginService_Login_WithTestOpenID(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{App: config.AppConfig{Env: "development"}, JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400}}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	result, err := svc.Login(ctx, LoginInput{TestOpenID: "test_openid_123"})
	require.NoError(t, err)
	assert.NotEmpty(t, result.AccessToken)
	assert.NotEmpty(t, result.RefreshToken)
	assert.Equal(t, "test_openid_123", result.OpenID)
}

func TestLoginService_Login_WithCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App:      config.AppConfig{Env: "production"},
		External: config.ExternalConfig{AppID: "appid", Secret: "secret"},
		JWT:      config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	// Since we can't mock ExchangeCode easily without gomonkey, we'll test error path
	_, err := svc.Login(ctx, LoginInput{Code: "invalid_code"})
	assert.Error(t, err)
}

func TestLoginService_Login_NewUserWithUnionID(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{App: config.AppConfig{Env: "development"}, JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400}}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	result, err := svc.Login(ctx, LoginInput{TestOpenID: "new_user_openid"})
	require.NoError(t, err)
	assert.NotEmpty(t, result.UserID)
	assert.Equal(t, "new_user_openid", result.OpenID)
}
