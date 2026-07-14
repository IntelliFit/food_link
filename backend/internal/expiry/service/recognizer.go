package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"log/slog"
)

const expiryCreditCost = 2

const (
	expiryRecognitionModel       = "gemini-3.5-flash"
	expiryRecognitionMaxAttempts = 2
	expiryRecognitionRetryDelay  = 300 * time.Millisecond
)

type ExpiryVisionClient interface {
	AnalyzeWithImagesAndTemperatureModel(ctx context.Context, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, error)
}

type Recognizer struct {
	client     ExpiryVisionClient
	model      string
	retryDelay time.Duration
}

type RecognizeInput struct {
	ImageURLs         []string
	AdditionalContext string
}

type RecognitionOutput struct {
	Items           []map[string]any `json:"items"`
	RecognizedCount int              `json:"recognized_count"`
}

func NewRecognizer(_ *config.Config) *Recognizer {
	return &Recognizer{
		model:      expiryRecognitionModel,
		retryDelay: expiryRecognitionRetryDelay,
	}
}

func (r *Recognizer) ConfigureVisionClient(client ExpiryVisionClient) {
	r.client = client
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
	if r.client == nil {
		return nil, expiryRecognitionConfigError("后端未配置保质期识别模型")
	}
	parsed, attempts, err := r.analyzeWithRetry(ctx, prompt, imageURLs)
	if err != nil {
		return nil, expiryRecognitionUpstreamError(ctx, fmt.Sprintf("保质期识别模型调用失败 model=%s attempts=%d error_class=%s: %v", r.model, attempts, expiryRecognitionErrorClass(err), err))
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
	logger.Info(ctx, "保质期识别完成",
		logger.Stage("recognize"),
		slog.Int("item_count", len(items)),
		slog.Int("image_count", len(imageURLs)),
	)
	return &RecognitionOutput{Items: items, RecognizedCount: len(items)}, nil
}

func (r *Recognizer) analyzeWithRetry(ctx context.Context, prompt string, imageURLs []string) (map[string]any, int, error) {
	for attempt := 1; attempt <= expiryRecognitionMaxAttempts; attempt++ {
		startedAt := time.Now()
		parsed, err := r.client.AnalyzeWithImagesAndTemperatureModel(ctx, prompt, imageURLs, 0.2, r.model)
		if err == nil {
			if attempt > 1 {
				logger.Info(ctx, "保质期识别上游重试成功",
					logger.Stage("llm_retry"),
					slog.String("model", r.model),
					slog.Int("attempt", attempt),
					slog.Int("max_attempts", expiryRecognitionMaxAttempts),
					slog.Duration("attempt_duration", time.Since(startedAt)),
				)
			}
			return parsed, attempt, nil
		}

		errorClass := expiryRecognitionErrorClass(err)
		if attempt >= expiryRecognitionMaxAttempts || ctx.Err() != nil || !isRetryableExpiryRecognitionError(err) {
			return nil, attempt, err
		}

		logger.Warn(ctx, "保质期识别上游调用失败，准备重试",
			logger.Stage("llm_retry"),
			slog.String("model", r.model),
			slog.Int("attempt", attempt),
			slog.Int("max_attempts", expiryRecognitionMaxAttempts),
			slog.String("error_class", errorClass),
			slog.Duration("attempt_duration", time.Since(startedAt)),
			slog.Duration("retry_delay", r.retryDelay),
			logger.Truncated("upstream_error", err.Error(), 300),
		)
		if err := waitForExpiryRecognitionRetry(ctx, r.retryDelay); err != nil {
			return nil, attempt, err
		}
	}
	return nil, expiryRecognitionMaxAttempts, errors.New("保质期识别重试流程异常结束")
}

func waitForExpiryRecognitionRetry(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func isRetryableExpiryRecognitionError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "tls handshake timeout") ||
		strings.Contains(lower, "unexpected eof") ||
		lower == "eof" ||
		strings.HasSuffix(lower, ": eof") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "server closed idle connection") ||
		strings.Contains(lower, "use of closed network connection") ||
		strings.Contains(lower, "socket hang up") ||
		strings.Contains(lower, "gemini api error 500") ||
		strings.Contains(lower, "gemini api error 502") ||
		strings.Contains(lower, "gemini api error 503") ||
		strings.Contains(lower, "gemini api error 504") {
		return true
	}
	var networkError net.Error
	return errors.As(err, &networkError) && networkError.Timeout()
}

func expiryRecognitionErrorClass(err error) string {
	if err == nil {
		return "none"
	}
	if errors.Is(err, context.Canceled) {
		return "context_canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline_exceeded"
	}
	lower := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lower, "tls handshake timeout"):
		return "tls_handshake_timeout"
	case strings.Contains(lower, "unexpected eof"), lower == "eof", strings.HasSuffix(lower, ": eof"):
		return "unexpected_eof"
	case strings.Contains(lower, "connection reset"):
		return "connection_reset"
	case strings.Contains(lower, "connection refused"):
		return "connection_refused"
	case strings.Contains(lower, "server closed idle connection"):
		return "closed_idle_connection"
	case strings.Contains(lower, "use of closed network connection"), strings.Contains(lower, "socket hang up"):
		return "connection_closed"
	case strings.Contains(lower, "gemini api error 500"),
		strings.Contains(lower, "gemini api error 502"),
		strings.Contains(lower, "gemini api error 503"),
		strings.Contains(lower, "gemini api error 504"):
		return "upstream_5xx"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "network_timeout"
	}
	return "non_retryable"
}

func expiryRecognitionBadRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}

func expiryRecognitionUpstreamError(ctx context.Context, logMessage string) error {
	logger.Warn(ctx, "保质期识别上游错误",
		logger.Stage("llm_upstream"),
		logger.Truncated("upstream_error", logMessage, 300),
	)
	return &commonerrors.AppError{Code: 10006, Message: "保质期识别服务暂时不可用，请稍后再试", HTTPStatus: http.StatusBadGateway}
}

func expiryRecognitionConfigError(message string) error {
	return &commonerrors.AppError{Code: 10000, Message: message, HTTPStatus: http.StatusInternalServerError}
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
