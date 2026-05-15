package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// LLMClient defines the interface for LLM-based analysis.
type LLMClient interface {
	Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error)
}

var ErrLLMJSONParse = errors.New("llm json parse error")

type LLMJSONParseError struct {
	Err error
}

func (e *LLMJSONParseError) Error() string {
	if e == nil || e.Err == nil {
		return "parse llm json failed"
	}
	return fmt.Sprintf("parse llm json failed: %v", e.Err)
}

func (e *LLMJSONParseError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *LLMJSONParseError) Is(target error) bool {
	return target == ErrLLMJSONParse
}

func IsLLMJSONParseError(err error) bool {
	return errors.Is(err, ErrLLMJSONParse)
}

// DashScopeClient calls DashScope/Qwen API.
type DashScopeClient struct {
	APIKey string
	Model  string
	client *http.Client
}

func NewDashScopeClient(apiKey, model string) *DashScopeClient {
	if model == "" {
		model = "qwen-vl-max"
	}
	return &DashScopeClient{
		APIKey: strings.TrimSpace(apiKey),
		Model:  strings.TrimSpace(model),
		client: &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *DashScopeClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	imageURLs := []string{}
	if strings.TrimSpace(imageURL) != "" {
		imageURLs = append(imageURLs, imageURL)
	}
	return c.AnalyzeWithImages(ctx, prompt, imageURLs)
}

func (c *DashScopeClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	return c.AnalyzeWithImagesAndTemperature(ctx, prompt, imageURLs, 0.3)
}

func (c *DashScopeClient) AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	content := []map[string]any{
		{"type": "text", "text": prompt},
	}
	for _, imageURL := range imageURLs {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]string{
				"url": imageURL,
			},
		})
	}
	body := map[string]any{
		"model":           c.Model,
		"messages":        []map[string]any{{"role": "user", "content": content}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     temperature,
	}
	return c.doRequest(ctx, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", body)
}

func (c *DashScopeClient) doRequest(ctx context.Context, url string, body map[string]any) (map[string]any, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("dashscope api error %d: %s", resp.StatusCode, string(data))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("empty response from dashscope")
	}
	return parseLLMJSON(result.Choices[0].Message.Content)
}

// OfoxAIClient calls OfoxAI/Gemini compatible API.
type OfoxAIClient struct {
	APIKey  string
	Model   string
	BaseURL string
	client  *http.Client
}

func NewOfoxAIClient(apiKey, model string, baseURLs ...string) *OfoxAIClient {
	if model == "" {
		model = "gemini-3-flash-preview"
	}
	baseURL := "https://api.ofox.ai/v1"
	if len(baseURLs) > 0 && strings.TrimSpace(baseURLs[0]) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURLs[0]), "/")
	}
	return &OfoxAIClient{
		APIKey:  apiKey,
		Model:   model,
		BaseURL: baseURL,
		client:  &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *OfoxAIClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	imageURLs := []string{}
	if strings.TrimSpace(imageURL) != "" {
		imageURLs = append(imageURLs, imageURL)
	}
	return c.AnalyzeWithImages(ctx, prompt, imageURLs)
}

func (c *OfoxAIClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	return c.AnalyzeWithImagesAndTemperature(ctx, prompt, imageURLs, 0.3)
}

func (c *OfoxAIClient) AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	content := []map[string]any{
		{"type": "text", "text": prompt},
	}
	for _, imageURL := range imageURLs {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]string{
				"url": imageURL,
			},
		})
	}
	body := map[string]any{
		"model":           c.Model,
		"messages":        []map[string]any{{"role": "user", "content": content}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     temperature,
	}
	return c.doRequest(ctx, c.BaseURL+"/chat/completions", body)
}

func (c *OfoxAIClient) doRequest(ctx context.Context, url string, body map[string]any) (map[string]any, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, readErr
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ofoxai api error %d: %s", resp.StatusCode, summarizeUpstreamBody(data, resp.Header.Get("Content-Type")))
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if looksLikeHTMLResponse(data, contentType) {
		return nil, fmt.Errorf("ofoxai api returned html instead of json; check OFOXAI_BASE_URL, current base URL: %s", c.BaseURL)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("decode ofoxai response failed: %w", err)
	}
	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("empty response from ofoxai")
	}
	return parseLLMJSON(result.Choices[0].Message.Content)
}

func summarizeUpstreamBody(data []byte, contentType string) string {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "empty response"
	}
	if looksLikeHTMLResponse(data, strings.ToLower(contentType)) {
		return "html response received; check API base URL"
	}
	runes := []rune(text)
	if len(runes) > 300 {
		return string(runes[:300]) + "..."
	}
	return text
}

func looksLikeHTMLResponse(data []byte, contentType string) bool {
	if strings.Contains(strings.ToLower(contentType), "text/html") {
		return true
	}
	text := strings.TrimSpace(strings.ToLower(string(data)))
	return strings.HasPrefix(text, "<!doctype html") ||
		strings.HasPrefix(text, "<html") ||
		strings.Contains(text, "<head") ||
		strings.Contains(text, "<body")
}

var codeFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

func parseLLMJSON(content string) (map[string]any, error) {
	content = strings.TrimSpace(content)
	content = codeFenceRe.ReplaceAllString(content, "")
	content = strings.TrimSpace(content)
	var parsed map[string]any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, &LLMJSONParseError{Err: err}
	}
	return normalizePayload(parsed), nil
}

func normalizePayload(parsed any) map[string]any {
	if m, ok := parsed.(map[string]any); ok {
		return m
	}
	if arr, ok := parsed.([]any); ok {
		dictItems := make([]any, 0)
		for _, item := range arr {
			if it, ok2 := item.(map[string]any); ok2 {
				if _, hasName := it["name"]; hasName {
					dictItems = append(dictItems, it)
				}
			}
		}
		if len(dictItems) > 0 {
			return map[string]any{"items": dictItems}
		}
	}
	return map[string]any{}
}

func normalizeImageURL(input string) string {
	if idx := strings.Index(input, ","); idx != -1 {
		return "data:image/jpeg;base64," + input[idx+1:]
	}
	return input
}
