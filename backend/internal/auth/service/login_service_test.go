package service

import (
	"context"
	"strings"
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
	require.NoError(t, db.AutoMigrate(&repo.User{}, &repo.UserTrialEntitlement{}))
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

	user, err := userRepo.FindByOpenID(ctx, "new_user_openid")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, defaultUserAvatarKey, user.Avatar)
	assert.True(t, strings.HasPrefix(user.Nickname, defaultWechatNicknamePrefix))
	suffix := strings.TrimPrefix(user.Nickname, defaultWechatNicknamePrefix)
	assert.True(t, defaultWechatNicknameSuffixPattern.MatchString(suffix), "suffix=%q", suffix)
}

func TestBuildDefaultWechatNickname(t *testing.T) {
	n1 := buildDefaultWechatNickname()
	n2 := buildDefaultWechatNickname()
	assert.True(t, strings.HasPrefix(n1, defaultWechatNicknamePrefix))
	assert.True(t, strings.HasPrefix(n2, defaultWechatNicknamePrefix))
	suffix1 := strings.TrimPrefix(n1, defaultWechatNicknamePrefix)
	suffix2 := strings.TrimPrefix(n2, defaultWechatNicknamePrefix)
	assert.True(t, defaultWechatNicknameSuffixPattern.MatchString(suffix1))
	assert.True(t, defaultWechatNicknameSuffixPattern.MatchString(suffix2))
}

func TestLoginService_Login_CreatesTrialEntitlement(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{App: config.AppConfig{Env: "development"}, JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400}}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	result, err := svc.Login(ctx, LoginInput{TestOpenID: "trial_openid_1"})
	require.NoError(t, err)
	ent, err := userRepo.FindTrialEntitlementByIdentity(ctx, "trial_openid_1", "")
	require.NoError(t, err)
	require.NotNil(t, ent)
	require.NotNil(t, ent.FirstUserID)
	assert.Equal(t, result.UserID, *ent.FirstUserID)
	assert.Equal(t, loginRegularUserTrialDays, ent.TrialDaysTotal)
}
