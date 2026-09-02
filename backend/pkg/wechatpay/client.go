package wechatpay

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const authSchema = "WECHATPAY2-SHA256-RSA2048"

var wechatPayAPIBase = "https://api.mch.weixin.qq.com"

// Client is a WeChat Pay API client.
type Client struct {
	MchID         string
	SerialNo      string
	AppID         string
	NotifyURL     string
	PrivateKeyPEM string
}

// NewClient creates a new WeChat Pay client.
func NewClient(mchID, serialNo, appID, notifyURL, privateKeyPEM string) *Client {
	return &Client{
		MchID:         mchID,
		SerialNo:      serialNo,
		AppID:         appID,
		NotifyURL:     notifyURL,
		PrivateKeyPEM: privateKeyPEM,
	}
}

// CreateNativeOrder creates a Native payment order for desktop web checkout
// and returns the code_url that should be rendered as a QR code.
func (c *Client) CreateNativeOrder(orderNo, description string, amountCents int) (string, error) {
	canonicalURL := "/v3/pay/transactions/native"
	payload := map[string]any{
		"appid":        c.AppID,
		"mchid":        c.MchID,
		"description":  description,
		"out_trade_no": orderNo,
		"notify_url":   c.NotifyURL,
		"amount": map[string]any{
			"total":    amountCents,
			"currency": "CNY",
		},
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}
	auth, err := c.buildAuthorization(http.MethodPost, canonicalURL, string(bodyBytes))
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, wechatPayAPIBase+canonicalURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "food-link/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("wechat pay native order failed (%d): %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		CodeURL string `json:"code_url"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}
	if result.CodeURL == "" {
		return "", fmt.Errorf("wechat pay did not return code_url")
	}
	return result.CodeURL, nil
}

// QueryOrder fetches the latest WeChat Pay state by merchant order number.
// It is used as a fallback when a payment notification is delayed or lost.
func (c *Client) QueryOrder(ctx context.Context, orderNo string) (map[string]any, error) {
	canonicalURL := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(orderNo) + "?mchid=" + url.QueryEscape(c.MchID)
	auth, err := c.buildAuthorization(http.MethodGet, canonicalURL, "")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wechatPayAPIBase+canonicalURL, nil)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "food-link/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wechat pay query failed (%d): %s", resp.StatusCode, string(respBody))
	}
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	return result, nil
}

// buildAuthorization builds the Authorization header for WeChat Pay API.
func (c *Client) buildAuthorization(method, canonicalURL, body string) (string, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "", err
	}
	nonceStr := hex.EncodeToString(nonceBytes)

	message := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n", method, canonicalURL, timestamp, nonceStr, body)
	signature, err := SignRSA256(message, c.PrivateKeyPEM)
	if err != nil {
		return "", fmt.Errorf("sign authorization: %w", err)
	}

	return fmt.Sprintf(
		"%s mchid=\"%s\",nonce_str=\"%s\",signature=\"%s\",timestamp=\"%s\",serial_no=\"%s\"",
		authSchema, c.MchID, nonceStr, signature, timestamp, c.SerialNo,
	), nil
}

// CreateJSAPIOrder creates a JSAPI order and returns the prepay_id.
func (c *Client) CreateJSAPIOrder(orderNo, description, openid string, amountCents int) (string, error) {
	canonicalURL := "/v3/pay/transactions/jsapi"

	payload := map[string]any{
		"appid":        c.AppID,
		"mchid":        c.MchID,
		"description":  description,
		"out_trade_no": orderNo,
		"notify_url":   c.NotifyURL,
		"amount": map[string]any{
			"total":    amountCents,
			"currency": "CNY",
		},
		"payer": map[string]string{
			"openid": openid,
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	auth, err := c.buildAuthorization("POST", canonicalURL, string(bodyBytes))
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", wechatPayAPIBase+canonicalURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "food-link/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", fmt.Errorf("wechat pay order failed (%d): %s", resp.StatusCode, string(respBody))
	}

	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	prepayID, _ := result["prepay_id"].(string)
	if prepayID == "" {
		return "", fmt.Errorf("wechat pay did not return prepay_id")
	}
	return prepayID, nil
}
