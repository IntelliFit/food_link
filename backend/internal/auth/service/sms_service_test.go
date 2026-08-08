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
	svc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, svc.smsCodeKey("13800138009"), "530836", 15*time.Minute))
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
	svc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, svc.smsCodeKey("13800138010"), "530836", 15*time.Minute))
	_, err := svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138010", Code: "000000"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")

	out, err := svc.LoginWithCode(ctx, SMSLoginInput{Phone: "13800138010", Code: "530836"})
	require.NoError(t, err)
	assert.Equal(t, "app-phone:13800138010", out.OpenID)
}

func TestSMSService_VerifyCodeConsumesCodeOnce(t *testing.T) {
	store := NewMemoryCodeStore()
	svc := NewSMSService(config.SMSConfig{}, "food_link", nil, nil, nil, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, svc.smsCodeKey("13800138013"), "530836", 15*time.Minute))
	require.NoError(t, svc.VerifyCode(ctx, "13800138013", " 530836 "))

	err := svc.VerifyCode(ctx, "13800138013", "530836")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")
	assert.ErrorIs(t, err, ErrSMSCodeInvalid)
}

func TestSMSService_VerifyCodeWrongAttemptDoesNotConsumeCorrectCode(t *testing.T) {
	store := NewMemoryCodeStore()
	svc := NewSMSService(config.SMSConfig{}, "food_link", nil, nil, nil, store, nil)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, svc.smsCodeKey("13800138014"), "530836", 15*time.Minute))
	err := svc.VerifyCode(ctx, "13800138014", "000000")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")
	assert.ErrorIs(t, err, ErrSMSCodeInvalid)
	require.NoError(t, svc.VerifyCode(ctx, "13800138014", "530836"))
}

func TestSMSService_RedisKeysUseConfiguredPrefix(t *testing.T) {
	svc := NewSMSService(config.SMSConfig{}, "food_link:", nil, nil, nil, nil, nil)

	assert.Equal(t, "food_link:sms_verification_code:13800138011", svc.smsCodeKey("13800138011"))
	assert.Equal(t, "food_link:throttle:sms:13800138011", svc.smsPhoneThrottleKey("13800138011"))
	assert.Equal(t, "food_link:throttle:sms:ip:127.0.0.1", svc.smsIPThrottleKey("127.0.0.1"))
}

func TestSMSService_SendCodeReturnsConfiguredCooldown(t *testing.T) {
	store := NewMemoryCodeStore()
	svc := NewSMSService(config.SMSConfig{
		MockEnabled:     true,
		MockCode:        "123456",
		CodeTTLMinutes:  5,
		ThrottleSeconds: 45,
	}, "food_link", nil, nil, nil, store, nil)

	out, err := svc.SendCode(context.Background(), SendSMSCodeInput{Phone: "13800138012"}, "127.0.0.1")
	require.NoError(t, err)
	assert.Equal(t, 300, out.ExpiresInSeconds)
	assert.Equal(t, 45, out.CooldownSeconds)
}
