package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"github.com/redis/go-redis/v9"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	sms "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/sms/v20210111"
)

const (
	smsCodeKeyPrefix      = "sms_verification_code:"
	smsPhoneThrottlePref  = "throttle:sms:"
	smsIPThrottlePref     = "throttle:sms:ip:"
	smsDefaultExpireMins  = 15
	smsDefaultThrottleSec = 30
)

type SMSCodeStore interface {
	SetNX(ctx context.Context, key, value string, ttl time.Duration) (bool, error)
	Set(ctx context.Context, key, value string, ttl time.Duration) error
	Consume(ctx context.Context, key, value string) (bool, error)
	Del(ctx context.Context, keys ...string) error
}

type SMSSender interface {
	SendVerificationCode(ctx context.Context, phone, code string, ttlMinutes int) (string, error)
}

type SMSService struct {
	cfg       config.SMSConfig
	keyPrefix string
	login     *LoginService
	users     *repo.UserRepo
	jwt       *JWTService
	store     SMSCodeStore
	sender    SMSSender
}

type SendSMSCodeInput struct {
	Phone string `json:"phone"`
}

type SMSLoginInput struct {
	Phone      string `json:"phone"`
	Code       string `json:"code"`
	InviteCode string `json:"inviteCode"`
}

type SendSMSCodeOutput struct {
	RequestID        string `json:"request_id"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
	CooldownSeconds  int    `json:"cooldown_seconds"`
}

func NewSMSService(cfg config.SMSConfig, keyPrefix string, login *LoginService, users *repo.UserRepo, jwt *JWTService, store SMSCodeStore, sender SMSSender) *SMSService {
	return &SMSService{
		cfg:       cfg,
		keyPrefix: normalizeRedisKeyPrefix(keyPrefix),
		login:     login,
		users:     users,
		jwt:       jwt,
		store:     store,
		sender:    sender,
	}
}

func (s *SMSService) SendCode(ctx context.Context, input SendSMSCodeInput, clientIP string) (*SendSMSCodeOutput, error) {
	phone, err := parsePhoneLoginIdentifier(input.Phone, "")
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fmt.Errorf("请输入手机号")
	}
	if s.store == nil {
		return nil, fmt.Errorf("验证码服务未配置")
	}
	ttlMinutes := s.cfg.CodeTTLMinutes
	if ttlMinutes <= 0 {
		ttlMinutes = smsDefaultExpireMins
	}
	throttle := time.Duration(s.cfg.ThrottleSeconds) * time.Second
	if throttle <= 0 {
		throttle = smsDefaultThrottleSec * time.Second
	}
	cooldownSeconds := int(throttle / time.Second)
	ipThrottle := time.Duration(s.cfg.IPThrottleSeconds) * time.Second
	if ipThrottle <= 0 {
		ipThrottle = throttle
	}
	phoneThrottleKey := s.smsPhoneThrottleKey(phone)
	ok, err := s.store.SetNX(ctx, phoneThrottleKey, "1", throttle)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("验证码发送过于频繁，请稍后再试")
	}
	ipThrottleKey := s.smsIPThrottleKey(clientIP)
	if strings.TrimSpace(clientIP) != "" {
		ok, err = s.store.SetNX(ctx, ipThrottleKey, "1", ipThrottle)
		if err != nil {
			_ = s.store.Del(ctx, phoneThrottleKey)
			return nil, err
		}
		if !ok {
			_ = s.store.Del(ctx, phoneThrottleKey)
			return nil, fmt.Errorf("验证码发送过于频繁，请稍后再试")
		}
	}
	code, err := generateSMSCode()
	if err != nil {
		_ = s.store.Del(ctx, phoneThrottleKey, ipThrottleKey)
		return nil, err
	}
	requestID := "mock-request-id"
	if s.cfg.MockEnabled {
		code = firstNonEmpty(s.cfg.MockCode, "123456")
		logger.Info(ctx, "App 手机验证码已生成（模拟发送）", slog.String("phone", maskPhoneForLog(phone)))
	} else {
		if s.sender == nil {
			_ = s.store.Del(ctx, phoneThrottleKey, ipThrottleKey)
			return nil, fmt.Errorf("短信服务未配置")
		}
		requestID, err = s.sender.SendVerificationCode(ctx, phone, code, ttlMinutes)
		if err != nil {
			_ = s.store.Del(ctx, phoneThrottleKey, ipThrottleKey)
			return nil, err
		}
	}
	if err := s.store.Set(ctx, s.smsCodeKey(phone), code, time.Duration(ttlMinutes)*time.Minute); err != nil {
		_ = s.store.Del(ctx, phoneThrottleKey, ipThrottleKey)
		return nil, err
	}
	logger.Info(ctx, "App 手机验证码发送成功", slog.String("phone", maskPhoneForLog(phone)), slog.String("request_id", requestID))
	return &SendSMSCodeOutput{RequestID: requestID, ExpiresInSeconds: ttlMinutes * 60, CooldownSeconds: cooldownSeconds}, nil
}

func (s *SMSService) LoginWithCode(ctx context.Context, input SMSLoginInput) (*LoginOutput, error) {
	phone, err := parsePhoneLoginIdentifier(input.Phone, "")
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fmt.Errorf("请输入手机号")
	}
	code := strings.TrimSpace(input.Code)
	if code == "" {
		return nil, fmt.Errorf("请输入验证码")
	}
	if s.store == nil {
		return nil, fmt.Errorf("验证码服务未配置")
	}
	matched, err := s.store.Consume(ctx, s.smsCodeKey(phone), code)
	if err != nil {
		return nil, err
	}
	if !matched {
		return nil, fmt.Errorf("验证码错误或已过期")
	}
	user, err := s.users.FindByTelephone(ctx, phone)
	if err != nil {
		return nil, err
	}
	if user == nil {
		user = newDefaultUser("app-phone:"+phone, &phone)
		now := time.Now()
		user.LastLoginAt = timePtrIfColumn(s.users, "last_login_at", now)
		if err := s.users.Create(ctx, user); err != nil {
			return nil, err
		}
		user, err = s.login.touchSMSLogin(ctx, user)
		if err != nil {
			return nil, err
		}
		if err := s.login.ensureTrialVoucher(ctx, user, user.OpenID, ""); err != nil {
			return nil, err
		}
		_ = s.login.ensureRegistrationInviteCode(ctx, user.ID)
		if inviteCode := strings.ToUpper(strings.TrimSpace(input.InviteCode)); inviteCode != "" {
			_ = s.login.bindInviteReferral(ctx, user.ID, inviteCode)
		}
	} else {
		user, err = s.login.touchSMSLogin(ctx, user)
		if err != nil {
			return nil, err
		}
	}
	logger.Info(ctx, "App 手机验证码登录成功", slog.String("user_id", user.ID), slog.String("phone", maskPhoneForLog(phone)))
	return s.login.issueLoginOutput(user, user.OpenID, firstNonEmpty(derefString(user.UnionID), derefString(user.AppUnionID)))
}

func (s *SMSService) smsCodeKey(phone string) string {
	return prefixedRedisKey(s.keyPrefix, smsCodeKeyPrefix+phone)
}

func (s *SMSService) smsPhoneThrottleKey(phone string) string {
	return prefixedRedisKey(s.keyPrefix, smsPhoneThrottlePref+phone)
}

func (s *SMSService) smsIPThrottleKey(clientIP string) string {
	return prefixedRedisKey(s.keyPrefix, smsIPThrottlePref+strings.TrimSpace(clientIP))
}

func normalizeRedisKeyPrefix(prefix string) string {
	return strings.Trim(strings.TrimSpace(prefix), ":")
}

func prefixedRedisKey(prefix, key string) string {
	prefix = normalizeRedisKeyPrefix(prefix)
	key = strings.TrimLeft(strings.TrimSpace(key), ":")
	if prefix == "" {
		return key
	}
	return prefix + ":" + key
}

type RedisCodeStore struct {
	client *redis.Client
}

func NewSMSCodeStore(cfg config.RedisConfig, appEnv string) (SMSCodeStore, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	if mode == "" {
		mode = "auto"
	}
	switch mode {
	case "redis":
		return NewRedisCodeStore(cfg)
	case "memory":
		return NewMemoryCodeStore(), nil
	case "auto":
		if strings.TrimSpace(cfg.URL) != "" {
			return NewRedisCodeStore(cfg)
		}
		if isLocalAppEnv(appEnv) {
			return NewMemoryCodeStore(), nil
		}
		return nil, nil
	default:
		return nil, fmt.Errorf("redis.mode 只支持 auto、redis 或 memory")
	}
}

func NewRedisCodeStore(cfg config.RedisConfig) (*RedisCodeStore, error) {
	if strings.TrimSpace(cfg.URL) == "" {
		return nil, fmt.Errorf("redis.url 不能为空")
	}
	opt, err := redis.ParseURL(strings.TrimSpace(cfg.URL))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Password) != "" && opt.Password == "" {
		opt.Password = strings.TrimSpace(cfg.Password)
	}
	opt.DB = cfg.DB
	return &RedisCodeStore{client: redis.NewClient(opt)}, nil
}

func (s *RedisCodeStore) SetNX(ctx context.Context, key, value string, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, key, value, ttl).Result()
}

func (s *RedisCodeStore) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	return s.client.Set(ctx, key, value, ttl).Err()
}

func (s *RedisCodeStore) Consume(ctx context.Context, key, value string) (bool, error) {
	result, err := s.client.Eval(ctx, `
local current = redis.call("GET", KEYS[1])
if not current then
	return 0
end
if current ~= ARGV[1] then
	return 0
end
redis.call("DEL", KEYS[1])
return 1
`, []string{key}, value).Int()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return result == 1, nil
}

func (s *RedisCodeStore) Del(ctx context.Context, keys ...string) error {
	filtered := make([]string, 0, len(keys))
	for _, key := range keys {
		if strings.TrimSpace(key) != "" {
			filtered = append(filtered, key)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	return s.client.Del(ctx, filtered...).Err()
}

type TencentCloudSMSSender struct {
	cfg config.SMSConfig
}

func NewTencentCloudSMSSender(cfg config.SMSConfig) *TencentCloudSMSSender {
	return &TencentCloudSMSSender{cfg: cfg}
}

func (s *TencentCloudSMSSender) SendVerificationCode(ctx context.Context, phone, code string, ttlMinutes int) (string, error) {
	if strings.TrimSpace(s.cfg.TencentCloudSecretID) == "" ||
		strings.TrimSpace(s.cfg.TencentCloudSecretKey) == "" ||
		strings.TrimSpace(s.cfg.TencentCloudSMSSDKAppID) == "" ||
		strings.TrimSpace(s.cfg.TencentCloudSMSSignName) == "" ||
		strings.TrimSpace(s.cfg.TencentCloudSMSVerificationTplID) == "" {
		return "", fmt.Errorf("短信服务配置不完整")
	}
	credential := common.NewCredential(s.cfg.TencentCloudSecretID, s.cfg.TencentCloudSecretKey)
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "sms.tencentcloudapi.com"
	client, err := sms.NewClient(credential, firstNonEmpty(s.cfg.TencentCloudRegion, "ap-guangzhou"), cpf)
	if err != nil {
		return "", err
	}
	req := sms.NewSendSmsRequest()
	req.SmsSdkAppId = common.StringPtr(s.cfg.TencentCloudSMSSDKAppID)
	req.SignName = common.StringPtr(s.cfg.TencentCloudSMSSignName)
	req.TemplateId = common.StringPtr(s.cfg.TencentCloudSMSVerificationTplID)
	req.TemplateParamSet = common.StringPtrs([]string{code, fmt.Sprint(ttlMinutes)})
	req.PhoneNumberSet = common.StringPtrs([]string{"+86" + phone})
	_ = ctx
	resp, err := client.SendSms(req)
	if err != nil {
		return "", err
	}
	if resp == nil || resp.Response == nil || resp.Response.RequestId == nil || strings.TrimSpace(*resp.Response.RequestId) == "" {
		return "", fmt.Errorf("发送短信失败，未收到请求编号")
	}
	if len(resp.Response.SendStatusSet) > 0 && resp.Response.SendStatusSet[0] != nil {
		status := resp.Response.SendStatusSet[0]
		if status.Code != nil && strings.TrimSpace(*status.Code) != "Ok" {
			message := ""
			if status.Message != nil {
				message = *status.Message
			}
			return "", fmt.Errorf("发送短信失败：%s", firstNonEmpty(message, *status.Code))
		}
	}
	return *resp.Response.RequestId, nil
}

type MemoryCodeStore struct {
	mu    sync.Mutex
	items map[string]memoryCodeItem
}

type memoryCodeItem struct {
	value     string
	expiresAt time.Time
}

func NewMemoryCodeStore() *MemoryCodeStore {
	return &MemoryCodeStore{items: map[string]memoryCodeItem{}}
}

func (s *MemoryCodeStore) SetNX(_ context.Context, key, value string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if item, ok := s.items[key]; ok && time.Now().Before(item.expiresAt) {
		return false, nil
	}
	s.items[key] = memoryCodeItem{value: value, expiresAt: time.Now().Add(ttl)}
	return true, nil
}

func (s *MemoryCodeStore) Set(_ context.Context, key, value string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key] = memoryCodeItem{value: value, expiresAt: time.Now().Add(ttl)}
	return nil
}

func (s *MemoryCodeStore) Consume(_ context.Context, key, value string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[key]
	if !ok || time.Now().After(item.expiresAt) {
		delete(s.items, key)
		return false, nil
	}
	if item.value != value {
		return false, nil
	}
	delete(s.items, key)
	return true, nil
}

func (s *MemoryCodeStore) Del(_ context.Context, keys ...string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, key := range keys {
		delete(s.items, key)
	}
	return nil
}

func generateSMSCode() (string, error) {
	max := big.NewInt(900000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()+100000), nil
}

func parsePhoneLoginIdentifier(phone, legacyUsername string) (string, error) {
	if normalized := normalizeLoginPhone(phone); normalized != "" {
		return normalized, nil
	}
	if strings.TrimSpace(phone) != "" {
		return "", fmt.Errorf("请输入有效手机号")
	}
	if normalized := normalizeLoginPhone(legacyUsername); normalized != "" {
		return normalized, nil
	}
	if strings.TrimSpace(legacyUsername) != "" {
		return "", fmt.Errorf("请输入有效手机号")
	}
	return "", nil
}

func maskPhoneForLog(phone string) string {
	phone = normalizeLoginPhone(phone)
	if len(phone) != 11 {
		return ""
	}
	return phone[:3] + "****" + phone[7:]
}

func isLocalAppEnv(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "", "dev", "development", "local", "test", "testing":
		return true
	default:
		return false
	}
}
