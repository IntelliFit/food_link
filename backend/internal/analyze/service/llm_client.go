package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// LLMClient defines the interface for LLM-based analysis.
type LLMClient interface {
	Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error)
}

type DoubaoWebSearchOptions struct {
	MaxKeyword   int
	Limit        int
	MaxToolCalls int
}

type DashScopeWebSearchOptions struct {
	ForcedSearch   bool
	SearchStrategy string
}

var ErrLLMJSONParse = errors.New("大模型 JSON 解析失败")

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

// OfoxAIClient calls OfoxAI/Gemini compatible API.
type OfoxAIClient struct {
	APIKey      string
	Model       string
	BaseURL     string
	client      *http.Client
	imageClient *http.Client
}

func NewDashScopeClient(apiKey string, baseURLs ...string) *OfoxAIClient {
	baseURL := "https://dashscope.aliyuncs.com/compatible-mode/v1"
	if len(baseURLs) > 0 && strings.TrimSpace(baseURLs[0]) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURLs[0]), "/")
	}
	return NewOfoxAIClient(apiKey, "qwen3.6-flash", baseURL)
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
		imageClient: &http.Client{
			Timeout: 30 * time.Second,
		},
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
	return c.AnalyzeWithImagesAndTemperature(ctx, prompt, imageURLs, 0)
}

func (c *OfoxAIClient) AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	return c.analyzeWithImagesAndTemperature(ctx, prompt, imageURLs, temperature, "", nil)
}

func (c *OfoxAIClient) AnalyzeWithImagesAndTemperatureModel(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, error) {
	return c.analyzeWithImagesAndTemperature(ctx, prompt, imageURLs, temperature, modelName, nil)
}

func (c *OfoxAIClient) AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error) {
	parsed, raw, err := c.analyzeWithImagesAndTemperatureMeta(ctx, prompt, imageURLs, temperature, "", nil)
	if err != nil {
		return nil, nil, err
	}
	meta := extractChatCompletionUsageMeta(raw)
	if strings.TrimSpace(stringFromAny(meta["model"])) == "" {
		meta["model"] = c.Model
	}
	return parsed, meta, nil
}

func (c *OfoxAIClient) AnalyzeWithImagesDashScopeWebSearch(ctx context.Context, prompt string, imageURLs []string, options DashScopeWebSearchOptions) (map[string]any, map[string]any, error) {
	searchStrategy := strings.TrimSpace(options.SearchStrategy)
	if searchStrategy == "" {
		searchStrategy = "turbo"
	}
	extras := map[string]any{
		"enable_search": true,
		"search_options": map[string]any{
			"forced_search":   options.ForcedSearch,
			"search_strategy": searchStrategy,
		},
	}
	parsed, err := c.analyzeWithImagesAndTemperature(ctx, prompt, imageURLs, 0, "", extras)
	if err != nil {
		return nil, nil, err
	}
	return parsed, map[string]any{
		"native_search":   true,
		"forced_search":   options.ForcedSearch,
		"search_strategy": searchStrategy,
		"model":           c.Model,
	}, nil
}

func (c *OfoxAIClient) analyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelOverride string, extras map[string]any) (map[string]any, error) {
	parsed, _, err := c.analyzeWithImagesAndTemperatureMeta(ctx, prompt, imageURLs, temperature, modelOverride, extras)
	return parsed, err
}

func (c *OfoxAIClient) analyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelOverride string, extras map[string]any) (map[string]any, map[string]any, error) {
	model := strings.TrimSpace(modelOverride)
	if model == "" {
		model = c.Model
	}
	if isWanjieGeminiNativeModel(model, c.BaseURL) {
		return c.doGeminiNativeRequest(ctx, model, prompt, imageURLs, temperature)
	}
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
		"model":           model,
		"messages":        []map[string]any{{"role": "user", "content": content}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     temperature,
	}
	if isDashScopeQwenModel(model, c.BaseURL) {
		body["enable_thinking"] = true
	}
	for key, value := range extras {
		body[key] = value
	}
	return c.doRequest(ctx, c.BaseURL+"/chat/completions", body)
}

func isDashScopeQwenModel(model, baseURL string) bool {
	normalizedModel := strings.ToLower(strings.TrimSpace(model))
	normalizedBase := strings.ToLower(strings.TrimSpace(baseURL))
	return strings.Contains(normalizedBase, "dashscope.aliyuncs.com") || strings.HasPrefix(normalizedModel, "qwen")
}

func isWanjieGeminiNativeModel(model, baseURL string) bool {
	return strings.Contains(strings.ToLower(baseURL), "maas-openapi.wanjiedata.com") &&
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "gemini-")
}

func (c *OfoxAIClient) doGeminiNativeRequest(ctx context.Context, model, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error) {
	parts := []map[string]any{{"text": prompt}}
	for _, imageURL := range imageURLs {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		inlineData, err := c.downloadGeminiInlineImage(ctx, imageURL)
		if err != nil {
			return nil, nil, err
		}
		parts = append(parts, map[string]any{"inlineData": inlineData})
	}
	body := map[string]any{
		"contents": []map[string]any{{"role": "user", "parts": parts}},
		"generationConfig": map[string]any{
			"temperature":      temperature,
			"maxOutputTokens":  8192,
			"responseMimeType": "application/json",
		},
	}
	b, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("encode Gemini request failed: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, geminiNativeEndpoint(c.BaseURL, model), bytes.NewReader(b))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("gemini api error %d: %s", resp.StatusCode, summarizeUpstreamBody(data, resp.Header.Get("Content-Type")))
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, nil, fmt.Errorf("decode Gemini response failed: %w", err)
	}
	candidates, ok := raw["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return nil, nil, fmt.Errorf("empty response from Gemini")
	}
	firstCandidate := mapFromAny(candidates[0])
	content := mapFromAny(firstCandidate["content"])
	for _, part := range anyListFromAny(content["parts"]) {
		text := stringFromAny(mapFromAny(part)["text"])
		if strings.TrimSpace(text) == "" {
			continue
		}
		parsed, err := parseLLMJSON(text)
		if err != nil {
			return nil, nil, err
		}
		return parsed, raw, nil
	}
	return nil, nil, fmt.Errorf("empty response from Gemini")
}

func geminiNativeEndpoint(baseURL, model string) string {
	endpoint, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return strings.TrimRight(baseURL, "/") + "/../v1beta/models/" + url.PathEscape(model) + ":generateContent"
	}
	endpoint.Path = "/api/v1beta/models/" + url.PathEscape(model) + ":generateContent"
	endpoint.RawQuery = ""
	return endpoint.String()
}

func (c *OfoxAIClient) downloadGeminiInlineImage(ctx context.Context, imageURL string) (map[string]string, error) {
	parsedURL, err := url.Parse(imageURL)
	if err != nil || !strings.EqualFold(parsedURL.Scheme, "https") || parsedURL.Host == "" {
		return nil, fmt.Errorf("Gemini 图片必须使用有效的 HTTPS 地址")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, err
	}
	imageClient := c.imageClient
	if imageClient == nil {
		imageClient = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := imageClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载 Gemini 图片失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("下载 Gemini 图片失败: HTTP %d", resp.StatusCode)
	}
	const maxGeminiImageBytes = 10 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxGeminiImageBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取 Gemini 图片失败: %w", err)
	}
	if len(data) == 0 || len(data) > maxGeminiImageBytes {
		return nil, fmt.Errorf("Gemini 图片大小必须在 1B 到 10MB 之间")
	}
	mimeType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		mimeType = http.DetectContentType(data)
	}
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return nil, fmt.Errorf("Gemini 图片格式无效")
	}
	return map[string]string{
		"mimeType": mimeType,
		"data":     base64.StdEncoding.EncodeToString(data),
	}, nil
}

func (c *OfoxAIClient) doRequest(ctx context.Context, url string, body map[string]any) (map[string]any, map[string]any, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, nil, readErr
	}

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("ofoxai api error %d: %s", resp.StatusCode, summarizeUpstreamBody(data, resp.Header.Get("Content-Type")))
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if looksLikeHTMLResponse(data, contentType) {
		return nil, nil, fmt.Errorf("ofoxai api returned html instead of json; check OFOXAI_BASE_URL, current base URL: %s", c.BaseURL)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, nil, fmt.Errorf("decode ofoxai response failed: %w", err)
	}
	choices, ok := raw["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, nil, fmt.Errorf("empty response from ofoxai")
	}
	firstChoice, ok := choices[0].(map[string]any)
	if !ok {
		return nil, nil, fmt.Errorf("empty response from ofoxai")
	}
	message := mapFromAny(firstChoice["message"])
	content := stringFromAny(message["content"])
	if strings.TrimSpace(content) == "" {
		return nil, nil, fmt.Errorf("empty response from ofoxai")
	}
	parsed, err := parseLLMJSON(content)
	if err != nil {
		return nil, nil, err
	}
	return parsed, raw, nil
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

func isDoubaoWebSearchNotActivatedError(data []byte) bool {
	lower := strings.ToLower(string(data))
	return strings.Contains(lower, "toolnotopen") ||
		strings.Contains(lower, "not activated web search") ||
		strings.Contains(lower, "activate web search")
}

// DoubaoClient calls Volcano Engine Ark API (OpenAI-compatible).
type DoubaoClient struct {
	APIKey  string
	Model   string
	BaseURL string
	client  *http.Client
}

func NewDoubaoClient(apiKey, model string, baseURLs ...string) *DoubaoClient {
	if model == "" {
		model = "doubao-seed-2-0-lite-260428"
	}
	baseURL := "https://ark.cn-beijing.volces.com/api/v3"
	if len(baseURLs) > 0 && strings.TrimSpace(baseURLs[0]) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURLs[0]), "/")
	}
	return &DoubaoClient{
		APIKey:  apiKey,
		Model:   model,
		BaseURL: baseURL,
		client:  &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *DoubaoClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	imageURLs := []string{}
	if strings.TrimSpace(imageURL) != "" {
		imageURLs = append(imageURLs, imageURL)
	}
	return c.AnalyzeWithImages(ctx, prompt, imageURLs)
}

func (c *DoubaoClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	return c.AnalyzeWithImagesAndTemperature(ctx, prompt, imageURLs, 0)
}

func (c *DoubaoClient) AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	return c.AnalyzeWithImagesAndTemperatureModel(ctx, prompt, imageURLs, temperature, "")
}

func (c *DoubaoClient) AnalyzeWithImagesAndTemperatureModel(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, error) {
	parsed, _, err := c.analyzeWithImagesAndTemperatureModelMeta(ctx, prompt, imageURLs, temperature, modelName)
	return parsed, err
}

func (c *DoubaoClient) AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error) {
	return c.analyzeWithImagesAndTemperatureModelMeta(ctx, prompt, imageURLs, temperature, "")
}

func (c *DoubaoClient) analyzeWithImagesAndTemperatureModelMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, map[string]any, error) {
	model := strings.TrimSpace(modelName)
	if model == "" {
		model = c.Model
	}
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
		"model":            model,
		"messages":         []map[string]any{{"role": "user", "content": content}},
		"temperature":      temperature,
		"reasoning_effort": "low",
	}
	parsed, raw, err := c.doRequest(ctx, c.BaseURL+"/chat/completions", body)
	if err != nil {
		return nil, nil, err
	}
	return parsed, extractChatCompletionUsageMeta(raw), nil
}

func (c *DoubaoClient) AnalyzeWithImagesWebSearch(ctx context.Context, prompt string, imageURLs []string, options DoubaoWebSearchOptions) (map[string]any, map[string]any, error) {
	if options.MaxKeyword <= 0 {
		options.MaxKeyword = 2
	}
	if options.Limit <= 0 {
		options.Limit = 5
	}
	if options.MaxToolCalls <= 0 {
		options.MaxToolCalls = 1
	}
	content := []map[string]any{
		{"type": "input_text", "text": prompt},
	}
	for _, imageURL := range imageURLs {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		content = append(content, map[string]any{
			"type":      "input_image",
			"image_url": imageURL,
		})
	}
	body := map[string]any{
		"model": c.Model,
		"input": []map[string]any{{
			"role":    "user",
			"content": content,
		}},
		"tools": []map[string]any{{
			"type":        "web_search",
			"max_keyword": options.MaxKeyword,
			"limit":       options.Limit,
		}},
		"max_tool_calls": options.MaxToolCalls,
	}
	return c.doResponsesRequest(ctx, c.BaseURL+"/responses", body)
}

func (c *DoubaoClient) doResponsesRequest(ctx context.Context, url string, body map[string]any) (map[string]any, map[string]any, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, nil, readErr
	}
	if resp.StatusCode != http.StatusOK {
		if isDoubaoWebSearchNotActivatedError(data) {
			return nil, nil, fmt.Errorf("doubao web search tool not activated")
		}
		return nil, nil, fmt.Errorf("doubao responses api error %d: %s", resp.StatusCode, summarizeUpstreamBody(data, resp.Header.Get("Content-Type")))
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if looksLikeHTMLResponse(data, contentType) {
		return nil, nil, fmt.Errorf("doubao responses api returned html instead of json; check DOUBAO_BASE_URL, current base URL: %s", c.BaseURL)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, nil, fmt.Errorf("decode doubao responses response failed: %w", err)
	}
	text := extractResponsesOutputText(raw)
	if strings.TrimSpace(text) == "" {
		return nil, nil, fmt.Errorf("empty output_text from doubao responses")
	}
	parsed, err := parseLLMJSON(text)
	if err != nil {
		return nil, nil, err
	}
	return parsed, extractResponsesUsageMeta(raw), nil
}

func (c *DoubaoClient) doRequest(ctx context.Context, url string, body map[string]any) (map[string]any, map[string]any, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, nil, readErr
	}

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("doubao api error %d: %s", resp.StatusCode, summarizeUpstreamBody(data, resp.Header.Get("Content-Type")))
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if looksLikeHTMLResponse(data, contentType) {
		return nil, nil, fmt.Errorf("doubao api returned html instead of json; check DOUBAO_BASE_URL, current base URL: %s", c.BaseURL)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, nil, fmt.Errorf("decode doubao response failed: %w", err)
	}
	choices, ok := raw["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, nil, fmt.Errorf("empty response from doubao")
	}
	firstChoice, ok := choices[0].(map[string]any)
	if !ok {
		return nil, nil, fmt.Errorf("empty response from doubao")
	}
	message := mapFromAny(firstChoice["message"])
	content := stringFromAny(message["content"])
	if strings.TrimSpace(content) == "" {
		return nil, nil, fmt.Errorf("empty response from doubao")
	}
	parsed, err := parseLLMJSON(content)
	if err != nil {
		return nil, nil, err
	}
	return parsed, raw, nil
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

func extractResponsesOutputText(raw map[string]any) string {
	if text := strings.TrimSpace(fmt.Sprintf("%v", raw["output_text"])); text != "" && text != "<nil>" {
		return text
	}
	var parts []string
	if output, ok := raw["output"].([]any); ok {
		for _, itemAny := range output {
			item, ok := itemAny.(map[string]any)
			if !ok {
				continue
			}
			if item["type"] != "message" {
				continue
			}
			content, ok := item["content"].([]any)
			if !ok {
				continue
			}
			for _, contentAny := range content {
				contentItem, ok := contentAny.(map[string]any)
				if !ok {
					continue
				}
				text := strings.TrimSpace(fmt.Sprintf("%v", contentItem["text"]))
				if text != "" && text != "<nil>" {
					parts = append(parts, text)
				}
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func extractResponsesUsageMeta(raw map[string]any) map[string]any {
	meta := map[string]any{}
	if id := strings.TrimSpace(fmt.Sprintf("%v", raw["id"])); id != "" && id != "<nil>" {
		meta["response_id"] = id
	}
	if model := strings.TrimSpace(fmt.Sprintf("%v", raw["model"])); model != "" && model != "<nil>" {
		meta["model"] = model
	}
	if usage, ok := raw["usage"].(map[string]any); ok {
		for _, key := range []string{"tool_usage", "tool_usage_details", "input_tokens", "output_tokens", "total_tokens"} {
			if value, exists := usage[key]; exists {
				meta[key] = value
			}
		}
	}
	if output, ok := raw["output"].([]any); ok {
		calls := []map[string]any{}
		for _, itemAny := range output {
			item, ok := itemAny.(map[string]any)
			if !ok {
				continue
			}
			if fmt.Sprintf("%v", item["type"]) != "web_search_call" {
				continue
			}
			call := map[string]any{}
			for _, key := range []string{"id", "status", "type"} {
				if value, exists := item[key]; exists {
					call[key] = value
				}
			}
			if action, ok := item["action"].(map[string]any); ok {
				call["action"] = action
			}
			calls = append(calls, call)
		}
		if len(calls) > 0 {
			meta["web_search_calls"] = calls
		}
	}
	return meta
}

func extractChatCompletionUsageMeta(raw map[string]any) map[string]any {
	meta := map[string]any{}
	if id := strings.TrimSpace(fmt.Sprintf("%v", raw["id"])); id != "" && id != "<nil>" {
		meta["response_id"] = id
	}
	if model := strings.TrimSpace(fmt.Sprintf("%v", raw["model"])); model != "" && model != "<nil>" {
		meta["model"] = model
	} else if model := strings.TrimSpace(fmt.Sprintf("%v", raw["modelVersion"])); model != "" && model != "<nil>" {
		meta["model"] = model
	}
	if usage, ok := raw["usage"].(map[string]any); ok {
		for _, key := range []string{"prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"} {
			if value, exists := usage[key]; exists {
				meta[key] = value
			}
		}
	}
	if usage, ok := raw["usageMetadata"].(map[string]any); ok {
		if value, exists := usage["promptTokenCount"]; exists {
			meta["input_tokens"] = value
		}
		if value, exists := usage["candidatesTokenCount"]; exists {
			meta["output_tokens"] = value
		}
		if value, exists := usage["totalTokenCount"]; exists {
			meta["total_tokens"] = value
		}
	}
	return meta
}

var codeFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

func parseLLMJSON(content string) (map[string]any, error) {
	content = strings.TrimSpace(content)
	content = codeFenceRe.ReplaceAllString(content, "")
	content = strings.TrimSpace(content)
	var parsed any
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
				_, hasName := it["name"]
				_, hasIndex := it["index"]
				_, hasUnit := it["unitNutritionPer100g"]
				if hasName || hasIndex || hasUnit {
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
