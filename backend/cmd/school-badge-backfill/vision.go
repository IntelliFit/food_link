package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	dashScopeDefaultBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	dashScopeModelHint      = "qwen3.5-flash"
)

type badgeDecision struct {
	IsBadge    bool    `json:"is_badge"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

type visionClient struct {
	apiKey  string
	baseURL string
	model   string
	http    *http.Client
}

func dashScopeBaseURL(configDir string) string {
	loadBackendEnv(configDir)
	if u := strings.TrimSpace(os.Getenv("DASHSCOPE_BASE_URL")); u != "" {
		return strings.TrimRight(u, "/")
	}
	return dashScopeDefaultBaseURL
}

func loadDashScopeAPIKey(configDir string) string {
	loadBackendEnv(configDir)
	if manual := strings.TrimSpace(os.Getenv("DASHSCOPE_API_KEY")); !isPlaceholderAPIKey(manual) {
		return strings.TrimPrefix(manual, "Bearer ")
	}
	return ""
}

func isPlaceholderAPIKey(key string) bool {
	key = strings.TrimSpace(key)
	return key == "" || key == "your_api_key" || key == "sk-xxxx" || strings.HasPrefix(key, "sk-xxxxxxxx")
}

func newVisionClient(configDir, baseURL, model string) (*visionClient, error) {
	key := loadDashScopeAPIKey(configDir)
	if key == "" {
		return nil, errors.New("未配置 DASHSCOPE_API_KEY")
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = dashScopeBaseURL(configDir)
	} else {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	return &visionClient{
		apiKey:  key,
		baseURL: baseURL,
		model:   strings.TrimSpace(model),
		http:    &http.Client{Timeout: 120 * time.Second},
	}, nil
}

func (c *visionClient) listModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("dashscope list models status %d: %s", resp.StatusCode, string(body))
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out, nil
}

func pickQwenFlashModel(models []string, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		for _, id := range models {
			if id == requested {
				return id, nil
			}
		}
		return requested, nil
	}
	preferred := []string{
		"qwen3.5-flash",
		"qwen3.5-flash-2026-02-23",
	}
	for _, want := range preferred {
		for _, id := range models {
			if id == want {
				return id, nil
			}
		}
	}
	var flash []string
	for _, id := range models {
		lower := strings.ToLower(id)
		if strings.Contains(lower, "qwen3.5") && strings.Contains(lower, "flash") {
			flash = append(flash, id)
		}
	}
	if len(flash) > 0 {
		return flash[0], nil
	}
	if len(models) > 0 {
		return "", fmt.Errorf("模型列表中未找到 qwen3.5-flash，共 %d 个模型；请用 --vision-model 指定", len(models))
	}
	return dashScopeModelHint, nil
}

func (c *visionClient) resolveModel(ctx context.Context, requested string) (string, error) {
	if strings.TrimSpace(requested) != "" && requested != dashScopeModelHint {
		return requested, nil
	}
	models, err := c.listModels(ctx)
	if err != nil {
		if strings.TrimSpace(requested) != "" {
			return requested, nil
		}
		fmt.Fprintf(os.Stderr, "警告: 无法拉取模型列表 (%v)，回退使用 %s\n", err, dashScopeModelHint)
		return dashScopeModelHint, nil
	}
	return pickQwenFlashModel(models, requested)
}

func (c *visionClient) classifyBadge(ctx context.Context, schoolName string, data []byte, contentType string) (*badgeDecision, error) {
	return c.classifyBadgeWithAlt(ctx, schoolName, "", data, contentType)
}

func (c *visionClient) classifyBadgeWithAlt(ctx context.Context, schoolName, altName string, data []byte, contentType string) (*badgeDecision, error) {
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	model := c.model
	if model == "" {
		resolved, err := c.resolveModel(ctx, "")
		if err != nil {
			return nil, err
		}
		model = resolved
		c.model = resolved
	}
	prompt := fmt.Sprintf(
		"请判断这张图片是否是「%s」的校徽或学校官方标志（logo）。",
		schoolName,
	)
	if altName != "" {
		prompt += fmt.Sprintf("这是一所独立学院，如果图片显示的是其母体学校「%s」的校徽，也请接受为有效结果。", altName)
	}
	prompt += "校徽通常是圆形、盾形或方形的徽章图案，包含学校名称、图案或校训元素。只返回 JSON，不要 Markdown。格式必须为 {\"is_badge\":true/false,\"confidence\":0到1,\"reason\":\"中文简短原因\"}。is_badge：true 表示这确实是该校的校徽/logo（或母体学校的校徽，针对独立学院）；false 表示不是校徽（如校门照片、校园风景、人物、无关图片等）。"
	payload := map[string]any{
		"model":           model,
		"temperature":     0,
		"max_tokens":      512,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": prompt},
				{"type": "image_url", "image_url": map[string]any{"url": "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)}},
			},
		}},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("dashscope status %d: %s", resp.StatusCode, string(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, errors.New("dashscope returned no choices")
	}
	return parseBadgeDecision(parsed.Choices[0].Message.Content)
}

func classifyBadgeImage(ctx context.Context, configDir, baseURL, model, schoolName string, data []byte, contentType string) (*badgeDecision, error) {
	return classifyBadgeImageWithAlt(ctx, configDir, baseURL, model, schoolName, "", data, contentType)
}

func classifyBadgeImageWithAlt(ctx context.Context, configDir, baseURL, model, schoolName, altName string, data []byte, contentType string) (*badgeDecision, error) {
	client, err := newVisionClient(configDir, baseURL, model)
	if err != nil {
		return nil, err
	}
	decision, err := client.classifyBadgeWithAlt(ctx, schoolName, altName, data, contentType)
	if err == nil {
		return decision, nil
	}
	if strings.Contains(err.Error(), "parse badge decision") {
		if retry, retryErr := client.classifyBadgeWithAlt(ctx, schoolName, altName, data, contentType); retryErr == nil {
			return retry, nil
		}
	}
	return nil, err
}

var (
	reBadgeIsBadge    = regexp.MustCompile(`"is_badge"\s*:\s*(true|false)`)
	reBadgeConfidence = regexp.MustCompile(`"confidence"\s*:\s*([0-9.]+)`)
	reBadgeReason     = regexp.MustCompile(`"reason"\s*:\s*"((?:\\.|[^"\\])*)"`)
)

func parseBadgeDecision(raw string) (*badgeDecision, error) {
	content := extractJSONObject(raw)
	var decision badgeDecision
	if jsonErr := json.Unmarshal([]byte(content), &decision); jsonErr == nil {
		clampBadgeDecision(&decision)
		return &decision, nil
	}
	if parts := reBadgeIsBadge.FindStringSubmatch(content); len(parts) == 2 {
		decision.IsBadge = parts[1] == "true"
	}
	if confParts := reBadgeConfidence.FindStringSubmatch(content); len(confParts) == 2 {
		fmt.Sscanf(confParts[1], "%f", &decision.Confidence)
	}
	if reasonParts := reBadgeReason.FindStringSubmatch(content); len(reasonParts) == 2 {
		decision.Reason = strings.ReplaceAll(reasonParts[1], `\"`, `"`)
	}
	if decision.Reason == "" {
		decision.Reason = "模型返回不完整"
	}
	clampBadgeDecision(&decision)
	return &decision, nil
}

func clampBadgeDecision(decision *badgeDecision) {
	if decision.Confidence < 0 {
		decision.Confidence = 0
	}
	if decision.Confidence > 1 {
		decision.Confidence = 1
	}
}

func extractJSONObject(value string) string {
	value = strings.TrimSpace(value)
	start := strings.Index(value, "{")
	end := strings.LastIndex(value, "}")
	if start >= 0 && end > start {
		return value[start : end+1]
	}
	return value
}
