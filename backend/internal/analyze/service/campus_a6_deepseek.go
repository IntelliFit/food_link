package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	food "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
)

const campusA6DeepSeekModel = "deepseek-v4-pro-0813"
const campusA6BodyLimit = 1024 * 1024

// This semaphore limits physical requests in each replica, not all business
// models. Each request-local estimator additionally permits six HTTP attempts.
var campusA6Slots = make(chan struct{}, 2)

type campusA6Transport struct {
	delegate  http.RoundTripper
	mu        sync.Mutex
	attempts  int
	notBefore time.Time
}

func newCampusDeepSeekEstimator(key string) *DeepSeekNutritionEstimator {
	e := NewDeepSeekNutritionEstimator(key, "https://api.a6api.com/v1", campusA6DeepSeekModel)
	e.client = &http.Client{
		Timeout:       40 * time.Second,
		Transport:     &campusA6Transport{delegate: http.DefaultTransport},
		CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("校园渠道禁止重定向") },
	}
	return e
}

func (t *campusA6Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != "api.a6api.com" || req.URL.Path != "/v1/chat/completions" {
		return nil, fmt.Errorf("校园渠道目标不在允许范围")
	}
	t.mu.Lock()
	if t.attempts >= 6 {
		t.mu.Unlock()
		return nil, fmt.Errorf("校园模型本次请求已达到尝试上限")
	}
	t.attempts++
	wait := time.Until(t.notBefore)
	t.mu.Unlock()
	if wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-timer.C:
		}
	}
	select {
	case campusA6Slots <- struct{}{}:
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}
	defer func() { <-campusA6Slots }()
	raw, err := io.ReadAll(io.LimitReader(req.Body, campusA6BodyLimit+1))
	_ = req.Body.Close()
	if err != nil || len(raw) > campusA6BodyLimit {
		return nil, fmt.Errorf("校园模型请求过大或不可读")
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return nil, fmt.Errorf("校园模型请求格式无效")
	}
	payload["model"] = campusA6DeepSeekModel
	payload["max_tokens"] = 4096 // Best effort only: this merchant may ignore it.
	payload["thinking"] = map[string]string{"type": "disabled"}
	payload["reasoning_effort"] = "none"
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("校园模型请求编码失败")
	}
	out := req.Clone(req.Context())
	out.Body = io.NopCloser(bytes.NewReader(encoded))
	out.ContentLength = int64(len(encoded))
	started := time.Now()
	resp, err := t.delegate.RoundTrip(out)
	if err != nil {
		return nil, fmt.Errorf("校园模型连接失败或超时")
	}
	defer resp.Body.Close()
	responseBytes, err := io.ReadAll(io.LimitReader(resp.Body, campusA6BodyLimit+1))
	if err != nil || len(responseBytes) > campusA6BodyLimit {
		return nil, fmt.Errorf("校园模型响应过大或不可读")
	}
	requestID := resp.Header.Get("X-Oneapi-Request-Id")
	if len(requestID) > 180 {
		requestID = ""
	}
	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		var retryAt time.Time
		if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
			retryAt = time.Now().Add(time.Duration(min(seconds, 3600)) * time.Second)
		} else {
			retryAt, _ = http.ParseTime(resp.Header.Get("Retry-After"))
		}
		t.mu.Lock()
		if retryAt.After(t.notBefore) {
			t.notBefore = retryAt
		}
		t.mu.Unlock()
	}
	var wire struct {
		Model   string          `json:"model"`
		Error   json.RawMessage `json:"error"`
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Input  int64 `json:"prompt_tokens"`
			Output int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	parseErr := json.Unmarshal(responseBytes, &wire)
	logger.Info(req.Context(), "校园 DeepSeek 渠道请求完成", slog.String("model", campusA6DeepSeekModel), slog.Int("http_status", resp.StatusCode), slog.String("request_id", requestID), slog.Int64("input_tokens_reported", wire.Usage.Input), slog.Int64("output_tokens_reported", wire.Usage.Output), slog.Duration("duration", time.Since(started)))
	// Do not propagate upstream error text or reasoning to existing log paths.
	var sanitized []byte
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		sanitized = []byte(`{"error":"校园上游请求未成功"}`)
	} else if parseErr != nil || len(wire.Error) > 0 && string(wire.Error) != "null" || len(wire.Choices) != 1 || (wire.Model != campusA6DeepSeekModel && wire.Model != "deepseek-v4-pro") || wire.Choices[0].Finish != "stop" || strings.TrimSpace(wire.Choices[0].Message.Content) == "" {
		resp.StatusCode = 422
		sanitized = []byte(`{"error":"校园上游响应结构、模型或结束标志无效"}`)
	} else {
		sanitized, _ = json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": wire.Choices[0].Message.Content}}}})
	}
	if wire.Usage.Output > 4096 {
		logger.Warn(req.Context(), "校园 DeepSeek 自报用量超过请求上限，按本人选择继续校验内容", slog.String("request_id", requestID), slog.Int64("output_tokens_reported", wire.Usage.Output))
	}
	resp.Body = io.NopCloser(bytes.NewReader(sanitized))
	resp.ContentLength = int64(len(sanitized))
	resp.Header = http.Header{"Content-Type": []string{"application/json"}}
	return resp, nil
}

func normalizeCampusAIEnergy(items []map[string]any) ([]map[string]any, error) {
	out := make([]map[string]any, len(items))
	for i, original := range items {
		item := copyAnyMap(original)
		out[i] = item
		source := strings.ToLower(stringFromAny(item["nutrition_source"]))
		switch source {
		case "ai_direct", "ai_then_db_exact", "legacy_direct", "deepseek_generated", "qwen_generated", "gemini_generated":
		default:
			continue // Preserve authoritative labels, exact database and user values.
		}
		unit := copyAnyMap(mapFromAny(item["unit_nutrition_per_100g"]))
		for _, key := range []string{"calories", "protein", "carbs", "fat"} {
			v, ok := unit[key].(float64)
			if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
				return nil, fmt.Errorf("校园 AI 营养字段不完整或无效")
			}
		}
		weight := nutritionWeightFromItem(item)
		energy := food.MacroCalories(numberFromAny(unit["protein"]), numberFromAny(unit["carbs"]), numberFromAny(unit["fat"]))
		item["campus_ai_energy_audit"] = map[string]any{"original_per100g_calories": unit["calories"], "derived_per100g_calories": energy, "rule": "macro_4_4_9"}
		unit["calories"] = energy
		nutrients := copyAnyMap(mapFromAny(item["nutrients"]))
		nutrients["calories"] = round4(energy * weight / 100)
		item["unit_nutrition_per_100g"], item["nutrients"] = unit, nutrients
		if err := food.ValidateFoodNutritionValues(stringFromAny(item["name"]), weight, numberFromAny(nutrients["calories"]), numberFromAny(nutrients["protein"]), numberFromAny(nutrients["carbs"]), numberFromAny(nutrients["fat"])); err != nil {
			return nil, err
		}
	}
	return out, nil
}
