package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLoginTestDB(t *testing.T) (*gorm.DB, *repo.UserRepo) {
	db := testdb.New(t)
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
	// In a fresh test DB this is the first user (rank 1), so it falls into the
	// founding top-500 early-user policy rather than the regular new-user policy.
	assert.Equal(t, loginEarlyUserTop500TrialDays, ent.TrialDaysTotal)
}

func TestLoginService_AppWechatLogin_WithDevelopmentMockCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		AppAuth: config.AppAuthConfig{
			DevelopmentMockLogin:      true,
			DevelopmentMockWechatCode: "expo-go-dev-wechat-code",
		},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)

	result, err := svc.LoginWithAppWechat(context.Background(), AppWechatLoginInput{Code: "expo-go-dev-wechat-code"})
	require.NoError(t, err)
	require.NotEmpty(t, result.AccessToken)
	assert.Equal(t, "app-wx:mobile-app-dev-openid-default", result.OpenID)
	assert.Equal(t, "mobile-app-dev-unionid-default", result.UnionID)

	user, err := userRepo.FindByAppOpenID(context.Background(), "mobile-app-dev-openid-default")
	require.NoError(t, err)
	require.NotNil(t, user)
	require.NotNil(t, user.LastLoginMethod)
	assert.Equal(t, "wechat_app", *user.LastLoginMethod)
}

func TestLoginService_RegisterAndLoginWithPhonePasswordOnly(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	registered, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "password123",
		Nickname: "Mobile User",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, registered.AccessToken)
	assert.Equal(t, "app-pwd-phone:13511679220", registered.OpenID)

	loggedIn, err := svc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "password123"})
	require.NoError(t, err)
	assert.Equal(t, registered.UserID, loggedIn.UserID)
}

func TestLoginService_SetPasswordFirstPhoneBindingRequiresSMSCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	smsSvc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	loginSvc.ConfigurePhoneCodeVerifier(smsSvc)
	ctx := context.Background()

	loggedIn, err := loginSvc.Login(ctx, LoginInput{TestOpenID: "set-password-first-binding"})
	require.NoError(t, err)

	_, err = loginSvc.SetPassword(ctx, loggedIn.UserID, SetPasswordInput{
		Phone:    "13800138020",
		Password: "newpassword123",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "请输入验证码")

	require.NoError(t, store.Set(ctx, smsSvc.smsCodeKey("13800138020"), "530836", 15*time.Minute))
	_, err = loginSvc.SetPassword(ctx, loggedIn.UserID, SetPasswordInput{
		Phone:            "13800138020",
		Password:         "newpassword123",
		VerificationCode: "530836",
	})
	require.NoError(t, err)

	user, err := userRepo.FindByID(ctx, loggedIn.UserID)
	require.NoError(t, err)
	require.NotNil(t, user)
	require.NotNil(t, user.Telephone)
	assert.Equal(t, "13800138020", *user.Telephone)
	assert.True(t, verifyUserPasswordWithFallback("newpassword123", user))

	_, err = loginSvc.SetPassword(ctx, loggedIn.UserID, SetPasswordInput{
		Phone:            "13800138021",
		Password:         "anotherpassword123",
		CurrentPassword:  "newpassword123",
		VerificationCode: "530836",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "验证码错误或已过期")
}

func TestLoginService_SetPasswordSamePhoneDoesNotRequireSMSCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	registered, err := loginSvc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "oldpassword123",
	})
	require.NoError(t, err)

	_, err = loginSvc.SetPassword(ctx, registered.UserID, SetPasswordInput{
		Phone:           "13511679220",
		Password:        "newpassword123",
		CurrentPassword: "oldpassword123",
	})
	require.NoError(t, err)

	_, err = loginSvc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "newpassword123"})
	require.NoError(t, err)
}

func TestLoginService_SetPasswordPhoneChangeChecksCurrentPasswordBeforeConsumingSMSCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	smsSvc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	loginSvc.ConfigurePhoneCodeVerifier(smsSvc)
	ctx := context.Background()

	registered, err := loginSvc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "oldpassword123",
	})
	require.NoError(t, err)
	require.NoError(t, store.Set(ctx, smsSvc.smsCodeKey("13800138024"), "530836", 15*time.Minute))

	_, err = loginSvc.SetPassword(ctx, registered.UserID, SetPasswordInput{
		Phone:            "13800138024",
		Password:         "newpassword123",
		CurrentPassword:  "wrongpassword",
		VerificationCode: "530836",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "当前密码错误")

	_, err = loginSvc.SetPassword(ctx, registered.UserID, SetPasswordInput{
		Phone:            "13800138024",
		Password:         "newpassword123",
		CurrentPassword:  "oldpassword123",
		VerificationCode: "530836",
	})
	require.NoError(t, err)

	_, err = loginSvc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13800138024", Password: "newpassword123"})
	require.NoError(t, err)
	oldPhoneUser, err := userRepo.FindByTelephone(ctx, "13511679220")
	require.NoError(t, err)
	assert.Nil(t, oldPhoneUser)
}

func TestLoginService_ResetPasswordWithSMSUpdatesPasswordAndConsumesCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	smsSvc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	loginSvc.ConfigurePhoneCodeVerifier(smsSvc)
	ctx := context.Background()

	registered, err := loginSvc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "oldpassword123",
	})
	require.NoError(t, err)
	require.NoError(t, store.Set(ctx, smsSvc.smsCodeKey("13511679220"), "530836", 15*time.Minute))

	reset, err := loginSvc.ResetPasswordWithSMS(ctx, ResetPasswordInput{
		Phone:    "13511679220",
		Code:     "530836",
		Password: "newpassword123",
	})
	require.NoError(t, err)
	assert.Equal(t, registered.UserID, reset.UserID)
	assert.NotEmpty(t, reset.AccessToken)

	_, err = loginSvc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "oldpassword123"})
	require.Error(t, err)
	_, err = loginSvc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "newpassword123"})
	require.NoError(t, err)

	_, err = loginSvc.ResetPasswordWithSMS(ctx, ResetPasswordInput{
		Phone:    "13511679220",
		Code:     "530836",
		Password: "anotherpassword123",
	})
	assert.ErrorIs(t, err, ErrPasswordResetFailed)
}

func TestLoginService_ResetPasswordWithSMSDoesNotRevealMissingAccount(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	smsSvc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	loginSvc.ConfigurePhoneCodeVerifier(smsSvc)
	ctx := context.Background()

	require.NoError(t, store.Set(ctx, smsSvc.smsCodeKey("13800138025"), "530836", 15*time.Minute))
	_, err := loginSvc.ResetPasswordWithSMS(ctx, ResetPasswordInput{
		Phone:    "13800138025",
		Code:     "530836",
		Password: "newpassword123",
	})
	assert.ErrorIs(t, err, ErrPasswordResetFailed)
	assert.Equal(t, "手机号或验证码错误，无法重置密码", err.Error())
}

func TestLoginService_ResetPasswordValidatesStrengthBeforeConsumingCode(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	loginSvc := NewLoginService(cfg, userRepo, jwtSvc)
	store := NewMemoryCodeStore()
	smsSvc := NewSMSService(config.SMSConfig{}, "food_link", loginSvc, userRepo, jwtSvc, store, nil)
	loginSvc.ConfigurePhoneCodeVerifier(smsSvc)
	ctx := context.Background()

	registered, err := loginSvc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "oldpassword123",
	})
	require.NoError(t, err)
	require.NoError(t, store.Set(ctx, smsSvc.smsCodeKey("13511679220"), "530836", 15*time.Minute))

	_, err = loginSvc.ResetPasswordWithSMS(ctx, ResetPasswordInput{
		Phone:    "13511679220",
		Code:     "530836",
		Password: "short",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "至少需要 8 位")

	reset, err := loginSvc.ResetPasswordWithSMS(ctx, ResetPasswordInput{
		Phone:    "13511679220",
		Code:     "530836",
		Password: "newpassword123",
	})
	require.NoError(t, err)
	assert.Equal(t, registered.UserID, reset.UserID)
}

func TestLoginService_RegisterAndLoginWithPhonePassword(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	registered, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "+86 135-1167-9220",
		Password: "password123",
		Nickname: "手机用户",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, registered.AccessToken)
	assert.Equal(t, "app-pwd-phone:13511679220", registered.OpenID)

	user, err := userRepo.FindByTelephone(ctx, "13511679220")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Nil(t, user.Username)
	require.NotNil(t, user.Telephone)
	assert.Equal(t, "13511679220", *user.Telephone)

	loggedIn, err := svc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "password123"})
	require.NoError(t, err)
	assert.Equal(t, registered.UserID, loggedIn.UserID)
}

func TestLoginService_RegisterWithPasswordExistingPhoneLogsIn(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	registered, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "password123",
		Nickname: "测试用户",
	})
	require.NoError(t, err)

	loggedIn, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "password123",
		Nickname: "不应覆盖昵称",
	})
	require.NoError(t, err)
	assert.Equal(t, registered.UserID, loggedIn.UserID)
	assert.NotEmpty(t, loggedIn.AccessToken)
}

func TestLoginService_RegisterWithPasswordExistingPhoneRejectsWrongPassword(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	_, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "password123",
	})
	require.NoError(t, err)

	_, err = svc.RegisterWithPassword(ctx, PasswordRegisterInput{
		Phone:    "13511679220",
		Password: "wrong-password",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "手机号或密码错误")
}

func TestLoginService_LoginWithPassword_InvalidPassword(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development", AllowDebugRegister: true},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := NewJWTService("test-secret", 3600, 86400)
	svc := NewLoginService(cfg, userRepo, jwtSvc)
	ctx := context.Background()

	_, err := svc.RegisterWithPassword(ctx, PasswordRegisterInput{Phone: "13511679220", Password: "password123"})
	require.NoError(t, err)
	_, err = svc.LoginWithPassword(ctx, PasswordLoginInput{Phone: "13511679220", Password: "wrong-password"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "手机号或密码错误")
}
