package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSMSService_LoginWithCodeCreatesUserAndConsumesCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	svc := NewSMSService(config.SMSConfig{}, loginSvc, userRepo, jwtSvc, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, smsCodeKeyPrefix+"13800138009", "530836", 15*time.Minute))
	out, err := svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138009", Code: "530836"})
	require.NoError(t, err)
	assert.NotEmpty(t, out.AccessToken)
	assert.Equal(t, "app-phone:13800138009", out.OpenID)

	user, err := userRepo.FindByTelephone(ctx, "13800138009")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, out.UserID, user.ID)

	_, err = svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138009", Code: "530836"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")
}

func TestSMSService_WrongCodeDoesNotConsumeCorrectCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	svc := NewSMSService(config.SMSConfig{}, loginSvc, userRepo, jwtSvc, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, smsCodeKeyPrefix+"13800138010", "530836", 15*time.Minute))
	_, err := svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138010", Code: "000000"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")

	out, err := svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138010", Code: "530836"})
	require.NoError(t, err)
	assert.Equal(t, "app-phone:13800138010", out.OpenID)
}
