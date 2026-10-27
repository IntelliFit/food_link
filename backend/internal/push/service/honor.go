package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/push/domain"
	"food_link/backend/pkg/config"
)

// HonorClient uses the current HONOR endpoints. Never return provider response
// text: OAuth and push errors can echo client secrets or device tokens.
type HonorClient struct {
	client      *http.Client
	config      config.HonorPushConfig
	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func NewHonorClient(cfg config.HonorPushConfig) *HonorClient {
	return &HonorClient{config: cfg, client: &http.Client{
		Timeout:       15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (c *HonorClient) token(ctx context.Context) (string, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.accessToken != "" && time.Now().Before(c.expiresAt) {
		return c.accessToken, ""
	}
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {c.config.ClientID}, "client_secret": {c.config.ClientSecret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://iam.developer.honor.com/auth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", "InvalidRequest"
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", "NetworkUnavailable"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", honorHTTPCode(resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		TokenType   string `json:"token_type"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body) != nil || body.AccessToken == "" || body.ExpiresIn <= 0 || body.ExpiresIn > 86400 || !strings.EqualFold(body.TokenType, "Bearer") {
		return "", "InvalidResponse"
	}
	c.accessToken = body.AccessToken
	// Do not use a token close to expiry. Short-lived tokens are not cached.
	c.expiresAt = time.Now().Add(time.Duration(body.ExpiresIn)*time.Second - time.Minute)
	return c.accessToken, ""
}

func honorHTTPCode(status int) string {
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return "InvalidCredentials"
	}
	return fmt.Sprintf("HTTP%d", status)
}

func (c *HonorClient) invalidateToken(used string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.accessToken == used {
		c.accessToken = ""
		c.expiresAt = time.Time{}
	}
}

// Send acknowledges provider acceptance, not handset delivery. No automatic
// cross-provider fallback: an ambiguous timeout must not cause an FCM duplicate.
func (c *HonorClient) Send(ctx context.Context, message domain.Message) (string, string) {
	if !c.config.Ready() {
		return "", "ProviderUnavailable"
	}
	if message.TTL <= 0 {
		return "", "Expired"
	}
	access, code := c.token(ctx)
	if code != "" {
		return "", code
	}
	data, err := json.Marshal(message.Data)
	if err != nil {
		return "", "InvalidPayload"
	}
	body, err := json.Marshal(map[string]any{
		"token": []string{message.To},
		"data":  string(data),
		"android": map[string]any{
			"ttl": strconv.Itoa(message.TTL) + "s",
			"notification": map[string]any{
				"title": message.Title, "body": message.Body, "tag": message.Tag,
				"clickAction": map[string]any{"type": 3},
			},
		},
	})
	if err != nil || len(body) > 4096 {
		return "", "MessageTooBig"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://push-api.cloud.honor.com/api/v1/"+url.PathEscape(c.config.AppID)+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return "", "InvalidRequest"
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	resp, err := c.client.Do(req)
	if err != nil {
		return "", "NetworkUnavailable"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		code := honorHTTPCode(resp.StatusCode)
		if code == "InvalidCredentials" {
			c.invalidateToken(access)
		}
		return "", code
	}
	var out struct {
		Code *int `json:"code"`
		Data struct {
			SendResult   bool     `json:"sendResult"`
			RequestID    string   `json:"requestId"`
			FailTokens   []string `json:"failTokens"`
			ExpireTokens []string `json:"expireTokens"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out) != nil || out.Code == nil {
		return "", "InvalidResponse"
	}
	// A single token is submitted. Never disable a device based on a generic
	// "all tokens invalid" error, which can also indicate app/credential mismatch.
	for _, expired := range out.Data.ExpireTokens {
		if expired == message.To {
			return "", "DeviceNotRegistered"
		}
	}
	if *out.Code == 200 && out.Data.SendResult && len(out.Data.FailTokens) == 0 && len(out.Data.ExpireTokens) == 0 && out.Data.RequestID != "" {
		return out.Data.RequestID, ""
	}
	switch *out.Code {
	case 401, 403:
		c.invalidateToken(access)
		return "", "InvalidCredentials"
	case 429, 503, 80200021:
		return "", "MessageRateExceeded"
	case 500, 502:
		return "", "HTTP500"
	case 80300008:
		return "", "MessageTooBig"
	default:
		return "", "ProviderRejected"
	}
}
