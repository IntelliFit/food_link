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

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"go.uber.org/zap"
)

const expiryCreditCost = 2

var expiryCodeFenceRe = regexp.MustCompile("(?s)```json?\\s*\n?|```")

type Recognizer struct {
	cfg    *config.Config
	client *http.Client
}

type RecognizeInput struct {
	ImageURLs         []string
	AdditionalContext string
}

type RecognitionOutput struct {
	Items           []map[string]any `json:"items"`
	RecognizedCount int              `json:"recognized_count"`
}

func NewRecognizer(cfg *config.Config) *Recognizer {
	return &Recognizer{
		cfg:    cfg,
		client: &http.Client{Timeout: 90 * time.Second},
	}
}

func (r *Recognizer) Recognize(ctx context.Context, input RecognizeInput) (*RecognitionOutput, error) {
	imageURLs := uniqueNonEmptyStrings(input.ImageURLs)
	if len(imageURLs) == 0 {
		return nil, expiryRecognitionBadRequest("请至少提供 1 张图片")
	}
	if len(imageURLs) > 5 {
		imageURLs = imageURLs[:5]
	}

	today := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60))
	prompt := buildFoodExpiryRecognitionPrompt(today.Format("2006-01-02"), input.AdditionalContext)
	content := []map[string]any{{"type": "text", "text": prompt}}
	for _, url := range imageURLs {
		content = append(content, map[string]any{
			"type":      "image_url",
			"image_url": map[string]string{"url": url},
		})
	}

	parsed, err := r.runJSONCompletion(ctx, content, 0.2)
	if err != nil {
		return nil, err
	}
	rawItems := extractMapItems(parsed["items"])
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		if normalized := normalizeFoodExpiryRecognitionItem(raw, today); normalized != nil {
			items = append(items, normalized)
		}
	}
	if len(items) == 0 {
		return nil, expiryRecognitionBadRequest("未识别到可用于保质期录入的食物，请换个角度拍清楚包装或食物主体后再试")
	}
	return &RecognitionOutput{Items: items, RecognizedCount: len(items)}, nil
}

func (r *Recognizer) runJSONCompletion(ctx context.Context, content []map[string]any, temperature float64) (map[string]any, error) {
	apiURL, model, apiKey, err := r.llmConfig()
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"model":            model,
		"messages":         []map[string]any{{"role": "user", "content": content}},
		"response_format":  map[string]string{"type": "json_object"},
		"temperature":      temperature,
		"reasoning_effort": "medium",
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, expiryRecognitionUpstreamError(
			fmt.Sprintf("保质期识别服务请求失败 %d: %s", resp.StatusCode, summarizeExpiryUpstreamBody(respBody, resp.Header.Get("Content-Type"))),
		)
	}
	if looksLikeExpiryHTMLResponse(respBody, resp.Header.Get("Content-Type")) {
		return nil, expiryRecognitionConfigError("保质期识别服务返回了网页而不是 JSON，请检查 OFOXAI_BASE_URL")
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, expiryRecognitionUpstreamError(fmt.Sprintf("保质期识别服务响应解析失败: %v", err))
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return nil, expiryRecognitionUpstreamError("AI 返回了空响应")
	}
	contentText := expiryCodeFenceRe.ReplaceAllString(result.Choices[0].Message.Content, "")
	var parsed map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(contentText)), &parsed); err != nil {
		return nil, expiryRecognitionUpstreamError(fmt.Sprintf("AI 返回结果格式解析失败: %v", err))
	}
	return parsed, nil
}

func (r *Recognizer) llmConfig() (apiURL, model, apiKey string, err error) {
	provider := strings.ToLower(strings.TrimSpace(r.cfg.External.LLMProvider))
	if provider == "" {
		provider = "doubao"
	}
	ofoxBaseURL := strings.TrimRight(strings.TrimSpace(r.cfg.External.OfoxAIBaseURL), "/")
	if ofoxBaseURL == "" {
		ofoxBaseURL = "https://api.ofox.ai/v1"
	}
	if (provider == "gemini" || provider == "ofox-gemini") && r.cfg.External.OfoxAIAPIKey != "" {
		return ofoxBaseURL + "/chat/completions", "gemini-3-flash-preview", r.cfg.External.OfoxAIAPIKey, nil
	}
	if provider == "doubao" && r.cfg.External.DoubaoAPIKey != "" {
		baseURL := strings.TrimRight(strings.TrimSpace(r.cfg.External.DoubaoBaseURL), "/")
		if baseURL == "" {
			baseURL = "https://ark.cn-beijing.volces.com/api/v3"
		}
		return baseURL + "/chat/completions", "doubao-seed-2-0-lite-260428", r.cfg.External.DoubaoAPIKey, nil
	}
	return "", "", "", expiryRecognitionConfigError("后端未配置保质期识别模型")
}

func expiryRecognitionBadRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}

func expiryRecognitionUpstreamError(logMessage string) error {
	if log := logger.L(); log != nil {
		log.Warn("expiry recognition upstream error", zap.String("error", logMessage))
	}
	return &commonerrors.AppError{Code: 10006, Message: "保质期识别服务暂时不可用，请稍后再试", HTTPStatus: http.StatusBadGateway}
}

func expiryRecognitionConfigError(message string) error {
	return &commonerrors.AppError{Code: 10000, Message: message, HTTPStatus: http.StatusInternalServerError}
}

func summarizeExpiryUpstreamBody(data []byte, contentType string) string {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "empty response"
	}
	if looksLikeExpiryHTMLResponse(data, contentType) {
		return "html response received; check API base URL"
	}
	runes := []rune(text)
	if len(runes) > 300 {
		return string(runes[:300]) + "..."
	}
	return text
}

func looksLikeExpiryHTMLResponse(data []byte, contentType string) bool {
	if strings.Contains(strings.ToLower(contentType), "text/html") {
		return true
	}
	text := strings.TrimSpace(strings.ToLower(string(data)))
	return strings.HasPrefix(text, "<!doctype html") ||
		strings.HasPrefix(text, "<html") ||
		strings.Contains(text, "<head") ||
		strings.Contains(text, "<body")
}

func buildFoodExpiryRecognitionPrompt(todayStr, additionalContext string) string {
	contextBlock := strings.TrimSpace(additionalContext)
	if contextBlock != "" {
		contextBlock = "\n用户补充说明：" + contextBlock + "\n"
	}
	return fmt.Sprintf(`你是一个“食物保质期录入助手”。你的任务不是做营养分析，而是帮用户从图片里提取“适合录入保质期提醒”的结构化信息。

今天日期：%s
%s
请根据图片识别多个食物，并输出适合前端表单预填的 JSON。

要求：
1. 支持一张图里出现多个食物，也支持多张图是同一批食物的不同角度。
2. 如果多张图里是同一个食物的不同角度，只保留 1 条，不要重复输出。
3. category 只能从这些分类中选择最接近的一项：乳制品、水果、蔬菜、肉类、海鲜、蛋类、豆制品、熟食、剩菜、主食、面包、零食、饮料、冷冻食品、调味品、其他。
4. storage_type 只能为 room_temp / refrigerated / frozen。
5. 如果包装上能清晰看到明确到期日/最佳赏味期，优先用图片中的明确日期，并将 expire_date_is_estimated 设为 false。
6. 如果看不到明确日期，但能根据食物类型、储存方式、常见经验给出建议，请自行补充 suggested_days，并把 expire_date 设为“今天 + suggested_days”，同时将 expire_date_is_estimated 设为 true。
7. quantity_note、日期、储存方式等识别不清时，可以留空或保守猜测，但要在 missing_fields 中写出仍建议用户手动确认的字段。
8. 只输出你相对有把握的食物；不要把背景里的无关物体当成食物。最多输出 8 条食物。

返回 JSON，格式严格如下：
{
  "items": [
    {
      "food_name": "纯牛奶",
      "category": "乳制品",
      "storage_type": "refrigerated",
      "quantity_note": "2盒",
      "expire_date": "%s",
      "expire_date_is_estimated": true,
      "suggested_days": 3,
      "note": "AI 根据常见冷藏乳制品保存期预估，请确认包装日期",
      "recognition_basis": "识别到牛奶包装，但未看清明确到期日",
      "confidence": 0.82,
      "missing_fields": ["quantity_note"]
    }
  ]
}

只返回 JSON，不要输出额外解释。`, todayStr, contextBlock, todayStr)
}

func normalizeFoodExpiryRecognitionItem(raw map[string]any, today time.Time) map[string]any {
	foodName := firstNonEmpty(raw, "food_name", "name")
	if foodName == "" {
		return nil
	}
	category := truncateString(firstNonEmpty(raw, "category"), 30)
	if category == "" {
		category = "其他"
	}
	storageType := normalizeExpiryStorageType(firstNonEmpty(raw, "storage_type"))
	quantityNote := truncateString(firstNonEmpty(raw, "quantity_note"), 40)
	suggestedDays := clampInt(intFromAny(raw["suggested_days"], 3), 0, 365)
	expireDate := normalizeExpiryDate(firstNonEmpty(raw, "expire_date"))
	if expireDate == "" {
		expireDate = today.AddDate(0, 0, suggestedDays).Format("2006-01-02")
	}
	note := truncateString(firstNonEmpty(raw, "note"), 200)
	recognitionBasis := truncateString(firstNonEmpty(raw, "recognition_basis"), 120)
	if note == "" {
		note = recognitionBasis
	}
	return map[string]any{
		"food_name":                truncateString(foodName, 60),
		"category":                 category,
		"storage_type":             storageType,
		"quantity_note":            nilIfEmpty(quantityNote),
		"expire_date":              expireDate,
		"opened_date":              nil,
		"note":                     nilIfEmpty(note),
		"source_type":              "ai",
		"status":                   "active",
		"suggested_days":           suggestedDays,
		"expire_date_is_estimated": boolFromAny(raw["expire_date_is_estimated"]),
		"confidence":               normalizeConfidence(raw["confidence"]),
		"recognition_basis":        nilIfEmpty(recognitionBasis),
		"missing_fields":           normalizeMissingFields(raw["missing_fields"]),
	}
}

func normalizeExpiryStorageType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "room_temp", "refrigerated", "frozen":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "refrigerated"
	}
}

func normalizeExpiryDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 10 {
		value = value[:10]
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

func normalizeMissingFields(value any) []string {
	allowed := map[string]bool{"food_name": true, "category": true, "storage_type": true, "quantity_note": true, "expire_date": true, "note": true}
	out := []string{}
	for _, item := range stringSlice(value) {
		if allowed[item] && !containsString(out, item) {
			out = append(out, item)
		}
	}
	return out
}

func extractMapItems(value any) []map[string]any {
	arr, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func firstNonEmpty(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(fmt.Sprintf("%v", m[key])); value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func intFromAny(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, err := v.Int64()
		if err == nil {
			return int(i)
		}
	}
	return fallback
}

func boolFromAny(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1"
	default:
		return false
	}
}

func normalizeConfidence(value any) any {
	switch v := value.(type) {
	case float64:
		if v < 0 {
			return 0.0
		}
		if v > 1 {
			return 1.0
		}
		return v
	case int:
		if v < 0 {
			return 0.0
		}
		if v > 1 {
			return 1.0
		}
		return float64(v)
	default:
		return nil
	}
}

func stringSlice(value any) []string {
	switch arr := value.(type) {
	case []string:
		return arr
	case []any:
		out := []string{}
		for _, item := range arr {
			if text := strings.TrimSpace(fmt.Sprintf("%v", item)); text != "" && text != "<nil>" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func truncateString(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}

func nilIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
