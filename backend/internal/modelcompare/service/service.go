// Package service provides isolated, non-billing FoodLink diagnostics.
// Provider calls may be billable; no FoodLink task, database or fallback is used.
package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	_ "golang.org/x/image/webp"
)

const Model = "gemini-3.5-flash"
const Model37 = "gemini-3.7-flash"
const Model3Preview = "gemini-3-flash-preview"
const MaxImageBytes = 8 << 20

type Provider struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Channel    string `json:"channel"`
	Model      string `json:"model"`
	Routing    string `json:"routing"`
	Configured bool   `json:"configured"`
	Base       string `json:"-"`
	Key        string `json:"-"`
}

func Providers(cfg config.ExternalConfig) []Provider {
	wKey, wBase := cfg.Gemini35APIKey, cfg.Gemini35BaseURL
	if strings.TrimSpace(wKey) == "" {
		wKey = cfg.OfoxAIAPIKey
	}
	if strings.TrimSpace(wBase) == "" {
		wBase = cfg.OfoxAIBaseURL
	}
	rows := []Provider{
		{ID: "wanjie_35", Name: "万界方舟 · 3.5", Channel: "wanjie", Model: Model, Routing: "default", Base: wBase, Key: wKey},
		{ID: "wanjie_3_preview", Name: "万界方舟 · 3 Flash Preview", Channel: "wanjie", Model: Model3Preview, Routing: "default", Base: wBase, Key: wKey},
		{ID: "openlux_37", Name: "OpenLux · 3.7", Channel: "openlux", Model: Model37, Routing: "success_rate", Base: cfg.OpenLuxBaseURL, Key: cfg.OpenLuxAPIKey},
		{ID: "openlux_3_preview", Name: "OpenLux · 3 Flash Preview", Channel: "openlux", Model: Model3Preview, Routing: "success_rate", Base: cfg.OpenLuxBaseURL, Key: cfg.OpenLuxAPIKey},
		{ID: "a6_37", Name: "A6 · 3.7", Channel: "a6", Model: Model37, Routing: "default", Base: cfg.A6BaseURL, Key: cfg.A6APIKey},
		{ID: "a6_3_preview", Name: "A6 · 3 Flash Preview", Channel: "a6", Model: Model3Preview, Routing: "default", Base: cfg.A6BaseURL, Key: cfg.A6APIKey},
	}
	for i := range rows {
		rows[i].Key = strings.TrimSpace(rows[i].Key)
		rows[i].Base = strings.TrimRight(strings.TrimSpace(rows[i].Base), "/")
		if rows[i].Base == "" && rows[i].Channel == "openlux" {
			rows[i].Base = "https://api.openlux.ai/v1"
		}
		if rows[i].Base == "" && rows[i].Channel == "a6" {
			rows[i].Base = "https://api.a6api.com"
		}
		rows[i].Configured = rows[i].Key != "" && rows[i].Base != ""
	}
	return rows
}

type Photo struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	MIME   string `json:"mime"`
	Bytes  int    `json:"bytes"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Data   []byte `json:"-"`
}

func ReadPhoto(name string, data []byte) (Photo, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return Photo{}, errors.New("图片须为1字节至8MiB")
	}
	mime := http.DetectContentType(data)
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		return Photo{}, errors.New("仅支持真实JPEG、PNG、WebP图片")
	}
	dim, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || dim.Width <= 0 || dim.Height <= 0 || int64(dim.Width)*int64(dim.Height) > 40_000_000 {
		return Photo{}, errors.New("图片损坏或超过4000万像素")
	}
	hash := sha256.Sum256(data)
	return Photo{Name: name, SHA256: hex.EncodeToString(hash[:]), MIME: mime, Bytes: len(data), Width: dim.Width, Height: dim.Height, Data: data}, nil
}

type Timings struct {
	SentMS      *int64 `json:"sent_ms"`
	FirstByteMS *int64 `json:"first_byte_ms"`
	TotalMS     int64  `json:"total_ms"`
}
type Result struct {
	Provider       string         `json:"provider"`
	Channel        string         `json:"channel"`
	Routing        string         `json:"routing"`
	RequestedModel string         `json:"requested_model"`
	ReturnedModel  string         `json:"returned_model,omitempty"`
	Protocol       string         `json:"protocol"`
	Endpoint       string         `json:"endpoint"`
	Status         string         `json:"status"`
	HTTPStatus     int            `json:"http_status"`
	RequestID      string         `json:"request_id,omitempty"`
	FinishReason   string         `json:"finish_reason,omitempty"`
	Error          string         `json:"error,omitempty"`
	Text           string         `json:"text,omitempty"`
	Raw            string         `json:"raw_response,omitempty"`
	Parsed         map[string]any `json:"parsed,omitempty"`
	Usage          any            `json:"usage,omitempty"`
	Timings        Timings        `json:"timings"`
	RequestBytes   int            `json:"request_bytes"`
	RequestPreview any            `json:"request_preview,omitempty"`
}

type Service struct {
	Providers []Provider
	Client    *http.Client
}

func New(providers []Provider) *Service {
	transport := &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		DialContext:       (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 10 * time.Second,
		MaxIdleConns: 12, MaxIdleConnsPerHost: 4, IdleConnTimeout: 90 * time.Second,
	}
	return &Service{Providers: providers, Client: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// BuildRequest maps the provider's documented native protocol, not a guessed
// URL/image field. Compatibility mode is an explicit separate experiment.
func BuildRequest(p Provider, protocol, prompt string, photo Photo, encoded string) (string, string, map[string]any, error) {
	u, err := url.Parse(p.Base)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", "", nil, errors.New("服务端渠道Base URL必须是无凭证及查询参数的HTTPS地址")
	}
	head := "Authorization"
	if protocol == "native" {
		prefix := "/v1beta/models/"
		if p.Channel == "wanjie" {
			prefix = "/api/v1beta/models/"
		}
		u.Path = prefix + p.Model + ":generateContent"
		if p.Channel == "openlux" && p.Routing == "success_rate" {
			u.RawQuery = "sort=success_rate"
		}
		if p.Channel == "a6" {
			head = "x-goog-api-key"
		}
		parts := []any{}
		if prompt != "" {
			parts = append(parts, map[string]any{"text": prompt})
		}
		if len(photo.Data) > 0 {
			parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": photo.MIME, "data": encoded}})
		}
		return u.String(), head, map[string]any{
			"contents": []any{map[string]any{"role": "user", "parts": parts}},
		}, nil
	}
	if protocol != "compat" {
		return "", "", nil, errors.New("协议必须为native或compat")
	}
	u.Path = "/v1/chat/completions"
	if p.Channel == "wanjie" {
		u.Path = "/api/v1/chat/completions"
	}
	model := p.Model
	if p.Channel == "openlux" && p.Routing == "success_rate" {
		model += ":stable"
	}
	var content any = prompt
	if len(photo.Data) > 0 {
		parts := []any{}
		if prompt != "" {
			parts = append(parts, map[string]any{"type": "text", "text": prompt})
		}
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + photo.MIME + ";base64," + encoded}})
		content = parts
	}
	return u.String(), head, map[string]any{
		"model": model, "stream": false,
		"messages": []any{map[string]any{"role": "user", "content": content}},
	}, nil
}

var tokenPattern = regexp.MustCompile(`sk-[A-Za-z0-9_-]{15,}`)

func (s *Service) Redact(text string) string {
	for _, p := range s.Providers {
		if p.Key != "" {
			text = strings.ReplaceAll(text, p.Key, "[REDACTED]")
		}
	}
	return tokenPattern.ReplaceAllString(text, "[REDACTED]")
}

func (s *Service) Compare(ctx context.Context, photo Photo, prompt, protocol string, timeout time.Duration, emit func(Result)) {
	encoded := base64.StdEncoding.EncodeToString(photo.Data)
	var wg sync.WaitGroup
	for _, provider := range s.Providers {
		wg.Add(1)
		go func(p Provider) { defer wg.Done(); emit(s.Call(ctx, p, photo, encoded, prompt, protocol, timeout)) }(provider)
	}
	wg.Wait()
}

func (s *Service) Call(parent context.Context, p Provider, photo Photo, encoded, prompt, protocol string, timeout time.Duration) (out Result) {
	out = Result{Provider: p.ID, Channel: p.Channel, Routing: p.Routing, RequestedModel: p.Model, Protocol: protocol, Status: "request_error"}
	started := time.Now()
	var timingMu sync.Mutex
	var traceTimes Timings
	defer func() {
		timingMu.Lock()
		out.Timings = traceTimes
		out.Timings.TotalMS = time.Since(started).Milliseconds()
		timingMu.Unlock()
		attrs := []slog.Attr{slog.String("provider", p.ID), slog.String("model", p.Model), slog.String("routing", p.Routing), slog.String("protocol", protocol), slog.String("status", out.Status), slog.Int("http.status_code", out.HTTPStatus), slog.Int64("elapsed_ms", out.Timings.TotalMS)}
		if out.Status == "answered" {
			logger.Info(parent, "模型对比渠道完成", attrs...)
		} else {
			logger.Warn(parent, "模型对比渠道未获得有效结果", attrs...)
		}
	}()
	if !p.Configured {
		out.Status = "not_configured"
		out.Error = "渠道未配置Key或Base URL"
		return
	}
	endpoint, header, body, err := BuildRequest(p, protocol, prompt, photo, encoded)
	if err != nil {
		out.Error = err.Error()
		return
	}
	out.Endpoint = endpoint
	data, err := json.Marshal(body)
	if err != nil {
		out.Error = "请求编码失败"
		return
	}
	out.RequestBytes = len(data)
	_, _, preview, _ := BuildRequest(p, protocol, s.Redact(prompt), photo, "[图片Base64已省略；SHA256="+photo.SHA256+"]")
	out.RequestPreview = preview
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	trace := &httptrace.ClientTrace{
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				ms := time.Since(started).Milliseconds()
				timingMu.Lock()
				traceTimes.SentMS = &ms
				timingMu.Unlock()
			}
		},
		GotFirstResponseByte: func() {
			ms := time.Since(started).Milliseconds()
			timingMu.Lock()
			traceTimes.FirstByteMS = &ms
			timingMu.Unlock()
		},
	}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		out.Error = "请求创建失败"
		return
	}
	if header == "Authorization" {
		req.Header.Set(header, "Bearer "+p.Key)
	} else {
		req.Header.Set(header, p.Key)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	logger.Info(parent, "模型对比渠道请求开始", slog.String("provider", p.ID), slog.String("protocol", protocol), slog.Int("image_bytes", photo.Bytes), slog.Int("request_bytes", len(data)))
	resp, err := s.Client.Do(req)
	if err != nil {
		out.Error = s.Redact(err.Error())
		out.Status = networkStatus(ctx)
		return
	}
	defer resp.Body.Close()
	out.HTTPStatus = resp.StatusCode
	out.RequestID = s.Redact(resp.Header.Get("x-request-id"))
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	out.Raw = s.Redact(string(raw))
	if err != nil {
		out.Error = s.Redact(err.Error())
		out.Status = networkStatus(ctx)
		return
	}
	if len(raw) > 2<<20 {
		out.Status = "response_too_large"
		out.Error = "响应超过2MiB，已截断，不算成功"
		if len(out.Raw) > 2<<20 {
			out.Raw = out.Raw[:2<<20]
		}
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		out.Status = "http_error"
		out.Error = fmt.Sprintf("上游HTTP %d，查看原始响应", resp.StatusCode)
		return
	}
	parseResponse(&out)
	return
}

func networkStatus(ctx context.Context) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return "cancelled"
	}
	return "network_error"
}

func parseResponse(out *Result) {
	var body map[string]any
	if json.Unmarshal([]byte(out.Raw), &body) != nil {
		out.Status = "invalid_envelope"
		out.Error = "HTTP成功但响应不是JSON"
		return
	}
	if out.Protocol == "native" {
		out.ReturnedModel, _ = body["modelVersion"].(string)
		out.Usage = body["usageMetadata"]
		candidates, _ := body["candidates"].([]any)
		if len(candidates) > 0 {
			candidate, _ := candidates[0].(map[string]any)
			out.FinishReason, _ = candidate["finishReason"].(string)
			content, _ := candidate["content"].(map[string]any)
			parts, _ := content["parts"].([]any)
			for _, part := range parts {
				p, _ := part.(map[string]any)
				if p["thought"] != true {
					t, _ := p["text"].(string)
					out.Text += t
				}
			}
		}
	} else {
		out.ReturnedModel, _ = body["model"].(string)
		out.Usage = body["usage"]
		choices, _ := body["choices"].([]any)
		if len(choices) > 0 {
			c, _ := choices[0].(map[string]any)
			out.FinishReason, _ = c["finish_reason"].(string)
			m, _ := c["message"].(map[string]any)
			out.Text, _ = m["content"].(string)
		}
	}
	if out.Text == "" {
		out.Status = "no_content"
		out.Error = "没有可用模型文本，查看安全拦截或上游error原文"
		return
	}
	// Preserve the answer verbatim; this tool does not impose a food/JSON schema.
	// A successful HTTP envelope alone must not hide the known upstream notice.
	if strings.Contains(out.Text, "no longer available") && strings.Contains(out.Text, "Antigravity") {
		out.Status = "upstream_notice"
		out.Error = "渠道返回模型不可用提示，原文如下"
		return
	}
	if out.FinishReason == "MAX_TOKENS" || out.FinishReason == "length" {
		out.Status = "truncated"
		out.Error = "渠道提示输出被截断，原文保留"
		return
	}
	clean := strings.TrimSpace(out.Text)
	if strings.HasPrefix(clean, "```") {
		clean = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(clean, "```json"), "```"), "```"))
	}
	var parsed map[string]any
	if json.Unmarshal([]byte(clean), &parsed) == nil {
		out.Parsed = parsed
	}
	out.Status = "answered"
}
