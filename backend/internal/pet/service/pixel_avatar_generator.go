package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

const (
	defaultPixelAvatarBaseURL = "https://maas-openapi.wanjiedata.com/api/v1"
	defaultPixelAvatarModel   = "gpt-image-2-pool"
	pixelAvatarQuality        = "low"
	pixelAvatarOutputSize     = "1024x1024"
	maxGeneratedAvatarBytes   = 24 << 20
	pixelAvatarHTTPTimeout    = 150 * time.Second
	pixelAvatarTLSTimeout     = 30 * time.Second
	pixelAvatarRetryDelay     = 300 * time.Millisecond
)

const pixelAvatarPrompt = `Transform the person in the reference photo into one polished animated pixel-art companion sprite sheet.

Identity and composition:
- preserve the person's recognizable facial features, hairstyle, hair color, skin tone, glasses and distinctive clothing colors
- show the same centered, friendly, front-facing chibi character in every frame, with head and upper body clearly visible
- keep the pose simple and suitable for a small mobile companion

Sprite-sheet layout:
- return one square 2-by-2 sprite sheet with four equal square cells and generous transparent gutters between cells
- top-left: neutral idle pose with eyes naturally open
- top-right: the pixel-identical idle pose with both eyes fully closed in a brief blink; closed eyelids must be two short horizontal dark pixel lines with no iris or pupil
- bottom-left: a tiny squash pose preparing to hop, eyes open
- bottom-right: a cheerful airborne hop pose, eyes open
- keep identity, proportions, scale, clothing, lighting and palette pixel-consistent across all four cells
- never add glasses, sunglasses, masks, eye patches or eyewear unless the person visibly wears them in the reference photo; eyewear must never appear or disappear between frames
- do not add cell borders, labels, numbers, guides, separators, stars, glows, floor shadows or duplicated background objects

Pixel-art requirements:
- detailed high-resolution 16-bit pixel art with crisp, small square pixel clusters and a controlled color palette
- retain clear eyes, eyebrows, nose, mouth, hair strands and clothing details; the face must remain recognizable at avatar size
- use fine pixel clusters rather than coarse mosaic blocks or an intentionally low-resolution look
- crisp nearest-neighbor look; no blur, no antialiasing, no soft-focus painting, no gradients, no photographic texture
- transparent background in every cell and all the way to every canvas edge; every pixel outside the four characters must have zero alpha
- absolutely no white border, white halo, outline frame, circular badge, card, sticker edge, drop shadow or background panel
- leave a small transparent margin around each character while keeping the center gutters transparent

Return exactly one square PNG 2-by-2 sprite sheet.`

var ErrPixelAvatarGenerationUnavailable = errors.New("pixel avatar generation unavailable")

type OpenAIImageEditClient struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

func NewOpenAIImageEditClient(apiKey, baseURL, model string) *OpenAIImageEditClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultPixelAvatarBaseURL
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultPixelAvatarModel
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// 图像生成接口偶尔会在入口网关的 TLS 握手阶段抖动。Go 默认只给握手
	// 10 秒，明显短于整次图像生成预算，因此这里单独放宽握手时间。
	transport.TLSHandshakeTimeout = pixelAvatarTLSTimeout
	return &OpenAIImageEditClient{
		apiKey:  strings.TrimSpace(apiKey),
		baseURL: baseURL,
		model:   model,
		httpClient: &http.Client{
			Timeout:   pixelAvatarHTTPTimeout,
			Transport: transport,
		},
	}
}

func (c *OpenAIImageEditClient) GeneratePixelAvatar(ctx context.Context, source []byte) ([]byte, error) {
	if c == nil || strings.TrimSpace(c.apiKey) == "" {
		return nil, ErrPixelAvatarGenerationUnavailable
	}
	if len(source) == 0 {
		return nil, ErrInvalidPixelAvatarImage
	}

	authHeaders := []string{"Bearer " + c.apiKey, c.apiKey}
	var lastErr error
	for index, authorization := range authHeaders {
		generated, status, err := c.generateWithHandshakeRetry(ctx, source, authorization)
		if err == nil {
			return generated, nil
		}
		lastErr = err
		if index == 0 && (status == http.StatusUnauthorized || status == http.StatusForbidden) {
			continue
		}
		break
	}
	return nil, lastErr
}

func (c *OpenAIImageEditClient) generateWithHandshakeRetry(ctx context.Context, source []byte, authorization string) ([]byte, int, error) {
	generated, status, err := c.generate(ctx, source, authorization)
	if err == nil || !isPixelAvatarTLSHandshakeTimeout(err) {
		return generated, status, err
	}

	// TLS 握手超时时请求体尚未交给上游应用，重试不会重复触发图像生成或计费。
	timer := time.NewTimer(pixelAvatarRetryDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, status, ctx.Err()
	case <-timer.C:
	}
	return c.generate(ctx, source, authorization)
}

func isPixelAvatarTLSHandshakeTimeout(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "tls handshake timeout")
}

func (c *OpenAIImageEditClient) generate(ctx context.Context, source []byte, authorization string) ([]byte, int, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", c.model); err != nil {
		return nil, 0, err
	}
	if err := writer.WriteField("prompt", pixelAvatarPrompt); err != nil {
		return nil, 0, err
	}
	if err := writer.WriteField("quality", pixelAvatarQuality); err != nil {
		return nil, 0, err
	}
	if err := writer.WriteField("size", pixelAvatarOutputSize); err != nil {
		return nil, 0, err
	}
	if err := writer.WriteField("background", "transparent"); err != nil {
		return nil, 0, err
	}
	if err := writer.WriteField("output_format", "png"); err != nil {
		return nil, 0, err
	}

	contentType, filename := pixelAvatarSourceType(source)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", `form-data; name="image"; filename="`+filename+`"`)
	partHeader.Set("Content-Type", contentType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return nil, 0, err
	}
	if _, err := part.Write(source); err != nil {
		return nil, 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/images/edits", &body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("调用像素头像模型失败: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxGeneratedAvatarBytes+1))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("读取像素头像模型响应失败: %w", err)
	}
	if len(responseBody) > maxGeneratedAvatarBytes {
		return nil, resp.StatusCode, errors.New("像素头像模型响应过大")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.StatusCode, fmt.Errorf("像素头像模型返回 %d: %s", resp.StatusCode, summarizePixelAvatarResponse(responseBody))
	}

	var payload struct {
		Data []struct {
			Base64JSON string `json:"b64_json"`
			URL        string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("解析像素头像模型响应失败: %w", err)
	}
	if len(payload.Data) == 0 {
		return nil, resp.StatusCode, errors.New("像素头像模型未返回图片")
	}
	if encoded := strings.TrimSpace(payload.Data[0].Base64JSON); encoded != "" {
		if comma := strings.IndexByte(encoded, ','); comma >= 0 && strings.Contains(encoded[:comma], "base64") {
			encoded = encoded[comma+1:]
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, resp.StatusCode, fmt.Errorf("解码像素头像失败: %w", err)
		}
		if len(decoded) == 0 || len(decoded) > maxGeneratedAvatarBytes {
			return nil, resp.StatusCode, errors.New("像素头像图片大小无效")
		}
		return decoded, resp.StatusCode, nil
	}
	if imageURL := strings.TrimSpace(payload.Data[0].URL); imageURL != "" {
		generated, err := c.downloadGeneratedImage(ctx, imageURL)
		return generated, resp.StatusCode, err
	}
	return nil, resp.StatusCode, errors.New("像素头像模型返回了空图片")
}

func (c *OpenAIImageEditClient) downloadGeneratedImage(ctx context.Context, imageURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载像素头像失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("下载像素头像返回 %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxGeneratedAvatarBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxGeneratedAvatarBytes {
		return nil, errors.New("下载的像素头像大小无效")
	}
	return data, nil
}

func pixelAvatarSourceType(source []byte) (contentType, filename string) {
	contentType = http.DetectContentType(source)
	switch contentType {
	case "image/png":
		return contentType, "reference.png"
	case "image/gif":
		return contentType, "reference.gif"
	case "image/webp":
		return contentType, "reference.webp"
	default:
		return "image/jpeg", "reference.jpg"
	}
}

func summarizePixelAvatarResponse(data []byte) string {
	summary := strings.TrimSpace(string(data))
	if len(summary) > 600 {
		summary = summary[:600] + "..."
	}
	return summary
}
