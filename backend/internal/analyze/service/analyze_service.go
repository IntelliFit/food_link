package service

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	"food_link/backend/pkg/storage"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
)

const (
	defaultExecutionMode         = "standard"
	liteExecutionMode            = "lite"
	precisionExecutionMode       = "strict"
	validExecutionMode           = "experimental"
	gemini35FlashExecutionMode   = "gemini35_flash"
	gemini35GroupedExecutionMode = "gemini35_flash_grouped"
	gemini3FlashModel            = "gemini-3-flash-preview"
	gemini31FlashLiteModel       = "gemini-3.1-flash-lite"
	gemini35FlashModel           = "gemini-3.5-flash"
	visionPrimaryTimeout         = 45 * time.Second
	maxLLMJSONParseRetries       = 3
	maxLLMTransientRetries       = 2
	ratioSuggestionTimeout       = 20 * time.Second
	standardHybridTimeout        = 60 * time.Second
	webSearchTimeout             = 6 * time.Second
	webSearchMaxQueries          = 3
	webSearchMaxResults          = 3
)

type AnalyzeService struct {
	ofoxAIClient          LLMClient
	gemini31LiteClient    LLMClient
	gemini35Client        LLMClient
	doubaoClient          LLMClient
	doubaoWebSearchClient interface {
		AnalyzeWithImagesWebSearch(context.Context, string, []string, DoubaoWebSearchOptions) (map[string]any, map[string]any, error)
	}
	imageProvider string
	users         *authrepo.UserRepo
	nutrition     *foodrecordrepo.FoodNutritionRepo
	deepseek      *DeepSeekNutritionEstimator
	storage       *storage.Client
	webSearcher   WebSearcher
}

func NewAnalyzeService(doubaoClient, ofoxAIClient LLMClient, users *authrepo.UserRepo, nutrition ...*foodrecordrepo.FoodNutritionRepo) *AnalyzeService {
	var nutritionRepo *foodrecordrepo.FoodNutritionRepo
	if len(nutrition) > 0 {
		nutritionRepo = nutrition[0]
	}
	var doubaoWebSearchClient interface {
		AnalyzeWithImagesWebSearch(context.Context, string, []string, DoubaoWebSearchOptions) (map[string]any, map[string]any, error)
	}
	if webClient, ok := doubaoClient.(interface {
		AnalyzeWithImagesWebSearch(context.Context, string, []string, DoubaoWebSearchOptions) (map[string]any, map[string]any, error)
	}); ok {
		doubaoWebSearchClient = webClient
	}
	return &AnalyzeService{
		doubaoClient:          doubaoClient,
		doubaoWebSearchClient: doubaoWebSearchClient,
		ofoxAIClient:          ofoxAIClient,
		users:                 users,
		nutrition:             nutritionRepo,
		webSearcher:           NewDuckDuckGoWebSearcher(),
	}
}

func (s *AnalyzeService) ConfigureWebSearcher(searcher WebSearcher) {
	s.webSearcher = searcher
}

func (s *AnalyzeService) ConfigureImageProvider(provider string) {
	s.imageProvider = normalizeImageProviderPreference(provider)
}

func (s *AnalyzeService) ConfigureDeepSeekFallback(apiKey string) {
	s.deepseek = NewDeepSeekNutritionEstimator(apiKey, "", "")
}

func (s *AnalyzeService) ConfigureDoubaoClient(apiKey, baseURL, model string) {
	if strings.TrimSpace(apiKey) != "" {
		client := NewDoubaoClient(apiKey, model, baseURL)
		s.doubaoClient = client
		if s.doubaoWebSearchClient == nil {
			s.doubaoWebSearchClient = client
		}
		m := model
		if m == "" {
			m = "doubao-seed-2-0-lite-260428"
		}
		logger.L().Info("doubao client initialized", slog.String("base_url", baseURL), slog.String("model", m))
	} else {
		logger.L().Warn("doubao client not initialized: empty api key")
	}
}

func (s *AnalyzeService) ConfigureGemini31LiteClient(apiKey, baseURL, model string) {
	if strings.TrimSpace(model) == "" {
		model = gemini31FlashLiteModel
	}
	if strings.TrimSpace(apiKey) != "" {
		s.gemini31LiteClient = NewOfoxAIClient(apiKey, model, baseURL)
		logger.L().Info("gemini 3.1 flash lite client initialized", slog.String("base_url", baseURL), slog.String("model", model))
		return
	}
	logger.L().Warn("gemini 3.1 flash lite client not initialized: empty api key")
}

func (s *AnalyzeService) ConfigureDoubaoWebSearchClient(apiKey, baseURL, model string) {
	if strings.TrimSpace(apiKey) != "" {
		s.doubaoWebSearchClient = NewDoubaoClient(apiKey, model, baseURL)
		m := model
		if m == "" {
			m = "doubao-seed-2-0-lite-260428"
		}
		logger.L().Info("doubao web search client initialized", slog.String("base_url", baseURL), slog.String("model", m))
		return
	}
	if s.doubaoWebSearchClient == nil {
		logger.L().Warn("doubao web search client not initialized: empty api key")
	}
}

func (s *AnalyzeService) ConfigureGemini35Client(apiKey, baseURL, model string) {
	if strings.TrimSpace(model) == "" {
		model = gemini35FlashModel
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://yunwu.ai/v1"
	}
	if strings.TrimSpace(apiKey) != "" {
		s.gemini35Client = NewOfoxAIClient(apiKey, model, baseURL)
		logger.L().Info("gemini 3.5 flash client initialized", slog.String("base_url", baseURL), slog.String("model", model))
		return
	}
	logger.L().Warn("gemini 3.5 flash client not initialized: empty api key")
}

func (s *AnalyzeService) RunPrecisionJSON(ctx context.Context, sourceType, prompt, imageURL, modelName string) (map[string]any, error) {
	imageURLs := []string{}
	if strings.TrimSpace(imageURL) != "" {
		imageURLs = append(imageURLs, imageURL)
	}
	return s.RunPrecisionJSONWithImages(ctx, sourceType, prompt, imageURLs, modelName)
}

func (s *AnalyzeService) RunPrecisionJSONWithImages(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return s.RunPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, 0.2)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesTemperature(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	return s.runPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, temperature, true)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesTemperatureNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	return s.runPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, temperature, false)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return s.RunPrecisionJSONWithImagesTemperatureNoFallback(ctx, sourceType, prompt, imageURLs, modelName, 0.2)
}

func (s *AnalyzeService) runPrecisionJSONWithImagesTemperature(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64, allowFallback bool) (map[string]any, error) {
	sourceType = strings.TrimSpace(sourceType)
	timeout := 60 * time.Second
	if sourceType == "image" {
		timeout = 90 * time.Second
	}
	provider, _ := resolveModelConfig(modelName)
	if sourceType == "image" {
		provider, _ = s.resolveImageModelConfig(modelName)
	} else if strings.TrimSpace(modelName) == "" {
		provider = "doubao"
	}
	traceCtx, span := apm.StartSpan(ctx, "analysis.precision.llm",
		attribute.String("analysis.source_type", sourceType),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.requested_model", strings.TrimSpace(modelName)),
		attribute.Int("analysis.image_count", len(nonEmptyStrings(imageURLs))),
	)
	defer span.End()
	ctx = traceCtx
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	apm.AddEvent(ctx, "precision llm select provider",
		attribute.String("analysis.source_type", sourceType),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.requested_model", strings.TrimSpace(modelName)),
		attribute.Int("analysis.image_count", len(nonEmptyStrings(imageURLs))),
	)
	var client LLMClient
	switch provider {
	case "deepseek":
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("精准模式文字模型使用 DeepSeek 时，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
	case "doubao":
		client = s.doubaoClient
	case "gemini":
		client = s.ofoxAIClient
	default:
		client = s.doubaoClient
	}
	if client == nil {
		err := fmt.Errorf("precision LLM client is not initialized")
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "select_client"))
		return nil, err
	}
	if strings.TrimSpace(sourceType) != "image" {
		imageURLs = nil
	}
	imageURLs = nonEmptyStrings(imageURLs)
	start := time.Now()
	apm.AddEvent(ctx, "precision llm call started",
		attribute.String("analysis.source_type", sourceType),
		attribute.String("analysis.provider", provider),
		attribute.Int("analysis.image_count", len(imageURLs)),
		attribute.Float64("analysis.temperature", temperature),
	)
	parsed, err := analyzeWithJSONParseRetry(callCtx, "precision", provider, "", func(retryCtx context.Context) (map[string]any, error) {
		attemptCtx := retryCtx
		attemptCancel := func() {}
		if provider == "gemini" && len(imageURLs) > 0 {
			attemptCtx, attemptCancel = context.WithTimeout(retryCtx, visionPrimaryTimeout)
		}
		defer attemptCancel()
		return analyzeWithImagesTemperature(attemptCtx, client, prompt, imageURLs, temperature)
	})
	if allowFallback && err != nil && provider == "gemini" && len(imageURLs) > 0 && isTransientLLMError(err) && s.doubaoClient != nil {
		fallbackParsed, fallbackErr := analyzeWithJSONParseRetry(callCtx, "precision_fallback", "doubao", "doubao-seed-2-0-lite-260428", func(retryCtx context.Context) (map[string]any, error) {
			return analyzeWithImagesTemperature(retryCtx, s.doubaoClient, prompt, imageURLs, temperature)
		})
		if fallbackErr == nil {
			logger.WithTrace(ctx).Warn("precision gemini vision transient error fallback to doubao",
				logger.Err(err),
				slog.Int("image_count", len(imageURLs)),
			)
			apm.AddEvent(ctx, "precision llm fallback completed",
				attribute.String("analysis.primary_provider", provider),
				attribute.String("analysis.fallback_provider", "doubao"),
				attribute.Int("analysis.image_count", len(imageURLs)),
				apm.DurationMS("analysis.duration_ms", time.Since(start)),
			)
			return fallbackParsed, nil
		}
		logger.WithTrace(ctx).Warn("precision doubao fallback failed",
			logger.NamedErr("fallback_error", fallbackErr),
			logger.Err(err),
			slog.Int("image_count", len(imageURLs)),
		)
		apm.RecordError(ctx, fallbackErr,
			attribute.String("analysis.stage", "fallback"),
			attribute.String("analysis.fallback_provider", "doubao"),
		)
	}
	if err != nil {
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "llm_call"),
			attribute.String("analysis.provider", provider),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		apm.AddEvent(ctx, "precision llm call failed",
			attribute.String("analysis.provider", provider),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		return parsed, err
	}
	apm.AddEvent(ctx, "precision llm call completed",
		attribute.String("analysis.provider", provider),
		attribute.Int("analysis.image_count", len(imageURLs)),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	return parsed, err
}

func (s *AnalyzeService) ApplyDBFirstToItems(ctx context.Context, items []map[string]any, additionalContext string) []map[string]any {
	resp := map[string]any{"items": items}
	resp = s.applyDBFirstNutrition(ctx, resp, additionalContext)
	return toItems(resp["items"])
}

func analyzeWithImagesTemperature(ctx context.Context, client LLMClient, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	if len(imageURLs) > 0 {
		if precisionClient, ok := client.(interface {
			AnalyzeWithImagesAndTemperature(context.Context, string, []string, float64) (map[string]any, error)
		}); ok {
			return precisionClient.AnalyzeWithImagesAndTemperature(ctx, prompt, imageURLs, temperature)
		}
		if multiClient, ok := client.(interface {
			AnalyzeWithImages(context.Context, string, []string) (map[string]any, error)
		}); ok {
			return multiClient.AnalyzeWithImages(ctx, prompt, imageURLs)
		}
		return client.Analyze(ctx, prompt, imageURLs[0])
	}
	if precisionClient, ok := client.(interface {
		AnalyzeWithImagesAndTemperature(context.Context, string, []string, float64) (map[string]any, error)
	}); ok {
		return precisionClient.AnalyzeWithImagesAndTemperature(ctx, prompt, nil, temperature)
	}
	return client.Analyze(ctx, prompt, "")
}

func isTransientLLMError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	hints := []string{
		"context deadline exceeded",
		"client.timeout",
		"timeout exceeded while awaiting headers",
		"net/http: timeout",
		"i/o timeout",
		"tls handshake timeout",
		"connection reset",
		"connection refused",
		"temporary failure",
		"resource exhausted",
		"please try again later",
		"internalserviceerror",
		"ofoxai api error 408",
		"ofoxai api error 429",
		"ofoxai api error 500",
		"ofoxai api error 502",
		"ofoxai api error 503",
		"ofoxai api error 504",
		"doubao api error 408",
		"doubao api error 429",
		"doubao api error 500",
		"doubao api error 502",
		"doubao api error 503",
		"doubao api error 504",
	}
	for _, hint := range hints {
		if strings.Contains(msg, hint) {
			return true
		}
	}
	return false
}

func analyzeWithJSONParseRetry(ctx context.Context, stage, provider, model string, call func(context.Context) (map[string]any, error)) (map[string]any, error) {
	var parsed map[string]any
	var err error
	jsonRetries := 0
	transientRetries := 0
	for {
		attemptStart := time.Now()
		parsed, err = call(ctx)
		attemptStatus := "success"
		if err != nil {
			switch {
			case IsLLMJSONParseError(err):
				attemptStatus = "json_parse_error"
			case isTransientLLMError(err):
				attemptStatus = "transient_error"
			default:
				attemptStatus = "error"
			}
		}
		metrics.ObserveLLMCall(stage, provider, model, attemptStatus, time.Since(attemptStart))
		if err == nil {
			return parsed, err
		}
		retryReason := ""
		retryNumber := 0
		maxRetries := 0
		switch {
		case IsLLMJSONParseError(err) && jsonRetries < maxLLMJSONParseRetries:
			jsonRetries++
			retryReason = "json_parse"
			metrics.ObserveLLMRetry(stage, provider, model, retryReason)
			retryNumber = jsonRetries
			maxRetries = maxLLMJSONParseRetries
		case isTransientLLMError(err) && transientRetries < maxLLMTransientRetries:
			transientRetries++
			retryReason = "transient"
			metrics.ObserveLLMRetry(stage, provider, model, retryReason)
			retryNumber = transientRetries
			maxRetries = maxLLMTransientRetries
		default:
			return parsed, err
		}
		apm.AddEvent(ctx, "llm retry",
			attribute.String("analysis.stage", stage),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			attribute.String("analysis.retry_reason", retryReason),
			attribute.Int("analysis.retry_number", retryNumber),
			attribute.Int("analysis.max_retries", maxRetries),
		)
		logger.WithTrace(ctx).Warn("llm call failed; retrying same task",
			slog.String("stage", stage),
			slog.String("provider", provider),
			slog.String("model", model),
			slog.String("retry_reason", retryReason),
			slog.Int("retry_number", retryNumber),
			slog.Int("max_retries", maxRetries),
			logger.Err(err),
		)
		backoff := time.Duration(200*retryNumber) * time.Millisecond
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return parsed, ctx.Err()
		case <-timer.C:
		}
	}
}

func nonEmptyStrings(values []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func imageCountForLog(primary string, values []string) int {
	seen := map[string]bool{}
	count := 0
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		count++
	}
	add(primary)
	for _, value := range values {
		add(value)
	}
	return count
}

func (s *AnalyzeService) ConfigureStorage(storageClient *storage.Client) {
	s.storage = storageClient
}

// AnalyzeInput holds all possible inputs for analysis.
type AnalyzeInput struct {
	Base64Image           string           `json:"base64Image"`
	ImageURL              string           `json:"image_url"`
	ImageURLs             []string         `json:"image_urls"`
	Text                  string           `json:"text"`
	AdditionalContext     string           `json:"additionalContext"`
	MealType              string           `json:"meal_type"`
	TimezoneOffsetMinutes *int             `json:"timezone_offset_minutes"`
	Province              string           `json:"province"`
	City                  string           `json:"city"`
	District              string           `json:"district"`
	UserGoal              string           `json:"user_goal"`
	DietGoal              string           `json:"diet_goal"`
	ActivityTiming        string           `json:"activity_timing"`
	RemainingCalories     *float64         `json:"remaining_calories"`
	SuggestRatioEnabled   bool             `json:"suggest_ratio_enabled"`
	ExecutionMode         *string          `json:"execution_mode"`
	ModelName             string           `json:"modelName"`
	AnalysisEngine        string           `json:"analysis_engine"`
	IsMultiView           bool             `json:"is_multi_view"`
	ReferenceObjects      []map[string]any `json:"reference_objects"`
	PreviousResult        map[string]any   `json:"previousResult"`
	CorrectionItems       []map[string]any `json:"correctionItems"`
}

func normalizeExecutionMode(mode *string) string {
	if mode == nil {
		return defaultExecutionMode
	}
	switch strings.TrimSpace(*mode) {
	case precisionExecutionMode, gemini35FlashExecutionMode, gemini35GroupedExecutionMode:
		return precisionExecutionMode
	case defaultExecutionMode, liteExecutionMode, validExecutionMode:
		return defaultExecutionMode
	default:
		return defaultExecutionMode
	}
}

func (s *AnalyzeService) normalizeFoodImageInput(input *AnalyzeInput) {
	if input == nil || s.storage == nil {
		if input != nil {
			normalizeAnalyzeImageRefs(input)
		}
		return
	}
	input.ImageURL = s.resolveFoodImageURL(input.ImageURL)
	input.ImageURLs = s.storage.ResolveReferenceURLs("food-images", input.ImageURLs)
	normalizeAnalyzeImageRefs(input)
}

func (s *AnalyzeService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func normalizeAnalyzeImageRefs(input *AnalyzeInput) {
	if input == nil {
		return
	}
	originalHasImageURLs := len(input.ImageURLs) > 0
	normalized := make([]string, 0, len(input.ImageURLs)+1)
	seen := make(map[string]struct{}, len(input.ImageURLs)+1)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	add(input.ImageURL)
	for _, value := range input.ImageURLs {
		add(value)
	}
	if len(normalized) == 0 {
		input.ImageURL = strings.TrimSpace(input.ImageURL)
		input.ImageURLs = nil
		return
	}
	input.ImageURL = normalized[0]
	if originalHasImageURLs || len(normalized) > 1 {
		input.ImageURLs = normalized
	} else {
		input.ImageURLs = nil
	}
}

func foodAnalyzeImageURLs(input AnalyzeInput) []string {
	images := make([]string, 0, len(input.ImageURLs)+1)
	seen := make(map[string]struct{}, len(input.ImageURLs)+1)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		images = append(images, value)
	}
	add(input.ImageURL)
	for _, value := range input.ImageURLs {
		add(value)
	}
	if len(images) == 0 && strings.TrimSpace(input.Base64Image) != "" {
		add(normalizeImageURL(input.Base64Image))
	}
	return images
}

func validateFoodAnalyzeImageLimit(count int) error {
	if count > maxFoodAnalyzeImages {
		return &errors.AppError{Code: 10002, Message: "最多支持 3 张图片", HTTPStatus: 400}
	}
	return nil
}

func (s *AnalyzeService) resolveExecutionMode(ctx context.Context, userID string, requested *string) string {
	mode := normalizeExecutionMode(requested)
	if userID == "" {
		return mode
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil || user == nil {
		return mode
	}
	profileMode := normalizeExecutionMode(user.ExecutionMode)
	if requested != nil {
		return normalizeExecutionMode(requested)
	}
	return profileMode
}

func buildLocationText(province, city, district string) string {
	parts := []string{}
	if province != "" {
		parts = append(parts, province)
	}
	if city != "" && city != province {
		parts = append(parts, city)
	}
	if district != "" {
		parts = append(parts, district)
	}
	return strings.Join(parts, " ")
}

func buildImageInputHint(input AnalyzeInput) string {
	if imageCountForLog(input.ImageURL, input.ImageURLs) <= 1 {
		return ""
	}
	if input.IsMultiView {
		return "本次用户上传了多张图片，并开启了多视角辅助；请把这些图片视为同一份餐食/同一组食物的不同角度，综合判断份量，不要重复计算同一食物。"
	}
	return "本次用户上传了多张图片；请把它们作为同一次饮食输入在一个结果中汇总。若多张图明显是同一食物的不同角度，不要重复计算；若是不同食物，请分别识别。"
}

func mealName(mealType string, tzOffset *int) string {
	// simplified mapping; extend as needed
	m := map[string]string{
		"breakfast": "早餐",
		"lunch":     "午餐",
		"dinner":    "晚餐",
		"snack":     "加餐",
	}
	if v, ok := m[mealType]; ok {
		return v
	}
	return mealType
}

func buildPrompt(input AnalyzeInput, user *authrepo.User, executionMode string) string {
	if executionMode == liteExecutionMode && strings.TrimSpace(input.Text) == "" {
		return buildLiteImageDBFirstPrompt(input, user)
	}
	if (executionMode == precisionExecutionMode || isGemini35ExecutionMode(executionMode)) && strings.TrimSpace(input.Text) == "" {
		promptMode := executionMode
		if executionMode == precisionExecutionMode {
			promptMode = gemini35FlashExecutionMode
		}
		return buildGemini35ImageDBFirstPrompt(input, user, promptMode)
	}
	if executionMode != validExecutionMode && !strings.EqualFold(input.AnalysisEngine, "legacy_direct") {
		if strings.TrimSpace(input.Text) != "" {
			return buildTextDBFirstPrompt(input, user)
		}
		return buildImageDBFirstPrompt(input, user)
	}

	if strings.TrimSpace(input.Text) != "" {
		return buildTextPrompt(input, user, executionMode)
	}

	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf(`用户补充背景信息: "%s"。请根据此信息调整对隐形成分或烹饪方式的判断。`, input.AdditionalContext)
	}
	imageInputHint := buildImageInputHint(input)

	if executionMode != validExecutionMode {
		compactTags := []string{}
		if input.MealType != "" {
			compactTags = append(compactTags, fmt.Sprintf("餐次:%s", mealName(input.MealType, input.TimezoneOffsetMinutes)))
		}
		stateParts := []string{}
		if input.DietGoal != "" && input.DietGoal != "none" {
			stateParts = append(stateParts, input.DietGoal)
		}
		if input.ActivityTiming != "" && input.ActivityTiming != "none" {
			stateParts = append(stateParts, input.ActivityTiming)
		}
		if len(stateParts) > 0 {
			compactTags = append(compactTags, "状态:"+strings.Join(stateParts, "/"))
		}
		if input.RemainingCalories != nil {
			compactTags = append(compactTags, fmt.Sprintf("剩余:%gkcal", *input.RemainingCalories))
		}
		locationText := buildLocationText(input.Province, input.City, input.District)
		if locationText != "" {
			compactTags = append(compactTags, fmt.Sprintf("位置:%s", locationText))
		}
		if user != nil {
			summary := formatHealthRiskSummary(user)
			if summary != "" {
				compactTags = append(compactTags, summary)
			}
		}
		compact := ""
		if len(compactTags) > 0 {
			compact = strings.Join(compactTags, "\n") + "\n"
		}
		return fmt.Sprintf(`识别图片中的食物，估算重量和营养，仅返回 JSON。
	%s%s%s
	估重时请优先看：占盘面积、厚度/高度、堆叠体积、容器大小、透视关系。
若画面里有筷子、勺子、手掌、包装、餐盒、碗盘等参照物，请利用参照物。
结合常识估算熟食密度、含水量、常见售卖分量，不要只看上表面面积。
重量口径必须与营养数据库一致：estimatedWeightGrams 表示可食部净重。带壳、带骨、带核食物按去壳/去骨/去核后的可食重量估算，不把虾壳、蟹壳、贝壳、花生壳、瓜子壳、骨头、果核计入重量。
输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- context_advice 1-2句，<= 32字，无需则空字符串
- 建议写得自然一点，但不要空泛和重复
- 只返回 JSON

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"suggestedRatio":100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
  "description":"",
  "insight":"",
  "context_advice":""
	}`, compact, imageInputHint, additionalLine)
	}

	// strict mode prompt
	goalHint := ""
	if input.UserGoal != "" {
		goalMap := map[string]string{"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
		goalHint = fmt.Sprintf("\n用户目标为「%s」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。", goalMap[input.UserGoal])
	}
	stateHint := ""
	stateParts := []string{}
	if input.DietGoal != "" && input.DietGoal != "none" {
		stateParts = append(stateParts, input.DietGoal)
	}
	if input.ActivityTiming != "" && input.ActivityTiming != "none" {
		stateParts = append(stateParts, input.ActivityTiming)
	}
	if len(stateParts) > 0 {
		stateHint = fmt.Sprintf("\n用户当前状态: %s，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。", strings.Join(stateParts, " + "))
	}
	remainHint := ""
	if input.RemainingCalories != nil {
		remainHint = fmt.Sprintf("\n用户当日剩余热量预算约 %g kcal。请在每个食物的 suggestedRatio 中给出建议摄入比例（0-100）：若剩余热量充足可按100；若接近或超出预算，建议降低主食/高热量食物的比例；若用户目标是减脂且本餐热量较高，可适当建议控制。", *input.RemainingCalories)
	}
	mealHint := ""
	if input.MealType != "" {
		mealHint = fmt.Sprintf("\n用户选择的是「%s」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。", mealName(input.MealType, input.TimezoneOffsetMinutes))
	}
	locationText := buildLocationText(input.Province, input.City, input.District)
	locationHint := ""
	if locationText != "" {
		locationHint = fmt.Sprintf("\n用户当前所在地区约为「%s」，可把它作为辅助线索，用于理解可能的地域菜名、口味和常见分量；若与图片内容冲突，始终以图片本身为准。", locationText)
	}
	profileBlock := ""
	if user != nil {
		profileBlock = formatHealthProfile(user)
		if profileBlock != "" {
			profileBlock = "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n" + profileBlock
		}
	}
	modeHint := buildExecutionModeHint(executionMode)

	return fmt.Sprintf(`请作为专业的营养师分析这张图片。
	%s

	1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分；重量必须是可食部净重，带壳/带骨/带核食物按去壳、去骨、去核后的重量估算。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。%s
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。%s
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态、位置或剩余热量的情境建议（若无则可为空字符串）。%s%s%s%s
8. 请遵守以下执行模式约束：%s

%s

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{
  "items": [
    {
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }
    }
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
	}`, imageInputHint, mealHint, goalHint, stateHint, remainHint, locationHint, profileBlock, modeHint, additionalLine)
}

func buildContextTags(input AnalyzeInput, user *authrepo.User) []string {
	tags := []string{}
	if input.MealType != "" {
		tags = append(tags, fmt.Sprintf("餐次:%s", mealName(input.MealType, input.TimezoneOffsetMinutes)))
	}
	stateParts := []string{}
	if input.DietGoal != "" && input.DietGoal != "none" {
		stateParts = append(stateParts, input.DietGoal)
	}
	if input.ActivityTiming != "" && input.ActivityTiming != "none" {
		stateParts = append(stateParts, input.ActivityTiming)
	}
	if len(stateParts) > 0 {
		tags = append(tags, "状态:"+strings.Join(stateParts, "/"))
	}
	if input.RemainingCalories != nil {
		tags = append(tags, fmt.Sprintf("剩余:%gkcal", *input.RemainingCalories))
	}
	locationText := buildLocationText(input.Province, input.City, input.District)
	if locationText != "" {
		tags = append(tags, fmt.Sprintf("位置:%s", locationText))
	}
	if user != nil {
		if summary := formatHealthRiskSummary(user); summary != "" {
			tags = append(tags, summary)
		}
	}
	return tags
}

func buildImageDBFirstPrompt(input AnalyzeInput, user *authrepo.User) string {
	tagBlock := ""
	if tags := buildContextTags(input, user); len(tags) > 0 {
		tagBlock = strings.Join(tags, "\n") + "\n"
	}
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf("用户补充背景信息:\n%s\n请根据此信息调整对隐形成分或烹饪方式的判断。", input.AdditionalContext)
	}
	imageInputHint := buildImageInputHint(input)
	correctionBlock := buildCorrectionContextBlock(input)
	return fmt.Sprintf(`你是专业的食物图像识别与份量估算助手。请识别图片中的食物，只输出实际可见的可食用食物名称、可食部分重量和该食物中可计入饮水参考的含水量；营养成分由后端数据库查表补充，不要自行估算营养。
	%s%s%s%s
识别规则：
- 只识别图片中实际可见的食物，不补充看不见的食物
- 包装食品、袋装食品、盒装食品、被其他物体部分遮挡但仍明显是食品包装的对象，也必须作为独立食物项输出；不要因为外层是包装、文字倒置、反光或只露出一部分就忽略它
- 请按区域逐一扫描画面：左侧、中央、右侧、下方、背景/被遮挡处；如果某个区域存在独立食物或独立食品包装，应单独列为一项
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断的食品名，不要输出“包装袋”
- 零食、点心、饼干、肉干、坚果、糖果、糕点等预包装食品，优先读取包装袋上的品牌、品名、口味、配料表、营养成分表、净含量、规格、独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 如果能看到配料表或营养成分表，即使字较小、倾斜、倒置、反光，也要尝试读取关键字段；用配料表判断食物类型和主要原料，用净含量/规格判断重量
- 对零食包装，不能只根据图片图案猜成“阿胶糕/无花果干/普通饼干”等；若包装文字、配料表或营养成分表与视觉图案冲突，最终名称优先采用包装文字和配料证据，并在 evidence 中说明
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分
- 营养库按可食部计算；如果食物带壳、带骨或带核，name 仍写食物本身，estimatedWeightGrams 必须换算为去壳/去骨/去核后的可食净重，不把壳、骨头、果核单独输出为食物
- 相同食物合并为一项，明显不同食物分开
- 食物名称使用简体中文，尽量具体、标准、常见，方便命中营养库
- 混合菜无法可靠拆分时，作为一道常见菜名输出，不要猜测不可见成分

重量规则：
- estimatedWeightGrams 必须是数字，单位克，不要输出范围或单位字符串
- 综合可见面积、厚度、高度、容器、餐具、手掌、包装等参照物估算
- 只估算可见可食部分，不把餐具、包装、骨头、壳、果核计入重量；例如虾/螃蟹/贝类按去壳肉重，花生/瓜子/坚果按去壳仁重，水果按去核后可食部分
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；固体食物按常见含水率保守估算，无法判断时填 0
- 饮品、汤、粥、奶、茶、咖啡等液体或半流体应估算 waterMl；干货、油炸物、酱料难判断时可填 0
- suggestedRatio 表示建议用户实际摄入该食物的比例（0-100 的整数），请结合用户当日剩余热量预算和饮食目标给出建议：减脂且剩余热量不足时降低主食/高热量食物比例；增肌且热量充足时可按100；默认100

输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- pfc_ratio_comment 可根据食物结构简要评价，不要编具体营养数值
- absorption_notes 可简述烹饪/搭配影响，不要编具体营养数值
- context_advice 1-2句，<= 32字，无需则空字符串
- 如果这是纠错任务，必须基于原图、上一轮结果和用户纠错说明重新判断；不要机械照抄上一轮结果，也不要仅把前端列表原样返回
- 只返回 JSON

JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":""
	}`, tagBlock, imageInputHint, additionalLine, correctionBlock)
}

func buildLiteImageDBFirstPrompt(input AnalyzeInput, user *authrepo.User) string {
	tagBlock := ""
	if tags := buildContextTags(input, user); len(tags) > 0 {
		tagBlock = strings.Join(tags, "\n") + "\n"
	}
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf("用户补充背景信息:\n%s\n", input.AdditionalContext)
	}
	imageInputHint := buildImageInputHint(input)
	return fmt.Sprintf(`你是轻量食物图像识别助手。请基于图片识别可见食物，必要时使用 web_search 补充包装食品、小众水果、进口零食、品牌食品的公开信息；只返回 JSON，不要输出解释。
%s%s%s
轻量模式目标：
- 单次完成食物名称和可食部净重估计，不输出营养；营养由后端数据库查表
- 食物名称用简体中文，尽量标准、具体，方便命中营养库
- 包装食品优先读取包装文字、品牌、品名、净含量、营养标签；文字倒置/旋转时要旋转后重读
- 零食/预包装食品要重点读取配料表、营养成分表、口味、规格和独立小包数量；不要只看包装正面插画猜食物
- 不确定 OCR 不能直接当食物名；若 OCR 与视觉冲突，把冲突写进 recognitionEvidence 和 alternativeNames
- 小众水果/进口零食/不确定包装食品可使用 web_search，搜索关键词要围绕可见包装文字、品牌、品名或用户补充信息，避免用泛泛描述搜索
- estimatedWeightGrams 是可食部净重；带壳、带骨、带核食物按去壳/去骨/去核后估算
- waterMl 表示该食物/饮品本身可计入饮水参考的水量；无法判断填 0

JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100,"confidence":0.8,"recognitionEvidence":"","weightEvidence":"","alternativeNames":[]}],
  "description":"",
  "insight":"",
  "ocrText":[],
  "webSearchSummary":""
}`, tagBlock, imageInputHint, additionalLine)
}

func buildGemini35ImageDBFirstPrompt(input AnalyzeInput, user *authrepo.User, executionMode string) string {
	if executionMode == gemini35GroupedExecutionMode {
		return buildGemini35GroupedPlanPrompt(input, user)
	}
	tagBlock := ""
	if tags := buildContextTags(input, user); len(tags) > 0 {
		tagBlock = strings.Join(tags, "\n") + "\n"
	}
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf("用户补充背景信息:\n%s\n请优先使用用户明确补充的食物名、品牌、包装文字、份量信息。", input.AdditionalContext)
	}
	imageInputHint := buildImageInputHint(input)
	groupLine := "本通道为 Gemini 3.5 Flash 直接识别：一次性输出完整食物清单。"
	return fmt.Sprintf(`你是专业的食物图像识别与可食部重量估算助手。请基于图片直接识别食物；营养由后端数据库查表补充，不要自行输出营养值。
%s%s%s
%s

识别重点：
- 必须逐区扫描画面：左侧、中央、右侧、下方、背景/被遮挡处
- 包装食品、袋装食品、盒装食品、被部分遮挡但仍明显是食品包装的对象，必须作为独立食物项输出
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断食品名，不要输出“包装袋”
- 包装文字可能横排、竖排、倒置、旋转、反光或被遮挡；请 mentally rotate 后重读，低置信 OCR 不能直接当食物名
- 零食、点心、饼干、肉干、坚果、糖果、糕点等预包装食品，优先读取包装袋上的品牌、品名、口味、配料表、营养成分表、净含量、规格、独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 如果能看到配料表或营养成分表，即使字较小、倾斜、倒置、反光，也要尝试读取关键字段；用配料表判断食物类型和主要原料，用净含量/规格判断重量
- 对零食包装，不能只根据图片图案猜成“阿胶糕/无花果干/普通饼干”等；若包装文字、配料表或营养成分表与视觉图案冲突，最终名称优先采用包装文字和配料证据，并在 recognitionEvidence 中说明
- 重点区分相近字：鹅胗/鹅肫/鹅珍 与 阿胶；龙宫果/龙贡果/longkong 与 无花果/无花果干
- 相同食物合并为一项，明显不同食物分开；不要因为一个物体在背景或被其它包装压住就漏掉
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分

重量规则：
- estimatedWeightGrams 是可食部净重，单位克，必须是数字
- 只估算可见可食部分；带壳、带骨、带核食物必须换算为去壳/去骨/去核后的可食净重
- 包装食品如果只能看到独立小包，按该小包通常净含量/可见体积估算；如果看得到净含量文字，优先参考净含量
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；无法判断填 0
- suggestedRatio 表示建议用户实际摄入比例，0-100 的整数，默认100

输出要求：
- 只返回 JSON，不要输出 Markdown
- 简体中文
- description <= 16字
- insight <= 32字
- 每个 item 都给出 recognitionEvidence 和 weightEvidence，便于排查
- ocrText 放你从图片中读到的关键包装文字；不确定的文字可放 alternativeNames 或 evidence 中说明

JSON:
{
  "items":[
    {
      "name":"",
      "type":"normal",
      "estimatedWeightGrams":0,
      "waterMl":0,
      "suggestedRatio":100,
      "groupId":1,
      "confidence":0.8,
      "recognitionEvidence":"",
      "weightEvidence":"",
      "alternativeNames":[]
    }
  ],
  "groups":[{"groupId":1,"description":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}`, tagBlock, imageInputHint, additionalLine, groupLine)
}

func buildGemini35GroupedPlanPrompt(input AnalyzeInput, user *authrepo.User) string {
	tagBlock := ""
	if tags := buildContextTags(input, user); len(tags) > 0 {
		tagBlock = strings.Join(tags, "\n") + "\n"
	}
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf("用户补充背景信息:\n%s\n请优先使用用户明确补充的食物名、品牌、包装文字、份量信息。", input.AdditionalContext)
	}
	imageInputHint := buildImageInputHint(input)
	return fmt.Sprintf(`你是专业的食物图像识别规划助手。当前任务只做第一阶段：看清楚图片里有哪些独立食物/包装食品，并按空间、遮挡和包装归属分成最多 2 组；不要把主要精力放在精确估重上。
%s%s%s

第一阶段目标：
- 锁定食物清单：图片里所有独立食物、独立包装食品、被部分遮挡但明显是食品包装的对象，都必须列出
- 最多分 2 组，groupId 只能是 1 或 2；不需要分组时全部填 1
- 输出每个 item 的位置、识别证据、OCR 证据和候选名称，方便第二阶段专门估重
- estimatedWeightGrams 可以给粗略占位值，但第二阶段会重新估重；不要因为重量不确定就漏掉食物

识别规则：
- 必须逐区扫描画面：左侧、中央、右侧、下方、背景/被遮挡处
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断食品名，不要输出“包装袋”
- 包装文字可能横排、竖排、倒置、旋转、反光或被遮挡；请 mentally rotate 后重读，低置信 OCR 不能直接当食物名
- 零食/预包装食品要重点读取配料表、营养成分表、口味、规格、净含量和独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 重点区分相近字：鹅胗/鹅肫/鹅珍 与 阿胶；龙宫果/龙贡果/longkong 与 无花果/无花果干
- 相同食物合并为一项，明显不同食物分开；不要因为一个物体在背景或被其它包装压住就漏掉
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分

输出要求：
- 只返回 JSON，不要输出 Markdown
- 简体中文
- description <= 16字
- insight <= 32字
- 每个 item 必须给 groupId、position、recognitionEvidence、alternativeNames
- ocrText 放你从图片中读到的关键包装文字；不确定的文字写进 evidence 或 alternativeNames

JSON:
{
  "items":[
    {
      "name":"",
      "type":"normal",
      "estimatedWeightGrams":0,
      "waterMl":0,
      "suggestedRatio":100,
      "groupId":1,
      "position":"",
      "confidence":0.8,
      "recognitionEvidence":"",
      "weightEvidence":"第一阶段仅粗略占位，第二阶段估重",
      "alternativeNames":[]
    }
  ],
  "groups":[{"groupId":1,"description":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}`, tagBlock, imageInputHint, additionalLine)
}

func buildTextPrompt(input AnalyzeInput, user *authrepo.User, executionMode string) string {
	compactTags := []string{}
	if input.MealType != "" {
		compactTags = append(compactTags, fmt.Sprintf("餐次:%s", mealName(input.MealType, input.TimezoneOffsetMinutes)))
	}
	if input.DietGoal != "" && input.DietGoal != "none" {
		compactTags = append(compactTags, "饮食目标:"+input.DietGoal)
	}
	if input.ActivityTiming != "" && input.ActivityTiming != "none" {
		compactTags = append(compactTags, "运动时机:"+input.ActivityTiming)
	}
	if input.RemainingCalories != nil {
		compactTags = append(compactTags, fmt.Sprintf("剩余热量:%gkcal", *input.RemainingCalories))
	}
	locationText := buildLocationText(input.Province, input.City, input.District)
	if locationText != "" {
		compactTags = append(compactTags, "位置:"+locationText)
	}
	if user != nil {
		if summary := formatHealthRiskSummary(user); summary != "" {
			compactTags = append(compactTags, summary)
		}
	}
	modeLine := "标准模式：从用户文字中拆解食物、估算重量和营养。"
	if executionMode == validExecutionMode {
		modeLine = "精准模式：从用户文字中尽可能精确拆解所有食物、重量、烹饪方式和营养。"
	}
	contextLine := ""
	if input.AdditionalContext != "" {
		contextLine = "用户补充说明：" + input.AdditionalContext
	}
	tags := ""
	if len(compactTags) > 0 {
		tags = strings.Join(compactTags, "\n")
	}
	return fmt.Sprintf(`请作为专业营养师分析这段用户饮食文字，只返回 JSON。

用户原始输入：
%s

%s
%s
%s

输出要求：
- 简体中文
- 根据自然语言拆分食物，不要虚构用户没有提到的主食物
- 重量可基于常见份量估算，但必须是可食部净重；带壳、带骨、带核食物按去壳/去骨/去核后的重量，不把壳、骨头、果核计入营养计算
- description <= 24字
- insight/context_advice 各 1-2 句，<= 40字
- suggestedRatio：每个食物的建议摄入比例（0-100），结合用户剩余热量和饮食目标给出建议，默认100

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"suggestedRatio":100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":""
}`, strings.TrimSpace(input.Text), tags, contextLine, modeLine)
}

func buildTextDBFirstPrompt(input AnalyzeInput, user *authrepo.User) string {
	tagBlock := ""
	if tags := buildContextTags(input, user); len(tags) > 0 {
		tagBlock = strings.Join(tags, "\n") + "\n"
	}
	contextLine := ""
	if input.AdditionalContext != "" {
		contextLine = "用户补充说明：" + input.AdditionalContext
	}
	correctionBlock := buildCorrectionContextBlock(input)
	return fmt.Sprintf(`你是食物文字解析助手。请把用户的自然语言饮食描述解析成可查营养数据库的结构化食物名称、重量和该食物中可计入饮水参考的含水量；营养成分由后端数据库统一计算，不要输出营养值。

用户描述:
%s

%s
%s%s解析规则：
- 只输出用户明确描述的食物，不补充没有出现的食物
- 如果用户写了明确重量、个数、半份、一碗、一杯等份量，请换算为克；没有明确重量时按日常熟食份量保守估算
- estimatedWeightGrams 是营养计算使用的可食部净重；带壳、带骨、带核食物即使用户描述的是整只/整份，也要换算为去壳/去骨/去核后的可食重量
- 食物名称使用简体中文，尽量具体、标准、常见，方便命中营养库
- 相同食物合并为一项，重量为合计重量
- 混合菜无法可靠拆分时，作为一道常见菜名输出
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；饮品、汤、粥、奶、茶、咖啡等应估算，无法判断时填 0
- 如果这是纠错任务，必须基于原始文字、上一轮结果和用户纠错说明重新判断；不要机械照抄上一轮结果，也不要仅把前端列表原样返回

输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- pfc_ratio_comment 可根据食物结构简要评价，不要编具体营养数值
- absorption_notes 可简述烹饪/搭配影响，不要编具体营养数值
- context_advice 1-2句，<= 32字，无需则空字符串
- 只返回 JSON

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":""
}`, strings.TrimSpace(input.Text), contextLine, tagBlock, correctionBlock)
}

func buildCorrectionContextBlock(input AnalyzeInput) string {
	parts := []string{}
	if len(input.PreviousResult) > 0 {
		prevParts := []string{}
		if desc := strings.TrimSpace(fmt.Sprintf("%v", input.PreviousResult["description"])); desc != "" && desc != "<nil>" {
			prevParts = append(prevParts, "上一轮餐食描述："+desc)
		}
		if insight := strings.TrimSpace(fmt.Sprintf("%v", input.PreviousResult["insight"])); insight != "" && insight != "<nil>" {
			prevParts = append(prevParts, "上一轮健康建议："+insight)
		}
		if itemText := formatCorrectionItemsForPrompt(toItems(input.PreviousResult["items"])); itemText != "" {
			prevParts = append(prevParts, "上一轮识别结果："+itemText)
		}
		if len(prevParts) > 0 {
			parts = append(parts, "第一轮分析输出 / 当前结果页基线（可能已包含用户手动修改后的名称与重量）：\n- "+strings.Join(prevParts, "\n- "))
		}
	}
	if itemText := formatCorrectionItemsForPrompt(input.CorrectionItems); itemText != "" {
		parts = append(parts, "用户在纠错列表中提交的结构化清单：\n"+itemText)
	}
	if len(parts) == 0 {
		return ""
	}
	return "\n\n这是一次基于「原始输入 + 上一轮结果 + 用户纠错说明」的二次纠错分析。\n" +
		strings.Join(parts, "\n\n") +
		"\n\n信息优先级（高到低）：\n1. 用户本轮纠错说明和结构化清单\n2. 上一轮分析输出 / 当前结果页基线\n3. 原始图片或原始文字\n若高优先级信息与低优先级冲突，必须以前者为准；但仍要让 AI 重新分析名称、重量和是否新增/删除食物。\n"
}

func formatCorrectionItemsForPrompt(items []map[string]any) string {
	if len(items) == 0 {
		return ""
	}
	lines := make([]string, 0, len(items))
	for index, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" || name == "<nil>" {
			continue
		}
		weight := numberFromAny(item["estimatedWeightGrams"])
		if weight <= 0 {
			weight = numberFromAny(item["weight"])
		}
		if weight <= 0 {
			weight = numberFromAny(item["originalWeightGrams"])
		}
		if weight <= 0 {
			weight = numberFromAny(item["originalWeight"])
		}
		sourceName := strings.TrimSpace(fmt.Sprintf("%v", item["sourceName"]))
		if sourceName == "<nil>" {
			sourceName = ""
		}
		editTags := []string{}
		if boolFromAny(item["nameEdited"]) {
			editTags = append(editTags, "名称已改")
		}
		if boolFromAny(item["weightEdited"]) {
			editTags = append(editTags, "重量已改")
		}
		line := fmt.Sprintf("%d. %s", index+1, name)
		if weight > 0 {
			line += fmt.Sprintf(" %.0fg", weight)
		}
		if sourceName != "" && sourceName != name {
			line += fmt.Sprintf("（原识别：%s）", sourceName)
		}
		if len(editTags) > 0 {
			line += " [" + strings.Join(editTags, "、") + "]"
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func buildExecutionModeHint(mode string) string {
	if mode == validExecutionMode {
		return "精准模式：请尽可能精确地识别每种食物，给出详细的重量估算和营养数据。"
	}
	return "标准模式：给出合理的估算即可。"
}

func formatHealthProfile(user *authrepo.User) string {
	parts := []string{}
	if user.Gender != nil {
		parts = append(parts, fmt.Sprintf("性别：%s", map[bool]string{true: "男", false: "女"}[*user.Gender == "male"]))
	}
	if user.Height != nil {
		parts = append(parts, fmt.Sprintf("身高 %.0f cm", *user.Height))
	}
	if user.Weight != nil {
		parts = append(parts, fmt.Sprintf("体重 %.1f kg", *user.Weight))
	}
	if user.Birthday != nil && *user.Birthday != "" {
		parts = append(parts, fmt.Sprintf("生日 %s", *user.Birthday))
	}
	line1 := strings.Join(parts, "  ")
	if line1 != "" {
		line1 = "· " + line1
	}
	activity := "未填"
	if user.ActivityLevel != nil {
		activity = *user.ActivityLevel
	}
	line2 := fmt.Sprintf("· 活动水平：%s", activity)

	hc := user.HealthCondition
	lines := []string{line1, line2}
	if routine := strings.TrimSpace(fmt.Sprintf("%v", hc["routine_type"])); routine != "" && routine != "<nil>" {
		lines = append(lines, "· 作息习惯："+routine)
	}
	if medical, ok := hc["medical_history"].([]any); ok && len(medical) > 0 {
		items := []string{}
		for _, m := range medical {
			items = append(items, fmt.Sprintf("%v", m))
		}
		lines = append(lines, "· 既往病史："+strings.Join(items, "、"))
	}
	if diet, ok := hc["diet_preference"].([]any); ok && len(diet) > 0 {
		items := []string{}
		for _, d := range diet {
			items = append(items, fmt.Sprintf("%v", d))
		}
		lines = append(lines, "· 饮食偏好："+strings.Join(items, "、"))
	}
	if allergies, ok := hc["allergies"].([]any); ok && len(allergies) > 0 {
		items := []string{}
		for _, a := range allergies {
			items = append(items, fmt.Sprintf("%v", a))
		}
		lines = append(lines, "· 过敏/忌口："+strings.Join(items, "、"))
	}
	if user.BMR != nil {
		lines = append(lines, fmt.Sprintf("· 基础代谢(BMR)：%.0f kcal/天", *user.BMR))
	}
	if user.TDEE != nil {
		lines = append(lines, fmt.Sprintf("· 每日总消耗(TDEE)：%.0f kcal/天", *user.TDEE))
	}
	filtered := []string{}
	for _, l := range lines {
		if l != "" {
			filtered = append(filtered, l)
		}
	}
	if len(filtered) == 0 {
		return ""
	}
	return "用户健康档案（供营养建议参考）：\n" + strings.Join(filtered, "\n")
}

func formatHealthRiskSummary(user *authrepo.User) string {
	hc := user.HealthCondition
	tags := []string{}
	if medical, ok := hc["medical_history"].([]any); ok {
		for _, m := range medical {
			s := strings.TrimSpace(fmt.Sprintf("%v", m))
			if s != "" {
				tags = append(tags, s)
			}
		}
	}
	if allergies, ok := hc["allergies"].([]any); ok {
		for _, a := range allergies {
			s := strings.TrimSpace(fmt.Sprintf("%v", a))
			if s != "" {
				tags = append(tags, "忌口"+s)
			}
		}
	}
	if diet, ok := hc["diet_preference"].([]any); ok {
		for _, d := range diet {
			s := strings.TrimSpace(fmt.Sprintf("%v", d))
			if s != "" {
				tags = append(tags, s)
			}
		}
	}
	seen := map[string]bool{}
	uniq := []string{}
	for _, t := range tags {
		if !seen[t] {
			seen[t] = true
			uniq = append(uniq, t)
		}
	}
	if len(uniq) == 0 {
		return ""
	}
	limit := 4
	if len(uniq) < limit {
		limit = len(uniq)
	}
	return "健康摘要:" + strings.Join(uniq[:limit], "、")
}

func resolveModelConfig(modelName string) (provider, model string) {
	raw := strings.TrimSpace(modelName)
	normalized := strings.ToLower(raw)
	if raw == "" {
		return "gemini", gemini3FlashModel
	}
	if normalized == "doubao" || normalized == "doubao-seed-2-0-lite" || normalized == "doubao-seed-2-0-lite-260428" {
		return "doubao", "doubao-seed-2-0-lite-260428"
	}
	if strings.HasPrefix(normalized, "doubao") {
		return "doubao", raw
	}
	if normalized == "deepseek" || normalized == "deepseek-v4-pro" {
		return "deepseek", deepSeekNutritionFallbackModel
	}
	if normalized == "deepseek-v4-flash" {
		return "deepseek", "deepseek-v4-flash"
	}
	if strings.HasPrefix(normalized, "deepseek") {
		return "deepseek", raw
	}
	if normalized == "gemini" || normalized == "gemini-flash" || normalized == "gemini-vision" ||
		normalized == "gemini-3-flash-preview" || normalized == "google/gemini-3-flash-preview" {
		return "gemini", gemini3FlashModel
	}
	if normalized == gemini31FlashLiteModel || normalized == "gemini31-flash-lite" || normalized == "gemini31_flash_lite" {
		return "gemini", gemini31FlashLiteModel
	}
	if normalized == "ofox-gemini" || normalized == "ofox-gemini-3-flash-preview" {
		return "gemini", gemini3FlashModel
	}
	if normalized == gemini35FlashModel || normalized == "gemini35-flash" || normalized == "gemini35_flash" {
		return "gemini", gemini35FlashModel
	}
	if strings.HasPrefix(normalized, "ofox-gemini:") {
		return "gemini", strings.TrimSpace(strings.TrimPrefix(raw, "ofox-gemini:"))
	}
	return "gemini", gemini3FlashModel
}

func normalizeImageProviderPreference(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "doubao":
		return "doubao"
	case "gemini", "ofox", "ofoxai", "ofox-gemini":
		return "gemini"
	default:
		return ""
	}
}

func isGemini35ExecutionMode(executionMode string) bool {
	return executionMode == gemini35FlashExecutionMode || executionMode == gemini35GroupedExecutionMode
}

func shouldUseImageProviderPreference(modelName string) bool {
	raw := strings.TrimSpace(modelName)
	if raw == "" {
		return false
	}
	normalized := strings.ToLower(raw)
	switch normalized {
	case "gemini", "gemini-flash", "gemini-vision":
		return true
	default:
		return false
	}
}

func (s *AnalyzeService) resolveImageModelConfig(modelName string) (provider, model string) {
	if shouldUseImageProviderPreference(modelName) {
		switch s.imageProvider {
		case "gemini":
			return "gemini", "gemini-3-flash-preview"
		case "doubao":
			return "doubao", "doubao-seed-2-0-lite-260428"
		}
	}
	return resolveModelConfig(modelName)
}

// Analyze performs single-image or text analysis synchronously.
func (s *AnalyzeService) Analyze(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	s.normalizeFoodImageInput(&input)
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	isCorrection := len(input.CorrectionItems) > 0 || len(input.PreviousResult) > 0
	if executionMode == defaultExecutionMode {
		if isCorrection {
			input.ModelName = gemini31FlashLiteModel
		} else {
			input.ModelName = gemini3FlashModel
		}
	} else if executionMode == precisionExecutionMode || executionMode == gemini35FlashExecutionMode {
		input.ModelName = gemini35FlashModel
	} else if executionMode != validExecutionMode {
		input.ModelName = gemini3FlashModel
	}
	if executionMode == gemini35GroupedExecutionMode {
		input.ModelName = gemini35FlashModel
	}

	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}

	prompt := buildPrompt(input, user, executionMode)

	provider, model := s.resolveImageModelConfig(input.ModelName)
	var client LLMClient
	switch provider {
	case "doubao":
		client = s.doubaoClient
	case "gemini":
		if executionMode == precisionExecutionMode || isGemini35ExecutionMode(executionMode) {
			client = s.gemini35Client
		} else if strings.EqualFold(model, gemini31FlashLiteModel) && s.gemini31LiteClient != nil {
			client = s.gemini31LiteClient
		} else {
			client = s.ofoxAIClient
		}
	case "deepseek":
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("图片识别使用 DeepSeek 时，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
	default:
		client = s.doubaoClient
	}
	if client == nil {
		if executionMode == precisionExecutionMode || isGemini35ExecutionMode(executionMode) {
			return nil, fmt.Errorf("Gemini 3.5 Flash 图片识别 client 未初始化，请配置 gemini35_api_key")
		}
		return nil, fmt.Errorf("图片识别 LLM client 未初始化")
	}

	imageURLs := foodAnalyzeImageURLs(input)
	if err := validateFoodAnalyzeImageLimit(len(imageURLs)); err != nil {
		return nil, err
	}

	start := time.Now()
	primaryProvider := provider
	primaryModel := model
	imageCount := len(imageURLs)
	ctx, span := apm.StartSpan(ctx, "analysis.food_image",
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.primary_provider", primaryProvider),
		attribute.String("analysis.primary_model", primaryModel),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.String("analysis.engine", strings.TrimSpace(input.AnalysisEngine)),
		attribute.Int("analysis.image_count", imageCount),
	)
	defer span.End()
	apm.AddEvent(ctx, "food image analyze llm start",
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.String("analysis.engine", strings.TrimSpace(input.AnalysisEngine)),
		attribute.Int("analysis.image_count", imageCount),
		attribute.Bool("analysis.has_base64_image", strings.TrimSpace(input.Base64Image) != ""),
	)
	logger.WithTrace(ctx).Info("food image analyze llm start",
		slog.String("user_id", userID),
		slog.String("provider", provider),
		slog.String("model", model),
		slog.String("requested_model", strings.TrimSpace(input.ModelName)),
		slog.String("execution_mode", executionMode),
		slog.String("analysis_engine", strings.TrimSpace(input.AnalysisEngine)),
		slog.Int("image_count", imageCount),
		slog.Bool("has_base64_image", strings.TrimSpace(input.Base64Image) != ""),
	)
	lightweightMeta := map[string]any{}
	parsed, err := analyzeWithJSONParseRetry(ctx, "food_image", provider, model, func(callCtx context.Context) (map[string]any, error) {
		attemptCtx := callCtx
		attemptCancel := func() {}
		if provider == "gemini" && len(imageURLs) > 0 {
			attemptCtx, attemptCancel = context.WithTimeout(callCtx, visionPrimaryTimeout)
		}
		defer attemptCancel()
		if executionMode == liteExecutionMode {
			if webClient := s.doubaoWebSearchClient; webClient != nil {
				lightParsed, meta, webErr := webClient.AnalyzeWithImagesWebSearch(attemptCtx, prompt, imageURLs, DoubaoWebSearchOptions{
					MaxKeyword:   2,
					Limit:        5,
					MaxToolCalls: 1,
				})
				lightweightMeta = meta
				return lightParsed, webErr
			}
			return nil, fmt.Errorf("lite food image mode requires Doubao Responses web search client; configure doubao_web_search_api_key")
		}
		return analyzeWithImagesTemperature(attemptCtx, client, prompt, imageURLs, 0.3)
	})
	fallbackUsed := false
	if err != nil {
		metrics.ObserveFoodAnalysis("image", provider, model, "llm_error", time.Since(start), -1)
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "llm_call"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		apm.AddEvent(ctx, "food image analyze llm failed",
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			attribute.String("analysis.primary_provider", primaryProvider),
			attribute.String("analysis.primary_model", primaryModel),
			attribute.Int("analysis.image_count", imageCount),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		logger.WithTrace(ctx).Warn("food image analyze llm failed",
			slog.String("user_id", userID),
			slog.String("provider", provider),
			slog.String("model", model),
			slog.String("primary_provider", primaryProvider),
			slog.String("primary_model", primaryModel),
			slog.String("requested_model", strings.TrimSpace(input.ModelName)),
			slog.Int("image_count", imageCount),
			slog.Duration("duration", time.Since(start)),
			logger.Err(err),
		)
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())
	hybridMeta := map[string]any{
		"status":          "skipped",
		"strategy":        provider + "_db_first",
		"base_provider":   provider,
		"base_model":      model,
		"review_provider": nil,
		"review_model":    nil,
	}
	if executionMode == liteExecutionMode {
		hybridMeta = map[string]any{
			"status":          "applied",
			"strategy":        "doubao_responses_web_search_db_first",
			"base_provider":   provider,
			"base_model":      model,
			"review_provider": nil,
			"review_model":    nil,
			"web_search":      lightweightMeta,
		}
	}
	if executionMode == precisionExecutionMode || isGemini35ExecutionMode(executionMode) {
		hybridMeta = map[string]any{
			"status":          "applied",
			"strategy":        executionMode + "_db_first",
			"base_provider":   provider,
			"base_model":      model,
			"review_provider": nil,
			"review_model":    nil,
		}
		if executionMode == gemini35GroupedExecutionMode {
			grouped, meta := s.refineGemini35GroupedEstimate(ctx, input, parsed, imageURLs)
			if len(meta) > 0 {
				hybridMeta = meta
			}
			if grouped != nil {
				parsed = grouped
			}
		}
	}
	if shouldRunStandardImageHybridReview(input, executionMode, provider) {
		reviewed, meta := s.reviewStandardImageWithGemini(ctx, input, parsed, imageURLs)
		if len(meta) > 0 {
			hybridMeta = meta
		}
		if reviewed != nil {
			parsed = reviewed
			if stringFromAny(hybridMeta["status"]) == "applied" {
				provider = "hybrid"
				model = fmt.Sprintf("%s+%s", model, stringFromAny(hybridMeta["review_model"]))
			}
		}
	}
	durationMs = float64(time.Since(start).Milliseconds())
	apm.SetAttributes(ctx,
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.Bool("analysis.fallback_used", fallbackUsed),
		attribute.String("analysis.hybrid_status", stringFromAny(hybridMeta["status"])),
		apm.DurationMS("analysis.llm_duration_ms", time.Since(start)),
	)
	apm.AddEvent(ctx, "food image analyze llm completed",
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.primary_provider", primaryProvider),
		attribute.String("analysis.primary_model", primaryModel),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.Int("analysis.image_count", imageCount),
		attribute.Bool("analysis.fallback_used", fallbackUsed),
		attribute.String("analysis.hybrid_status", stringFromAny(hybridMeta["status"])),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	logger.WithTrace(ctx).Info("food image analyze llm completed",
		slog.String("user_id", userID),
		slog.String("provider", provider),
		slog.String("model", model),
		slog.String("primary_provider", primaryProvider),
		slog.String("primary_model", primaryModel),
		slog.String("requested_model", strings.TrimSpace(input.ModelName)),
		slog.Int("image_count", imageCount),
		slog.Bool("fallback_used", fallbackUsed),
		slog.Any("hybrid_review", hybridMeta),
		slog.Duration("duration", time.Since(start)),
	)

	result, err := s.finalizeAnalyzeResponse(ctx, parsed, input, executionMode, provider, model, durationMs)
	if err != nil {
		metrics.ObserveFoodAnalysis("image", provider, model, "finalize_error", time.Since(start), -1)
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "finalize"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		logger.WithTrace(ctx).Warn("food image analyze finalize failed",
			slog.String("user_id", userID),
			slog.String("provider", provider),
			slog.String("model", model),
			slog.Duration("duration", time.Since(start)),
			logger.Err(err),
		)
		return nil, err
	}
	result["food_image_strategy"] = hybridMeta["strategy"]
	result["hybrid_review"] = hybridMeta
	apm.SetAttributes(ctx,
		attribute.String("analysis.engine", stringFromAny(result["analysis_engine"])),
		attribute.Int("analysis.item_count", len(toItems(result["items"]))),
		attribute.Int("analysis.resolved_count", intFromAny(result["resolved_count"])),
		attribute.Int("analysis.unresolved_count", intFromAny(result["unresolved_count"])),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	apm.AddEvent(ctx, "food image analyze finalized",
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.engine", stringFromAny(result["analysis_engine"])),
		attribute.Int("analysis.item_count", len(toItems(result["items"]))),
		attribute.Int("analysis.resolved_count", intFromAny(result["resolved_count"])),
		attribute.Int("analysis.unresolved_count", intFromAny(result["unresolved_count"])),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	logger.WithTrace(ctx).Info("food image analyze finalized",
		slog.String("user_id", userID),
		slog.String("provider", provider),
		slog.String("model", model),
		slog.String("analysis_engine", stringFromAny(result["analysis_engine"])),
		slog.Int("item_count", len(toItems(result["items"]))),
		slog.Int("resolved_count", intFromAny(result["resolved_count"])),
		slog.Int("unresolved_count", intFromAny(result["unresolved_count"])),
		slog.Duration("duration", time.Since(start)),
	)
	metrics.ObserveFoodAnalysis("image", provider, model, "success", time.Since(start), len(toItems(result["items"])))
	return result, nil
}

func shouldRunStandardImageHybridReview(input AnalyzeInput, executionMode, provider string) bool {
	if executionMode != precisionExecutionMode {
		return false
	}
	if executionMode == liteExecutionMode {
		return false
	}
	if !strings.EqualFold(provider, "doubao") {
		return false
	}
	if strings.EqualFold(input.AnalysisEngine, "legacy_direct") {
		return false
	}
	if len(input.CorrectionItems) == 0 && len(input.PreviousResult) == 0 && strings.TrimSpace(input.Text) != "" {
		return false
	}
	if len(input.CorrectionItems) > 0 || len(input.PreviousResult) > 0 {
		return false
	}
	return true
}

func (s *AnalyzeService) reviewStandardImageWithGemini(ctx context.Context, input AnalyzeInput, doubaoParsed map[string]any, imageURLs []string) (map[string]any, map[string]any) {
	modelName := "gemini"
	if client, ok := s.ofoxAIClient.(*OfoxAIClient); ok && strings.TrimSpace(client.Model) != "" {
		modelName = client.Model
	}
	meta := map[string]any{
		"status":          "skipped",
		"strategy":        "doubao_db_first",
		"base_provider":   "doubao",
		"base_model":      "doubao-seed-2-0-lite-260428",
		"review_provider": "gemini",
		"review_model":    modelName,
	}
	if baseItems := compactHybridDebugItems(parseItems(doubaoParsed), 8); len(baseItems) > 0 {
		meta["base_items"] = baseItems
	}
	if baseDescription := strings.TrimSpace(fmt.Sprintf("%v", doubaoParsed["description"])); baseDescription != "" && baseDescription != "<nil>" {
		meta["base_description"] = baseDescription
	}
	if s.ofoxAIClient == nil {
		meta["status"] = "unavailable"
		meta["error"] = "gemini client is not configured"
		return nil, meta
	}
	if s.ofoxAIClient == s.doubaoClient {
		meta["status"] = "unavailable"
		meta["error"] = "gemini client equals doubao client"
		return nil, meta
	}
	imageURLs = nonEmptyStrings(imageURLs)
	if len(imageURLs) == 0 {
		meta["status"] = "no_images"
		return nil, meta
	}
	searchEvidence := s.collectStandardImageSearchEvidence(ctx, input, doubaoParsed)
	meta["web_search_status"] = "skipped"
	if len(searchEvidence) > 0 {
		meta["web_search_status"] = "applied"
		meta["web_search_queries"] = webSearchEvidenceQueries(searchEvidence)
		meta["web_search_result_count"] = webSearchEvidenceResultCount(searchEvidence)
	}
	prompt := buildStandardImageHybridReviewPrompt(input, doubaoParsed, searchEvidence)
	callCtx, cancel := context.WithTimeout(ctx, standardHybridTimeout)
	defer cancel()
	reviewed, err := analyzeWithJSONParseRetry(callCtx, "food_image_hybrid_review", "gemini", modelName, func(retryCtx context.Context) (map[string]any, error) {
		return analyzeWithImagesTemperature(retryCtx, s.ofoxAIClient, prompt, imageURLs, 0.2)
	})
	if err != nil {
		logger.WithTrace(ctx).Warn("standard image hybrid review failed",
			logger.Err(err),
			slog.Int("image_count", len(imageURLs)),
		)
		meta["status"] = "failed"
		meta["error"] = err.Error()
		return nil, meta
	}
	merged := mergeHybridReviewParsed(doubaoParsed, reviewed)
	if len(parseItems(merged)) == 0 {
		meta["status"] = "empty"
		return nil, meta
	}
	meta["status"] = "applied"
	meta["strategy"] = "doubao_visual_gemini_weight_db_first"
	meta["review_item_count"] = len(parseItems(merged))
	if reviewItems := compactHybridDebugItems(parseItems(reviewed), 8); len(reviewItems) > 0 {
		meta["review_items"] = reviewItems
	}
	if finalItems := compactHybridDebugItems(parseItems(merged), 8); len(finalItems) > 0 {
		meta["final_items"] = finalItems
	}
	if agreement := strings.TrimSpace(fmt.Sprintf("%v", reviewed["modelAgreement"])); agreement != "" && agreement != "<nil>" {
		meta["model_agreement"] = agreement
	}
	if ocrText := stringSliceFromAny(reviewed["ocrText"]); len(ocrText) > 0 {
		meta["ocr_text"] = limitStrings(ocrText, 8)
	}
	logger.WithTrace(ctx).Info("standard image hybrid review applied",
		slog.Int("image_count", len(imageURLs)),
		slog.Int("item_count", len(parseItems(merged))),
		slog.Any("hybrid_review", meta),
	)
	return merged, meta
}

func (s *AnalyzeService) refineGemini35GroupedEstimate(ctx context.Context, input AnalyzeInput, plan map[string]any, imageURLs []string) (map[string]any, map[string]any) {
	modelName := "gemini-3.5-flash"
	if client, ok := s.gemini35Client.(*OfoxAIClient); ok && strings.TrimSpace(client.Model) != "" {
		modelName = client.Model
	}
	meta := map[string]any{
		"status":          "skipped",
		"strategy":        "gemini35_flash_grouped_db_first",
		"base_provider":   "gemini",
		"base_model":      modelName,
		"review_provider": "gemini",
		"review_model":    modelName,
	}
	planItems := parseItems(plan)
	if baseItems := compactHybridDebugItems(planItems, 8); len(baseItems) > 0 {
		meta["plan_items"] = baseItems
		meta["base_items"] = baseItems
	}
	if groups := normalizeGemini35Groups(plan["groups"]); len(groups) > 0 {
		meta["plan_groups"] = groups
	}
	if s.gemini35Client == nil {
		meta["status"] = "unavailable"
		meta["error"] = "gemini 3.5 flash client is not configured"
		return nil, meta
	}
	imageURLs = nonEmptyStrings(imageURLs)
	if len(imageURLs) == 0 {
		meta["status"] = "no_images"
		return nil, meta
	}
	if len(planItems) == 0 {
		meta["status"] = "empty_plan"
		return nil, meta
	}
	prompt := buildGemini35GroupedWeightPrompt(input, plan)
	callCtx, cancel := context.WithTimeout(ctx, standardHybridTimeout)
	defer cancel()
	weightResult, err := analyzeWithJSONParseRetry(callCtx, "gemini35_grouped_weight", "gemini", modelName, func(retryCtx context.Context) (map[string]any, error) {
		return analyzeWithImagesTemperature(retryCtx, s.gemini35Client, prompt, imageURLs, 0.15)
	})
	if err != nil {
		logger.WithTrace(ctx).Warn("gemini 3.5 grouped weight estimate failed",
			logger.Err(err),
			slog.Int("image_count", len(imageURLs)),
		)
		meta["status"] = "failed"
		meta["error"] = err.Error()
		return nil, meta
	}
	if len(parseItems(weightResult)) == 0 {
		meta["status"] = "empty"
		return nil, meta
	}
	reviewed := mergeGemini35GroupedPlanAndWeights(plan, weightResult)
	if len(parseItems(reviewed)) == 0 {
		meta["status"] = "empty_merged"
		return nil, meta
	}
	meta["status"] = "applied"
	meta["review_item_count"] = len(parseItems(reviewed))
	if weightItems := compactHybridDebugItems(parseItems(weightResult), 8); len(weightItems) > 0 {
		meta["weight_items"] = weightItems
		meta["review_items"] = weightItems
	}
	if finalItems := compactHybridDebugItems(parseItems(reviewed), 8); len(finalItems) > 0 {
		meta["final_items"] = finalItems
	}
	if groups := normalizeGemini35Groups(reviewed["groups"]); len(groups) > 0 {
		meta["groups"] = groups
		reviewed["groups"] = groups
	}
	if ocrText := stringSliceFromAny(reviewed["ocrText"]); len(ocrText) > 0 {
		meta["ocr_text"] = limitStrings(ocrText, 8)
	}
	logger.WithTrace(ctx).Info("gemini 3.5 grouped estimate applied",
		slog.Int("image_count", len(imageURLs)),
		slog.Int("item_count", len(parseItems(reviewed))),
		slog.Any("hybrid_review", meta),
	)
	return reviewed, meta
}

func buildGemini35GroupedWeightPrompt(input AnalyzeInput, plan map[string]any) string {
	planBytes, _ := json.Marshal(map[string]any{
		"description": plan["description"],
		"items":       gemini35GroupedPlanItemsForPrompt(parseItems(plan), 12),
		"groups":      normalizeGemini35Groups(plan["groups"]),
		"ocrText":     plan["ocrText"],
	})
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = "用户补充背景信息:\n" + input.AdditionalContext + "\n"
	}
	return fmt.Sprintf(`你是食物图像分组重量估算助手。请基于原图和第一阶段已锁定的食物清单，专门估计每组和每个食物的可食部净重。

第一阶段识别规划结果:
%s

%s估重要求:
- 第一阶段的食物清单默认已经锁定；第二阶段主要估重量，不要随意新增、删除或改名
- 只有当图片中有非常强的反证时，才允许在 alternativeNames 或 recognitionEvidence 中说明名称疑点；最终 name 仍尽量沿用第一阶段
- groupId 只能使用第一阶段给出的 1 或 2；不要重新发明更多组
- 先估每组总可食净重，再把组内重量分配到各 item
- 优先利用包装净含量、可见数量、剩余比例、常见单个重量、盘子/手/包装尺寸、面积厚度、遮挡关系进行推理
- estimatedWeightGrams 必须是可食部净重，单位克
- 带壳、带骨、带核食物按去壳/去骨/去核后的可食净重估算
- 不输出营养，营养由后端数据库查表
- 每个 item 必须给 weightEvidence；如果是粗估，要说明依据和不确定性
- 返回 items 数量应尽量等于第一阶段 item 数量，并按第一阶段顺序输出

只返回 JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100,"groupId":1,"confidence":0.8,"recognitionEvidence":"","weightEvidence":"","alternativeNames":[]}],
  "groups":[{"groupId":1,"description":"","estimatedWeightGrams":0,"weightEvidence":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}`, string(planBytes), additionalLine)
}

func gemini35GroupedPlanItemsForPrompt(items []map[string]any, limit int) []map[string]any {
	if limit <= 0 || len(items) == 0 {
		return nil
	}
	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]map[string]any, 0, len(items))
	for index, item := range items {
		row := map[string]any{
			"index":               index,
			"name":                strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			"type":                strings.TrimSpace(fmt.Sprintf("%v", item["type"])),
			"groupId":             normalizeGemini35GroupID(item["groupId"]),
			"position":            strings.TrimSpace(fmt.Sprintf("%v", item["position"])),
			"recognitionEvidence": strings.TrimSpace(fmt.Sprintf("%v", item["recognitionEvidence"])),
			"alternativeNames":    limitStrings(stringSliceFromAny(item["alternativeNames"]), 5),
			"roughWeightGrams":    numberFromAny(item["estimatedWeightGrams"]),
			"roughWeightEvidence": strings.TrimSpace(fmt.Sprintf("%v", item["weightEvidence"])),
			"confidence":          numberFromAny(item["confidence"]),
			"suggestedRatio":      numberFromAny(item["suggestedRatio"]),
		}
		out = append(out, row)
	}
	return out
}

func mergeGemini35GroupedPlanAndWeights(plan, weightResult map[string]any) map[string]any {
	merged := copyAnyMap(plan)
	planItems := parseItems(plan)
	weightItems := parseItems(weightResult)
	if len(planItems) == 0 {
		if len(weightItems) > 0 {
			merged["items"] = extractRawItems(weightResult["items"])
		}
		return merged
	}
	finalItems := make([]map[string]any, 0, len(planItems))
	usedWeights := map[int]struct{}{}
	for index, planItem := range planItems {
		next := copyAnyMap(planItem)
		next["groupId"] = normalizeGemini35GroupID(planItem["groupId"])
		if weightItem, weightIndex := bestGemini35WeightItemForPlan(index, planItem, weightItems, usedWeights); weightItem != nil {
			usedWeights[weightIndex] = struct{}{}
			if weight := numberFromAny(weightItem["estimatedWeightGrams"]); weight > 0 {
				next["estimatedWeightGrams"] = weight
				next["originalWeightGrams"] = weight
			}
			if water := numberFromAny(firstNonNil(weightItem["waterMl"], weightItem["water_ml"])); water >= 0 {
				next["waterMl"] = water
			}
			if ratio := numberFromAny(weightItem["suggestedRatio"]); ratio >= 0 && ratio <= 100 {
				next["suggestedRatio"] = ratio
			}
			if confidence := numberFromAny(weightItem["confidence"]); confidence > 0 {
				next["confidence"] = confidence
			}
			if evidence := cleanAnalyzeText(weightItem["weightEvidence"]); evidence != "" {
				next["weightEvidence"] = evidence
			}
			if evidence := cleanAnalyzeText(weightItem["recognitionEvidence"]); evidence != "" {
				if baseEvidence := cleanAnalyzeText(planItem["recognitionEvidence"]); baseEvidence != "" && baseEvidence != evidence {
					next["recognitionEvidence"] = baseEvidence + "；估重阶段补充：" + evidence
				} else {
					next["recognitionEvidence"] = evidence
				}
			}
			if alternatives := stringSliceFromAny(weightItem["alternativeNames"]); len(alternatives) > 0 {
				next["alternativeNames"] = mergeAnalyzeStringSlices(stringSliceFromAny(planItem["alternativeNames"]), alternatives, 6)
			}
		}
		finalItems = append(finalItems, next)
	}
	merged["items"] = finalItems
	if groups := normalizeGemini35Groups(firstNonNil(weightResult["groups"], plan["groups"])); len(groups) > 0 {
		merged["groups"] = groups
	}
	for _, key := range []string{"description", "insight", "context_advice", "pfc_ratio_comment", "absorption_notes"} {
		if text := cleanAnalyzeText(weightResult[key]); text != "" {
			merged[key] = text
		}
	}
	if ocr := stringSliceFromAny(weightResult["ocrText"]); len(ocr) > 0 {
		merged["ocrText"] = mergeAnalyzeStringSlices(stringSliceFromAny(plan["ocrText"]), ocr, 12)
	}
	return merged
}

func bestGemini35WeightItemForPlan(index int, planItem map[string]any, weightItems []map[string]any, used map[int]struct{}) (map[string]any, int) {
	if index >= 0 && index < len(weightItems) {
		if _, ok := used[index]; !ok {
			return weightItems[index], index
		}
	}
	planName := normalizeAnalyzeName(planItem["name"])
	for candidateIndex, item := range weightItems {
		if _, ok := used[candidateIndex]; ok {
			continue
		}
		if normalizeAnalyzeName(item["name"]) == planName {
			return item, candidateIndex
		}
	}
	return nil, -1
}

func normalizeGemini35GroupID(value any) int {
	groupID := int(numberFromAny(value))
	if groupID < 1 || groupID > 2 {
		return 1
	}
	return groupID
}

func cleanAnalyzeText(value any) string {
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "" || text == "<nil>" {
		return ""
	}
	return text
}

func normalizeAnalyzeName(value any) string {
	name := cleanAnalyzeText(value)
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, " ", "")
	name = strings.ReplaceAll(name, "　", "")
	return name
}

func mergeAnalyzeStringSlices(primary, secondary []string, limit int) []string {
	if limit <= 0 {
		limit = 8
	}
	out := make([]string, 0, limit)
	seen := map[string]struct{}{}
	for _, list := range [][]string{primary, secondary} {
		for _, value := range list {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			key := strings.ToLower(value)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, value)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func normalizeGemini35Groups(value any) []map[string]any {
	rows := anyListFromAny(value)
	if len(rows) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, 2)
	seen := map[int]struct{}{}
	for _, row := range rows {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		groupID := int(numberFromAny(m["groupId"]))
		if groupID < 1 || groupID > 2 {
			continue
		}
		if _, ok := seen[groupID]; ok {
			continue
		}
		seen[groupID] = struct{}{}
		out = append(out, map[string]any{
			"groupId":     groupID,
			"description": strings.TrimSpace(fmt.Sprintf("%v", m["description"])),
		})
		if len(out) == 2 {
			break
		}
	}
	return out
}

func anyListFromAny(value any) []any {
	switch v := value.(type) {
	case []any:
		return v
	case []map[string]any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func compactHybridDebugItems(items []map[string]any, limit int) []map[string]any {
	if limit <= 0 || len(items) == 0 {
		return nil
	}
	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" || name == "<nil>" {
			continue
		}
		row := map[string]any{
			"name":     name,
			"weight_g": numberFromAny(item["estimatedWeightGrams"]),
		}
		if water := numberFromAny(item["waterMl"]); water > 0 {
			row["water_ml"] = water
		}
		if confidence := numberFromAny(item["confidence"]); confidence > 0 {
			row["confidence"] = confidence
		}
		if evidence := strings.TrimSpace(fmt.Sprintf("%v", item["recognitionEvidence"])); evidence != "" && evidence != "<nil>" {
			row["recognition_evidence"] = truncateRunes(evidence, 120)
		}
		if evidence := strings.TrimSpace(fmt.Sprintf("%v", item["weightEvidence"])); evidence != "" && evidence != "<nil>" {
			row["weight_evidence"] = truncateRunes(evidence, 120)
		}
		if alternatives := stringSliceFromAny(item["alternativeNames"]); len(alternatives) > 0 {
			row["alternative_names"] = limitStrings(alternatives, 5)
		}
		out = append(out, row)
	}
	return out
}

func buildStandardImageHybridReviewPrompt(input AnalyzeInput, doubaoParsed map[string]any, searchEvidence []WebSearchEvidence) string {
	type doubaoItem struct {
		Index                int     `json:"index"`
		Name                 string  `json:"name"`
		EstimatedWeightGrams float64 `json:"estimatedWeightGrams"`
		WaterMl              float64 `json:"waterMl"`
	}
	items := []doubaoItem{}
	for index, item := range parseItems(doubaoParsed) {
		items = append(items, doubaoItem{
			Index:                index,
			Name:                 strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			EstimatedWeightGrams: numberFromAny(item["estimatedWeightGrams"]),
			WaterMl:              numberFromAny(item["waterMl"]),
		})
	}
	contextPayload := map[string]any{
		"task": "基于原图和 Doubao 初识别结果，复核食物名称并重点重新估算可食部净重。营养由后端数据库计算，不要输出营养。",
		"doubaoInitialResult": map[string]any{
			"description": doubaoParsed["description"],
			"items":       items,
		},
		"webSearchEvidence": searchEvidence,
		"userContext": map[string]any{
			"mealType":          input.MealType,
			"dietGoal":          input.DietGoal,
			"activityTiming":    input.ActivityTiming,
			"remainingCalories": input.RemainingCalories,
			"additionalContext": strings.TrimSpace(input.AdditionalContext),
			"isMultiView":       input.IsMultiView,
		},
		"rules": []string{
			"只返回 JSON，不要输出解释性正文。",
			"必须先独立观察图片和 OCR 信息，再参考 Doubao 候选；不要先假设 Doubao 正确。",
			"OCR 必须检查横向、竖排、倒置、旋转、被遮挡和反光文字；如果文字疑似倒置或旋转，要在 mentally rotate 后重读，尤其区分形近的“鹅胗/鹅肫/鹅珍”和“阿胶”等。",
			"不要把低置信度 OCR 片段直接当作食物名；包装食品最终名称必须同时满足 OCR 文字、包装图案、品牌/品类和可见食物逻辑一致。",
			"如果 OCR 字样与视觉食物或包装图案不一致，必须在 recognitionEvidence 中说明冲突，并把可能误读的文字放入 alternativeNames，而不是直接定名。",
			"优先利用包装文字、品牌名、品名、净含量、营养成分表、规格、份数、已食用比例等文字证据；包装食品不要只靠外观猜。",
			"webSearchEvidence 只作为外部佐证，不能替代图片证据；当搜索结果与可见图片/包装文字冲突时，以图片和包装文字为准。",
			"没有包装文字时，可以参考 Doubao 的视觉候选，但必须结合原图重新判断食物名称和重量。",
			"对小众水果、进口零食、包装食品、候选冲突项，要显式比较 alternativeNames，不要被 Doubao 的单一候选锚定。",
			"estimatedWeightGrams 必须是营养计算使用的可食部净重；带壳、带骨、带核食物按去壳/去骨/去核后估算。",
			"重量必须有 evidence：包装净含量、剩余比例、数量、容器体积、厚度、面积、参照物、常见熟重等至少写一条。",
			"如果 Doubao 名称明显不对，可以修正；如果不确定，选择最可能名称，并在 alternativeNames 中保留候选。",
			"waterMl 只表示食物/饮品本身可计入饮水参考的水量；无法判断填 0。",
			"不要输出餐具、包装、骨头、壳、果核等不可食或非食物部分。",
		},
		"responseSchema": map[string]any{
			"description":    "简短餐食描述",
			"insight":        "一句自然健康建议",
			"context_advice": "",
			"modelAgreement": "agree|name_changed|weight_changed|conflict",
			"ocrText":        []string{},
			"items": []map[string]any{{
				"name":                 "食物名称",
				"estimatedWeightGrams": 100,
				"waterMl":              0,
				"confidence":           0.8,
				"recognitionEvidence":  "为什么是这个食物",
				"weightEvidence":       "为什么是这个重量",
				"alternativeNames":     []string{},
			}},
		},
	}
	bytes, _ := json.Marshal(contextPayload)
	return "你是食物图像复核与重量推理专家。请把 Doubao 的食物识别优势作为候选参考，同时发挥你的 OCR、包装理解、世界知识和重量推理能力，输出最终用于营养库查询的食物名称与可食部净重。\n" + string(bytes)
}

func mergeHybridReviewParsed(base, review map[string]any) map[string]any {
	merged := copyAnyMap(base)
	for _, key := range []string{"description", "insight", "context_advice", "pfc_ratio_comment", "absorption_notes"} {
		if text := strings.TrimSpace(fmt.Sprintf("%v", review[key])); text != "" && text != "<nil>" {
			merged[key] = text
		}
	}
	reviewItems := extractRawItems(review["items"])
	if len(reviewItems) > 0 {
		merged["items"] = reviewItems
	}
	for _, key := range []string{"ocrText", "modelAgreement"} {
		if value, ok := review[key]; ok && !isEmptyAnalyzeAny(value) {
			merged[key] = value
		}
	}
	return merged
}

type WebSearcher interface {
	Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error)
}

type WebSearchResult struct {
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	URL     string `json:"url,omitempty"`
}

type WebSearchEvidence struct {
	Query   string            `json:"query"`
	Results []WebSearchResult `json:"results"`
}

type DuckDuckGoWebSearcher struct {
	client *http.Client
}

func NewDuckDuckGoWebSearcher() *DuckDuckGoWebSearcher {
	return &DuckDuckGoWebSearcher{client: &http.Client{Timeout: webSearchTimeout}}
}

func (s *DuckDuckGoWebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > webSearchMaxResults {
		limit = webSearchMaxResults
	}
	endpoint := "https://duckduckgo.com/html/?" + url.Values{"q": []string{query}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FoodLinkBot/1.0; +https://healthymax.cn)")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("web search status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseDuckDuckGoHTMLResults(string(data), limit), nil
}

var (
	duckResultBlockRe   = regexp.MustCompile(`(?is)<div[^>]+class="[^"]*result[^"]*"[^>]*>(.*?)</div>\s*</div>`)
	duckTitleRe         = regexp.MustCompile(`(?is)<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)</a>`)
	duckSnippetRe       = regexp.MustCompile(`(?is)<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>`)
	htmlTagRe           = regexp.MustCompile(`(?is)<[^>]+>`)
	htmlWhitespaceRe    = regexp.MustCompile(`\s+`)
	duckRedirectParamRe = regexp.MustCompile(`[?&]uddg=([^&]+)`)
)

func parseDuckDuckGoHTMLResults(raw string, limit int) []WebSearchResult {
	if limit <= 0 {
		limit = webSearchMaxResults
	}
	blocks := duckResultBlockRe.FindAllStringSubmatch(raw, -1)
	results := make([]WebSearchResult, 0, limit)
	for _, blockMatch := range blocks {
		if len(blockMatch) < 2 {
			continue
		}
		block := blockMatch[1]
		titleMatch := duckTitleRe.FindStringSubmatch(block)
		if len(titleMatch) < 3 {
			continue
		}
		title := cleanHTMLText(titleMatch[2])
		if title == "" {
			continue
		}
		snippet := ""
		if snippetMatch := duckSnippetRe.FindStringSubmatch(block); len(snippetMatch) >= 2 {
			snippet = cleanHTMLText(snippetMatch[1])
		}
		results = append(results, WebSearchResult{
			Title:   truncateRunes(title, 80),
			Snippet: truncateRunes(snippet, 180),
			URL:     normalizeDuckDuckGoURL(titleMatch[1]),
		})
		if len(results) >= limit {
			break
		}
	}
	return results
}

func normalizeDuckDuckGoURL(raw string) string {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if match := duckRedirectParamRe.FindStringSubmatch(raw); len(match) >= 2 {
		if decoded, err := url.QueryUnescape(match[1]); err == nil {
			return decoded
		}
	}
	return raw
}

func cleanHTMLText(raw string) string {
	text := htmlTagRe.ReplaceAllString(raw, " ")
	text = html.UnescapeString(text)
	text = htmlWhitespaceRe.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func (s *AnalyzeService) collectStandardImageSearchEvidence(ctx context.Context, input AnalyzeInput, doubaoParsed map[string]any) []WebSearchEvidence {
	if s.webSearcher == nil {
		return nil
	}
	queries := buildStandardImageSearchQueries(input, doubaoParsed)
	if len(queries) == 0 {
		return nil
	}
	searchCtx, cancel := context.WithTimeout(ctx, webSearchTimeout*time.Duration(len(queries)))
	defer cancel()
	evidence := make([]WebSearchEvidence, 0, len(queries))
	for _, query := range queries {
		results, err := s.webSearcher.Search(searchCtx, query, webSearchMaxResults)
		if err != nil {
			logger.WithTrace(ctx).Warn("standard image web search failed",
				slog.String("query", query),
				logger.Err(err),
			)
			continue
		}
		if len(results) == 0 {
			continue
		}
		evidence = append(evidence, WebSearchEvidence{Query: query, Results: results})
	}
	return evidence
}

func buildStandardImageSearchQueries(input AnalyzeInput, doubaoParsed map[string]any) []string {
	candidates := []string{}
	if text := strings.TrimSpace(input.AdditionalContext); text != "" {
		candidates = append(candidates, text)
	}
	if desc := strings.TrimSpace(fmt.Sprintf("%v", doubaoParsed["description"])); desc != "" && desc != "<nil>" {
		candidates = append(candidates, desc)
	}
	for _, item := range parseItems(doubaoParsed) {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name != "" && name != "未知食物" {
			candidates = append(candidates, name)
		}
		for _, alt := range stringSliceFromAny(item["alternativeNames"]) {
			candidates = append(candidates, alt)
		}
	}
	queries := []string{}
	seen := map[string]bool{}
	add := func(value string) {
		value = normalizeSearchQuery(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		queries = append(queries, value)
	}
	for _, candidate := range candidates {
		add(candidate + " 食物 外观 营养")
		add(candidate + " 包装 净含量 营养成分")
		if len(queries) >= webSearchMaxQueries {
			break
		}
	}
	return limitStrings(queries, webSearchMaxQueries)
}

func normalizeSearchQuery(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	value = htmlWhitespaceRe.ReplaceAllString(value, " ")
	value = strings.Trim(value, "，,。.;；:：|")
	return truncateRunes(value, 80)
}

func webSearchEvidenceQueries(evidence []WebSearchEvidence) []string {
	queries := make([]string, 0, len(evidence))
	for _, row := range evidence {
		if row.Query != "" {
			queries = append(queries, row.Query)
		}
	}
	return queries
}

func webSearchEvidenceResultCount(evidence []WebSearchEvidence) int {
	count := 0
	for _, row := range evidence {
		count += len(row.Results)
	}
	return count
}

func limitStrings(values []string, limit int) []string {
	if limit <= 0 || len(values) <= limit {
		return values
	}
	return values[:limit]
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if limit <= 0 || len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit])
}

func extractRawItems(value any) []any {
	switch arr := value.(type) {
	case []any:
		out := make([]any, 0, len(arr))
		for _, item := range arr {
			if m, ok := item.(map[string]any); ok && strings.TrimSpace(fmt.Sprintf("%v", m["name"])) != "" {
				out = append(out, m)
			}
		}
		return out
	case []map[string]any:
		out := make([]any, 0, len(arr))
		for _, item := range arr {
			if item != nil && strings.TrimSpace(fmt.Sprintf("%v", item["name"])) != "" {
				out = append(out, item)
			}
		}
		return out
	default:
		return nil
	}
}

func isEmptyAnalyzeAny(value any) bool {
	if value == nil {
		return true
	}
	switch v := value.(type) {
	case string:
		text := strings.TrimSpace(v)
		return text == "" || text == "<nil>"
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	case []map[string]any:
		return len(v) == 0
	default:
		return false
	}
}

// AnalyzeText performs text-only analysis.
func (s *AnalyzeService) AnalyzeText(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	prompt := buildPrompt(input, user, executionMode)
	provider, model := resolveModelConfig(input.ModelName)
	var client LLMClient
	if strings.TrimSpace(input.ModelName) == "" {
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("文字输入模式默认使用 DeepSeek，请配置 DEEPSEEK_API_KEY")
		}
		provider = "deepseek"
		model = s.deepseek.Model
		client = s.deepseek
	} else if provider == "deepseek" {
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("文字输入模式使用 DeepSeek，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
		model = s.deepseek.Model
	} else if provider == "doubao" {
		client = s.doubaoClient
	} else if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.doubaoClient
	}
	start := time.Now()
	ctx, span := apm.StartSpan(ctx, "analysis.food_text",
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.String("analysis.execution_mode", executionMode),
	)
	defer span.End()
	apm.AddEvent(ctx, "food text analyze llm start",
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.String("analysis.execution_mode", executionMode),
	)
	parsed, err := analyzeWithJSONParseRetry(ctx, "food_text", provider, model, func(callCtx context.Context) (map[string]any, error) {
		return client.Analyze(callCtx, prompt, "")
	})
	if err != nil {
		metrics.ObserveFoodAnalysis("text", provider, model, "llm_error", time.Since(start), -1)
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "llm_call"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())
	result, err := s.finalizeAnalyzeResponse(ctx, parsed, input, executionMode, provider, model, durationMs)
	if err != nil {
		metrics.ObserveFoodAnalysis("text", provider, model, "finalize_error", time.Since(start), -1)
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "finalize"))
		return nil, err
	}
	apm.AddEvent(ctx, "food text analyze finalized",
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.engine", stringFromAny(result["analysis_engine"])),
		attribute.Int("analysis.item_count", len(toItems(result["items"]))),
		attribute.Int("analysis.resolved_count", intFromAny(result["resolved_count"])),
		attribute.Int("analysis.unresolved_count", intFromAny(result["unresolved_count"])),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	metrics.ObserveFoodAnalysis("text", provider, model, "success", time.Since(start), len(toItems(result["items"])))
	return result, nil
}

// AnalyzeCompare calls both Doubao and Gemini in parallel.
func (s *AnalyzeService) AnalyzeCompare(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	s.normalizeFoodImageInput(&input)
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	compareInput := input
	compareInput.AnalysisEngine = "legacy_direct"
	prompt := buildPrompt(compareInput, user, executionMode)

	imageURL := ""
	if input.ImageURL != "" {
		imageURL = input.ImageURL
	} else if input.Base64Image != "" {
		imageURL = normalizeImageURL(input.Base64Image)
	}

	var wg sync.WaitGroup
	var doubaoRes, geminiRes map[string]any
	var doubaoErr, geminiErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		start := time.Now()
		parsed, err := s.doubaoClient.Analyze(ctx, prompt, imageURL)
		if err != nil {
			doubaoErr = err
			return
		}
		doubaoRes = buildAnalyzeResponse(parsed, executionMode, "doubao", "doubao-seed-2-0-lite-260428", float64(time.Since(start).Milliseconds()))
	}()
	go func() {
		defer wg.Done()
		start := time.Now()
		parsed, err := s.ofoxAIClient.Analyze(ctx, prompt, imageURL)
		if err != nil {
			geminiErr = err
			return
		}
		geminiRes = buildAnalyzeResponse(parsed, executionMode, "gemini", "gemini-3-flash-preview", float64(time.Since(start).Milliseconds()))
	}()
	wg.Wait()

	doubaoResult := modelResultFrom(doubaoRes, doubaoErr, "doubao-seed-2-0-lite-260428")
	geminiResult := modelResultFrom(geminiRes, geminiErr, "gemini-3-flash-preview")

	return map[string]any{
		"doubao_result": doubaoResult,
		"gemini_result": geminiResult,
	}, nil
}

// AnalyzeCompareEngines runs legacy_direct vs db_first on the same input.
func (s *AnalyzeService) AnalyzeCompareEngines(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	s.normalizeFoodImageInput(&input)
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	// Use the richer legacy prompt here so the direct branch still has model
	// nutrients; db_first then replaces nutrients with library lookup results.
	compareInput := input
	compareInput.AnalysisEngine = "legacy_direct"
	prompt := buildPrompt(compareInput, user, executionMode)

	imageURL := ""
	if input.ImageURL != "" {
		imageURL = input.ImageURL
	} else if input.Base64Image != "" {
		imageURL = normalizeImageURL(input.Base64Image)
	}

	provider, model := s.resolveImageModelConfig(input.ModelName)
	var client LLMClient
	if provider == "doubao" {
		client = s.doubaoClient
	} else if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.doubaoClient
	}

	start := time.Now()
	parsed, err := client.Analyze(ctx, prompt, imageURL)
	if err != nil {
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())

	legacy := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	legacy["analysis_engine"] = "legacy_direct"

	dbFirst := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	dbFirst = s.applyDBFirstNutrition(ctx, dbFirst, input.AdditionalContext)
	dbFirst["analysis_engine"] = "db_first"

	return map[string]any{
		"model_name":            model,
		"legacy_result":         modelResultFrom(legacy, nil, model),
		"db_first_result":       modelResultFrom(dbFirst, nil, model),
		"requested_model_names": []string{model},
		"results": []map[string]any{
			{
				"model_name":      model,
				"legacy_result":   modelResultFrom(legacy, nil, model),
				"db_first_result": modelResultFrom(dbFirst, nil, model),
			},
		},
	}, nil
}

// AnalyzeBatch analyzes multiple images in one model request.
func (s *AnalyzeService) AnalyzeBatch(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	s.normalizeFoodImageInput(&input)
	imageURLs := foodAnalyzeImageURLs(input)
	if len(imageURLs) == 0 {
		return nil, errors.ErrBadRequest
	}
	if err := validateFoodAnalyzeImageLimit(len(imageURLs)); err != nil {
		return nil, err
	}
	input.ImageURL = imageURLs[0]
	input.ImageURLs = imageURLs
	return s.Analyze(ctx, userID, input)
}

func buildAnalyzeResponse(parsed map[string]any, executionMode, provider, model string, durationMs float64) map[string]any {
	parsed = normalizePayload(parsed)
	items := parseItems(parsed)
	optStr := func(v any) *string {
		if v == nil {
			return nil
		}
		s := strings.TrimSpace(fmt.Sprintf("%v", v))
		if s == "" {
			return nil
		}
		return &s
	}

	desc := "无法获取描述"
	if d, ok := parsed["description"].(string); ok && d != "" {
		desc = d
	}
	insight := "保持健康饮食！"
	if i, ok := parsed["insight"].(string); ok && i != "" {
		insight = i
	}

	resp := map[string]any{
		"description":          desc,
		"insight":              insight,
		"items":                items,
		"pfc_ratio_comment":    optStr(parsed["pfc_ratio_comment"]),
		"absorption_notes":     optStr(parsed["absorption_notes"]),
		"context_advice":       optStr(parsed["context_advice"]),
		"analysis_engine":      "db_first",
		"analysis_duration_ms": durationMs,
		"resolved_count":       len(items),
		"unresolved_count":     0,
	}

	if executionMode != validExecutionMode {
		resp["pfc_ratio_comment"] = nil
		resp["absorption_notes"] = nil
		resp["recognitionOutcome"] = nil
		resp["rejectionReason"] = nil
		resp["retakeGuidance"] = nil
		resp["allowedFoodCategory"] = nil
		resp["followupQuestions"] = nil
	} else {
		resp["recognitionOutcome"] = optStr(parsed["recognitionOutcome"])
		resp["rejectionReason"] = optStr(parsed["rejectionReason"])
		resp["retakeGuidance"] = toStringSlice(parsed["retakeGuidance"])
		resp["allowedFoodCategory"] = optStr(parsed["allowedFoodCategory"])
		resp["followupQuestions"] = toStringSlice(parsed["followupQuestions"])
	}

	_ = provider
	return resp
}

func parseItems(parsed map[string]any) []map[string]any {
	var raw []any
	if arr, ok := parsed["items"].([]any); ok {
		raw = arr
	} else if arrMap, ok := parsed["items"].([]map[string]any); ok {
		raw = make([]any, len(arrMap))
		for i, v := range arrMap {
			raw[i] = v
		}
	}
	if raw == nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(raw))
	for _, v := range raw {
		if item, ok := v.(map[string]any); ok {
			next := copyAnyMap(item)
			name := "未知食物"
			if n, ok := item["name"].(string); ok && n != "" {
				name = n
			}
			weight := 0.0
			if w, ok := item["estimatedWeightGrams"].(float64); ok {
				weight = w
			}
			waterMl := numberFromAny(item["waterMl"])
			if waterMl <= 0 {
				waterMl = numberFromAny(item["water_ml"])
			}
			if waterMl < 0 {
				waterMl = 0
			}
			nutrients := map[string]any{
				"calories": 0.0,
				"protein":  0.0,
				"carbs":    0.0,
				"fat":      0.0,
				"fiber":    0.0,
				"sugar":    0.0,
			}
			if n, ok := item["nutrients"].(map[string]any); ok {
				for k := range nutrients {
					if v2, ok := n[k].(float64); ok {
						nutrients[k] = v2
					}
				}
			}
			suggestedRatio := 100.0
			if sr, ok := item["suggestedRatio"].(float64); ok && sr >= 0 && sr <= 100 {
				suggestedRatio = sr
			}
			next["name"] = name
			next["estimatedWeightGrams"] = weight
			next["originalWeightGrams"] = weight
			next["waterMl"] = waterMl
			next["suggestedRatio"] = suggestedRatio
			next["nutrients"] = nutrients
			out = append(out, next)
		}
	}
	return out
}

func toStringSlice(v any) []string {
	if arr, ok := v.([]any); ok {
		out := make([]string, 0, len(arr))
		for _, s := range arr {
			if str, ok := s.(string); ok && str != "" {
				out = append(out, str)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func toItems(v any) []map[string]any {
	if arr, ok := v.([]map[string]any); ok {
		return arr
	}
	if arr, ok := v.([]any); ok {
		out := make([]map[string]any, 0, len(arr))
		for _, a := range arr {
			if m, ok := a.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func modelResultFrom(result map[string]any, err error, modelName string) map[string]any {
	if err != nil {
		return map[string]any{
			"model_name": modelName,
			"success":    false,
			"error":      err.Error(),
		}
	}
	result["model_name"] = modelName
	result["success"] = true
	return result
}

func (s *AnalyzeService) finalizeAnalyzeResponse(ctx context.Context, parsed map[string]any, input AnalyzeInput, executionMode, provider, model string, durationMs float64) (map[string]any, error) {
	resp := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	if strings.EqualFold(input.AnalysisEngine, "legacy_direct") {
		resp["analysis_engine"] = "legacy_direct"
		return s.applySuggestedRatios(ctx, resp, input), nil
	}
	resp = s.applyDBFirstNutrition(ctx, resp, input.AdditionalContext)
	return s.applySuggestedRatios(ctx, resp, input), nil
}

func (s *AnalyzeService) applyDBFirstNutrition(ctx context.Context, resp map[string]any, additionalContext ...string) map[string]any {
	start := time.Now()
	resolveStatus := "success"
	defer func() {
		metrics.ObserveNutritionResolve("db_first", resolveStatus, time.Since(start))
	}()
	resp["analysis_engine"] = "db_first"
	if s.nutrition == nil {
		resolveStatus = "skipped_no_repo"
		return resp
	}
	items := toItems(resp["items"])
	if len(items) == 0 {
		resp["resolved_count"] = 0
		resp["unresolved_count"] = 0
		resolveStatus = "empty"
		return resp
	}

	type lookupItem struct {
		index    int
		item     map[string]any
		name     string
		weight   float64
		resolve  *foodrecordrepo.ResolveResult
		packaged *foodrecordrepo.PackagedResolveResult
	}
	lookups := make([]lookupItem, 0, len(items))
	fallbackCandidates := []UnresolvedNutritionCandidate{}
	resolvedCount := 0
	unresolvedCount := 0
	for index, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		weight := numberFromAny(item["estimatedWeightGrams"])
		if weight <= 0 {
			weight = numberFromAny(item["originalWeightGrams"])
		}
		if markSnackTypeForAnalyzeItem(item) {
			if packagedResolve, packagedErr := s.nutrition.ResolvePackagedFood(ctx, name); packagedErr != nil {
				logger.WithTrace(ctx).Warn("零食营养库查询失败",
					logger.Err(packagedErr),
					slog.String("food_name", name),
				)
			} else if packagedResolve != nil && packagedResolve.Food != nil {
				resolvedCount++
				lookups = append(lookups, lookupItem{index: index, item: item, name: name, weight: weight, resolve: &foodrecordrepo.ResolveResult{Status: packagedResolve.Status, Score: packagedResolve.Score}, packaged: packagedResolve})
				continue
			}
		}
		resolve, err := s.nutrition.ResolveFood(ctx, name)
		if err != nil || resolve == nil || resolve.Food == nil {
			unresolvedCount++
			if weight > 0 {
				fallbackCandidates = append(fallbackCandidates, UnresolvedNutritionCandidate{Index: index, Name: name, EstimatedWeightGrams: weight})
			}
			lookups = append(lookups, lookupItem{index: index, item: item, name: name, weight: weight, resolve: &foodrecordrepo.ResolveResult{Status: "unresolved", Score: 0}})
		} else {
			resolvedCount++
			lookups = append(lookups, lookupItem{index: index, item: item, name: name, weight: weight, resolve: resolve})
		}
	}

	fallbacks := map[int]map[string]any{}
	if len(fallbackCandidates) > 0 {
		contextText := ""
		if len(additionalContext) > 0 {
			contextText = additionalContext[0]
		}
		if rows, err := s.estimateNutritionWithDeepSeek(ctx, fallbackCandidates, contextText); err == nil {
			fallbacks = rows
		} else {
			metrics.AddNutritionResolveItems("db_first", "deepseek_fallback_failed", len(fallbackCandidates))
			logger.WithTrace(ctx).Warn("deepseek nutrition fallback failed",
				logger.Err(err),
				slog.Int("candidate_count", len(fallbackCandidates)),
			)
		}
	}

	out := make([]map[string]any, 0, len(items))
	deepseekGeneratedCount := 0
	deepseekPersistedCount := 0
	deepseekPersistFailedCount := 0
	for _, lookup := range lookups {
		next := copyAnyMap(lookup.item)
		if lookup.packaged != nil && lookup.packaged.Food != nil {
			food := lookup.packaged.Food
			unit := packagedNutritionUnit(food)
			next["type"] = "snack"
			next["matched_food_id"] = food.ID
			next["matched_food_name"] = food.ProductName
			next["resolve_status"] = lookup.packaged.Status
			next["resolve_score"] = lookup.packaged.Score
			next["is_unresolved"] = false
			next["nutrition_source"] = "packaged_food_library"
			next["unit_nutrition_per_100g"] = unit
			next["nutrients"] = scaleNutrition(unit, lookup.weight)
			next["estimatedWeightGrams"] = lookup.weight
			next["originalWeightGrams"] = lookup.weight
			out = append(out, next)
			continue
		}
		resolve := lookup.resolve
		if resolve == nil || resolve.Food == nil {
			_ = s.nutrition.LogUnresolved(ctx, lookup.name)
			unit := zeroUnitNutritionPer100g()
			next["matched_food_id"] = nil
			next["matched_food_name"] = nil
			next["resolve_status"] = "unresolved"
			next["is_unresolved"] = true
			next["resolve_score"] = 0
			next["nutrition_source"] = "unresolved"
			if fallbackUnit, ok := fallbacks[lookup.index]; ok && len(fallbackUnit) > 0 {
				deepseekGeneratedCount++
				unit = fallbackUnit
				next["nutrition_source"] = "deepseek_generated"
				next["nutrition_persisted"] = false
				if foodID, err := s.nutrition.UpsertDeepSeekNutrition(ctx, lookup.name, fallbackUnit, "deepseek_generated"); err != nil {
					deepseekPersistFailedCount++
					logger.WithTrace(ctx).Warn("deepseek nutrition upsert failed",
						logger.Err(err),
						slog.String("food_name", lookup.name),
						slog.Any("unit_nutrition_per_100g", fallbackUnit),
					)
				} else {
					deepseekPersistedCount++
					next["nutrition_persisted"] = true
					next["matched_food_id"] = foodID
					logger.WithTrace(ctx).Info("deepseek nutrition upsert succeeded",
						slog.String("food_name", lookup.name),
						slog.String("food_id", foodID),
						slog.Any("unit_nutrition_per_100g", unit),
					)
				}
			}
			next["unit_nutrition_per_100g"] = unit
			next["nutrients"] = scaleNutrition(unit, lookup.weight)
			next["estimatedWeightGrams"] = lookup.weight
			next["originalWeightGrams"] = lookup.weight
			out = append(out, next)
			continue
		}
		unit := nutritionUnit(resolve.Food)
		next["matched_food_id"] = resolve.Food.ID
		next["matched_food_name"] = resolve.Food.CanonicalName
		next["resolve_status"] = resolve.Status
		next["resolve_score"] = resolve.Score
		next["is_unresolved"] = false
		next["nutrition_source"] = nutritionSource(resolve.Status)
		next["unit_nutrition_per_100g"] = unit
		next["nutrients"] = scaleNutrition(unit, lookup.weight)
		next["estimatedWeightGrams"] = lookup.weight
		next["originalWeightGrams"] = lookup.weight
		_ = resolve.MatchSource
		out = append(out, next)
	}
	resp["items"] = out
	resp["resolved_count"] = resolvedCount
	resp["unresolved_count"] = unresolvedCount
	metrics.AddNutritionResolveItems("db_first", "resolved", resolvedCount)
	metrics.AddNutritionResolveItems("db_first", "unresolved", unresolvedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_generated", deepseekGeneratedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_persisted", deepseekPersistedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_persist_failed", deepseekPersistFailedCount)
	logDBFirstNutritionSummary(ctx, out, resolvedCount, unresolvedCount)
	return resp
}

func (s *AnalyzeService) applySuggestedRatios(ctx context.Context, resp map[string]any, input AnalyzeInput) map[string]any {
	items := toItems(resp["items"])
	if len(items) == 0 {
		resp["suggest_ratio_enabled"] = input.SuggestRatioEnabled
		resp["suggest_ratio_status"] = "no_items"
		return resp
	}
	if !input.SuggestRatioEnabled {
		resp["items"] = withDefaultSuggestedRatios(items, "disabled")
		resp["suggest_ratio_enabled"] = false
		resp["suggest_ratio_status"] = "disabled"
		return resp
	}
	if s.ofoxAIClient == nil {
		resp["items"] = withDefaultSuggestedRatios(items, "unavailable")
		resp["suggest_ratio_enabled"] = true
		resp["suggest_ratio_status"] = "unavailable"
		return resp
	}

	prompt := buildSuggestedRatioPrompt(items, input)
	modelName := "gemini"
	if client, ok := s.ofoxAIClient.(*OfoxAIClient); ok && strings.TrimSpace(client.Model) != "" {
		modelName = client.Model
	}
	callCtx, cancel := context.WithTimeout(ctx, ratioSuggestionTimeout)
	defer cancel()
	parsed, err := analyzeWithJSONParseRetry(callCtx, "suggest_ratio", "gemini", modelName, func(innerCtx context.Context) (map[string]any, error) {
		return s.ofoxAIClient.Analyze(innerCtx, prompt, "")
	})
	if err != nil {
		logger.WithTrace(ctx).Warn("suggested ratio generation failed",
			logger.Err(err),
			slog.Int("item_count", len(items)),
		)
		resp["items"] = withDefaultSuggestedRatios(items, "failed")
		resp["suggest_ratio_enabled"] = true
		resp["suggest_ratio_status"] = "failed"
		return resp
	}

	suggestions := parseSuggestedRatioRows(parsed)
	out := make([]map[string]any, 0, len(items))
	applied := 0
	for index, item := range items {
		next := copyAnyMap(item)
		if row, ok := suggestions[index]; ok {
			next["suggestedRatio"] = row.ratio
			if row.reason != "" {
				next["suggestedRatioReason"] = row.reason
			} else {
				delete(next, "suggestedRatioReason")
			}
			next["suggestedRatioSource"] = "ai"
			applied++
		} else {
			next["suggestedRatio"] = 100.0
			delete(next, "suggestedRatioReason")
			next["suggestedRatioSource"] = "fallback"
		}
		out = append(out, next)
	}
	if applied == 0 {
		out = withDefaultSuggestedRatios(items, "empty")
		resp["suggest_ratio_status"] = "empty"
	} else {
		resp["suggest_ratio_status"] = "applied"
	}
	resp["items"] = out
	resp["suggest_ratio_enabled"] = true
	resp["suggest_ratio_applied_count"] = applied
	return resp
}

type suggestedRatioRow struct {
	ratio  float64
	reason string
}

func withDefaultSuggestedRatios(items []map[string]any, source string) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		next := copyAnyMap(item)
		next["suggestedRatio"] = 100.0
		next["suggestedRatioSource"] = source
		delete(next, "suggestedRatioReason")
		out = append(out, next)
	}
	return out
}

func parseSuggestedRatioRows(parsed map[string]any) map[int]suggestedRatioRow {
	out := map[int]suggestedRatioRow{}
	rawItems, ok := parsed["items"].([]any)
	if !ok {
		return out
	}
	for _, raw := range rawItems {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if _, exists := row["index"]; !exists {
			continue
		}
		index := int(numberFromAny(row["index"]))
		if index < 0 {
			continue
		}
		if _, exists := row["suggestedRatio"]; !exists {
			continue
		}
		rawRatio := numberFromAny(row["suggestedRatio"])
		if rawRatio < 0 || rawRatio > 100 {
			continue
		}
		reason := strings.TrimSpace(fmt.Sprintf("%v", row["reason"]))
		if reason == "<nil>" {
			reason = ""
		}
		out[index] = suggestedRatioRow{
			ratio:  math.Round(rawRatio),
			reason: truncateSuggestedRatioReason(reason),
		}
	}
	return out
}

func truncateSuggestedRatioReason(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= 36 {
		return string(runes)
	}
	return string(runes[:36])
}

func buildSuggestedRatioPrompt(items []map[string]any, input AnalyzeInput) string {
	payloadItems := make([]map[string]any, 0, len(items))
	totalCalories := 0.0
	totalProtein := 0.0
	totalCarbs := 0.0
	totalFat := 0.0
	for index, item := range items {
		nutrients := map[string]any{}
		if raw, ok := item["nutrients"].(map[string]any); ok {
			nutrients = raw
		}
		calories := numberFromAny(nutrients["calories"])
		protein := numberFromAny(nutrients["protein"])
		carbs := numberFromAny(nutrients["carbs"])
		fat := numberFromAny(nutrients["fat"])
		totalCalories += calories
		totalProtein += protein
		totalCarbs += carbs
		totalFat += fat
		payloadItems = append(payloadItems, map[string]any{
			"index":                index,
			"name":                 strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			"estimatedWeightGrams": round2(numberFromAny(item["estimatedWeightGrams"])),
			"nutrients": map[string]any{
				"calories": round2(calories),
				"protein":  round2(protein),
				"carbs":    round2(carbs),
				"fat":      round2(fat),
				"fiber":    round2(numberFromAny(nutrients["fiber"])),
				"sugar":    round2(numberFromAny(nutrients["sugar"])),
			},
			"nutritionSource": item["nutrition_source"],
		})
	}

	contextPayload := map[string]any{
		"task": "为本餐每个食物生成实际摄入比例。这个比例会直接作为结果页滑块初始值。",
		"rules": []string{
			"只返回 JSON，不要输出解释性正文。",
			"suggestedRatio 必须是 0 到 100 的整数；无法判断时填 100。",
			"不要平均削减所有食物。优先保留蛋白质、蔬菜和低能量密度食物；需要控制时优先降低高油、高糖、高热量密度、过量主食或甜饮甜点。",
			"如果 remainingCalories 缺失或本餐总热量并不明显超出目标，建议应保守，通常保持 100。",
			"如果用户目标是减脂且剩余热量不足，应让总摄入更接近预算；如果是增肌且热量充足，可更多保持 100。",
			"reason 用 20 个中文字以内说明，不确定或保持 100 时可以为空。",
		},
		"context": map[string]any{
			"mealType":          input.MealType,
			"userGoal":          input.UserGoal,
			"dietGoal":          input.DietGoal,
			"activityTiming":    input.ActivityTiming,
			"remainingCalories": input.RemainingCalories,
			"additionalContext": strings.TrimSpace(input.AdditionalContext),
			"currentMealTotals": map[string]any{
				"calories": round2(totalCalories),
				"protein":  round2(totalProtein),
				"carbs":    round2(totalCarbs),
				"fat":      round2(totalFat),
			},
		},
		"items": payloadItems,
		"responseSchema": map[string]any{
			"items": []map[string]any{{
				"index":          0,
				"suggestedRatio": 100,
				"reason":         "",
			}},
		},
	}
	bytes, _ := json.Marshal(contextPayload)
	return "你是健康饮食决策助手。请根据用户上下文和本餐最终营养数据，给出每个食物的实际摄入比例建议。\n" + string(bytes)
}

func (s *AnalyzeService) estimateNutritionWithDeepSeek(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
		return nil, fmt.Errorf("deepseek nutrition fallback client is not configured")
	}
	return s.deepseek.Estimate(ctx, candidates, additionalContext)
}

func logDBFirstNutritionSummary(ctx context.Context, items []map[string]any, resolvedCount, unresolvedCount int) {
	total := resolvedCount + unresolvedCount
	hitRate := 0.0
	if total > 0 {
		hitRate = math.Round((float64(resolvedCount)/float64(total))*10000) / 100
	}
	fields := []slog.Attr{
		slog.Int("total", total),
		slog.Int("resolved", resolvedCount),
		slog.Int("unresolved", unresolvedCount),
		slog.Float64("hit_rate_percent", hitRate),
	}
	itemFields := make([]map[string]any, 0, len(items))
	for _, item := range items {
		itemFields = append(itemFields, map[string]any{
			"name":              strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			"weight_g":          numberFromAny(item["estimatedWeightGrams"]),
			"matched_food_name": item["matched_food_name"],
			"resolve_status":    item["resolve_status"],
			"resolve_score":     item["resolve_score"],
			"nutrition_source":  item["nutrition_source"],
			"is_unresolved":     item["is_unresolved"],
		})
	}
	fields = append(fields, slog.Any("items", itemFields))
	logger.WithTrace(ctx).Info("db_first nutrition lookup summary", fields...)
	apm.AddEvent(ctx, "db_first nutrition lookup summary",
		attribute.Int("nutrition.total", total),
		attribute.Int("nutrition.resolved", resolvedCount),
		attribute.Int("nutrition.unresolved", unresolvedCount),
		attribute.Float64("nutrition.hit_rate_percent", hitRate),
		attribute.String("nutrition.items", summarizeTraceLookupItems(items, 8)),
	)
}

func summarizeTraceLookupItems(items []map[string]any, limit int) string {
	if limit <= 0 || len(items) == 0 {
		return ""
	}
	parts := make([]string, 0, limit)
	for _, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" {
			name = "unknown"
		}
		status := strings.TrimSpace(fmt.Sprintf("%v", item["resolve_status"]))
		source := strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source"]))
		if status == "" {
			status = "unknown"
		}
		if source == "" {
			source = "unknown"
		}
		parts = append(parts, fmt.Sprintf("%s:%s:%s", name, status, source))
		if len(parts) >= limit {
			break
		}
	}
	if len(items) > limit {
		parts = append(parts, fmt.Sprintf("more=%d", len(items)-limit))
	}
	return strings.Join(parts, "|")
}

func copyAnyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func numberFromAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	default:
		return 0
	}
}

func nutritionUnit(food *foodrecorddomain.FoodNutrition) map[string]any {
	return map[string]any{
		"calories":       food.KcalPer100g,
		"protein":        food.ProteinPer100g,
		"carbs":          food.CarbsPer100g,
		"fat":            food.FatPer100g,
		"fiber":          food.FiberPer100g,
		"sugar":          food.SugarPer100g,
		"saturatedFat":   food.SaturatedFatPer100g,
		"cholesterolMg":  food.CholesterolMgPer100g,
		"sodiumMg":       food.SodiumMgPer100g,
		"potassiumMg":    food.PotassiumMgPer100g,
		"calciumMg":      food.CalciumMgPer100g,
		"ironMg":         food.IronMgPer100g,
		"magnesiumMg":    food.MagnesiumMgPer100g,
		"zincMg":         food.ZincMgPer100g,
		"vitaminARaeMcg": food.VitaminARaeMcgPer100g,
		"vitaminCMg":     food.VitaminCMgPer100g,
		"vitaminDMcg":    food.VitaminDMcgPer100g,
		"vitaminEMg":     food.VitaminEMgPer100g,
		"vitaminKMcg":    food.VitaminKMcgPer100g,
		"thiaminMg":      food.ThiaminMgPer100g,
		"riboflavinMg":   food.RiboflavinMgPer100g,
		"niacinMg":       food.NiacinMgPer100g,
		"vitaminB6Mg":    food.VitaminB6MgPer100g,
		"folateMcg":      food.FolateMcgPer100g,
		"vitaminB12Mcg":  food.VitaminB12McgPer100g,
	}
}

func packagedNutritionUnit(food *foodrecorddomain.PackagedFood) map[string]any {
	return map[string]any{
		"calories":       food.KcalPer100g,
		"protein":        food.ProteinPer100g,
		"carbs":          food.CarbsPer100g,
		"fat":            food.FatPer100g,
		"fiber":          food.FiberPer100g,
		"sugar":          food.SugarPer100g,
		"saturatedFat":   food.SaturatedFatPer100g,
		"cholesterolMg":  food.CholesterolMgPer100g,
		"sodiumMg":       food.SodiumMgPer100g,
		"potassiumMg":    food.PotassiumMgPer100g,
		"calciumMg":      food.CalciumMgPer100g,
		"ironMg":         food.IronMgPer100g,
		"magnesiumMg":    food.MagnesiumMgPer100g,
		"zincMg":         food.ZincMgPer100g,
		"vitaminARaeMcg": food.VitaminARaeMcgPer100g,
		"vitaminCMg":     food.VitaminCMgPer100g,
		"vitaminDMcg":    food.VitaminDMcgPer100g,
		"vitaminEMg":     food.VitaminEMgPer100g,
		"vitaminKMcg":    food.VitaminKMcgPer100g,
		"thiaminMg":      food.ThiaminMgPer100g,
		"riboflavinMg":   food.RiboflavinMgPer100g,
		"niacinMg":       food.NiacinMgPer100g,
		"vitaminB6Mg":    food.VitaminB6MgPer100g,
		"folateMcg":      food.FolateMcgPer100g,
		"vitaminB12Mcg":  food.VitaminB12McgPer100g,
	}
}

func markSnackTypeForAnalyzeItem(item map[string]any) bool {
	itemType := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["type"], item["food_type"]))))
	if itemType == "snack" || strings.Contains(itemType, "packaged") || strings.Contains(itemType, "package") {
		item["type"] = "snack"
		return true
	}
	text := strings.ToLower(strings.Join([]string{
		fmt.Sprintf("%v", item["name"]),
		fmt.Sprintf("%v", item["category"]),
		fmt.Sprintf("%v", item["recognitionEvidence"]),
		fmt.Sprintf("%v", item["ocrText"]),
		fmt.Sprintf("%v", item["alternativeNames"]),
	}, " "))
	for _, keyword := range snackAnalyzeKeywords {
		if strings.Contains(text, keyword) {
			item["type"] = "snack"
			return true
		}
	}
	return false
}

var snackAnalyzeKeywords = []string{
	"snack",
	"packaged",
	"package",
	"nutrition facts",
	"营养成分",
	"净含量",
	"零食",
	"预包装",
	"袋装",
	"盒装",
	"饼干",
	"薯片",
	"巧克力",
	"糖果",
	"坚果",
	"果干",
	"肉干",
	"牛肉干",
	"蛋白棒",
	"能量棒",
	"辣条",
	"海苔",
	"话梅",
	"果冻",
	"威化",
	"沙琪玛",
	"麻薯",
	"阿胶糕",
	"糕点",
}

func scaleNutrition(unit map[string]any, weight float64) map[string]any {
	factor := weight / 100.0
	out := map[string]any{}
	for key, value := range unit {
		out[key] = math.Round(numberFromAny(value)*factor*100) / 100
	}
	return out
}

func nutritionSource(status string) string {
	switch status {
	case "exact_alias":
		return "library_exact_alias"
	case "exact_canonical":
		return "library_exact_canonical"
	case "fuzzy":
		return "library_fuzzy"
	default:
		return "unresolved"
	}
}

func mergeBatchResults(results []map[string]any, executionMode string) map[string]any {
	allItems := []map[string]any{}
	descriptions := []string{}
	insights := []string{}
	pfcComments := []string{}
	absorptionList := []string{}
	contextList := []string{}
	recognitionOutcomes := []string{}
	rejectionReasons := []string{}
	allowedCategories := []string{}
	retakeGuidanceLists := [][]string{}
	followupQuestionLists := [][]string{}

	for _, parsed := range results {
		parsed = normalizePayload(parsed)
		items := parseItems(parsed)
		allItems = append(allItems, items...)

		if desc, ok := parsed["description"].(string); ok && desc != "" && desc != "无法获取描述" {
			descriptions = append(descriptions, desc)
		}
		if insight, ok := parsed["insight"].(string); ok && insight != "" && insight != "保持健康饮食！" {
			insights = append(insights, insight)
		}
		if pfc, ok := parsed["pfc_ratio_comment"].(string); ok && pfc != "" {
			pfcComments = append(pfcComments, pfc)
		}
		if absorption, ok := parsed["absorption_notes"].(string); ok && absorption != "" {
			absorptionList = append(absorptionList, absorption)
		}
		if context, ok := parsed["context_advice"].(string); ok && context != "" {
			contextList = append(contextList, context)
		}
		if recognition, ok := parsed["recognitionOutcome"].(string); ok && recognition != "" {
			recognitionOutcomes = append(recognitionOutcomes, recognition)
		}
		if rejection, ok := parsed["rejectionReason"].(string); ok && rejection != "" {
			rejectionReasons = append(rejectionReasons, rejection)
		}
		if allowed, ok := parsed["allowedFoodCategory"].(string); ok && allowed != "" {
			allowedCategories = append(allowedCategories, allowed)
		}
		if rg, ok := parsed["retakeGuidance"].([]string); ok && len(rg) > 0 {
			retakeGuidanceLists = append(retakeGuidanceLists, rg)
		}
		if fq, ok := parsed["followupQuestions"].([]string); ok && len(fq) > 0 {
			followupQuestionLists = append(followupQuestionLists, fq)
		}
	}

	mergedItems := []map[string]any{}
	for _, item := range allItems {
		nutrients := map[string]any{
			"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "fiber": 0.0, "sugar": 0.0,
		}
		if n, ok := item["nutrients"].(map[string]any); ok {
			for k := range nutrients {
				if v, ok2 := n[k].(float64); ok2 {
					nutrients[k] = v
				}
			}
		}
		mergedItems = append(mergedItems, map[string]any{
			"name":                 item["name"],
			"estimatedWeightGrams": item["estimatedWeightGrams"],
			"originalWeightGrams":  item["estimatedWeightGrams"],
			"waterMl":              numberFromAny(item["waterMl"]),
			"suggestedRatio":       100.0,
			"nutrients":            nutrients,
		})
	}

	desc := fmt.Sprintf("本餐共识别 %d 张图片，包含 %d 种食物。", len(results), len(mergedItems))
	if len(descriptions) > 0 {
		desc += " " + descriptions[0]
	}
	insight := "保持健康饮食！"
	if len(insights) > 0 {
		insight = strings.Join(insights, " ")
	}

	merged := map[string]any{
		"description":         desc,
		"insight":             insight,
		"items":               mergedItems,
		"pfc_ratio_comment":   nil,
		"absorption_notes":    nil,
		"context_advice":      nil,
		"recognitionOutcome":  nil,
		"rejectionReason":     nil,
		"retakeGuidance":      nil,
		"allowedFoodCategory": nil,
		"followupQuestions":   nil,
	}

	if len(pfcComments) > 0 {
		merged["pfc_ratio_comment"] = pfcComments[0]
	}
	if len(absorptionList) > 0 {
		merged["absorption_notes"] = absorptionList[0]
	}
	if len(contextList) > 0 {
		merged["context_advice"] = strings.Join(contextList, " ")
	}
	if len(rejectionReasons) > 0 {
		merged["rejectionReason"] = rejectionReasons[0]
	}

	// recognitionOutcome logic
	if len(recognitionOutcomes) > 0 {
		outcome := recognitionOutcomes[0]
		for _, o := range recognitionOutcomes {
			if o == "hard_reject" {
				outcome = "hard_reject"
				break
			} else if o == "soft_reject" && outcome != "hard_reject" {
				outcome = "soft_reject"
			}
		}
		merged["recognitionOutcome"] = outcome
	}

	// allowedFoodCategory
	uniqueCategories := []string{}
	seen := map[string]bool{}
	for _, c := range allowedCategories {
		if !seen[c] {
			seen[c] = true
			uniqueCategories = append(uniqueCategories, c)
		}
	}
	if len(uniqueCategories) == 1 {
		merged["allowedFoodCategory"] = uniqueCategories[0]
	} else if len(uniqueCategories) > 1 {
		merged["allowedFoodCategory"] = "unknown"
	}

	// merge unique text lists
	merged["retakeGuidance"] = mergeUniqueTextLists(retakeGuidanceLists...)
	merged["followupQuestions"] = mergeUniqueTextLists(followupQuestionLists...)

	if executionMode != validExecutionMode {
		merged["pfc_ratio_comment"] = nil
		merged["absorption_notes"] = nil
		merged["recognitionOutcome"] = nil
		merged["rejectionReason"] = nil
		merged["retakeGuidance"] = nil
		merged["allowedFoodCategory"] = nil
		merged["followupQuestions"] = nil
	}

	return merged
}

func mergeUniqueTextLists(lists ...[]string) []string {
	seen := map[string]bool{}
	merged := []string{}
	for _, list := range lists {
		for _, item := range list {
			if item == "" || seen[item] {
				continue
			}
			seen[item] = true
			merged = append(merged, item)
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}
