package feishu

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const defaultHTTPTimeout = 10 * time.Second

// WebhookClient sends messages to a Feishu custom bot webhook.
type WebhookClient struct {
	webhookURL string
	secret     string
	httpClient *http.Client
}

// NewWebhookClient creates a client. When webhookURL is empty the client is disabled.
func NewWebhookClient(webhookURL, secret string) *WebhookClient {
	return &WebhookClient{
		webhookURL: strings.TrimSpace(webhookURL),
		secret:     strings.TrimSpace(secret),
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
	}
}

// Enabled reports whether webhook notifications are configured.
func (c *WebhookClient) Enabled() bool {
	return c != nil && c.webhookURL != ""
}

// SendText posts a plain-text message. The call is a no-op when the client is disabled.
func (c *WebhookClient) SendText(ctx context.Context, text string) error {
	if !c.Enabled() {
		return nil
	}
	payload := map[string]any{
		"msg_type": "text",
		"content": map[string]string{
			"text": text,
		},
	}
	return c.send(ctx, payload)
}

func (c *WebhookClient) send(ctx context.Context, payload map[string]any) error {
	if c.secret != "" {
		timestamp := time.Now().Unix()
		sign, err := genSign(c.secret, timestamp)
		if err != nil {
			return fmt.Errorf("feishu sign: %w", err)
		}
		payload["timestamp"] = strconv.FormatInt(timestamp, 10)
		payload["sign"] = sign
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("feishu marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("feishu build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("feishu request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return fmt.Errorf("feishu read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("feishu status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var result struct {
		Code          int    `json:"code"`
		Msg           string `json:"msg"`
		StatusCode    int    `json:"StatusCode"`
		StatusMessage string `json:"StatusMessage"`
	}
	if len(respBody) > 0 {
		_ = json.Unmarshal(respBody, &result)
	}
	if result.Code != 0 && result.StatusCode != 0 {
		return fmt.Errorf("feishu api error code=%d msg=%s status=%d message=%s",
			result.Code, result.Msg, result.StatusCode, result.StatusMessage)
	}
	return nil
}

// genSign follows Feishu custom bot signature rules:
// HmacSHA256(key=timestamp+"\n"+secret, data="") then Base64.
func genSign(secret string, timestamp int64) (string, error) {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	mac := hmac.New(sha256.New, []byte(stringToSign))
	if _, err := mac.Write(nil); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}
