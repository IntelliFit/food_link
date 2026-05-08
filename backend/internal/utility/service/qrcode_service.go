package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
)

type QRCodeService struct {
	appID  string
	secret string
	client *http.Client

	stableTokenURL string
	tokenURL       string
	qrCodeURL      string

	mu             sync.Mutex
	accessToken    string
	tokenFetchedAt int64
	tokenExpiresAt int64
}

func NewQRCodeService(cfg ...*config.Config) *QRCodeService {
	s := &QRCodeService{
		client:         &http.Client{Timeout: 15 * time.Second},
		stableTokenURL: "https://api.weixin.qq.com/cgi-bin/stable_token",
		tokenURL:       "https://api.weixin.qq.com/cgi-bin/token",
		qrCodeURL:      "https://api.weixin.qq.com/wxa/getwxacodeunlimit",
	}
	if len(cfg) > 0 && cfg[0] != nil {
		s.appID = strings.TrimSpace(cfg[0].External.AppID)
		s.secret = strings.TrimSpace(cfg[0].External.Secret)
	}
	return s
}

func (s *QRCodeService) GenerateQRCode(ctx context.Context, scene, page string, width int, checkPath bool, envVersion string) (string, error) {
	scene = strings.TrimSpace(scene)
	if scene == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "scene 不能为空", HTTPStatus: 400}
	}
	if width <= 0 {
		width = 430
	}
	if width < 280 {
		width = 280
	}
	if width > 1280 {
		width = 1280
	}
	envVersion = strings.TrimSpace(envVersion)
	if envVersion == "" {
		envVersion = "release"
	}
	payload := map[string]any{
		"scene":       scene,
		"width":       width,
		"check_path":  checkPath,
		"env_version": envVersion,
	}
	if strings.TrimSpace(page) != "" {
		payload["page"] = strings.TrimSpace(page)
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		token, err := s.getAccessToken(ctx)
		if err != nil {
			return "", err
		}
		image, retry, err := s.requestQRCode(ctx, token, payload)
		if err == nil {
			return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(image), nil
		}
		lastErr = err
		if attempt == 0 && retry {
			s.clearAccessToken()
			continue
		}
		break
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", &commonerrors.AppError{Code: 10000, Message: "生成二维码失败", HTTPStatus: 500}
}

func (s *QRCodeService) getAccessToken(ctx context.Context) (string, error) {
	now := time.Now().Unix()
	s.mu.Lock()
	if s.accessToken != "" && now-s.tokenFetchedAt < 5400 {
		token := s.accessToken
		s.mu.Unlock()
		return token, nil
	}
	s.mu.Unlock()

	if s.appID == "" || s.secret == "" {
		return "", &commonerrors.AppError{Code: 10000, Message: "缺少 APPID 或 SECRET 环境变量", HTTPStatus: 500}
	}
	token, expiresIn, err := s.fetchStableToken(ctx)
	if err != nil || token == "" {
		token, expiresIn, err = s.fetchLegacyToken(ctx)
	}
	if err != nil {
		return "", err
	}
	if token == "" {
		return "", &commonerrors.AppError{Code: 10000, Message: "获取 access_token 失败：未返回 token", HTTPStatus: 500}
	}

	s.mu.Lock()
	s.accessToken = token
	s.tokenFetchedAt = now
	s.tokenExpiresAt = now + int64(expiresIn)
	s.mu.Unlock()
	return token, nil
}

func (s *QRCodeService) fetchStableToken(ctx context.Context) (string, int, error) {
	body, _ := json.Marshal(map[string]any{
		"grant_type":    "client_credential",
		"appid":         s.appID,
		"secret":        s.secret,
		"force_refresh": false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.stableTokenURL, bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, fmt.Errorf("stable_token status %d", resp.StatusCode)
	}
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", 0, err
	}
	if intFromAny(data["errcode"]) != 0 {
		return "", 0, fmt.Errorf("stable_token 返回错误: %v", data["errmsg"])
	}
	return strings.TrimSpace(fmt.Sprintf("%v", data["access_token"])), positiveOrDefault(intFromAny(data["expires_in"]), 7200), nil
}

func (s *QRCodeService) fetchLegacyToken(ctx context.Context) (string, int, error) {
	values := url.Values{}
	values.Set("grant_type", "client_credential")
	values.Set("appid", s.appID)
	values.Set("secret", s.secret)
	reqURL := s.tokenURL + "?" + values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", 0, err
	}
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, &commonerrors.AppError{Code: 10000, Message: fmt.Sprintf("获取 access_token 失败: %d", resp.StatusCode), HTTPStatus: 500}
	}
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", 0, err
	}
	if intFromAny(data["errcode"]) != 0 {
		return "", 0, &commonerrors.AppError{Code: 10000, Message: fmt.Sprintf("获取 access_token 失败: %v (错误码: %d)", data["errmsg"], intFromAny(data["errcode"])), HTTPStatus: 500}
	}
	return strings.TrimSpace(fmt.Sprintf("%v", data["access_token"])), positiveOrDefault(intFromAny(data["expires_in"]), 7200), nil
}

func (s *QRCodeService) requestQRCode(ctx context.Context, token string, payload map[string]any) ([]byte, bool, error) {
	reqURL := s.qrCodeURL + "?access_token=" + url.QueryEscape(token)
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false, &commonerrors.AppError{Code: 10000, Message: "请求微信二维码接口失败", HTTPStatus: 500}
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/json") {
		var data map[string]any
		_ = json.Unmarshal(respBody, &data)
		errcode := intFromAny(data["errcode"])
		if errcode == 40001 || errcode == 42001 {
			return nil, true, &commonerrors.AppError{Code: 10000, Message: "微信 access_token 已失效", HTTPStatus: 500}
		}
		return nil, false, &commonerrors.AppError{Code: 10000, Message: fmt.Sprintf("生成二维码失败: %v", data["errmsg"]), HTTPStatus: 500}
	}
	return respBody, false, nil
}

func (s *QRCodeService) clearAccessToken() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accessToken = ""
	s.tokenFetchedAt = 0
	s.tokenExpiresAt = 0
}

func (s *QRCodeService) httpClient() *http.Client {
	if s.client != nil {
		return s.client
	}
	return http.DefaultClient
}

func positiveOrDefault(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func intFromAny(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}
