package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

var releaseMediaLock = redis.NewScript(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`)

var (
	ErrRejected    = &commonerrors.AppError{Code: 10011, Message: "所发布内容含违规信息", HTTPStatus: http.StatusBadRequest}
	ErrPending     = &commonerrors.AppError{Code: 10012, Message: "图片审核尚未完成，请稍后重试", HTTPStatus: http.StatusConflict}
	ErrUnavailable = &commonerrors.AppError{Code: 10013, Message: "内容审核暂时不可用，请稍后重试", HTTPStatus: http.StatusServiceUnavailable}
)

type UserFinder interface {
	FindByID(context.Context, string) (*authrepo.User, error)
}

type Result struct {
	Suggest string `json:"suggest" xml:"suggest"`
	Label   int    `json:"label" xml:"label"`
}

type APIResponse struct {
	ErrCode *int   `json:"errcode" xml:"errcode"`
	TraceID string `json:"trace_id" xml:"trace_id"`
	Result  Result `json:"result" xml:"result"`
}

// Service checks content before a write. Only an explicit pass permits publication.
// Redis shares image tickets/results across replicas; absent Redis never permits images.
type Service struct {
	users                 UserFinder
	appID, secret, prefix string
	client                *http.Client
	baseURL               string
	store                 *redis.Client
	mediaEnabled          bool
	approvalReader        func(context.Context, string, string) (map[string]any, error)
	mediaResultHandler    func(context.Context, string) error
	mu                    sync.Mutex
	token                 string
	expires               time.Time
}

func New(cfg *config.Config, users UserFinder) (*Service, error) {
	s := &Service{users: users, appID: cfg.WechatMiniProgramAppID(), secret: cfg.WechatMiniProgramAppSecret(),
		prefix: strings.TrimSpace(cfg.Redis.KeyPrefix) + ":content-security:", baseURL: "https://api.weixin.qq.com",
		client: &http.Client{Timeout: 8 * time.Second}}
	s.mediaEnabled = strings.TrimSpace(cfg.Wechat.ContentSecurity.MessageToken) != "" || strings.TrimSpace(cfg.Wechat.XPay.MessageToken) != ""
	if strings.TrimSpace(cfg.Redis.URL) != "" {
		opt, err := redis.ParseURL(cfg.Redis.URL)
		if err != nil {
			return nil, fmt.Errorf("内容审核 Redis 地址无效")
		}
		if opt.Password == "" {
			opt.Password = cfg.Redis.Password
		}
		opt.DB = cfg.Redis.DB
		s.store = redis.NewClient(opt)
	}
	return s, nil
}

func (s *Service) Close() error {
	if s.store != nil {
		return s.store.Close()
	}
	return nil
}

func (s *Service) Identity(ctx context.Context, userID string) (string, error) {
	if s.users == nil {
		return "", ErrUnavailable
	}
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		logger.Error(ctx, "内容审核查询用户失败", err, slog.String("user_id", userID))
		return "", ErrUnavailable
	}
	if u == nil || strings.TrimSpace(u.OpenID) == "" {
		return "", ErrUnavailable
	}
	return u.OpenID, nil
}

func (s *Service) CheckText(ctx context.Context, openID string, scene int, text string) error {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) == 0 {
		return nil
	}
	cacheKey := s.mediaKey(openID, scene, text) + ":text"
	if s.store != nil {
		if cached, err := s.store.Get(ctx, cacheKey).Result(); err == nil && cached == "pass" {
			return nil
		}
	}
	// Overlap prevents a keyword spanning the API's length boundary from being skipped.
	for start := 0; start < len(runes); {
		end := min(start+2400, len(runes))
		var res APIResponse
		err := s.call(ctx, "/wxa/msg_sec_check", map[string]any{
			"version": 2, "openid": openID, "scene": scene, "content": string(runes[start:end]),
		}, &res)
		if err != nil {
			return err
		}
		if err := decision(res); err != nil {
			return err
		}
		logger.Info(ctx, "文本内容审核通过", slog.String("wechat_trace_id", res.TraceID), slog.Int("scene", scene))
		if end == len(runes) {
			break
		}
		start = end - 100
	}
	if s.store != nil {
		_ = s.store.Set(ctx, cacheKey, "pass", 30*time.Minute).Err()
	}
	return nil
}

func decision(res APIResponse) error {
	if res.ErrCode == nil || *res.ErrCode != 0 {
		return ErrUnavailable
	}
	switch res.Result.Suggest {
	case "pass":
		return nil
	case "risky", "review":
		return ErrRejected
	default:
		return ErrUnavailable
	}
}

func (s *Service) CheckImages(ctx context.Context, openID string, scene int, urls []string) error {
	if len(urls) == 0 {
		return nil
	}
	if s.store == nil || !s.mediaEnabled {
		return ErrUnavailable
	}
	pending := false
	for _, mediaURL := range urls {
		key := s.mediaKey(openID, scene, mediaURL)
		traceID, err := s.store.Get(ctx, key).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return ErrUnavailable
		}
		if traceID == "" {
			lockValue := uuid.NewString()
			locked, err := s.store.SetNX(ctx, key+":lock", lockValue, time.Minute).Result()
			if err != nil {
				return ErrUnavailable
			}
			if !locked {
				pending = true
				continue
			}
			// Another replica may have finished between our first GET and the lock.
			traceID, err = s.store.Get(ctx, key).Result()
			if errors.Is(err, redis.Nil) {
				err = nil
			}
			if err == nil && traceID == "" {
				var res APIResponse
				err = s.call(ctx, "/wxa/media_check_async", map[string]any{
					"version": 2, "openid": openID, "scene": scene, "media_type": 2, "media_url": mediaURL,
				}, &res)
				if err == nil && strings.TrimSpace(res.TraceID) != "" {
					traceID = res.TraceID
					err = s.store.Set(ctx, key, traceID, time.Hour).Err()
				} else if err == nil {
					err = ErrUnavailable
				}
			}
			_, _ = releaseMediaLock.Run(ctx, s.store, []string{key + ":lock"}, lockValue).Result()
			if err != nil {
				return ErrUnavailable
			}
			logger.Info(ctx, "图片内容审核已提交", slog.String("wechat_trace_id", traceID), slog.Int("scene", scene))
		}
		raw, err := s.store.Get(ctx, s.prefix+"result:"+traceID).Bytes()
		if errors.Is(err, redis.Nil) {
			pending = true
			continue
		}
		if err != nil {
			return ErrUnavailable
		}
		var res APIResponse
		if json.Unmarshal(raw, &res) != nil {
			return ErrUnavailable
		}
		if err := decision(res); err != nil {
			if err == ErrUnavailable {
				_ = s.store.Del(ctx, key).Err()
			}
			return err
		}
	}
	if pending {
		return ErrPending
	}
	return nil
}

func (s *Service) mediaKey(openID string, scene int, mediaURL string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d\x00%s", openID, scene, mediaURL)))
	return s.prefix + "media:" + hex.EncodeToString(sum[:])
}

// RecordMediaResult is called only after callback signature/decryption/appid validation.
func (s *Service) RecordMediaResult(ctx context.Context, res APIResponse) error {
	if s.store == nil || strings.TrimSpace(res.TraceID) == "" || res.ErrCode == nil {
		return ErrUnavailable
	}
	raw, _ := json.Marshal(res)
	// First result wins; retries cannot overwrite a rejection with a later pass.
	if err := s.store.SetNX(ctx, s.prefix+"result:"+res.TraceID, raw, time.Hour).Err(); err != nil {
		return ErrUnavailable
	}
	logger.Info(ctx, "图片内容审核回调已保存", slog.String("wechat_trace_id", res.TraceID),
		slog.Int("wechat_errcode", *res.ErrCode), slog.String("suggest", res.Result.Suggest))
	if s.mediaResultHandler != nil {
		tasks, err := s.store.SMembers(ctx, s.prefix+"watchers:"+res.TraceID).Result()
		if err != nil {
			return ErrUnavailable
		}
		for _, taskID := range tasks {
			if err := s.mediaResultHandler(ctx, taskID); err != nil {
				logger.Error(ctx, "图片审核回调唤醒识别任务失败", err, slog.String("task_id", taskID))
				return ErrUnavailable
			}
		}
	}
	return nil
}

func (s *Service) call(ctx context.Context, path string, payload any, res *APIResponse) error {
	for attempt := 0; attempt < 2; attempt++ {
		token, err := s.accessToken(ctx)
		if err != nil {
			return ErrUnavailable
		}
		*res = APIResponse{}
		if err := s.post(ctx, path+"?access_token="+url.QueryEscape(token), payload, res); err != nil {
			return ErrUnavailable
		}
		if res.ErrCode != nil && (*res.ErrCode == 40001 || *res.ErrCode == 40014 || *res.ErrCode == 42001) && attempt == 0 {
			s.mu.Lock()
			if s.token == token {
				s.token = ""
			}
			s.mu.Unlock()
			continue
		}
		if res.ErrCode == nil || *res.ErrCode != 0 {
			if res.ErrCode != nil {
				logger.Warn(ctx, "微信内容审核调用失败", slog.Int("wechat_errcode", *res.ErrCode))
			}
			return ErrUnavailable
		}
		return nil
	}
	return ErrUnavailable
}

func (s *Service) accessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && time.Now().Before(s.expires) {
		return s.token, nil
	}
	if s.appID == "" || s.secret == "" {
		return "", ErrUnavailable
	}
	var res struct {
		ErrCode int    `json:"errcode"`
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	err := s.post(ctx, "/cgi-bin/stable_token", map[string]any{
		"grant_type": "client_credential", "appid": s.appID, "secret": s.secret, "force_refresh": false,
	}, &res)
	if err != nil || res.ErrCode != 0 || res.Token == "" || res.Expires <= 120 {
		return "", ErrUnavailable
	}
	s.token, s.expires = res.Token, time.Now().Add(time.Duration(res.Expires-120)*time.Second)
	return s.token, nil
}

func (s *Service) post(ctx context.Context, path string, payload, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := s.client.Do(req)
	// Never propagate transport errors containing access_token in the request URL.
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ErrUnavailable
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(result) != nil {
		return ErrUnavailable
	}
	return nil
}
