package service

import (
	"bytes"
	"context"
	"encoding/json"
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
		APIKey: apiKey,
		Model:  model,
		client: &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *DashScopeClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	content := []map[string]any{
		{"type": "text", "text": prompt},
	}
	if imageURL != "" {
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]string{
				"url": imageURL,
			},
		})
	}
	body := map[string]any{
		"model":    c.Model,
		"messages": []map[string]any{{"role": "user", "content": content}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature": 0.3,
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
	APIKey string
	Model  string
	client *http.Client
}

func NewOfoxAIClient(apiKey, model string) *OfoxAIClient {
	if model == "" {
		model = "gemini-3-flash-preview"
	}
	return &OfoxAIClient{
		APIKey: apiKey,
		Model:  model,
		client: &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *OfoxAIClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	content := []map[string]any{
		{"type": "text", "text": prompt},
	}
	if imageURL != "" {
		content = append(content, map[string]any{
			"type": "image_url",
			"image_url": map[string]string{
				"url": imageURL,
			},
		})
	}
	body := map[string]any{
		"model":    c.Model,
		"messages": []map[string]any{{"role": "user", "content": content}},
		"response_format": map[string]string{"type": "json_object"},
		"temperature": 0.3,
	}
	return c.doRequest(ctx, "https://ofoxai.com/v1/chat/completions", body)
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

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ofoxai api error %d: %s", resp.StatusCode, string(data))
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
		return nil, fmt.Errorf("empty response from ofoxai")
	}
	return parseLLMJSON(result.Choices[0].Message.Content)
}

var codeFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

func parseLLMJSON(content string) (map[string]any, error) {
	content = strings.TrimSpace(content)
	content = codeFenceRe.ReplaceAllString(content, "")
	content = strings.TrimSpace(content)
	var parsed map[string]any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("parse llm json failed: %w", err)
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
