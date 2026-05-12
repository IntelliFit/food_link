package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

const (
	defaultExecutionMode   = "standard"
	validExecutionMode     = "strict"
	visionPrimaryTimeout   = 45 * time.Second
	maxLLMJSONParseRetries = 3
)

type AnalyzeService struct {
	dashScopeClient LLMClient
	ofoxAIClient    LLMClient
	imageProvider   string
	users           *authrepo.UserRepo
	nutrition       *foodrecordrepo.FoodNutritionRepo
	deepseek        *DeepSeekNutritionEstimator
	storage         *storage.Client
}

func NewAnalyzeService(dashScopeClient, ofoxAIClient LLMClient, users *authrepo.UserRepo, nutrition ...*foodrecordrepo.FoodNutritionRepo) *AnalyzeService {
	var nutritionRepo *foodrecordrepo.FoodNutritionRepo
	if len(nutrition) > 0 {
		nutritionRepo = nutrition[0]
	}
	return &AnalyzeService{
		dashScopeClient: dashScopeClient,
		ofoxAIClient:    ofoxAIClient,
		users:           users,
		nutrition:       nutritionRepo,
	}
}

func (s *AnalyzeService) ConfigureImageProvider(provider string) {
	s.imageProvider = normalizeImageProviderPreference(provider)
}

func (s *AnalyzeService) ConfigureDeepSeekFallback(apiKey string) {
	s.deepseek = NewDeepSeekNutritionEstimator(apiKey, "", "")
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
	sourceType = strings.TrimSpace(sourceType)
	timeout := 60 * time.Second
	if sourceType == "image" {
		timeout = 90 * time.Second
	}
	provider, _ := resolveModelConfig(modelName)
	if sourceType == "image" {
		provider, _ = s.resolveImageModelConfig(modelName)
	} else if strings.TrimSpace(modelName) == "" {
		provider = "qwen"
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
	case "qwen":
		client = s.dashScopeClient
	case "gemini":
		client = s.ofoxAIClient
	default:
		client = s.dashScopeClient
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
	if err != nil && provider == "gemini" && len(imageURLs) > 0 && isTransientLLMError(err) && s.dashScopeClient != nil {
		fallbackParsed, fallbackErr := analyzeWithJSONParseRetry(callCtx, "precision_fallback", "qwen", "qwen-vl-max", func(retryCtx context.Context) (map[string]any, error) {
			return analyzeWithImagesTemperature(retryCtx, s.dashScopeClient, prompt, imageURLs, temperature)
		})
		if fallbackErr == nil {
			logger.WithTrace(ctx).Warn("precision gemini vision transient error fallback to dashscope",
				zap.Error(err),
				zap.Int("image_count", len(imageURLs)),
			)
			apm.AddEvent(ctx, "precision llm fallback completed",
				attribute.String("analysis.primary_provider", provider),
				attribute.String("analysis.fallback_provider", "qwen"),
				attribute.Int("analysis.image_count", len(imageURLs)),
				apm.DurationMS("analysis.duration_ms", time.Since(start)),
			)
			return fallbackParsed, nil
		}
		logger.WithTrace(ctx).Warn("precision dashscope fallback failed",
			zap.Error(fallbackErr),
			zap.Error(err),
			zap.Int("image_count", len(imageURLs)),
		)
		apm.RecordError(ctx, fallbackErr,
			attribute.String("analysis.stage", "fallback"),
			attribute.String("analysis.fallback_provider", "qwen"),
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
		"ofoxai api error 408",
		"ofoxai api error 429",
		"ofoxai api error 500",
		"ofoxai api error 502",
		"ofoxai api error 503",
		"ofoxai api error 504",
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
	for retry := 0; ; retry++ {
		parsed, err = call(ctx)
		if err == nil || !IsLLMJSONParseError(err) || retry >= maxLLMJSONParseRetries {
			return parsed, err
		}
		retryNumber := retry + 1
		apm.AddEvent(ctx, "llm json parse retry",
			attribute.String("analysis.stage", stage),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			attribute.Int("analysis.retry_number", retryNumber),
			attribute.Int("analysis.max_retries", maxLLMJSONParseRetries),
		)
		logger.WithTrace(ctx).Warn("llm returned invalid json; retrying same task",
			zap.String("stage", stage),
			zap.String("provider", provider),
			zap.String("model", model),
			zap.Int("retry_number", retryNumber),
			zap.Int("max_retries", maxLLMJSONParseRetries),
			zap.Error(err),
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
	if *mode == validExecutionMode {
		return *mode
	}
	return defaultExecutionMode
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
输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- context_advice 1-2句，<= 32字，无需则空字符串
- 建议写得自然一点，但不要空泛和重复
- 只返回 JSON

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
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
		remainHint = fmt.Sprintf("\n用户当日剩余热量预算约 %g kcal，可在 context_advice 中提示本餐占比或下一餐建议。", *input.RemainingCalories)
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
2. 估算每种食物的重量（克）和详细营养成分。
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
- 不输出餐具、包装、桌面、骨头、壳、果核、签子等不可食或非食物部分
- 相同食物合并为一项，明显不同食物分开
- 食物名称使用简体中文，尽量具体、标准、常见，方便命中营养库
- 混合菜无法可靠拆分时，作为一道常见菜名输出，不要猜测不可见成分

重量规则：
- estimatedWeightGrams 必须是数字，单位克，不要输出范围或单位字符串
- 综合可见面积、厚度、高度、容器、餐具、手掌、包装等参照物估算
- 只估算可见可食部分，不把餐具、包装、骨头、壳、果核计入重量
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；固体食物按常见含水率保守估算，无法判断时填 0
- 饮品、汤、粥、奶、茶、咖啡等液体或半流体应估算 waterMl；干货、油炸物、酱料难判断时可填 0

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
  "items":[{"name":"","estimatedWeightGrams":0,"waterMl":0}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "absorption_notes":"",
  "context_advice":""
	}`, tagBlock, imageInputHint, additionalLine, correctionBlock)
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
- 重量可基于常见份量估算
- description <= 24字
- insight/context_advice 各 1-2 句，<= 40字

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
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
  "items":[{"name":"","estimatedWeightGrams":0,"waterMl":0}],
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
		return "qwen", "qwen-vl-max"
	}
	if normalized == "qwen" || normalized == "qwen-vl" || normalized == "qwen-vl-max" {
		return "qwen", "qwen-vl-max"
	}
	if normalized == "deepseek" || normalized == "deepseek-v4-flash" {
		return "deepseek", "deepseek-v4-flash"
	}
	if strings.HasPrefix(normalized, "deepseek") {
		return "deepseek", raw
	}
	if normalized == "gemini" || normalized == "gemini-flash" || normalized == "gemini-vision" ||
		normalized == "gemini-3-flash-preview" || normalized == "google/gemini-3-flash-preview" {
		return "qwen", "qwen-vl-max"
	}
	if normalized == "ofox-gemini" || normalized == "ofox-gemini-3-flash-preview" {
		return "gemini", "gemini-3-flash-preview"
	}
	if strings.HasPrefix(normalized, "ofox-gemini:") {
		return "gemini", strings.TrimSpace(strings.TrimPrefix(raw, "ofox-gemini:"))
	}
	return "qwen", "qwen-vl-max"
}

func normalizeImageProviderPreference(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "qwen", "dashscope", "qwen-vl", "qwen-vl-max":
		return "qwen"
	case "gemini", "ofox", "ofoxai", "ofox-gemini":
		return "gemini"
	default:
		return ""
	}
}

func shouldUseImageProviderPreference(modelName string) bool {
	raw := strings.TrimSpace(modelName)
	if raw == "" {
		return true
	}
	normalized := strings.ToLower(raw)
	switch normalized {
	case "gemini", "gemini-flash", "gemini-vision", "gemini-3-flash-preview", "google/gemini-3-flash-preview":
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
		case "qwen":
			return "qwen", "qwen-vl-max"
		}
	}
	return resolveModelConfig(modelName)
}

// Analyze performs single-image or text analysis synchronously.
func (s *AnalyzeService) Analyze(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	s.normalizeFoodImageInput(&input)
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)

	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}

	prompt := buildPrompt(input, user, executionMode)

	provider, model := s.resolveImageModelConfig(input.ModelName)
	var client LLMClient
	switch provider {
	case "qwen":
		client = s.dashScopeClient
	case "gemini":
		client = s.ofoxAIClient
	case "deepseek":
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("图片识别使用 DeepSeek 时，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
	default:
		client = s.dashScopeClient
	}
	if client == nil {
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
		zap.String("user_id", userID),
		zap.String("provider", provider),
		zap.String("model", model),
		zap.String("requested_model", strings.TrimSpace(input.ModelName)),
		zap.String("execution_mode", executionMode),
		zap.String("analysis_engine", strings.TrimSpace(input.AnalysisEngine)),
		zap.Int("image_count", imageCount),
		zap.Bool("has_base64_image", strings.TrimSpace(input.Base64Image) != ""),
	)
	parsed, err := analyzeWithJSONParseRetry(ctx, "food_image", provider, model, func(callCtx context.Context) (map[string]any, error) {
		attemptCtx := callCtx
		attemptCancel := func() {}
		if provider == "gemini" && len(imageURLs) > 0 {
			attemptCtx, attemptCancel = context.WithTimeout(callCtx, visionPrimaryTimeout)
		}
		defer attemptCancel()
		return analyzeWithImagesTemperature(attemptCtx, client, prompt, imageURLs, 0.3)
	})
	fallbackUsed := false
	if err != nil && provider == "gemini" && isTransientLLMError(err) && s.dashScopeClient != nil {
		fallbackParsed, fallbackErr := analyzeWithJSONParseRetry(ctx, "food_image_fallback", "qwen", "qwen-vl-max", func(retryCtx context.Context) (map[string]any, error) {
			return analyzeWithImagesTemperature(retryCtx, s.dashScopeClient, prompt, imageURLs, 0.3)
		})
		if fallbackErr == nil {
			logger.WithTrace(ctx).Warn("gemini vision transient error fallback to dashscope",
				zap.Error(err),
			)
			apm.AddEvent(ctx, "food image analyze llm fallback completed",
				attribute.String("analysis.primary_provider", primaryProvider),
				attribute.String("analysis.primary_model", primaryModel),
				attribute.String("analysis.fallback_provider", "qwen"),
				attribute.String("analysis.fallback_model", "qwen-vl-max"),
				apm.DurationMS("analysis.duration_ms", time.Since(start)),
			)
			parsed = fallbackParsed
			err = nil
			provider = "qwen"
			model = "qwen-vl-max"
			fallbackUsed = true
		} else {
			logger.WithTrace(ctx).Warn("dashscope fallback failed",
				zap.Error(fallbackErr),
				zap.Error(err),
			)
			apm.RecordError(ctx, fallbackErr,
				attribute.String("analysis.stage", "fallback"),
				attribute.String("analysis.fallback_provider", "qwen"),
			)
		}
	}
	if err != nil {
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
			zap.String("user_id", userID),
			zap.String("provider", provider),
			zap.String("model", model),
			zap.String("primary_provider", primaryProvider),
			zap.String("primary_model", primaryModel),
			zap.String("requested_model", strings.TrimSpace(input.ModelName)),
			zap.Int("image_count", imageCount),
			zap.Duration("duration", time.Since(start)),
			zap.Error(err),
		)
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())
	apm.SetAttributes(ctx,
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.Bool("analysis.fallback_used", fallbackUsed),
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
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	logger.WithTrace(ctx).Info("food image analyze llm completed",
		zap.String("user_id", userID),
		zap.String("provider", provider),
		zap.String("model", model),
		zap.String("primary_provider", primaryProvider),
		zap.String("primary_model", primaryModel),
		zap.String("requested_model", strings.TrimSpace(input.ModelName)),
		zap.Int("image_count", imageCount),
		zap.Bool("fallback_used", fallbackUsed),
		zap.Duration("duration", time.Since(start)),
	)

	result, err := s.finalizeAnalyzeResponse(ctx, parsed, input, executionMode, provider, model, durationMs)
	if err != nil {
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "finalize"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		logger.WithTrace(ctx).Warn("food image analyze finalize failed",
			zap.String("user_id", userID),
			zap.String("provider", provider),
			zap.String("model", model),
			zap.Duration("duration", time.Since(start)),
			zap.Error(err),
		)
		return nil, err
	}
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
		zap.String("user_id", userID),
		zap.String("provider", provider),
		zap.String("model", model),
		zap.String("analysis_engine", stringFromAny(result["analysis_engine"])),
		zap.Int("item_count", len(toItems(result["items"]))),
		zap.Int("resolved_count", intFromAny(result["resolved_count"])),
		zap.Int("unresolved_count", intFromAny(result["unresolved_count"])),
		zap.Duration("duration", time.Since(start)),
	)
	return result, nil
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
	} else if provider == "qwen" {
		client = s.dashScopeClient
	} else if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
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
	return result, nil
}

// AnalyzeCompare calls both Qwen and Gemini in parallel.
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
	var qwenRes, geminiRes map[string]any
	var qwenErr, geminiErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		start := time.Now()
		parsed, err := s.dashScopeClient.Analyze(ctx, prompt, imageURL)
		if err != nil {
			qwenErr = err
			return
		}
		qwenRes = buildAnalyzeResponse(parsed, executionMode, "qwen", "qwen-vl-max", float64(time.Since(start).Milliseconds()))
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

	qwenResult := modelResultFrom(qwenRes, qwenErr, "qwen-vl-max")
	geminiResult := modelResultFrom(geminiRes, geminiErr, "gemini-3-flash-preview")

	return map[string]any{
		"qwen_result":   qwenResult,
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
	if provider == "qwen" {
		client = s.dashScopeClient
	} else if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
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
			out = append(out, map[string]any{
				"name":                 name,
				"estimatedWeightGrams": weight,
				"originalWeightGrams":  weight,
				"waterMl":              waterMl,
				"nutrients":            nutrients,
			})
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
		return resp, nil
	}
	return s.applyDBFirstNutrition(ctx, resp, input.AdditionalContext), nil
}

func (s *AnalyzeService) applyDBFirstNutrition(ctx context.Context, resp map[string]any, additionalContext ...string) map[string]any {
	resp["analysis_engine"] = "db_first"
	if s.nutrition == nil {
		return resp
	}
	items := toItems(resp["items"])
	if len(items) == 0 {
		resp["resolved_count"] = 0
		resp["unresolved_count"] = 0
		return resp
	}

	type lookupItem struct {
		index   int
		item    map[string]any
		name    string
		weight  float64
		resolve *foodrecordrepo.ResolveResult
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
	if s.deepseek != nil && len(fallbackCandidates) > 0 {
		contextText := ""
		if len(additionalContext) > 0 {
			contextText = additionalContext[0]
		}
		if rows, err := s.deepseek.Estimate(ctx, fallbackCandidates, contextText); err == nil {
			fallbacks = rows
		}
	}

	out := make([]map[string]any, 0, len(items))
	for _, lookup := range lookups {
		next := copyAnyMap(lookup.item)
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
				unit = fallbackUnit
				next["nutrition_source"] = "deepseek_text_fallback"
				_, _ = s.nutrition.UpsertDeepSeekNutrition(ctx, lookup.name, unit)
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
	logDBFirstNutritionSummary(ctx, out, resolvedCount, unresolvedCount)
	return resp
}

func logDBFirstNutritionSummary(ctx context.Context, items []map[string]any, resolvedCount, unresolvedCount int) {
	total := resolvedCount + unresolvedCount
	hitRate := 0.0
	if total > 0 {
		hitRate = math.Round((float64(resolvedCount)/float64(total))*10000) / 100
	}
	fields := []zap.Field{
		zap.Int("total", total),
		zap.Int("resolved", resolvedCount),
		zap.Int("unresolved", unresolvedCount),
		zap.Float64("hit_rate_percent", hitRate),
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
	fields = append(fields, zap.Any("items", itemFields))
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
