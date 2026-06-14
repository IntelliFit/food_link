package feishu

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	feishuBaseURL           = "https://open.feishu.cn/open-apis"
	tenantAccessTokenExpiry = 7000 * time.Second // 飞书 token 有效期约 2 小时，留一些余量
)

// ImageUploader uploads images to Feishu and returns image_key values.
// It requires a Feishu app_id and app_secret with im:resource permission.
type ImageUploader struct {
	appID     string
	appSecret string
	httpClient *http.Client

	mu        sync.RWMutex
	token     string
	tokenExp  time.Time
}

// NewImageUploader creates an uploader. When appID or appSecret is empty,
// the uploader is disabled and UploadImageFromURL returns an error.
func NewImageUploader(appID, appSecret string) *ImageUploader {
	return &ImageUploader{
		appID:      strings.TrimSpace(appID),
		appSecret:  strings.TrimSpace(appSecret),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// Enabled reports whether the uploader is configured.
func (u *ImageUploader) Enabled() bool {
	return u != nil && u.appID != "" && u.appSecret != ""
}

// UploadImageFromURL downloads an image from the given URL and uploads it to Feishu.
// It returns the Feishu image_key that can be used in message cards.
func (u *ImageUploader) UploadImageFromURL(ctx context.Context, imageURL string) (string, error) {
	if !u.Enabled() {
		return "", fmt.Errorf("feishu image uploader not configured")
	}

	imageBytes, contentType, err := u.downloadImage(ctx, imageURL)
	if err != nil {
		return "", fmt.Errorf("download image: %w", err)
	}

	token, err := u.getTenantAccessToken(ctx)
	if err != nil {
		return "", fmt.Errorf("get tenant access token: %w", err)
	}

	imageKey, err := u.uploadImage(ctx, token, imageBytes, contentType)
	if err != nil {
		return "", fmt.Errorf("upload image: %w", err)
	}
	return imageKey, nil
}

func (u *ImageUploader) downloadImage(ctx context.Context, imageURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, "", err
	}

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("status=%d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return nil, "", err
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return data, contentType, nil
}

func (u *ImageUploader) getTenantAccessToken(ctx context.Context) (string, error) {
	u.mu.RLock()
	token := u.token
	exp := u.tokenExp
	u.mu.RUnlock()

	if token != "" && time.Until(exp) > 60*time.Second {
		return token, nil
	}

	u.mu.Lock()
	defer u.mu.Unlock()

	// double check
	if u.token != "" && time.Until(u.tokenExp) > 60*time.Second {
		return u.token, nil
	}

	payload := map[string]string{
		"app_id":     u.appID,
		"app_secret": u.appSecret,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, feishuBaseURL+"/auth/v3/tenant_access_token/internal", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", err
	}

	var result struct {
		Code          int    `json:"code"`
		Msg           string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire        int    `json:"expire"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal token response: %w", err)
	}
	if result.Code != 0 {
		return "", fmt.Errorf("feishu token api code=%d msg=%s", result.Code, result.Msg)
	}
	if result.TenantAccessToken == "" {
		return "", fmt.Errorf("feishu token api returned empty token")
	}

	u.token = result.TenantAccessToken
	expiry := time.Duration(result.Expire) * time.Second
	if expiry <= 0 {
		expiry = tenantAccessTokenExpiry
	}
	u.tokenExp = time.Now().Add(expiry)
	return u.token, nil
}

func (u *ImageUploader) uploadImage(ctx context.Context, token string, imageBytes []byte, contentType string) (string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("image", "image"+extensionForContentType(contentType))
	if err != nil {
		return "", err
	}
	if _, err := part.Write(imageBytes); err != nil {
		return "", err
	}
	// image_type must be "message" for use in messages/cards
	if err := writer.WriteField("image_type", "message"); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, feishuBaseURL+"/im/v1/images", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", err
	}

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			ImageKey string `json:"image_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal upload response: %w", err)
	}
	if result.Code != 0 {
		return "", fmt.Errorf("feishu upload api code=%d msg=%s", result.Code, result.Msg)
	}
	if result.Data.ImageKey == "" {
		return "", fmt.Errorf("feishu upload api returned empty image_key")
	}
	return result.Data.ImageKey, nil
}

func extensionForContentType(contentType string) string {
	switch {
	case strings.Contains(contentType, "png"):
		return ".png"
	case strings.Contains(contentType, "gif"):
		return ".gif"
	case strings.Contains(contentType, "webp"):
		return ".webp"
	case strings.Contains(contentType, "bmp"):
		return ".bmp"
	default:
		return ".jpg"
	}
}

// UploadImageResult exposes the parsed API response for testing/diagnostics.
type UploadImageResult struct {
	ImageKey string
}

// ParseFeishuImageURL extracts the image key if the URL already is a Feishu image_key or
// a Feishu CDN URL. Returns empty if it is a third-party URL.
func ParseFeishuImageURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if strings.Contains(u.Host, "feishucdn.com") || strings.Contains(u.Host, "feishu.cn") {
		return strings.TrimPrefix(u.Path, "/")
	}
	return ""
}
