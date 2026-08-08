package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/auth/repo"
	nicknamepolicy "food_link/backend/internal/user/nickname"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
)

const (
	loginRegularUserTrialDays     = 3
	loginEarlyUserTrialLimit      = 1000
	loginEarlyUserTop500Limit     = 500
	loginEarlyUserTop500TrialDays = 60
	loginEarlyUserTrialDays       = 30

	defaultUserAvatarKey        = "_system/default_avatar.jpg"
	defaultWechatNicknamePrefix = "微信用户_"
	defaultAppMockOpenID        = "mobile-app-dev-openid"
	defaultAppMockUnionID       = "mobile-app-dev-unionid"
)

type LoginInput struct {
	Code       string `json:"code"`
	PhoneCode  string `json:"phoneCode"`
	InviteCode string `json:"inviteCode"`
	TestOpenID string `json:"testOpenid"`
}

type AppWechatLoginInput struct {
	Code       string `json:"code"`
	InviteCode string `json:"inviteCode"`
}

type PasswordLoginInput struct {
	Username string `json:"username"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

type PasswordRegisterInput struct {
	Username   string `json:"username"`
	Phone      string `json:"phone"`
	Password   string `json:"password"`
	Nickname   string `json:"nickname"`
	InviteCode string `json:"inviteCode"`
}

type SetPasswordInput struct {
	Username         string `json:"username"`
	Phone            string `json:"phone"`
	Password         string `json:"password"`
	CurrentPassword  string `json:"current_password"`
	VerificationCode string `json:"verification_code"`
}

type ResetPasswordInput struct {
	Phone    string `json:"phone"`
	Code     string `json:"code"`
	Password string `json:"password"`
}

var (
	ErrPasswordResetFailed      = errors.New("手机号或验证码错误，无法重置密码")
	ErrPasswordResetUnavailable = errors.New("密码重置暂时不可用，请稍后重试")
)

type LoginOutput struct {
	AccessToken     string  `json:"access_token"`
	RefreshToken    string  `json:"refresh_token"`
	TokenType       string  `json:"token_type"`
	ExpiresIn       int64   `json:"expires_in"`
	UserID          string  `json:"user_id"`
	OpenID          string  `json:"openid"`
	UnionID         string  `json:"unionid,omitempty"`
	PhoneNumber     *string `json:"phoneNumber,omitempty"`
	PurePhoneNumber *string `json:"purePhoneNumber,omitempty"`
	CountryCode     *string `json:"countryCode,omitempty"`
	DietGoal        *string `json:"diet_goal,omitempty"`
}

type LoginService struct {
	cfg               *config.Config
	users             *repo.UserRepo
	jwt               *JWTService
	phoneCodeVerifier PhoneCodeVerifier
}

type PhoneCodeVerifier interface {
	VerifyCode(ctx context.Context, phone, code string) error
}

func NewLoginService(cfg *config.Config, users *repo.UserRepo, jwt *JWTService) *LoginService {
	return &LoginService{cfg: cfg, users: users, jwt: jwt}
}

func (s *LoginService) ConfigurePhoneCodeVerifier(verifier PhoneCodeVerifier) {
	s.phoneCodeVerifier = verifier
}

func (s *LoginService) Login(ctx context.Context, input LoginInput) (*LoginOutput, error) {
	var openID, unionID string
	testOpenID := strings.TrimSpace(input.TestOpenID)
	if testOpenID != "" && s.cfg.App.Env == "development" {
		openID = testOpenID
	} else {
		oid, uid, err := s.users.ExchangeCode(ctx, s.cfg.WechatMiniProgramAppID(), s.cfg.WechatMiniProgramAppSecret(), strings.TrimSpace(input.Code))
		if err != nil {
			return nil, err
		}
		openID = oid
		unionID = uid
	}

	loginMethod := "wechat_miniprogram"
	if testOpenID != "" && s.cfg.App.Env == "development" {
		loginMethod = "development_test_openid"
	}
	user, err := s.findOrCreateWechatUser(ctx, openID, unionID, input.PhoneCode, input.InviteCode, loginMethod)
	if err != nil {
		return nil, err
	}
	if user != nil {
		if err := s.ensureTrialEntitlement(ctx, user, openID, unionID); err != nil {
			return nil, err
		}
	}
	if user != nil && (user.Telephone == nil || strings.TrimSpace(*user.Telephone) == "") && strings.TrimSpace(input.PhoneCode) != "" {
		if phone := s.resolvePhoneNumber(ctx, input.PhoneCode); phone != nil && strings.TrimSpace(*phone) != "" {
			user, err = s.users.UpdateFields(ctx, user.ID, map[string]any{"telephone": strings.TrimSpace(*phone)})
			if err != nil {
				return nil, err
			}
		}
	}

	return s.issueLoginOutput(user, openID, unionID)
}

func (s *LoginService) LoginWithAppWechat(ctx context.Context, input AppWechatLoginInput) (*LoginOutput, error) {
	code := strings.TrimSpace(input.Code)
	appOpenID, unionID, err := s.exchangeAppWechatCode(ctx, code)
	if err != nil {
		return nil, err
	}
	user, err := s.findOrCreateAppWechatUser(ctx, appOpenID, unionID, input.InviteCode)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "App 微信登录成功",
		slog.String("user_id", user.ID),
		slog.Bool("has_unionid", strings.TrimSpace(unionID) != ""),
	)
	return s.issueLoginOutput(user, user.OpenID, firstNonEmpty(unionID, derefString(user.UnionID), derefString(user.AppUnionID)))
}

func (s *LoginService) LoginWithPassword(ctx context.Context, input PasswordLoginInput) (*LoginOutput, error) {
	phone, _, err := parseLoginIdentifier(input.Username, input.Phone)
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fmt.Errorf("请输入手机号")
	}
	password := strings.TrimSpace(input.Password)
	if password == "" {
		return nil, fmt.Errorf("请输入密码")
	}
	var user *repo.User
	user, err = s.users.FindByTelephone(ctx, phone)
	if err != nil {
		return nil, err
	}
	if user == nil {
		user, err = s.users.FindByOpenID(ctx, passwordLoginOpenID(phone, ""))
		if err != nil {
			return nil, err
		}
	}
	if user == nil || !verifyUserPasswordWithFallback(password, user) {
		logger.Warn(ctx, "App 账号密码登录失败", slog.String("identifier_type", loginIdentifierType(phone, "")))
		return nil, fmt.Errorf("手机号或密码错误")
	}
	user, err = s.touchLogin(ctx, user, "password")
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "App 账号密码登录成功", slog.String("user_id", user.ID), slog.String("identifier_type", loginIdentifierType(phone, "")))
	return s.issueLoginOutput(user, user.OpenID, firstNonEmpty(derefString(user.UnionID), derefString(user.AppUnionID)))
}

func (s *LoginService) RegisterWithPassword(ctx context.Context, input PasswordRegisterInput) (*LoginOutput, error) {
	phone, _, err := parseLoginIdentifier(input.Username, input.Phone)
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fmt.Errorf("请输入手机号")
	}
	if !s.cfg.App.AllowDebugRegister {
		return nil, fmt.Errorf("当前未开启测试注册")
	}
	if phone != "13511679220" {
		return nil, fmt.Errorf("测试注册仅支持指定手机号")
	}
	trimmedInviteCode := strings.TrimSpace(input.InviteCode)
	logger.Info(ctx, "App 账号密码测试注册请求已收到",
		slog.String("phone", maskPhoneForLog(phone)),
		slog.Bool("invite_code_present", trimmedInviteCode != ""),
		slog.Int("invite_code_length", len(trimmedInviteCode)),
	)
	if existing, err := s.users.FindByTelephone(ctx, phone); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.PasswordHash == nil || !VerifyUserPassword(input.Password, *existing.PasswordHash) {
			return nil, fmt.Errorf("手机号或密码错误")
		}
		existing, err = s.touchLogin(ctx, existing, "password")
		if err != nil {
			return nil, err
		}
		logger.Info(ctx, "App 账号密码测试注册命中已有账号，已按密码登录",
			slog.String("user_id", existing.ID),
			slog.String("identifier_type", loginIdentifierType(phone, "")),
			slog.Bool("invite_code_present", trimmedInviteCode != ""),
		)
		return s.issueLoginOutput(existing, existing.OpenID, firstNonEmpty(derefString(existing.UnionID), derefString(existing.AppUnionID)))
	}
	passwordHash, err := HashUserPassword(input.Password)
	if err != nil {
		return nil, err
	}
	pointsBalance := 100.0
	publicRecords := true
	now := time.Now()
	nickname := strings.TrimSpace(input.Nickname)
	if nickname == "" {
		nickname = "Food Link 用户"
	}
	generatedNickname := strings.TrimSpace(input.Nickname) == ""
	if generatedNickname {
		nickname = buildDefaultWechatNickname()
	} else if nickname, err = nicknamepolicy.Validate(nickname); err != nil {
		return nil, err
	}
	user := &repo.User{
		OpenID:          passwordLoginOpenID(phone, ""),
		PasswordHash:    strPtrIfColumn(s.users, "password_hash", passwordHash),
		PasswordSetAt:   timePtrIfColumn(s.users, "password_set_at", now),
		Nickname:        nickname,
		Avatar:          defaultUserAvatarKey,
		PointsBalance:   &pointsBalance,
		PublicRecords:   &publicRecords,
		LastLoginMethod: strPtrIfColumn(s.users, "last_login_method", "password"),
		LastLoginAt:     timePtrIfColumn(s.users, "last_login_at", now),
	}
	user.Telephone = strPtrIfColumn(s.users, "telephone", phone)
	ensureLegacyAppAuth(user, phone, passwordHash)
	if err := s.createUserWithUniqueNickname(ctx, user, generatedNickname); err != nil {
		return nil, err
	}
	if err := s.ensureTrialEntitlement(ctx, user, user.OpenID, ""); err != nil {
		return nil, err
	}
	_ = s.ensureRegistrationInviteCode(ctx, user.ID)
	if inviteCode := strings.ToUpper(trimmedInviteCode); inviteCode != "" {
		logger.Info(ctx, "App 账号密码注册开始绑定邀请关系", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
		if err := s.bindInviteReferral(ctx, user.ID, inviteCode); err != nil {
			logger.Error(ctx, "App 账号密码注册绑定邀请关系失败", err, slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
		} else {
			logger.Info(ctx, "App 账号密码注册绑定邀请关系完成", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
		}
	} else {
		logger.Info(ctx, "App 账号密码注册未携带邀请码", slog.String("user_id", user.ID))
	}
	logger.Info(ctx, "App 账号密码注册成功", slog.String("user_id", user.ID), slog.String("identifier_type", loginIdentifierType(phone, "")))
	return s.issueLoginOutput(user, user.OpenID, "")
}

func (s *LoginService) SetPassword(ctx context.Context, userID string, input SetPasswordInput) (*LoginOutput, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		logger.Error(ctx, "查询 App 账号安全信息失败", err, slog.String("user_id", userID))
		return nil, err
	}
	if user == nil {
		logger.Warn(ctx, "设置 App 账号密码时用户不存在", slog.String("user_id", userID))
		return nil, fmt.Errorf("用户不存在")
	}
	if user.PasswordHash != nil && strings.TrimSpace(*user.PasswordHash) != "" {
		if !VerifyUserPassword(input.CurrentPassword, *user.PasswordHash) {
			logger.Warn(ctx, "修改 App 账号密码时当前密码错误", slog.String("user_id", user.ID))
			return nil, fmt.Errorf("当前密码错误")
		}
	}
	phone, _, err := parseLoginIdentifier(input.Username, input.Phone)
	if err != nil {
		return nil, err
	}
	if phone == "" {
		phone = normalizeLoginPhone(derefString(user.Telephone))
	}
	if phone == "" {
		return nil, fmt.Errorf("请输入手机号")
	}
	currentPhone := normalizeLoginPhone(derefString(user.Telephone))
	phoneChanged := currentPhone != phone
	if phoneChanged {
		if s.phoneCodeVerifier == nil {
			verificationErr := fmt.Errorf("验证码服务未配置")
			logger.Error(ctx, "修改 App 账号手机号时验证码服务未配置", verificationErr, slog.String("user_id", user.ID))
			return nil, verificationErr
		}
		logger.Info(ctx, "修改 App 账号手机号开始验证", slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)))
		if err := s.phoneCodeVerifier.VerifyCode(ctx, phone, input.VerificationCode); err != nil {
			logger.Warn(ctx, "修改 App 账号手机号验证失败", slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)), slog.String("reason", err.Error()))
			return nil, err
		}
	}
	if existing, err := s.users.FindByTelephone(ctx, phone); err != nil {
		logger.Error(ctx, "检查 App 账号手机号占用状态失败", err, slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)))
		return nil, err
	} else if existing != nil && existing.ID != user.ID {
		logger.Warn(ctx, "修改 App 账号手机号时目标号码已被使用", slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)))
		return nil, fmt.Errorf("手机号已被使用")
	}
	passwordHash, err := HashUserPassword(input.Password)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	updates := map[string]any{
		"password_hash":   passwordHash,
		"password_set_at": now,
	}
	updates["telephone"] = phone
	if !s.users.HasUserColumn("password_hash") || !s.users.HasUserColumn("telephone") {
		condition := cloneHealthCondition(user.HealthCondition)
		auth := map[string]any{
			"password_hash":   passwordHash,
			"password_set_at": now.Format(time.RFC3339),
			"phone":           phone,
		}
		condition["app_auth"] = auth
		updates["health_condition"] = condition
	}
	user, err = s.users.UpdateFields(ctx, user.ID, updates)
	if err != nil {
		logger.Error(ctx, "保存 App 账号手机号密码失败", err, slog.String("user_id", user.ID), slog.Bool("phone_changed", phoneChanged))
		return nil, err
	}
	logger.Info(ctx, "App 账号密码已设置", slog.String("user_id", user.ID), slog.String("identifier_type", loginIdentifierType(phone, "")), slog.Bool("phone_changed", phoneChanged))
	return s.issueLoginOutput(user, user.OpenID, firstNonEmpty(derefString(user.UnionID), derefString(user.AppUnionID)))
}

func (s *LoginService) ResetPasswordWithSMS(ctx context.Context, input ResetPasswordInput) (*LoginOutput, error) {
	phone, err := parsePhoneLoginIdentifier(input.Phone, "")
	if err != nil || phone == "" {
		logger.Warn(ctx, "App 短信重置密码校验失败", slog.String("reason", "invalid_phone"))
		return nil, ErrPasswordResetFailed
	}
	passwordHash, err := HashUserPassword(input.Password)
	if err != nil {
		return nil, err
	}
	if s.phoneCodeVerifier == nil {
		logger.Error(ctx, "App 短信重置密码时验证码服务未配置", ErrPasswordResetUnavailable, slog.String("phone", maskPhoneForLog(phone)))
		return nil, ErrPasswordResetUnavailable
	}
	logger.Info(ctx, "App 短信重置密码开始验证", slog.String("phone", maskPhoneForLog(phone)))
	if err := s.phoneCodeVerifier.VerifyCode(ctx, phone, input.Code); err != nil {
		if errors.Is(err, ErrSMSVerificationUnavailable) {
			logger.Error(ctx, "App 短信重置密码验证码服务不可用", err, slog.String("phone", maskPhoneForLog(phone)))
			return nil, ErrPasswordResetUnavailable
		}
		logger.Warn(ctx, "App 短信重置密码验证失败", slog.String("phone", maskPhoneForLog(phone)))
		return nil, ErrPasswordResetFailed
	}
	user, err := s.users.FindByTelephone(ctx, phone)
	if err != nil {
		logger.Error(ctx, "App 短信重置密码查询账号失败", err, slog.String("phone", maskPhoneForLog(phone)))
		return nil, ErrPasswordResetUnavailable
	}
	if user == nil {
		logger.Warn(ctx, "App 短信重置密码未匹配账号", slog.String("phone", maskPhoneForLog(phone)))
		return nil, ErrPasswordResetFailed
	}

	now := time.Now()
	updates := map[string]any{
		"password_hash":   passwordHash,
		"password_set_at": now,
		"telephone":       phone,
	}
	if !s.users.HasUserColumn("password_hash") || !s.users.HasUserColumn("telephone") {
		condition := cloneHealthCondition(user.HealthCondition)
		condition["app_auth"] = map[string]any{
			"password_hash":   passwordHash,
			"password_set_at": now.Format(time.RFC3339),
			"phone":           phone,
		}
		updates["health_condition"] = condition
	}
	user, err = s.users.UpdateFields(ctx, user.ID, updates)
	if err != nil {
		logger.Error(ctx, "保存 App 短信重置密码失败", err, slog.String("user_id", user.ID))
		return nil, ErrPasswordResetUnavailable
	}
	logger.Info(ctx, "App 短信重置密码完成", slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)))
	return s.issueLoginOutput(user, user.OpenID, firstNonEmpty(derefString(user.UnionID), derefString(user.AppUnionID)))
}

// ensureTrialEntitlement activates the registration trial immediately. Registration
// trials are not deferred vouchers: a new user should see the default trial as
// soon as their account is created.
func (s *LoginService) ensureTrialEntitlement(ctx context.Context, user *repo.User, openID, unionID string) error {
	if user == nil {
		return nil
	}
	openID = strings.TrimSpace(openID)
	unionID = strings.TrimSpace(unionID)

	// Determine trial policy and days.
	trialDays := loginRegularUserTrialDays
	policy := "regular_new_user"
	var earlyRank *int
	if rank, err := s.users.GetFirstMembershipTrialBatchRank(ctx, user.ID, loginEarlyUserTrialLimit); err == nil && rank > 0 {
		earlyRank = &rank
		switch {
		case rank <= loginEarlyUserTop500Limit:
			trialDays = loginEarlyUserTop500TrialDays
			policy = "founding_top_500_bonus_month"
		case rank <= loginEarlyUserTrialLimit:
			trialDays = loginEarlyUserTrialDays
			policy = "early_first_1000"
		}
	}

	ent, err := s.users.FindTrialEntitlementByUserID(ctx, user.ID)
	if err != nil {
		return err
	}
	if ent == nil {
		ent = &repo.UserTrialEntitlement{
			FirstUserID:       &user.ID,
			OpenID:            openID,
			FirstRegisteredAt: user.CreatedAt,
			EarlyUserRank:     earlyRank,
			TrialDaysTotal:    trialDays,
			TrialPolicy:       policy,
		}
		if unionID != "" {
			ent.UnionID = &unionID
		}
		return s.users.CreateTrialEntitlement(ctx, ent)
	}
	updates := map[string]any{}
	if ent.FirstUserID == nil && strings.TrimSpace(user.ID) != "" {
		updates["first_user_id"] = user.ID
	}
	if strings.TrimSpace(ent.OpenID) == "" && openID != "" {
		updates["openid"] = openID
	}
	if ent.FirstRegisteredAt == nil && user.CreatedAt != nil {
		updates["first_registered_at"] = *user.CreatedAt
	}
	if unionID != "" && ent.UnionID == nil {
		updates["unionid"] = unionID
	}
	if len(updates) == 0 {
		return nil
	}
	_, err = s.users.UpdateTrialEntitlement(ctx, ent.ID, updates)
	return err
}

func (s *LoginService) findOrCreateWechatUser(ctx context.Context, openID, unionID, phoneCode, inviteCode, loginMethod string) (*repo.User, error) {
	user, err := s.users.FindByOpenID(ctx, openID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		phone := s.resolvePhoneNumber(ctx, phoneCode)
		user = newDefaultUser(openID, phone)
		if unionID != "" {
			user.UnionID = &unionID
		}
		user.LastLoginMethod = strPtr(loginMethod)
		now := time.Now()
		user.LastLoginAt = &now
		if err := s.createUserWithUniqueNickname(ctx, user, true); err != nil {
			return nil, err
		}
		if err := s.ensureTrialEntitlement(ctx, user, openID, unionID); err != nil {
			return nil, err
		}
		_ = s.ensureRegistrationInviteCode(ctx, user.ID)
		if inviteCode := strings.ToUpper(strings.TrimSpace(inviteCode)); inviteCode != "" {
			logger.Info(ctx, "微信登录新用户开始绑定邀请关系", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			if err := s.bindInviteReferral(ctx, user.ID, inviteCode); err != nil {
				logger.Error(ctx, "微信登录新用户绑定邀请关系失败", err, slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			} else {
				logger.Info(ctx, "微信登录新用户绑定邀请关系完成", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			}
		} else {
			logger.Info(ctx, "微信登录新用户未携带邀请码", slog.String("user_id", user.ID))
		}
		return user, nil
	}
	updates := map[string]any{}
	if unionID != "" && user.UnionID == nil {
		updates["unionid"] = unionID
	}
	updates["last_login_method"] = loginMethod
	updates["last_login_at"] = time.Now()
	if len(updates) > 0 {
		return s.users.UpdateFields(ctx, user.ID, updates)
	}
	return user, nil
}

func (s *LoginService) findOrCreateAppWechatUser(ctx context.Context, appOpenID, unionID, inviteCode string) (*repo.User, error) {
	if appOpenID == "" {
		return nil, fmt.Errorf("App openid 不能为空")
	}
	user, err := s.users.FindByAppOpenID(ctx, appOpenID)
	if err != nil {
		return nil, err
	}
	if user == nil && unionID != "" {
		user, err = s.users.FindByUnionID(ctx, unionID)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now()
	if user == nil {
		openID := "app-wx:" + appOpenID
		user = newDefaultUser(openID, nil)
		user.AppOpenID = &appOpenID
		if unionID != "" {
			user.AppUnionID = &unionID
			user.UnionID = &unionID
		}
		user.LastLoginMethod = strPtr("wechat_app")
		user.LastLoginAt = &now
		if err := s.createUserWithUniqueNickname(ctx, user, true); err != nil {
			return nil, err
		}
		if err := s.ensureTrialEntitlement(ctx, user, user.OpenID, unionID); err != nil {
			return nil, err
		}
		_ = s.ensureRegistrationInviteCode(ctx, user.ID)
		if inviteCode := strings.ToUpper(strings.TrimSpace(inviteCode)); inviteCode != "" {
			logger.Info(ctx, "App 微信登录新用户开始绑定邀请关系", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			if err := s.bindInviteReferral(ctx, user.ID, inviteCode); err != nil {
				logger.Error(ctx, "App 微信登录新用户绑定邀请关系失败", err, slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			} else {
				logger.Info(ctx, "App 微信登录新用户绑定邀请关系完成", slog.String("user_id", user.ID), slog.String("invite_code", inviteCode))
			}
		} else {
			logger.Info(ctx, "App 微信登录新用户未携带邀请码", slog.String("user_id", user.ID))
		}
		return user, nil
	}
	updates := map[string]any{
		"app_openid":        appOpenID,
		"last_login_method": "wechat_app",
		"last_login_at":     now,
	}
	if unionID != "" {
		if user.AppUnionID == nil {
			updates["app_unionid"] = unionID
		}
		if user.UnionID == nil {
			updates["unionid"] = unionID
		}
	}
	return s.users.UpdateFields(ctx, user.ID, updates)
}

func (s *LoginService) exchangeAppWechatCode(ctx context.Context, code string) (string, string, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", "", fmt.Errorf("code 不能为空")
	}
	if s.cfg.App.Env == "development" && s.cfg.AppAuth.DevelopmentMockLogin {
		mockCode := strings.TrimSpace(s.cfg.WechatMobileAppDevelopmentMockCode())
		if mockCode == "" {
			mockCode = "expo-go-dev-wechat-code"
		}
		if code == mockCode || strings.HasPrefix(code, "mock:") {
			suffix := strings.TrimPrefix(code, "mock:")
			if suffix == "" || suffix == mockCode {
				suffix = "default"
			}
			return defaultAppMockOpenID + "-" + suffix, defaultAppMockUnionID + "-" + suffix, nil
		}
	}
	appID := s.cfg.WechatMobileAppID()
	appSecret := s.cfg.WechatMobileAppSecret()
	if appID == "" || appSecret == "" {
		return "", "", fmt.Errorf("App 微信登录未配置 wechat.mobile_app.app_id / wechat.mobile_app.app_secret")
	}
	return s.users.ExchangeAppCode(ctx, appID, appSecret, code)
}

func (s *LoginService) touchLogin(ctx context.Context, user *repo.User, method string) (*repo.User, error) {
	if user == nil {
		return nil, fmt.Errorf("用户不存在")
	}
	return s.users.UpdateFields(ctx, user.ID, map[string]any{
		"last_login_method": method,
		"last_login_at":     time.Now(),
	})
}

func (s *LoginService) touchSMSLogin(ctx context.Context, user *repo.User) (*repo.User, error) {
	updated, err := s.touchLogin(ctx, user, "sms_code")
	if err == nil || !isLastLoginMethodConstraintError(err) {
		return updated, err
	}
	logger.Warn(ctx, "短信登录方式字段受旧约束限制，已跳过 last_login_method 更新", slog.String("user_id", user.ID))
	return s.users.UpdateFields(ctx, user.ID, map[string]any{
		"last_login_at": time.Now(),
	})
}

func isLastLoginMethodConstraintError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "weapp_user_last_login_method_check") ||
		(strings.Contains(msg, "sqlstate 23514") && strings.Contains(msg, "last_login_method"))
}

func (s *LoginService) issueLoginOutput(user *repo.User, openID, unionID string) (*LoginOutput, error) {
	if user == nil {
		return nil, fmt.Errorf("用户不存在")
	}
	if strings.TrimSpace(openID) == "" {
		openID = user.OpenID
	}
	unionID = firstNonEmpty(unionID, derefString(user.UnionID), derefString(user.AppUnionID))
	access, err := s.jwt.IssueAccess(user.ID, openID, unionID)
	if err != nil {
		return nil, err
	}
	refresh, err := s.jwt.IssueRefresh(user.ID, openID)
	if err != nil {
		return nil, err
	}
	return &LoginOutput{
		AccessToken:     access,
		RefreshToken:    refresh,
		TokenType:       "bearer",
		ExpiresIn:       s.cfg.JWT.AccessTokenTTLSeconds,
		UserID:          user.ID,
		OpenID:          openID,
		UnionID:         unionID,
		PhoneNumber:     user.Telephone,
		PurePhoneNumber: user.Telephone,
		DietGoal:        user.DietGoal,
	}, nil
}

func newDefaultUser(openID string, phone *string) *repo.User {
	pointsBalance := 100.0
	publicRecords := true
	return &repo.User{
		OpenID:        openID,
		Nickname:      buildDefaultWechatNickname(),
		Avatar:        defaultUserAvatarKey,
		Telephone:     phone,
		PointsBalance: &pointsBalance,
		PublicRecords: &publicRecords,
	}
}

func (s *LoginService) createUserWithUniqueNickname(ctx context.Context, user *repo.User, generated bool) error {
	// Nicknames are display names and are temporarily allowed to repeat.
	// Keep the helper name to avoid widening this urgent registration fix.
	return s.users.Create(ctx, user)
}
func (s *LoginService) resolvePhoneNumber(ctx context.Context, phoneCode string) *string {
	phoneCode = strings.TrimSpace(phoneCode)
	if phoneCode == "" {
		return nil
	}
	accessToken, err := s.getWechatAccessToken(ctx)
	if err != nil {
		return nil
	}
	url := fmt.Sprintf("https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=%s", accessToken)
	body, _ := json.Marshal(map[string]string{"code": phoneCode})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	phoneInfo, _ := result["phone_info"].(map[string]any)
	pure := strings.TrimSpace(fmt.Sprintf("%v", phoneInfo["purePhoneNumber"]))
	if pure == "" || pure == "<nil>" {
		return nil
	}
	return &pure
}

func (s *LoginService) getWechatAccessToken(ctx context.Context) (string, error) {
	url := "https://api.weixin.qq.com/cgi-bin/stable_token"
	body, _ := json.Marshal(map[string]string{
		"grant_type": "client_credential",
		"appid":      s.cfg.WechatMiniProgramAppID(),
		"secret":     s.cfg.WechatMiniProgramAppSecret(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if token, ok := result["access_token"].(string); ok && token != "" {
		return token, nil
	}
	return "", fmt.Errorf("access_token empty")
}

func (s *LoginService) ensureRegistrationInviteCode(ctx context.Context, userID string) error {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil || user == nil {
		return err
	}
	if user.RegistrationInviteCode != nil && strings.TrimSpace(*user.RegistrationInviteCode) != "" {
		return nil
	}
	for i := 0; i < 8; i++ {
		code := randomInviteCode()
		if _, err := s.users.UpdateFields(ctx, userID, map[string]any{"registration_invite_code": code}); err == nil {
			return nil
		}
	}
	return nil
}

func (s *LoginService) bindInviteReferral(ctx context.Context, inviteeUserID, inviteCode string) error {
	inviter, err := s.users.FindByRegistrationInviteCode(ctx, inviteCode)
	if err != nil {
		logger.Error(ctx, "通过 registration_invite_code 查询邀请人失败", err, slog.String("invite_code", inviteCode))
		return err
	}
	if inviter == nil {
		inviter, err = s.users.ResolveUserByInviteCode(ctx, inviteCode)
		if err != nil {
			logger.Error(ctx, "通过用户 ID 前缀解析邀请人失败", err, slog.String("invite_code", inviteCode))
			return err
		}
	}
	if inviter == nil {
		logger.Warn(ctx, "未找到邀请人", slog.String("invite_code", inviteCode), slog.String("invitee_user_id", inviteeUserID))
		return nil
	}
	if inviter.ID == "" || inviter.ID == inviteeUserID {
		logger.Warn(ctx, "邀请人无效或自己邀请自己", slog.String("invite_code", inviteCode), slog.String("inviter_id", inviter.ID), slog.String("invitee_user_id", inviteeUserID))
		return nil
	}
	if _, err := s.users.UpdateFields(ctx, inviteeUserID, map[string]any{"referred_by_user_id": inviter.ID}); err != nil {
		logger.Error(ctx, "更新被邀请人 referred_by_user_id 失败", err, slog.String("invitee_user_id", inviteeUserID), slog.String("inviter_id", inviter.ID))
		return err
	}
	if err := s.users.CreateInviteReferralBinding(ctx, inviter.ID, inviteeUserID, inviteCode); err != nil {
		logger.Error(ctx, "创建邀请关系记录失败", err, slog.String("inviter_id", inviter.ID), slog.String("invitee_user_id", inviteeUserID), slog.String("invite_code", inviteCode))
		return err
	}
	logger.Info(ctx, "邀请关系绑定成功", slog.String("inviter_id", inviter.ID), slog.String("invitee_user_id", inviteeUserID), slog.String("invite_code", inviteCode))
	return nil
}

func randomInviteCode() string {
	var buf [4]byte
	_, _ = rand.Read(buf[:])
	return strings.ToUpper(hex.EncodeToString(buf[:]))
}

func buildDefaultWechatNickname() string {
	var buf [4]byte
	_, _ = rand.Read(buf[:])
	n := binary.BigEndian.Uint32(buf[:]) % 1_000_000
	return fmt.Sprintf("%s%06d", defaultWechatNicknamePrefix, n)
}

var defaultWechatNicknameSuffixPattern = regexp.MustCompile(`^\d{6}$`)

var (
	loginUsernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)
	loginPhonePattern    = regexp.MustCompile(`^1[3-9]\d{9}$`)
	loginPhoneReplacer   = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "")
)

func normalizeLoginUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func normalizeLoginPhone(phone string) string {
	phone = loginPhoneReplacer.Replace(strings.TrimSpace(phone))
	phone = strings.TrimPrefix(phone, "+")
	if strings.HasPrefix(phone, "86") && len(phone) == 13 {
		phone = phone[2:]
	}
	if !loginPhonePattern.MatchString(phone) {
		return ""
	}
	return phone
}

func parseLoginIdentifier(username, phone string) (string, string, error) {
	phone = strings.TrimSpace(phone)
	if phone != "" {
		normalizedPhone := normalizeLoginPhone(phone)
		if normalizedPhone == "" {
			return "", "", fmt.Errorf("请输入有效手机号")
		}
		return normalizedPhone, "", nil
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return "", "", nil
	}
	if normalizedPhone := normalizeLoginPhone(username); normalizedPhone != "" {
		return normalizedPhone, "", nil
	}
	return "", "", fmt.Errorf("请输入有效手机号")
}

func loginIdentifierType(phone, username string) string {
	if phone != "" {
		return "phone"
	}
	if username != "" {
		return "username"
	}
	return "empty"
}

func passwordLoginOpenID(phone, username string) string {
	if phone != "" {
		return "app-pwd-phone:" + phone
	}
	return "app-pwd:" + username
}

func validateLoginUsername(username string) error {
	if !loginUsernamePattern.MatchString(username) {
		return fmt.Errorf("账号需为 3-32 位小写字母、数字、点、横线或下划线，并以字母或数字开头")
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func strPtr(value string) *string {
	value = strings.TrimSpace(value)
	return &value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func verifyUserPasswordWithFallback(password string, user *repo.User) bool {
	if user == nil {
		return false
	}
	if user.PasswordHash != nil && VerifyUserPassword(password, *user.PasswordHash) {
		return true
	}
	return VerifyUserPassword(password, legacyUserPasswordHash(user))
}

func legacyUserPasswordHash(user *repo.User) string {
	if user == nil || user.HealthCondition == nil {
		return ""
	}
	authValue, ok := user.HealthCondition["app_auth"]
	if !ok {
		return ""
	}
	if authMap, ok := authValue.(map[string]any); ok {
		return strings.TrimSpace(fmt.Sprint(authMap["password_hash"]))
	}
	if authMap, ok := authValue.(map[string]interface{}); ok {
		return strings.TrimSpace(fmt.Sprint(authMap["password_hash"]))
	}
	return ""
}

func ensureLegacyAppAuth(user *repo.User, username, passwordHash string) {
	if user == nil || user.PasswordHash != nil {
		return
	}
	condition := cloneHealthCondition(user.HealthCondition)
	condition["app_auth"] = map[string]any{
		"username":      username,
		"password_hash": passwordHash,
	}
	user.HealthCondition = condition
}

func cloneHealthCondition(input map[string]any) map[string]any {
	out := make(map[string]any, len(input)+1)
	for key, value := range input {
		out[key] = value
	}
	return out
}

func strPtrIfColumn(users *repo.UserRepo, column, value string) *string {
	if users != nil && users.HasUserColumn(column) {
		return strPtr(value)
	}
	return nil
}

func timePtrIfColumn(users *repo.UserRepo, column string, value time.Time) *time.Time {
	if users != nil && users.HasUserColumn(column) {
		return &value
	}
	return nil
}
