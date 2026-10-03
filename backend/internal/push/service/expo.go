package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"food_link/backend/internal/push/domain"
	"io"
	"net/http"
	"strings"
	"time"
)

type expoResult struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}
type ExpoClient struct {
	client      *http.Client
	accessToken string
}

func NewExpoClient(accessToken string) *ExpoClient {
	return &ExpoClient{client: &http.Client{Timeout: 15 * time.Second}, accessToken: strings.TrimSpace(accessToken)}
}

func (c *ExpoClient) post(ctx context.Context, path string, body any, result any) (string, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return "InvalidPayload", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/"+path, bytes.NewReader(b))
	if err != nil {
		return "InvalidRequest", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	resp, err := c.client.Do(req)
	// Never propagate URL, response bodies, token or credential-bearing provider messages.
	if err != nil {
		return "NetworkUnavailable", fmt.Errorf("推送服务网络请求失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Sprintf("HTTP%d", resp.StatusCode), fmt.Errorf("推送服务 HTTP %d", resp.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(result); err != nil {
		return "InvalidResponse", fmt.Errorf("推送服务返回格式无效")
	}
	return "", nil
}
func providerCode(code string) string {
	switch code {
	case "DeviceNotRegistered", "MessageTooBig", "MessageRateExceeded", "MismatchSenderId", "InvalidCredentials", "UNAUTHORIZED", "TOO_MANY_REQUESTS":
		return code
	default:
		return "ProviderRejected"
	}
}
func (c *ExpoClient) Send(ctx context.Context, message domain.Message) (string, string) {
	var out struct {
		Data   expoResult `json:"data"`
		Errors []struct {
			Code string `json:"code"`
		} `json:"errors"`
	}
	code, err := c.post(ctx, "send", message, &out)
	if err != nil {
		return "", code
	}
	if len(out.Errors) > 0 {
		return "", providerCode(out.Errors[0].Code)
	}
	if out.Data.Status != "ok" || out.Data.ID == "" {
		return "", providerCode(out.Data.Details.Error)
	}
	return out.Data.ID, ""
}
func (c *ExpoClient) Receipt(ctx context.Context, id string) (bool, string) {
	var out struct {
		Data   map[string]expoResult `json:"data"`
		Errors []struct {
			Code string `json:"code"`
		} `json:"errors"`
	}
	code, err := c.post(ctx, "getReceipts", map[string]any{"ids": []string{id}}, &out)
	if err != nil {
		return false, code
	}
	if len(out.Errors) > 0 {
		return false, providerCode(out.Errors[0].Code)
	}
	result, ok := out.Data[id]
	if !ok {
		return false, ""
	}
	if result.Status != "ok" {
		return true, providerCode(result.Details.Error)
	}
	return true, ""
}
func retryable(code string) bool {
	return code == "NetworkUnavailable" || code == "HTTP429" || strings.HasPrefix(code, "HTTP5") || code == "TOO_MANY_REQUESTS" || code == "MessageRateExceeded"
}
