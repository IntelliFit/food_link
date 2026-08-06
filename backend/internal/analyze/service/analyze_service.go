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
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

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
	defaultExecutionMode            = "standard"
	standardWebSearchMode           = "standard_web_search"
	standardPackagedExperimentMode  = "standard_packaged_experiment"
	fastExecutionMode               = "fast"
	fastWebSearchMode               = "fast_web_search"
	liteExecutionMode               = "lite"
	precisionExecutionMode          = "strict"
	precisionSeparateExecutionMode  = "strict_separate"
	precisionWebSearchMode          = "strict_web_search"
	validExecutionMode              = "experimental"
	gemini35FlashExecutionMode      = "gemini35_flash"
	gemini35GroupedExecutionMode    = "gemini35_flash_grouped"
	gemini3FlashModel               = "gemini-3-flash-preview"
	gemini31FlashLiteModel          = "gemini-3.1-flash-lite"
	gemini35FlashModel              = "gemini-3.5-flash"
	qwen36FlashModel                = "qwen3.6-flash"
	visionPrimaryTimeout            = 45 * time.Second
	visionFallbackTimeout           = 12 * time.Second
	maxLLMJSONParseRetries          = 3
	maxLLMTransientRetries          = 2
	realtimeVisionJSONRetries       = 1
	realtimeVisionTransientRetries  = 1
	ratioSuggestionTimeout          = 8 * time.Second
	ediblePortionTimeout            = 8 * time.Second
	nutritionFallbackAttemptTimeout = 35 * time.Second
	fastNutritionFallbackTimeout    = 25 * time.Second
	fastVisionAnalysisTimeout       = 25 * time.Second
	fastPostprocessTimeout          = 30 * time.Second
	standardHybridTimeout           = 60 * time.Second
	webSearchTimeout                = 6 * time.Second
	webSearchMaxQueries             = 3
	webSearchMaxResults             = 3
	webSearchMinRelevantResults     = 1
	resolveFoodCandidateLimit       = 5
	resolveFoodCandidateRRFK        = 60.0
	resolveFoodSemanticThreshold    = 0.97
	resolveFoodSemanticTimeout      = 6 * time.Second
	resolveFoodEmbeddingTimeout     = 4 * time.Second
	kilojoulesPerKilocalorie        = 4.184
)

const packagedFoodResolveEnabled = true

type AnalyzeService struct {
	ofoxAIClient          LLMClient
	gemini31LiteClient    LLMClient
	gemini35Client        LLMClient
	doubaoClient          LLMClient
	dashscopeClient       LLMClient
	doubaoWebSearchClient interface {
		AnalyzeWithImagesWebSearch(context.Context, string, []string, DoubaoWebSearchOptions) (map[string]any, map[string]any, error)
	}
	imageProvider     string
	users             *authrepo.UserRepo
	nutrition         NutritionResolver
	nutritionSemantic NutritionSemanticRetriever
	deepseek          *DeepSeekNutritionEstimator
	nutritionAI       nutritionFallbackEstimator
	storage           *storage.Client
	webSearcher       WebSearcher
}

type NutritionResolver interface {
	ResolvePackagedFood(context.Context, foodrecordrepo.PackagedFoodResolveInput) (*foodrecordrepo.PackagedResolveResult, error)
	SearchPackagedFood(context.Context, string, int) ([]foodrecorddomain.PackagedFood, error)
	ResolveFood(context.Context, string) (*foodrecordrepo.ResolveResult, error)
	SearchCandidates(context.Context, string, int) ([]foodrecordrepo.SearchCandidate, error)
	EnsureNutritionAlias(context.Context, string, string) error
	LogUnresolved(context.Context, string) error
	UpsertDeepSeekNutrition(context.Context, string, map[string]any, ...string) (string, error)
}

type NutritionSemanticRetriever interface {
	SearchCandidates(context.Context, []string, int) ([][]foodrecordrepo.SearchCandidate, error)
}

type nutritionFallbackEstimator interface {
	Estimate(context.Context, []UnresolvedNutritionCandidate, string) (map[int]map[string]any, error)
}

type nutritionAliasCandidateProposer interface {
	ProposeNutritionAliasCandidate(context.Context, string, string, string, float64, string) error
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
		webSearcher:           NewMultiWebSearcher(NewSo360WebSearcher(), NewSogouWebSearcher(), NewBingWebSearcher(), NewDuckDuckGoWebSearcher()),
	}
}

func (s *AnalyzeService) ConfigureWebSearcher(searcher WebSearcher) {
	s.webSearcher = searcher
}

func (s *AnalyzeService) ConfigureNutritionResolver(resolver NutritionResolver) {
	s.nutrition = resolver
}

func (s *AnalyzeService) ConfigureNutritionSemanticRetriever(retriever NutritionSemanticRetriever) {
	s.nutritionSemantic = retriever
}

func (s *AnalyzeService) ConfigureNutritionFallbackEstimator(estimator interface {
	Estimate(context.Context, []UnresolvedNutritionCandidate, string) (map[int]map[string]any, error)
}) {
	s.nutritionAI = estimator
}

func (s *AnalyzeService) ConfigureImageProvider(provider string) {
	s.imageProvider = normalizeImageProviderPreference(provider)
}

func (s *AnalyzeService) ConfigureDeepSeekFallback(apiKey string, baseURLs ...string) {
	baseURL := ""
	if len(baseURLs) > 0 {
		baseURL = baseURLs[0]
	}
	estimator := NewDeepSeekNutritionEstimator(apiKey, baseURL, "")
	s.deepseek = estimator
	s.refreshNutritionFallbackEstimator()
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
		logger.Info(context.Background(), "豆包客户端初始化完成", slog.String("base_url", baseURL), slog.String("model", m))
	} else {
		logger.Warn(context.Background(), "豆包客户端未初始化：密钥为空")
	}
}

func (s *AnalyzeService) ConfigureDashScopeClient(apiKey, baseURL string) {
	if strings.TrimSpace(apiKey) != "" {
		s.dashscopeClient = NewDashScopeClient(apiKey, baseURL)
		s.refreshNutritionFallbackEstimator()
		logger.Info(context.Background(), "百炼客户端初始化完成", slog.String("base_url", baseURL), slog.String("model", qwen36FlashModel))
		return
	}
	logger.Warn(context.Background(), "百炼客户端未初始化：密钥为空")
}

func (s *AnalyzeService) ConfigureDashScopeLLMClient(client LLMClient) {
	s.dashscopeClient = client
	s.refreshNutritionFallbackEstimator()
}

func (s *AnalyzeService) refreshNutritionFallbackEstimator() {
	estimators := []namedNutritionFallbackEstimator{}
	// Prefer Qwen for user-facing post-processing so DeepSeek retries cannot
	// dominate latency after the vision result is already available.
	if s.dashscopeClient != nil {
		estimators = append(estimators, namedNutritionFallbackEstimator{
			source:    "qwen_generated",
			estimator: NewQwenNutritionEstimator(s.dashscopeClient),
			timeout:   nutritionFallbackAttemptTimeout,
		})
	}
	// Gemini is the quality fallback when Qwen is unavailable or returns no
	// usable nutrition rows. The deterministic 4/4/9 gate still runs for both.
	if s.gemini35Client != nil {
		estimators = append(estimators, namedNutritionFallbackEstimator{
			source:    "gemini_generated",
			estimator: NewGeminiNutritionEstimator(s.gemini35Client),
			timeout:   nutritionFallbackAttemptTimeout,
		})
	}
	if s.deepseek != nil && strings.TrimSpace(s.deepseek.APIKey) != "" {
		estimators = append(estimators, namedNutritionFallbackEstimator{
			source:    "deepseek_generated",
			estimator: s.deepseek,
			timeout:   nutritionFallbackAttemptTimeout,
		})
	}
	if len(estimators) == 0 {
		s.nutritionAI = nil
		return
	}
	s.nutritionAI = newChainedNutritionFallbackEstimator(estimators...)
}

func (s *AnalyzeService) runtimePostprocessClient() (LLMClient, string, string) {
	if s != nil && s.dashscopeClient != nil {
		return s.dashscopeClient, "qwen", qwen36FlashModel
	}
	if s != nil && s.deepseek != nil && strings.TrimSpace(s.deepseek.APIKey) != "" {
		model := strings.TrimSpace(s.deepseek.Model)
		if model == "" {
			model = deepSeekNutritionFallbackModel
		}
		return s.deepseek, "deepseek", model
	}
	return nil, "", ""
}

func (s *AnalyzeService) ediblePortionPostprocessClient() (LLMClient, string, string) {
	if s != nil && s.deepseek != nil && strings.TrimSpace(s.deepseek.APIKey) != "" {
		model := strings.TrimSpace(s.deepseek.Model)
		if model == "" {
			model = deepSeekNutritionFallbackModel
		}
		return s.deepseek, "deepseek", model
	}
	if s != nil && s.dashscopeClient != nil {
		return s.dashscopeClient, "qwen", qwen36FlashModel
	}
	return nil, "", ""
}

func analyzePostprocess(ctx context.Context, client LLMClient, prompt string) (map[string]any, error) {
	if fastClient, ok := client.(interface {
		AnalyzeWithoutThinking(context.Context, string, string) (map[string]any, error)
	}); ok {
		return fastClient.AnalyzeWithoutThinking(ctx, prompt, "")
	}
	return client.Analyze(ctx, prompt, "")
}

func (s *AnalyzeService) ConfigureGemini31LiteClient(apiKey, baseURL, model string) {
	if strings.TrimSpace(model) == "" {
		model = gemini31FlashLiteModel
	}
	if strings.TrimSpace(apiKey) != "" {
		s.gemini31LiteClient = NewOfoxAIClient(apiKey, model, baseURL)
		logger.Info(context.Background(), "Gemini 3.1 Flash Lite 客户端初始化完成", slog.String("base_url", baseURL), slog.String("model", model))
		return
	}
	logger.Warn(context.Background(), "Gemini 3.1 Flash Lite 客户端未初始化：密钥为空")
}

func (s *AnalyzeService) ConfigureDoubaoWebSearchClient(apiKey, baseURL, model string) {
	if strings.TrimSpace(apiKey) != "" {
		s.doubaoWebSearchClient = NewDoubaoClient(apiKey, model, baseURL)
		m := model
		if m == "" {
			m = "doubao-seed-2-0-lite-260428"
		}
		logger.Info(context.Background(), "豆包联网搜索客户端初始化完成", slog.String("base_url", baseURL), slog.String("model", m))
		return
	}
	if s.doubaoWebSearchClient == nil {
		logger.Warn(context.Background(), "豆包联网搜索客户端未初始化：密钥为空")
	}
}

func (s *AnalyzeService) ConfigureGemini35Client(apiKey, baseURL, model string) {
	if strings.TrimSpace(apiKey) == "" {
		logger.Warn(context.Background(), "Gemini 3.5 Flash 客户端未初始化：密钥为空")
		return
	}
	if strings.TrimSpace(baseURL) == "" {
		logger.Warn(context.Background(), "Gemini 3.5 Flash 客户端未初始化：服务地址为空，请检查 Apollo 配置")
		return
	}
	if strings.TrimSpace(model) == "" {
		model = gemini35FlashModel
	}
	s.gemini35Client = NewOfoxAIClient(apiKey, model, baseURL)
	s.refreshNutritionFallbackEstimator()
	logger.Info(context.Background(), "Gemini 3.5 Flash 客户端初始化完成", slog.String("base_url", baseURL), slog.String("model", model))
}

func (s *AnalyzeService) ConfigureGemini35LLMClient(client LLMClient) {
	s.gemini35Client = client
	s.refreshNutritionFallbackEstimator()
}

func (s *AnalyzeService) RunPrecisionJSON(ctx context.Context, sourceType, prompt, imageURL, modelName string) (map[string]any, error) {
	imageURLs := []string{}
	if strings.TrimSpace(imageURL) != "" {
		imageURLs = append(imageURLs, imageURL)
	}
	return s.RunPrecisionJSONWithImages(ctx, sourceType, prompt, imageURLs, modelName)
}

func (s *AnalyzeService) RunPrecisionJSONWithImages(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return s.RunPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, 0)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesTemperature(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	return s.runPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, temperature, true)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesTemperatureNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	return s.runPrecisionJSONWithImagesTemperature(ctx, sourceType, prompt, imageURLs, modelName, temperature, false)
}

func (s *AnalyzeService) RunPrecisionJSONWithImagesNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return s.RunPrecisionJSONWithImagesTemperatureNoFallback(ctx, sourceType, prompt, imageURLs, modelName, 0)
}

func (s *AnalyzeService) runPrecisionJSONWithImagesTemperature(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64, allowFallback bool) (map[string]any, error) {
	sourceType = strings.TrimSpace(sourceType)
	timeout := 60 * time.Second
	if sourceType == "image" {
		timeout = 90 * time.Second
	}
	provider, model := resolveModelConfig(modelName)
	if sourceType == "image" {
		provider, model = s.resolveImageModelConfig(modelName)
	} else if strings.TrimSpace(modelName) == "" {
		provider = "doubao"
		model = ""
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
	apm.AddEvent(ctx, "精准模式大模型选择提供方",
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
		if model == gemini35FlashModel && s.gemini35Client != nil {
			client = s.gemini35Client
		} else {
			client = s.ofoxAIClient
		}
	case "openai":
		client = s.ofoxAIClient
	default:
		client = s.doubaoClient
	}
	if client == nil {
		err := fmt.Errorf("精准模式大模型客户端未初始化")
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "select_client"))
		return nil, err
	}
	if strings.TrimSpace(sourceType) != "image" {
		imageURLs = nil
	}
	imageURLs = nonEmptyStrings(imageURLs)
	start := time.Now()
	apm.AddEvent(ctx, "精准模式大模型调用开始",
		attribute.String("analysis.source_type", sourceType),
		attribute.String("analysis.provider", provider),
		attribute.Int("analysis.image_count", len(imageURLs)),
		attribute.Float64("analysis.temperature", temperature),
	)
	primaryCall := newAnalyzeWithImagesTemperatureModelCall(client, prompt, imageURLs, temperature, model)
	policy := defaultLLMRetryPolicy
	if provider == "gemini" && len(imageURLs) > 0 {
		policy = realtimeVisionRetryPolicy
	}
	parsed, err := analyzeWithJSONParseRetryPolicy(callCtx, "precision", provider, model, policy, func(retryCtx context.Context) (map[string]any, error) {
		attemptCtx := retryCtx
		attemptCancel := func() {}
		if provider == "gemini" && len(imageURLs) > 0 {
			attemptCtx, attemptCancel = context.WithTimeout(retryCtx, visionPrimaryTimeout)
		}
		defer attemptCancel()
		return primaryCall(attemptCtx)
	})
	if allowFallback && err != nil && provider == "gemini" && len(imageURLs) > 0 && (isTransientLLMError(err) || IsLLMJSONParseError(err)) && s.dashscopeClient != nil {
		fallbackCtx, fallbackCancel := context.WithTimeout(callCtx, visionFallbackTimeout)
		fallbackCall := newAnalyzeWithImagesTemperatureModelCall(s.dashscopeClient, prompt, imageURLs, temperature, qwen36FlashModel)
		fallbackParsed, fallbackErr := analyzeWithJSONParseRetryPolicy(fallbackCtx, "precision_fallback", "qwen", qwen36FlashModel, postprocessRetryPolicy, fallbackCall)
		fallbackCancel()
		if fallbackErr == nil {
			logger.Warn(ctx, "精准模式 Gemini 视觉模型临时失败，回退 Qwen 3.6 Flash",
				logger.Err(err),
				slog.Int("image_count", len(imageURLs)),
			)
			apm.AddEvent(ctx, "精准模式大模型回退完成",
				attribute.String("analysis.primary_provider", provider),
				attribute.String("analysis.fallback_provider", "qwen"),
				attribute.Int("analysis.image_count", len(imageURLs)),
				apm.DurationMS("analysis.duration_ms", time.Since(start)),
			)
			return fallbackParsed, nil
		}
		logger.Warn(ctx, "精准模式 Qwen 3.6 Flash 回退失败",
			logger.NamedErr("fallback_error", fallbackErr),
			logger.Err(err),
			slog.Int("image_count", len(imageURLs)),
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
		apm.AddEvent(ctx, "精准模式大模型调用失败",
			attribute.String("analysis.provider", provider),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		return parsed, err
	}
	apm.AddEvent(ctx, "精准模式大模型调用完成",
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

const preciseMicronutrientAnalysisMarker = "ai_precise_v1"

var preciseMicronutrientKeys = []string{
	"fiber", "sugar", "saturatedFat", "cholesterolMg", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "zincMg",
	"vitaminARaeMcg", "vitaminCMg", "vitaminDMcg", "vitaminEMg", "vitaminKMcg", "thiaminMg", "riboflavinMg", "niacinMg", "vitaminB6Mg", "folateMcg", "vitaminB12Mcg",
}

// ApplyDBFirstToItemsWithPreciseMicronutrients keeps the existing database-first
// macro calculation, then reuses the configured nutrition fallback chain to
// estimate the complete micronutrient profile for every item. Campus dishes use
// this method so a nutrition-library hit cannot bypass precise micronutrient
// analysis.
func (s *AnalyzeService) ApplyDBFirstToItemsWithPreciseMicronutrients(ctx context.Context, items []map[string]any, additionalContext string) ([]map[string]any, error) {
	resolved := s.ApplyDBFirstToItems(ctx, items, additionalContext)
	if err := ValidateResolvedNutritionItems(resolved); err != nil {
		return nil, err
	}
	candidates := make([]UnresolvedNutritionCandidate, 0, len(resolved))
	rows := make(map[int]map[string]any, len(resolved))
	for index, item := range resolved {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		weight := nutritionWeightFromItem(item)
		if name == "" || weight <= 0 {
			return nil, fmt.Errorf("校园菜品微量营养精确分析缺少有效名称或份量")
		}
		existingSource := strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source"]))
		existingUnit := copyAnyMap(mapFromAny(item["unit_nutrition_per_100g"]))
		if foodrecorddomain.IsAIGeneratedNutritionSource(existingSource) && validatePreciseMicronutrientUnit(existingUnit) == nil {
			existingUnit[fallbackNutritionSourceKey] = existingSource
			rows[index] = existingUnit
			continue
		}
		candidates = append(candidates, UnresolvedNutritionCandidate{
			Index:                index,
			Name:                 name,
			EstimatedWeightGrams: weight,
			FoodState:            strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["foodState"], item["food_state"]))),
			WeightBasis:          strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightBasis"], item["weight_basis"]))),
			BasisEvidence:        strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["basisEvidence"], item["basis_evidence"]))),
		})
	}
	if len(candidates) > 0 {
		generatedRows, err := s.estimateNutritionWithFallback(ctx, candidates, additionalContext)
		if err != nil {
			return nil, fmt.Errorf("校园菜品微量营养精确分析失败: %w", err)
		}
		for index, unit := range generatedRows {
			rows[index] = unit
		}
	}
	for index := range resolved {
		unit, ok := rows[index]
		if !ok || len(unit) == 0 {
			return nil, fmt.Errorf("校园菜品微量营养精确分析未返回第 %d 项结果", index+1)
		}
		source := popFallbackSource(unit, "")
		if source == "" {
			return nil, fmt.Errorf("校园菜品微量营养精确分析缺少第 %d 项来源", index+1)
		}
		if err := validatePreciseMicronutrientUnit(unit); err != nil {
			return nil, fmt.Errorf("校园菜品第 %d 项微量营养结果不完整: %w", index+1, err)
		}
		weight := nutritionWeightFromItem(resolved[index])
		scaled := scaleNutrition(unit, weight)
		nutrients := copyAnyMap(mapFromAny(resolved[index]["nutrients"]))
		unitNutrition := copyAnyMap(mapFromAny(resolved[index]["unit_nutrition_per_100g"]))
		for _, key := range preciseMicronutrientKeys {
			nutrients[key] = scaled[key]
			unitNutrition[key] = unit[key]
		}
		resolved[index]["nutrients"] = nutrients
		resolved[index]["unit_nutrition_per_100g"] = unitNutrition
		resolved[index]["micronutrient_analysis"] = preciseMicronutrientAnalysisMarker
		resolved[index]["micronutrient_source"] = source
	}
	if err := ValidatePreciseMicronutrientItems(resolved); err != nil {
		return nil, err
	}
	return resolved, nil
}

func validatePreciseMicronutrientUnit(unit map[string]any) error {
	missing := make([]string, 0)
	positive := 0
	for _, key := range preciseMicronutrientKeys {
		value, ok := unit[key]
		if !ok {
			missing = append(missing, key)
			continue
		}
		if numberFromAny(value) > 0 {
			positive++
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("缺少字段 %s", strings.Join(missing, ","))
	}
	if positive < 4 {
		return fmt.Errorf("有效微量营养少于 4 项")
	}
	return nil
}

// ValidatePreciseMicronutrientItems is the publication gate for campus food.
// It verifies that each result crossed the existing AI micronutrient estimator
// and contains a useful full-field profile.
func ValidatePreciseMicronutrientItems(items []map[string]any) error {
	if len(items) == 0 {
		return fmt.Errorf("校园菜品微量营养结果为空")
	}
	for index, item := range items {
		if strings.TrimSpace(fmt.Sprintf("%v", item["micronutrient_analysis"])) != preciseMicronutrientAnalysisMarker {
			return fmt.Errorf("校园菜品第 %d 项尚未完成微量营养精确分析", index+1)
		}
		if strings.TrimSpace(fmt.Sprintf("%v", item["micronutrient_source"])) == "" {
			return fmt.Errorf("校园菜品第 %d 项缺少微量营养分析来源", index+1)
		}
		if err := validatePreciseMicronutrientUnit(mapFromAny(item["nutrients"])); err != nil {
			return fmt.Errorf("校园菜品第 %d 项微量营养不完整: %w", index+1, err)
		}
	}
	return nil
}

// ValidateResolvedNutritionItems prevents unresolved zero placeholders from
// crossing a task boundary as a successful analysis result.
func ValidateResolvedNutritionItems(items []map[string]any) error {
	names := make([]string, 0)
	for _, item := range items {
		if !boolFromAny(item["is_unresolved"]) &&
			!strings.EqualFold(strings.TrimSpace(fmt.Sprintf("%v", item["resolve_status"])), "unresolved") &&
			!strings.EqualFold(strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source"])), "unresolved") {
			continue
		}
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" {
			name = "未识别食物"
		}
		names = append(names, name)
	}
	if len(names) == 0 {
		return nil
	}
	if len(names) > 3 {
		names = names[:3]
	}
	return fmt.Errorf("食物「%s」的营养信息暂时无法可靠补全，请稍后重试", strings.Join(names, "、"))
}

func analyzeWithImagesTemperature(ctx context.Context, client LLMClient, prompt string, imageURLs []string, temperature float64) (map[string]any, error) {
	return analyzeWithImagesTemperatureModel(ctx, client, prompt, imageURLs, temperature, "")
}

func analyzeWithImagesTemperatureModel(ctx context.Context, client LLMClient, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, error) {
	if len(imageURLs) > 0 {
		if modelClient, ok := client.(interface {
			AnalyzeWithImagesAndTemperatureModel(context.Context, string, []string, float64, string) (map[string]any, error)
		}); ok {
			return modelClient.AnalyzeWithImagesAndTemperatureModel(ctx, prompt, imageURLs, temperature, modelName)
		}
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
	if modelClient, ok := client.(interface {
		AnalyzeWithImagesAndTemperatureModel(context.Context, string, []string, float64, string) (map[string]any, error)
	}); ok {
		return modelClient.AnalyzeWithImagesAndTemperatureModel(ctx, prompt, nil, temperature, modelName)
	}
	if precisionClient, ok := client.(interface {
		AnalyzeWithImagesAndTemperature(context.Context, string, []string, float64) (map[string]any, error)
	}); ok {
		return precisionClient.AnalyzeWithImagesAndTemperature(ctx, prompt, nil, temperature)
	}
	return client.Analyze(ctx, prompt, "")
}

func newAnalyzeWithImagesTemperatureModelCall(client LLMClient, prompt string, imageURLs []string, temperature float64, modelName string) func(context.Context) (map[string]any, error) {
	if preparedClient, ok := client.(interface {
		NewAnalyzeWithImagesAndTemperatureModelCall(string, []string, float64, string) func(context.Context) (map[string]any, error)
	}); ok {
		return preparedClient.NewAnalyzeWithImagesAndTemperatureModelCall(prompt, imageURLs, temperature, modelName)
	}
	return func(ctx context.Context) (map[string]any, error) {
		return analyzeWithImagesTemperatureModel(ctx, client, prompt, imageURLs, temperature, modelName)
	}
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
		"gemini api error 408",
		"gemini api error 429",
		"gemini api error 500",
		"gemini api error 502",
		"gemini api error 503",
		"gemini api error 504",
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

type llmRetryPolicy struct {
	maxJSONRetries      int
	maxTransientRetries int
}

var defaultLLMRetryPolicy = llmRetryPolicy{
	maxJSONRetries:      maxLLMJSONParseRetries,
	maxTransientRetries: maxLLMTransientRetries,
}

var realtimeVisionRetryPolicy = llmRetryPolicy{
	maxJSONRetries:      realtimeVisionJSONRetries,
	maxTransientRetries: realtimeVisionTransientRetries,
}

var postprocessRetryPolicy = llmRetryPolicy{
	maxJSONRetries:      1,
	maxTransientRetries: 0,
}

func analyzeWithJSONParseRetry(ctx context.Context, stage, provider, model string, call func(context.Context) (map[string]any, error)) (map[string]any, error) {
	return analyzeWithJSONParseRetryPolicy(ctx, stage, provider, model, defaultLLMRetryPolicy, call)
}

func analyzeWithJSONParseRetryPolicy(ctx context.Context, stage, provider, model string, policy llmRetryPolicy, call func(context.Context) (map[string]any, error)) (map[string]any, error) {
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
		case IsLLMJSONParseError(err) && jsonRetries < policy.maxJSONRetries:
			jsonRetries++
			retryReason = "json_parse"
			metrics.ObserveLLMRetry(stage, provider, model, retryReason)
			retryNumber = jsonRetries
			maxRetries = policy.maxJSONRetries
		case isTransientLLMError(err) && transientRetries < policy.maxTransientRetries:
			transientRetries++
			retryReason = "transient"
			metrics.ObserveLLMRetry(stage, provider, model, retryReason)
			retryNumber = transientRetries
			maxRetries = policy.maxTransientRetries
		default:
			logger.Warn(ctx, "大模型调用最终失败",
				logger.Stage(stage),
				logger.ProviderModel(provider, model),
				slog.Int("json_retries", jsonRetries),
				slog.Int("transient_retries", transientRetries),
				logger.Err(err),
			)
			return parsed, err
		}
		apm.AddEvent(ctx, "大模型调用准备重试",
			attribute.String("analysis.stage", stage),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			attribute.String("analysis.retry_reason", retryReason),
			attribute.Int("analysis.retry_number", retryNumber),
			attribute.Int("analysis.max_retries", maxRetries),
		)
		logger.Warn(ctx, "大模型调用失败，准备重试同一任务",
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
	switch strings.ToLower(strings.TrimSpace(*mode)) {
	case fastExecutionMode, "qwen_fast", "qwen-fast", "quick":
		return fastExecutionMode
	case fastWebSearchMode, "fast-web-search", "qwen_fast_web_search", "qwen-fast-web-search", "quick_web_search":
		return fastWebSearchMode
	case standardWebSearchMode, "web_search", "standard-web-search":
		return standardWebSearchMode
	case standardPackagedExperimentMode, "packaged_experiment", "standard-packaged-experiment":
		return standardPackagedExperimentMode
	case precisionSeparateExecutionMode, "precision_separate", "strict-separate":
		return precisionSeparateExecutionMode
	case precisionWebSearchMode, "precision_web_search", "strict-web-search":
		return precisionWebSearchMode
	case precisionExecutionMode, "precision", gemini35FlashExecutionMode, "gemini35", "gemini_35_flash", gemini35GroupedExecutionMode, "gemini35_grouped", "gemini_35_flash_grouped":
		return precisionExecutionMode
	case defaultExecutionMode, liteExecutionMode, "lightweight", validExecutionMode, "experiment":
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
	if userID == "" || s.users == nil {
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
	if (isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode)) && strings.TrimSpace(input.Text) == "" {
		promptMode := executionMode
		if isPrecisionLikeExecutionMode(executionMode) {
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

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"suggestedRatio":100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
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
6. eating_order_advice: 本餐进食顺序建议，一句话，必须只基于 items 中真实存在的食物组织顺序，不得提到不存在的奶茶、蔬果、甜饮、甜点或其它食物。
7. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
8. context_advice: 结合用户状态、位置或剩余热量的情境建议（若无则可为空字符串）。%s%s%s%s
9. 请遵守以下执行模式约束：%s

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
  "eating_order_advice": "进食顺序建议（简体中文，一句话）",
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

func imageEdiblePortionPromptRules() string {
	return `通用可食部分估算规则（适用于所有食物，不按食物名称套固定比例）：
- 先判断图片中的呈现状态：完整/购买态、带皮带壳带骨带核，还是已经去皮、去壳、去骨、切块、装盘的可食状态；只扣除原图中实际存在的不可食部分
- hasInedibleParts 表示原图这份食物是否仍包含不可食结构；已经去皮、去壳、去骨、去核且可直接食用的部分通常填 false，ediblePortionRatio 填 100
- 对仍有不可食结构的完整食物，必须根据原图估计外皮/壳/骨/核/硬芯的厚度、体积占比和与可食组织的密度差异，再得到 ediblePortionRatio；不能因为不确定就习惯性填 50，也不能只按食物名称查一个固定常数
- 估算证据优先级：包装净含量或称重/OCR > 可见数量与单体尺寸 > 原图几何体积、厚度、密度和容器比例尺 > 同状态食物的常见出成率；常见出成率只能辅助校验，不能覆盖原图呈现状态
- grossWeightGrams 是原图中这份食物连同实际存在的不可食结构的毛重；estimatedWeightGrams 是可食净重，必须严格等于 grossWeightGrams × ediblePortionRatio / 100
- ediblePortionReason 用一句短语说明原图中扣除了什么结构、依据是什么；比例为 100 时说明已是可直接食用状态或没有可见不可食结构
- 这些视觉初估字段会进入现有第二步文本模型复核；第二步只做校验和有依据的修正，因此本轮必须先给出完整、可自洽的初估，不能只填毛重`
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
	return fmt.Sprintf(`你是专业的食物图像识别与份量估算助手。请识别图片中的食物，只输出实际可见的可食用食物名称、可食部分重量和该食物中可计入饮水参考的含水量；营养成分由后端数据库统一查表计算，请绝对不要自行输出或估算卡路里、蛋白质等任何营养数值。
	%s%s%s%s
核心扫描与识别规则：
- 只识别图片中实际可见的食物，不补充看不见的食物
- 请按区域逐一扫描画面：左侧、中央、右侧、下方、背景/被遮挡处；如果某个区域存在独立食物或独立食品包装，应单独列为一项
- 在估重前进行快速物理空间标定：优先寻找画面中的天然比例尺，例如标准易拉罐、常见手机、餐具、包装上印有净含量/规格的预包装食品；用这些参照物推算盘子、碗、砂锅、杯盒的真实口径、高度和体积
- 严禁在没有尺寸对比时直接套用市面最常见的均值小分量；例如不要盲目把所有杯装酸奶默认为 130g，应结合杯体与旁边碗盘/餐具/包装的比例判断
- 包装食品、袋装食品、盒装食品、被其他物体部分遮挡但仍明显是独立食品包装的对象，应作为独立食物项输出；但前提是你能确认它确实是一个独立食品包装，而不是桌面边缘露出的一小块色块、封边、角落或无法归属的包装碎片
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断的食品名，不要输出“包装袋”
- 零食、点心、饼干、肉干、坚果、糖果、糕点、酸奶、饮料等预包装食品，优先读取包装袋/杯/盒上的品牌、品名、口味、配料表、营养成分表、净含量、规格、独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 如果能看到配料表或营养成分表，即使字较小、倾斜、倒置、反光，也要尝试读取关键字段；用配料表判断食物类型和主要原料，用净含量/规格判断重量
- 如果 OCR 明确读到净含量或规格，例如 260g、250ml、独立小包 20g，则 grossWeightGrams 优先采用该数值或按可见食用数量换算；除非画面明显显示包装已开封且食物已被消耗，才按剩余比例扣减
- 对零食/包装食品，不能只根据图片图案猜成“阿胶糕/无花果干/普通饼干”等；若包装文字、配料表或营养成分表与视觉图案冲突，最终名称优先采用包装文字和配料证据，并在 evidence 中说明
- 若包装食品的配料表和营养成分表可被读取，请在对应 item 的 "ingredients" 字段输出：原始配料文本 ingredientsText、每份规格 servingSize、每100g关键营养 nutritionPer100g（能量/蛋白质/脂肪/碳水/钠）；energyKj 表示包装原文的千焦，calories 必须表示千卡(kcal)。若标签只写 kJ，按 calories = energyKj / 4.184 换算，严禁把 kJ 数字直接填入 calories；未识别到时省略该字段，不要编造
- 严禁凭 Logo 或颜色脑补品牌：不要仅凭标志颜色、圆形图案、包装主色等断定品牌；只有读到明确品牌文字时才写品牌，否则使用客观品名，例如“草莓酸奶”“草莓风味发酵乳”
- 如果包装只露出很小一角、只有色块/封边/局部花纹，读不到可靠文字，也无法确认完整包装归属，不要猜成具体零食或品牌；这类对象不计入
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分
- 对仅在边缘露出少量、无法确认种类或份量的食物，不计入
- name 仍写食物本身；不可食部分必须由本次视觉识别按原图呈现状态直接折算
- 相同食物合并为一项，明显不同食物分开
- 食物名称使用简体中文，尽量具体、标准、常见，方便命中营养库
- 混合菜无法可靠拆分时，作为一道常见菜名输出，不要猜测不可见成分

重量规则：
- grossWeightGrams 必须是数字，单位克，表示图片中可见食物的原始可见总重量；带壳、带骨、带核时先估整份原始重量，不要扣壳/骨/核
- estimatedWeightGrams 必须是本次视觉识别直接估算的可食净重，不再交给文本模型按食物名称二次猜测
- 多个可独立计数的同类食物（水果、鸡蛋、包子等）必须先数清 itemCount，再估 estimatedUnitWeightGrams，并按 itemCount × estimatedUnitWeightGrams 得到 grossWeightGrams；三个字段必须严格自洽
- 掌心大小鲜桃单枚按常见重量保守估算，无电子秤或明确超大尺寸证据时不得超过180g；苹果、梨、柑橘等其它鲜果单枚超过250g也必须有强证据，不能只因近景透视而放大
- 必须区分食物状态 foodState 与重量口径 weightBasis：泡发/泡开的燕麦、木耳、银耳等，如果用户明确说“60g干燕麦”则按60g干重并填 weightBasis=dry；否则按泡发后的实际湿重并填 weightBasis=as_served，名称也要保留“泡发/粥”等状态，严禁用湿重配干态食物名
- 不要因为减脂、控糖、剩余热量不足或健康建议而下调 grossWeightGrams 或 estimatedWeightGrams；饮食控制只能体现在 suggestedRatio，不能改变重量本身
- 综合可见面积、厚度、高度、容器、餐具、手掌、包装等参照物估算
- 生成 estimatedWeightGrams 前，必须先用空间标定或 OCR 规格做一次合理性校验；大杯、大盒、大盘、砂锅不能被压成默认小份量
- 不把餐具、空包装计入重量；任何带皮、带壳、带骨、带核食物都按下面的通用物理规则折算
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；固体食物按常见含水率保守估算，无法判断时填 0
- 饮品、汤、粥、奶、茶、咖啡等液体或半流体应估算 waterMl；干货、油炸物、酱料难判断时可填 0
- suggestedRatio 只是结果页“实际摄入比例”滑块的建议值，不能反向影响 estimatedWeightGrams、waterMl 或营养计算基础；默认100

%s

输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字，必须结合本餐具体食物，不要写“保持健康饮食”这类泛话
- pfc_ratio_comment 必须给出本餐蛋白/脂肪/碳水结构判断，并点名应优先保留或控制的食物类别；不要编具体营养数值；不得提到 items 中不存在的奶茶、蔬果、甜饮、甜点或其它食物
- eating_order_advice 必须是本餐进食顺序建议；只能使用 items 中真实存在的食物组织顺序，不得套用“蔬菜/汤水/奶茶/甜饮”等模板词；如果本餐只有牛肉面一类混合主食，可写“先少量喝汤、吃牛肉，再吃面条”
- absorption_notes 只写吸收率/生物利用度/消化节奏，不要再写进食顺序
- context_advice 1-2句，<= 48字；必须结合用户目标、餐次、剩余热量或健康档案中的一个关键点给出细致建议，无信息时空字符串
- 如果这是纠错任务，必须基于原图、上一轮结果和用户纠错说明重新判断；不要机械照抄上一轮结果，也不要仅把前端列表原样返回
- 只返回 JSON

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[{
    "name":"",
    "type":"normal",
	"foodState":"fresh",
	"weightBasis":"as_served",
	"itemCount":1,
	"estimatedUnitWeightGrams":0,
    "grossWeightGrams":0,
	"hasInedibleParts":false,
	"ediblePortionRatio":100,
	"ediblePortionReason":"已是可直接食用状态",
    "estimatedWeightGrams":0,
    "waterMl":0,
    "suggestedRatio":100,
    "ingredients":{
      "ingredientsText":"",
      "servingSize":"",
      "nutritionPer100g":{
		"energyKj":0,
        "calories":0,
        "protein":0,
        "fat":0,
        "carbs":0,
        "sodiumMg":0
      }
    }
  }],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
  "absorption_notes":"",
  "context_advice":""
	}

注意：ingredients 为可选字段，仅当该 item 识别到配料表/营养成分表时才输出；未识别到时请省略或置 null。`, tagBlock, imageInputHint, additionalLine, correctionBlock, imageEdiblePortionPromptRules())
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
- 若配料表和营养成分表可被读取，请在对应 item 的 "ingredients" 字段输出：原始配料文本 ingredientsText、每份规格 servingSize、每100g关键营养 nutritionPer100g（能量/蛋白质/脂肪/碳水/钠）；energyKj 表示包装原文的千焦，calories 必须表示千卡(kcal)。若标签只写 kJ，按 calories = energyKj / 4.184 换算，严禁把 kJ 数字直接填入 calories；未识别到时省略该字段，不要编造
- 如果包装只露出很小一角、只有色块/封边/局部花纹，读不到可靠文字，也无法确认完整包装归属，不要猜成具体零食或品牌；这类对象不计入
- 不确定 OCR 不能直接当食物名；若 OCR 与视觉冲突，把冲突写进 recognitionEvidence 和 alternativeNames
- 小众水果/进口零食/不确定包装食品可使用 web_search，搜索关键词要围绕可见包装文字、品牌、品名或用户补充信息，避免用泛泛描述搜索
- grossWeightGrams 是图中可见原始总重量；estimatedWeightGrams 是视觉模型按原图呈现状态直接估算的可食净重
- 多枚同类水果、鸡蛋、包子等必须输出 itemCount 和 estimatedUnitWeightGrams，并令 grossWeightGrams = itemCount × estimatedUnitWeightGrams；掌心大小鲜桃无秤时单枚不超过180g，其它桃/苹果/梨/柑橘单枚超过250g必须有强比例尺证据
- 输出 foodState（fresh/dry/hydrated/cooked/liquid/packaged）和 weightBasis（dry/as_served/package_net）。泡发燕麦若用户明确提供干重则沿用干重；否则必须按湿重并把名称写成“泡发燕麦/燕麦粥”，不得用湿重套干态名称
- waterMl 表示该食物/饮品本身可计入饮水参考的水量；无法判断填 0

%s

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[{
    "name":"",
    "type":"normal",
	"foodState":"fresh",
	"weightBasis":"as_served",
	"itemCount":1,
	"estimatedUnitWeightGrams":0,
    "grossWeightGrams":0,
	"hasInedibleParts":false,
	"ediblePortionRatio":100,
	"ediblePortionReason":"已是可直接食用状态",
    "estimatedWeightGrams":0,
    "waterMl":0,
    "suggestedRatio":100,
    "confidence":0.8,
    "recognitionEvidence":"",
    "weightEvidence":"",
    "alternativeNames":[],
    "ingredients":{
      "ingredientsText":"",
      "servingSize":"",
      "nutritionPer100g":{
		"energyKj":0,
        "calories":0,
        "protein":0,
        "fat":0,
        "carbs":0,
        "sodiumMg":0
      }
    }
  }],
  "description":"",
  "insight":"",
  "ocrText":[],
  "webSearchSummary":""
}

注意：ingredients 为可选字段，仅当该 item 识别到配料表/营养成分表时才输出；未识别到时请省略或置 null。`, tagBlock, imageInputHint, additionalLine, imageEdiblePortionPromptRules())
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
	return fmt.Sprintf(`你是专业的食物图像识别与可食部重量估算助手。请基于图片直接识别食物；营养由后端数据库统一查表补充，你不需要输出任何营养数值。
%s%s%s
%s

深度识别与多模态对齐规则：
- 必须逐区扫描画面：左侧、中央、右侧、下方、背景/被遮挡处
- 在输出 grossWeightGrams 之前，必须先在脑中完成 recognitionEvidence 和 weightEvidence 的逻辑闭环：先说明为什么认定它是什么，再说明为什么原始可见重量是这个数
- 物理尺寸与空间标定：先定位标准化工业品或天然比例尺，例如标准 330ml/500ml 易拉罐、常见手机、餐具，或包装上印有净含量的食品；再以这些参照物推算砂锅、大盘、深碗、杯盒的真实口径、高度和体积；最后结合食物堆积高度估算可食部重量
- 绝对禁止在没有进行空间标定的情况下直接套用市面均值小分量；例如不要把与大砂锅/大盘对比明显很大的 260g 酸奶杯，盲目猜测为 130g 均值杯
- 包装食品、袋装食品、盒装食品、被部分遮挡但仍能确认是完整独立食品包装的对象，才作为独立食物项输出
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断食品名，不要输出“包装袋”
- OCR 绝对优先与 mentally rotate：包装文字可能横排、竖排、倒置、旋转、反光或被遮挡；请 mentally rotate 后重读，优先提取品牌、品名、口味、规格、配料表、营养成分表、净含量，例如 XX克/XXg/XXml
- OCR 强覆盖规则：如果 OCR 明确识别到包装净含量或规格，例如“260g”“Net 250g”“250ml”，grossWeightGrams 必须优先采用该包装标明重量/容量或按可见食用数量换算；除非视觉证据极明显显示包装已拆封且食物被消耗，此时必须在 weightEvidence 中写明扣减比例
- 零食、点心、饼干、肉干、坚果、糖果、糕点等预包装食品，优先读取包装袋上的品牌、品名、口味、配料表、营养成分表、净含量、规格、独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 如果能看到配料表或营养成分表，即使字较小、倾斜、倒置、反光，也要尝试读取关键字段；用配料表判断食物类型和主要原料，用净含量/规格判断重量
- 对零食包装，不能只根据图片图案猜成“阿胶糕/无花果干/普通饼干”等；若包装文字、配料表或营养成分表与视觉图案冲突，最终名称优先采用包装文字和配料证据，并在 recognitionEvidence 中说明
- 若包装食品的配料表和营养成分表可被读取，请在对应 item 的 "ingredients" 字段输出：原始配料文本 ingredientsText、每份规格 servingSize、每100g关键营养 nutritionPer100g（能量/蛋白质/脂肪/碳水/钠）；energyKj 表示包装原文的千焦，calories 必须表示千卡(kcal)。若标签只写 kJ，按 calories = energyKj / 4.184 换算，严禁把 kJ 数字直接填入 calories；未识别到时省略该字段，不要编造
- 禁止凭 Logo 图案盲猜品牌：不要仅凭标志颜色或几何外形，例如只看到红色圆圈，就猜成某品牌；必须通过 OCR 确认中文字符或清晰品牌文本。若字迹反光无法看清，直接用客观品名命名，并在 recognitionEvidence 中说明“包装文字模糊，未检测到明确品牌文本，不进行品牌猜测”
- 若包装只露出很小一角、只有色块/封边/局部花纹，读不到可靠文字，也无法确认是一个完整独立包装，不要猜成具体零食名；这类对象不计入
- 重点区分相近字：鹅胗/鹅肫/鹅珍 与 阿胶；龙宫果/龙贡果/longkong 与 无花果/无花果干
- 相同食物合并为一项，明显不同食物分开；不要因为一个物体在背景或被其它包装压住就漏掉
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分
- 对仅在边缘露出少量、无法确认种类或份量的食物，不计入

重量规则：
- grossWeightGrams 是图中可见食物原始总重量，单位克，必须是数字；带壳、带骨、带核时先估整份原始重量，不要扣壳/骨/核
- estimatedWeightGrams 是本次视觉识别按原图呈现状态直接估算的可食净重
- 多个可独立计数的同类食物必须先输出 itemCount 与 estimatedUnitWeightGrams，再令 grossWeightGrams = itemCount × estimatedUnitWeightGrams；三个字段不得互相矛盾
- 掌心大小鲜桃无电子秤或明显超大尺寸证据时单枚不得超过180g；其它桃/苹果/梨/柑橘等鲜果单枚超过250g时，必须在 weightEvidence 中给出电子秤、包装规格或明显超大尺寸等强证据；近景透视本身不能作为放大重量的理由
- 输出 foodState（fresh/dry/hydrated/cooked/liquid/packaged）和 weightBasis（dry/as_served/package_net）。泡发燕麦若用户明确给出干重则采用干重；否则采用湿重且名称必须保留泡发/粥状态，禁止把湿重与干燕麦营养口径混用
- 不要因为减脂、控糖、剩余热量不足或健康建议而下调 grossWeightGrams 或 estimatedWeightGrams；饮食控制只能体现在 suggestedRatio，不能改变重量本身
- 不把餐具、空包装计入重量；不可食部分由本次视觉识别按下面的通用物理规则扣除
- 包装食品如果只能看到独立小包，按该小包通常净含量/可见体积估算；如果看得到净含量文字，优先参考净含量
- grossWeightGrams 必须与 weightEvidence 完全吻合；如果 weightEvidence 写明包装净含量 260g 且未开封，则重量不能输出 130g 或其它均值猜测
- waterMl 表示该食物/饮品本身含有的水量，单位毫升，必须是数字；无法判断填 0
- suggestedRatio 只是结果页“实际摄入比例”滑块的建议值，不能反向影响 estimatedWeightGrams、waterMl 或营养计算基础；默认100

%s

输出要求：
- 只返回 JSON，不要输出 Markdown
- 简体中文
- description <= 16字
- insight <= 32字，必须结合本餐具体食物，不要写泛话
- pfc_ratio_comment 必须点名本餐里应优先保留或控制的食物类别；不得提到 items 中不存在的奶茶、蔬果、甜饮、甜点或其它食物
- eating_order_advice 必须是本餐进食顺序建议；只能使用 items 中真实存在的食物组织顺序，不得套用“蔬菜/汤水/奶茶/甜饮”等模板词
- absorption_notes 只写吸收率/生物利用度/消化节奏，不要再写进食顺序
- context_advice 必须结合用户目标、餐次、剩余热量或健康档案中的一个关键点给出细致建议，无信息时空字符串
- 每个 item 都给出 recognitionEvidence 和 weightEvidence，便于排查
- ocrText 放你从图片中读到的关键包装文字；不确定的文字可放 alternativeNames 或 evidence 中说明

JSON:
{
  "items":[
    {
      "name":"",
      "type":"normal",
	  "foodState":"fresh",
	  "weightBasis":"as_served",
	  "itemCount":1,
	  "estimatedUnitWeightGrams":0,
      "grossWeightGrams":0,
	  "hasInedibleParts":false,
	  "ediblePortionRatio":100,
	  "ediblePortionReason":"已是可直接食用状态",
      "estimatedWeightGrams":0,
      "waterMl":0,
      "suggestedRatio":100,
      "groupId":1,
      "confidence":0.8,
      "recognitionEvidence":"",
      "weightEvidence":"",
      "alternativeNames":[],
      "ingredients":{
        "ingredientsText":"",
        "servingSize":"",
        "nutritionPer100g":{
		  "energyKj":0,
          "calories":0,
          "protein":0,
          "fat":0,
          "carbs":0,
          "sodiumMg":0
        }
      }
    }
  ],
  "groups":[{"groupId":1,"description":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}

注意：ingredients 为可选字段，仅当该 item 识别到配料表/营养成分表时才输出；未识别到时请省略或置 null。`, tagBlock, imageInputHint, additionalLine, groupLine, imageEdiblePortionPromptRules())
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
- 锁定食物清单：图片里所有独立食物、独立包装食品、被部分遮挡但仍能确认是完整独立食品包装的对象，都必须列出
- 最多分 2 组，groupId 只能是 1 或 2；不需要分组时全部填 1
- 输出每个 item 的位置、识别证据、OCR 证据和候选名称，方便第二阶段专门估重
- grossWeightGrams/estimatedWeightGrams 可以给粗略占位值且两者先保持一致；第二阶段会重新估重；不要因为重量不确定就漏掉食物

识别规则：
- 必须逐区扫描画面：左侧、中央、右侧、下方、背景/被遮挡处
- 包装本身不是食物，但包装代表的可食内容要输出为食物项；name 写包装上的品名/可判断食品名，不要输出“包装袋”
- 包装文字可能横排、竖排、倒置、旋转、反光或被遮挡；请 mentally rotate 后重读，低置信 OCR 不能直接当食物名
- 零食/预包装食品要重点读取配料表、营养成分表、口味、规格、净含量和独立小包数量；这些文字证据优先级高于包装正面插画或模型对外观的猜测
- 若包装食品的配料表和营养成分表可被读取，请在对应 item 的 "ingredients" 字段输出：原始配料文本 ingredientsText、每份规格 servingSize、每100g关键营养 nutritionPer100g（能量/蛋白质/脂肪/碳水/钠）；energyKj 表示包装原文的千焦，calories 必须表示千卡(kcal)。若标签只写 kJ，按 calories = energyKj / 4.184 换算，严禁把 kJ 数字直接填入 calories；未识别到时省略该字段，不要编造
- 如果包装只露出很小一角、只有色块/封边/局部花纹，读不到可靠文字，也无法确认完整包装归属，不要猜成具体零食或品牌，也不要列入第一阶段食物清单
- 重点区分相近字：鹅胗/鹅肫/鹅珍 与 阿胶；龙宫果/龙贡果/longkong 与 无花果/无花果干
- 相同食物合并为一项，明显不同食物分开；不要因为一个物体在背景或被其它包装压住就漏掉
- 不输出餐具、空包装、桌面、骨头、壳、果核、签子等不可食或非食物部分
- 对仅在边缘露出少量、无法确认种类或份量的食物，不计入

输出要求：
- 只返回 JSON，不要输出 Markdown
- 简体中文
- description <= 16字
- insight <= 32字
- 每个 item 必须给 groupId、position、recognitionEvidence、alternativeNames
- ocrText 放你从图片中读到的关键包装文字；不确定的文字写进 evidence 或 alternativeNames

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[
    {
      "name":"",
      "type":"normal",
      "grossWeightGrams":0,
      "estimatedWeightGrams":0,
      "waterMl":0,
      "suggestedRatio":100,
      "groupId":1,
      "position":"",
      "confidence":0.8,
      "recognitionEvidence":"",
      "weightEvidence":"第一阶段仅粗略占位，第二阶段估重",
      "alternativeNames":[],
      "ingredients":{
        "ingredientsText":"",
        "servingSize":"",
        "nutritionPer100g":{
		  "energyKj":0,
          "calories":0,
          "protein":0,
          "fat":0,
          "carbs":0,
          "sodiumMg":0
        }
      }
    }
  ],
  "groups":[{"groupId":1,"description":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}

注意：ingredients 为可选字段，仅当该 item 识别到配料表/营养成分表时才输出；未识别到时请省略或置 null。`, tagBlock, imageInputHint, additionalLine)
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
- 如果用户在输入文字中明确声明了具体重量数值（如"59克"、"37g"、"100克"等），则 estimatedWeightGrams 必须严格等于该数值，禁止进行任何四舍五入、估算或修正
- description <= 24字
- insight/context_advice 各 1-2 句，<= 40字
- suggestedRatio：每个食物的建议摄入比例（0-100），结合用户剩余热量和饮食目标给出建议，默认100

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"suggestedRatio":100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
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
- 如果用户在输入文字中已经直接给出了明确的具体重量数值（如"59克"、"37g"、"100克"等），则 estimatedWeightGrams 必须严格等于该数值，禁止进行任何四舍五入、估算或修正
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
- pfc_ratio_comment 可根据食物结构简要评价，不要编具体营养数值；不得提到 items 中不存在的奶茶、蔬果、甜饮、甜点或其它食物
- eating_order_advice 必须是本餐进食顺序建议；只能基于 items 中真实存在的食物给建议，不得套用“蔬菜/汤水/奶茶/甜饮”等模板词
- absorption_notes 可简述烹饪/搭配影响，不要编具体营养数值；不要再写进食顺序
- context_advice 1-2句，<= 32字，无需则空字符串
- 只返回 JSON

Type rule:
- Every item must include "type".
- Use "normal" for regular cooked food, fresh food, dishes, drinks, fruit, staple food, meat, eggs, dairy, and vegetables.
- Use "snack" for snack-like packaged/prepackaged foods.
- Use "packaged" for other packaged/prepackaged foods.

JSON:
{
  "items":[{"name":"","type":"normal","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
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
	if normalized == "qwen" || normalized == "qwen-flash" || normalized == qwen36FlashModel {
		return "qwen", qwen36FlashModel
	}
	if strings.HasPrefix(normalized, "qwen") {
		return "qwen", raw
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
	if isOpenAICompatibleVisionModel(normalized) {
		return "openai", raw
	}
	return "gemini", gemini3FlashModel
}

func isOpenAICompatibleVisionModel(normalizedModel string) bool {
	normalizedModel = strings.TrimSpace(strings.ToLower(normalizedModel))
	if normalizedModel == "" {
		return false
	}
	if strings.HasPrefix(normalizedModel, "openai/") {
		normalizedModel = strings.TrimSpace(strings.TrimPrefix(normalizedModel, "openai/"))
	}
	return strings.HasPrefix(normalizedModel, "gpt-") ||
		strings.HasPrefix(normalizedModel, "chatgpt-") ||
		strings.HasPrefix(normalizedModel, "o1") ||
		strings.HasPrefix(normalizedModel, "o3") ||
		strings.HasPrefix(normalizedModel, "o4")
}

func normalizeImageProviderPreference(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "doubao":
		return "doubao"
	case "gemini", "ofox", "ofoxai", "ofox-gemini":
		return "gemini"
	case "qwen", "dashscope":
		return "qwen"
	default:
		return ""
	}
}

func isGemini35ExecutionMode(executionMode string) bool {
	return executionMode == gemini35FlashExecutionMode || executionMode == gemini35GroupedExecutionMode
}

func isPrecisionLikeExecutionMode(executionMode string) bool {
	return executionMode == precisionExecutionMode || executionMode == precisionSeparateExecutionMode || executionMode == precisionWebSearchMode
}

func isPackagedExperimentExecutionMode(executionMode string) bool {
	return executionMode == standardPackagedExperimentMode
}

func isWebSearchExecutionMode(executionMode string) bool {
	return executionMode == standardWebSearchMode || executionMode == precisionWebSearchMode
}

func isFastExecutionMode(executionMode string) bool {
	return executionMode == fastExecutionMode || executionMode == fastWebSearchMode
}

func shouldUseImageProviderPreference(modelName string) bool {
	raw := strings.TrimSpace(modelName)
	if raw == "" {
		return false
	}
	normalized := strings.ToLower(raw)
	switch normalized {
	case "gemini", "gemini-flash", "gemini-vision",
		"doubao", "qwen", "qwen-flash":
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
	isCorrection := len(input.CorrectionItems) > 0 || len(input.PreviousResult) > 0
	if strings.TrimSpace(input.ModelName) == "" {
		if isCorrection {
			if isPrecisionLikeExecutionMode(executionMode) || executionMode == gemini35FlashExecutionMode || executionMode == gemini35GroupedExecutionMode {
				input.ModelName = gemini35FlashModel
			} else {
				input.ModelName = qwen36FlashModel
			}
		} else if executionMode == defaultExecutionMode || executionMode == standardWebSearchMode || isPackagedExperimentExecutionMode(executionMode) {
			input.ModelName = gemini3FlashModel
		} else if isFastExecutionMode(executionMode) {
			input.ModelName = qwen36FlashModel
		} else if isPrecisionLikeExecutionMode(executionMode) || executionMode == gemini35FlashExecutionMode {
			input.ModelName = gemini35FlashModel
		} else if executionMode != validExecutionMode {
			input.ModelName = gemini3FlashModel
		}
		if executionMode == gemini35GroupedExecutionMode {
			input.ModelName = gemini35FlashModel
		}
	}

	var user *authrepo.User
	if userID != "" && s.users != nil {
		user, _ = s.users.FindByID(ctx, userID)
	}

	prompt := buildPrompt(input, user, executionMode)

	provider, model := s.resolveImageModelConfig(input.ModelName)
	var client LLMClient
	switch provider {
	case "doubao":
		client = s.doubaoClient
	case "qwen":
		client = s.dashscopeClient
	case "gemini":
		if isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode) {
			client = s.gemini35Client
		} else if strings.EqualFold(model, gemini31FlashLiteModel) && s.gemini31LiteClient != nil {
			client = s.gemini31LiteClient
		} else {
			client = s.ofoxAIClient
		}
	case "openai":
		client = s.ofoxAIClient
	case "deepseek":
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("图片识别使用 DeepSeek 时，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
	default:
		client = s.doubaoClient
	}
	if client == nil {
		if isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode) {
			return nil, fmt.Errorf("Gemini 3.5 Flash 图片识别 client 未初始化，请配置 gemini35_api_key")
		}
		return nil, fmt.Errorf("图片识别大模型客户端未初始化")
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
	apm.AddEvent(ctx, "食物图片大模型识别开始",
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.requested_model", strings.TrimSpace(input.ModelName)),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.String("analysis.engine", strings.TrimSpace(input.AnalysisEngine)),
		attribute.Int("analysis.image_count", imageCount),
		attribute.Bool("analysis.has_base64_image", strings.TrimSpace(input.Base64Image) != ""),
	)
	logger.Info(ctx, "食物图片大模型识别开始",
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
	qwenNativeSearchMeta := map[string]any{}
	analysisCallCtx := ctx
	analysisCallCancel := func() {}
	if isFastExecutionMode(executionMode) {
		analysisCallCtx, analysisCallCancel = context.WithTimeout(ctx, fastVisionAnalysisTimeout)
	}
	defer analysisCallCancel()
	primaryImageCall := newAnalyzeWithImagesTemperatureModelCall(client, prompt, imageURLs, 0, model)
	visionPolicy := defaultLLMRetryPolicy
	if provider == "gemini" && len(imageURLs) > 0 {
		visionPolicy = realtimeVisionRetryPolicy
	}
	parsed, err := analyzeWithJSONParseRetryPolicy(analysisCallCtx, "food_image", provider, model, visionPolicy, func(callCtx context.Context) (map[string]any, error) {
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
		if executionMode == fastWebSearchMode {
			qwenSearchClient, ok := client.(interface {
				AnalyzeWithImagesDashScopeWebSearch(context.Context, string, []string, DashScopeWebSearchOptions) (map[string]any, map[string]any, error)
			})
			if !ok {
				return nil, fmt.Errorf("fast web search mode requires DashScope qwen client")
			}
			fastParsed, meta, fastErr := qwenSearchClient.AnalyzeWithImagesDashScopeWebSearch(attemptCtx, prompt, imageURLs, DashScopeWebSearchOptions{
				ForcedSearch:   true,
				SearchStrategy: "turbo",
			})
			qwenNativeSearchMeta = meta
			return fastParsed, fastErr
		}
		return primaryImageCall(attemptCtx)
	})
	fallbackUsed := false
	if err != nil && provider == "gemini" && len(imageURLs) > 0 && (isTransientLLMError(err) || IsLLMJSONParseError(err)) && s.dashscopeClient != nil {
		primaryErr := err
		fallbackCtx, fallbackCancel := context.WithTimeout(ctx, visionFallbackTimeout)
		fallbackCall := newAnalyzeWithImagesTemperatureModelCall(s.dashscopeClient, prompt, imageURLs, 0, qwen36FlashModel)
		fallbackParsed, fallbackErr := analyzeWithJSONParseRetryPolicy(fallbackCtx, "food_image_fallback", "qwen", qwen36FlashModel, postprocessRetryPolicy, fallbackCall)
		fallbackCancel()
		if fallbackErr == nil {
			parsed = fallbackParsed
			err = nil
			fallbackUsed = true
			client = s.dashscopeClient
			provider = "qwen"
			model = qwen36FlashModel
			logger.Warn(ctx, "食物图片 Gemini 临时失败，已快速回退千问",
				logger.NamedErr("primary_error", primaryErr),
				slog.Int("image_count", len(imageURLs)),
			)
		} else {
			logger.Warn(ctx, "食物图片千问快速回退失败",
				logger.NamedErr("primary_error", primaryErr),
				logger.NamedErr("fallback_error", fallbackErr),
				slog.Int("image_count", len(imageURLs)),
			)
		}
	}
	if err != nil {
		metrics.ObserveFoodAnalysis("image", provider, model, "llm_error", time.Since(start), -1)
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "llm_call"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		apm.AddEvent(ctx, "食物图片大模型识别失败",
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			attribute.String("analysis.primary_provider", primaryProvider),
			attribute.String("analysis.primary_model", primaryModel),
			attribute.Int("analysis.image_count", imageCount),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		logger.Warn(ctx, "食物图片大模型识别失败",
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
	rawItems := parseItems(parsed)
	logger.Info(ctx, "视觉模型识别结果已返回",
		slog.String("user_id", userID),
		slog.String("provider", provider),
		slog.String("model", model),
		slog.String("execution_mode", executionMode),
		slog.String("analysis_engine", strings.TrimSpace(input.AnalysisEngine)),
		slog.Int("image_count", imageCount),
		slog.Int("item_count", len(rawItems)),
		slog.Any("items", analyzeItemLogSummary(rawItems, 12)),
		slog.Duration("duration", time.Since(start)),
	)
	apm.AddEvent(ctx, "视觉模型识别结果已返回",
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.Int("analysis.image_count", imageCount),
		attribute.Int("analysis.item_count", len(rawItems)),
		attribute.String("analysis.items", summarizeAnalyzeItemsForTrace(rawItems, 12)),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
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
	if isFastExecutionMode(executionMode) {
		hybridMeta = map[string]any{
			"status":          "applied",
			"strategy":        executionMode + "_qwen36_flash_db_first",
			"base_provider":   provider,
			"base_model":      model,
			"review_provider": nil,
			"review_model":    nil,
		}
		if executionMode == fastWebSearchMode {
			hybridMeta["web_search"] = qwenNativeSearchMeta
			hybridMeta["strategy"] = "fast_web_search_qwen36_flash_native_search_db_first"
		}
	}
	if isPrecisionLikeExecutionMode(executionMode) || isGemini35ExecutionMode(executionMode) {
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
	if isWebSearchExecutionMode(executionMode) {
		reviewed, meta := s.refineImageWithLowCostWebSearch(ctx, input, parsed, imageURLs, client, provider, model, executionMode)
		if len(meta) > 0 {
			hybridMeta = meta
		}
		if reviewed != nil {
			parsed = reviewed
		}
	}
	if isPackagedExperimentExecutionMode(executionMode) {
		hybridMeta = map[string]any{
			"status":          "applied",
			"strategy":        "standard_packaged_experiment_db_first",
			"base_provider":   provider,
			"base_model":      model,
			"review_provider": nil,
			"review_model":    nil,
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
	apm.AddEvent(ctx, "食物图片大模型识别完成",
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
	logger.Info(ctx, "食物图片大模型识别完成",
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

	result, err := s.finalizeAnalyzeResponse(ctx, userID, parsed, input, executionMode, provider, model, durationMs)
	if err != nil {
		metrics.ObserveFoodAnalysis("image", provider, model, "finalize_error", time.Since(start), -1)
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "finalize"),
			attribute.String("analysis.provider", provider),
			attribute.String("analysis.model", model),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		logger.Warn(ctx, "食物图片识别结果收尾失败",
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
	apm.AddEvent(ctx, "食物图片识别结果收尾完成",
		attribute.String("analysis.provider", provider),
		attribute.String("analysis.model", model),
		attribute.String("analysis.engine", stringFromAny(result["analysis_engine"])),
		attribute.Int("analysis.item_count", len(toItems(result["items"]))),
		attribute.Int("analysis.resolved_count", intFromAny(result["resolved_count"])),
		attribute.Int("analysis.unresolved_count", intFromAny(result["unresolved_count"])),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	logger.Info(ctx, "食物图片识别结果收尾完成",
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
		return analyzeWithImagesTemperature(retryCtx, s.ofoxAIClient, prompt, imageURLs, 0)
	})
	if err != nil {
		logger.Warn(ctx, "标准图片混合复核失败",
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
	logger.Info(ctx, "标准图片混合复核已应用",
		slog.Int("image_count", len(imageURLs)),
		slog.Int("item_count", len(parseItems(merged))),
		slog.Any("hybrid_review", meta),
	)
	return merged, meta
}

func (s *AnalyzeService) refineImageWithLowCostWebSearch(ctx context.Context, input AnalyzeInput, baseParsed map[string]any, imageURLs []string, _ LLMClient, provider, model, executionMode string) (map[string]any, map[string]any) {
	start := time.Now()
	baseItems := parseItems(baseParsed)
	complexity := decideWebSearchComplexity(baseParsed)
	meta := map[string]any{
		"status":                "skipped",
		"strategy":              executionMode + "_single_vision_web_search_db_first",
		"base_provider":         provider,
		"base_model":            model,
		"review_provider":       nil,
		"review_model":          nil,
		"calibration_method":    "none",
		"complexity_decision":   complexity,
		"stage_durations_ms":    map[string]any{},
		"second_vision_skipped": true,
	}
	if compacted := compactHybridDebugItems(baseItems, 12); len(compacted) > 0 {
		meta["base_items"] = compacted
	}
	if baseDescription := strings.TrimSpace(fmt.Sprintf("%v", baseParsed["description"])); baseDescription != "" && baseDescription != "<nil>" {
		meta["base_description"] = baseDescription
	}
	imageURLs = nonEmptyStrings(imageURLs)
	if len(imageURLs) == 0 {
		meta["status"] = "no_images"
		return nil, meta
	}
	if complexity.Decision == "simple" {
		meta["status"] = "skipped_simple"
		meta["web_search_status"] = "skipped_simple"
		meta["calibration_method"] = "first_pass_kept"
		meta["stage_durations_ms"] = map[string]any{"total": time.Since(start).Milliseconds()}
		return nil, meta
	}
	searchEvidence := s.collectStandardImageSearchEvidence(ctx, input, baseParsed)
	if len(searchEvidence) == 0 {
		meta["status"] = "no_evidence"
		meta["web_search_status"] = "no_results"
		meta["calibration_method"] = "first_pass_kept"
		meta["stage_durations_ms"] = map[string]any{"total": time.Since(start).Milliseconds()}
		return nil, meta
	}
	relevantEvidence, relevanceRows := filterRelevantWebSearchEvidence(searchEvidence, baseItems)
	meta["web_search_queries"] = webSearchEvidenceQueries(searchEvidence)
	meta["web_search_result_count"] = webSearchEvidenceResultCount(searchEvidence)
	meta["web_search_relevance"] = relevanceRows
	meta["stage_durations_ms"] = map[string]any{"search": time.Since(start).Milliseconds()}
	if len(relevantEvidence) == 0 {
		meta["status"] = "no_relevant_evidence"
		meta["web_search_status"] = "no_relevant_results"
		meta["web_search_evidence"] = compactWebSearchEvidence(searchEvidence, webSearchMaxQueries, 2)
		meta["calibration_method"] = "first_pass_kept"
		meta["stage_durations_ms"] = map[string]any{"search": time.Since(start).Milliseconds(), "total": time.Since(start).Milliseconds()}
		logger.Info(ctx, "低成本搜索无有效食品证据",
			slog.String("execution_mode", executionMode),
			slog.Int("image_count", len(imageURLs)),
			slog.Any("web_search_relevance", relevanceRows),
			slog.Any("web_search_evidence", meta["web_search_evidence"]),
		)
		return nil, meta
	}
	meta["web_search_status"] = "relevant_results"
	meta["web_search_evidence"] = compactWebSearchEvidence(relevantEvidence, webSearchMaxQueries, 2)
	logger.Info(ctx, "低成本搜索证据已收集",
		slog.String("execution_mode", executionMode),
		slog.Int("image_count", len(imageURLs)),
		slog.Int("base_item_count", len(baseItems)),
		slog.Any("base_items", meta["base_items"]),
		slog.Any("web_search_evidence", meta["web_search_evidence"]),
	)
	merged, calibrationRows := applyRuleBasedWebSearchCalibration(baseParsed, relevantEvidence)
	if len(parseItems(merged)) == 0 {
		meta["status"] = "empty"
		return nil, meta
	}
	finalItems := parseItems(merged)
	meta["calibration_method"] = "rule_based_spec_extraction"
	meta["review_item_count"] = len(parseItems(merged))
	if compacted := compactHybridDebugItems(finalItems, 12); len(compacted) > 0 {
		meta["final_items"] = compacted
	}
	if changes := compactHybridItemChanges(baseItems, finalItems, 12); len(changes) > 0 {
		meta["item_changes"] = changes
	}
	meta["calibration_items"] = calibrationRows
	meta["stage_durations_ms"] = map[string]any{"search": time.Since(start).Milliseconds(), "calibration": 0, "total": time.Since(start).Milliseconds()}
	appliedCount := countAppliedCalibrationRows(calibrationRows)
	meta["calibration_applied_count"] = appliedCount
	if appliedCount == 0 {
		meta["status"] = "no_applicable_specs"
		meta["web_search_status"] = "no_applicable_specs"
		meta["calibration_method"] = "first_pass_kept"
		logger.Info(ctx, "低成本搜索未找到可应用规格",
			slog.String("execution_mode", executionMode),
			slog.Int("image_count", len(imageURLs)),
			slog.Int("item_count", len(finalItems)),
			slog.Any("hybrid_review", meta),
		)
		return nil, meta
	}
	meta["status"] = "applied"
	meta["web_search_status"] = "applied"
	logger.Info(ctx, "低成本搜索校准已应用",
		slog.String("execution_mode", executionMode),
		slog.Int("image_count", len(imageURLs)),
		slog.Int("item_count", len(finalItems)),
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
		return analyzeWithImagesTemperature(retryCtx, s.gemini35Client, prompt, imageURLs, 0)
	})
	if err != nil {
		logger.Warn(ctx, "Gemini 3.5 分组重量估算失败",
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
	logger.Info(ctx, "Gemini 3.5 分组估算已应用",
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
- 先估每组总毛重，再把组内毛重分配到各 item，并分别判断每项原图中是否存在不可食结构
- 优先利用包装净含量、可见数量、剩余比例、常见单个重量、盘子/手/包装尺寸、面积厚度、遮挡关系进行推理
- grossWeightGrams 是原图呈现状态的毛重，estimatedWeightGrams 是可食部净重，单位克
- 不输出营养，营养由后端数据库查表
- 每个 item 必须给 weightEvidence；如果是粗估，要说明依据和不确定性
- 返回 items 数量应尽量等于第一阶段 item 数量，并按第一阶段顺序输出

%s

只返回 JSON:
{
  "items":[{"name":"","type":"normal","grossWeightGrams":0,"hasInedibleParts":false,"ediblePortionRatio":100,"ediblePortionReason":"已是可直接食用状态","estimatedWeightGrams":0,"waterMl":0,"suggestedRatio":100,"groupId":1,"confidence":0.8,"recognitionEvidence":"","weightEvidence":"","alternativeNames":[]}],
  "groups":[{"groupId":1,"description":"","estimatedWeightGrams":0,"weightEvidence":""}],
  "description":"",
  "insight":"",
  "pfc_ratio_comment":"",
  "eating_order_advice":"",
  "absorption_notes":"",
  "context_advice":"",
  "ocrText":[]
}`, string(planBytes), additionalLine, imageEdiblePortionPromptRules())
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
			if grossWeight := numberFromAny(weightItem["grossWeightGrams"]); grossWeight > 0 {
				next["grossWeightGrams"] = grossWeight
			}
			if hasInedibleParts, ok := weightItem["hasInedibleParts"].(bool); ok {
				next["hasInedibleParts"] = hasInedibleParts
			}
			if edibleRatio := numberFromAny(weightItem["ediblePortionRatio"]); edibleRatio > 0 && edibleRatio <= 100 {
				next["ediblePortionRatio"] = edibleRatio
			}
			if reason := cleanAnalyzeText(weightItem["ediblePortionReason"]); reason != "" {
				next["ediblePortionReason"] = reason
			}
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
	for _, key := range []string{"description", "insight", "context_advice", "pfc_ratio_comment", "eating_order_advice", "absorption_notes"} {
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
		if source := strings.TrimSpace(fmt.Sprintf("%v", item["evidenceSource"])); source != "" && source != "<nil>" {
			row["evidence_source"] = truncateRunes(source, 120)
		}
		if sources := stringSliceFromAny(item["searchEvidenceUsed"]); len(sources) > 0 {
			row["search_evidence_used"] = limitStrings(sources, 5)
		}
		out = append(out, row)
	}
	return out
}

func compactWebSearchEvidence(evidence []WebSearchEvidence, queryLimit, resultLimit int) []map[string]any {
	if queryLimit <= 0 || len(evidence) == 0 {
		return nil
	}
	if resultLimit <= 0 {
		resultLimit = 2
	}
	if len(evidence) > queryLimit {
		evidence = evidence[:queryLimit]
	}
	out := make([]map[string]any, 0, len(evidence))
	for _, row := range evidence {
		query := strings.TrimSpace(row.Query)
		if query == "" {
			continue
		}
		results := row.Results
		if len(results) > resultLimit {
			results = results[:resultLimit]
		}
		compactResults := make([]map[string]any, 0, len(results))
		for _, result := range results {
			title := strings.TrimSpace(result.Title)
			snippet := strings.TrimSpace(result.Snippet)
			if title == "" && snippet == "" {
				continue
			}
			item := map[string]any{
				"title":   truncateRunes(title, 80),
				"snippet": truncateRunes(snippet, 160),
			}
			if url := strings.TrimSpace(result.URL); url != "" {
				item["url"] = truncateRunes(url, 160)
			}
			compactResults = append(compactResults, item)
		}
		out = append(out, map[string]any{
			"query":   query,
			"results": compactResults,
		})
	}
	return out
}

func compactHybridItemChanges(baseItems, finalItems []map[string]any, limit int) []map[string]any {
	if limit <= 0 || len(finalItems) == 0 {
		return nil
	}
	if len(finalItems) > limit {
		finalItems = finalItems[:limit]
	}
	out := make([]map[string]any, 0, len(finalItems))
	for index, finalItem := range finalItems {
		finalName := strings.TrimSpace(fmt.Sprintf("%v", finalItem["name"]))
		if finalName == "" || finalName == "<nil>" {
			continue
		}
		var baseItem map[string]any
		if index < len(baseItems) {
			baseItem = baseItems[index]
		}
		baseName := ""
		baseWeight := 0.0
		baseWater := 0.0
		if baseItem != nil {
			baseName = strings.TrimSpace(fmt.Sprintf("%v", baseItem["name"]))
			baseWeight = numberFromAny(baseItem["estimatedWeightGrams"])
			baseWater = numberFromAny(baseItem["waterMl"])
		}
		finalWeight := numberFromAny(finalItem["estimatedWeightGrams"])
		finalWater := numberFromAny(finalItem["waterMl"])
		nameChanged := baseName != "" && baseName != finalName
		weightDelta := round2(finalWeight - baseWeight)
		waterDelta := round2(finalWater - baseWater)
		changed := nameChanged || math.Abs(weightDelta) >= 0.01 || math.Abs(waterDelta) >= 0.01
		row := map[string]any{
			"index":           index,
			"changed":         changed,
			"before_name":     baseName,
			"after_name":      finalName,
			"before_weight_g": round2(baseWeight),
			"after_weight_g":  round2(finalWeight),
			"weight_delta_g":  weightDelta,
		}
		if baseWater > 0 || finalWater > 0 {
			row["before_water_ml"] = round2(baseWater)
			row["after_water_ml"] = round2(finalWater)
			row["water_delta_ml"] = waterDelta
		}
		if evidence := strings.TrimSpace(fmt.Sprintf("%v", finalItem["recognitionEvidence"])); evidence != "" && evidence != "<nil>" {
			row["recognition_evidence"] = truncateRunes(evidence, 120)
		}
		if evidence := strings.TrimSpace(fmt.Sprintf("%v", finalItem["weightEvidence"])); evidence != "" && evidence != "<nil>" {
			row["weight_evidence"] = truncateRunes(evidence, 160)
		}
		if source := strings.TrimSpace(fmt.Sprintf("%v", finalItem["evidenceSource"])); source != "" && source != "<nil>" {
			row["evidence_source"] = truncateRunes(source, 120)
		}
		if sources := stringSliceFromAny(finalItem["searchEvidenceUsed"]); len(sources) > 0 {
			row["search_evidence_used"] = limitStrings(sources, 5)
		}
		out = append(out, row)
	}
	return out
}

type webSearchComplexityDecision struct {
	Decision  string   `json:"decision"`
	Reasons   []string `json:"reasons"`
	ItemCount int      `json:"item_count"`
}

func decideWebSearchComplexity(parsed map[string]any) webSearchComplexityDecision {
	items := parseItems(parsed)
	reasons := []string{}
	searchCandidates := 0
	lowConfidence := 0
	abnormalWeight := 0
	for _, item := range items {
		if isHighPrioritySearchItem(item) {
			searchCandidates++
		}
		if confidence := numberFromAny(item["confidence"]); confidence > 0 && confidence < 0.65 {
			lowConfidence++
		}
		weight := numberFromAny(item["estimatedWeightGrams"])
		if weight <= 0 || weight > 900 {
			abnormalWeight++
		}
	}
	if searchCandidates > 0 {
		reasons = append(reasons, "包含包装食品、饮品或品牌商品，需要搜索规格")
	}
	if len(items) >= 4 {
		reasons = append(reasons, "食物数量较多")
	}
	if lowConfidence > 0 {
		reasons = append(reasons, "存在低置信度识别")
	}
	if abnormalWeight > 0 {
		reasons = append(reasons, "存在异常重量")
	}
	decision := "simple"
	if searchCandidates > 0 {
		decision = "search_calibration_needed"
	} else if len(items) >= 4 || lowConfidence > 0 || abnormalWeight > 0 {
		decision = "complex"
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "单个或少量常见食物，第一轮结果可直接使用")
	}
	return webSearchComplexityDecision{Decision: decision, Reasons: reasons, ItemCount: len(items)}
}

func filterRelevantWebSearchEvidence(evidence []WebSearchEvidence, baseItems []map[string]any) ([]WebSearchEvidence, []map[string]any) {
	if len(evidence) == 0 {
		return nil, nil
	}
	foodTerms := buildFoodSearchTerms(baseItems)
	filtered := make([]WebSearchEvidence, 0, len(evidence))
	relevanceRows := make([]map[string]any, 0, len(evidence))
	for _, row := range evidence {
		relevantResults := []WebSearchResult{}
		for _, result := range row.Results {
			if isRelevantFoodSearchResult(row.Query, result, foodTerms) {
				relevantResults = append(relevantResults, result)
			}
		}
		status := "irrelevant"
		if len(relevantResults) >= webSearchMinRelevantResults {
			status = "relevant"
			filtered = append(filtered, WebSearchEvidence{Query: row.Query, Results: relevantResults})
		}
		relevanceRows = append(relevanceRows, map[string]any{
			"query":          row.Query,
			"status":         status,
			"result_count":   len(row.Results),
			"relevant_count": len(relevantResults),
		})
	}
	return filtered, relevanceRows
}

func buildFoodSearchTerms(items []map[string]any) []string {
	terms := []string{}
	for _, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		terms = append(terms, splitFoodSearchTerms(name)...)
		for _, alt := range stringSliceFromAny(item["alternativeNames"]) {
			terms = append(terms, splitFoodSearchTerms(alt)...)
		}
	}
	terms = append(terms, []string{
		"食物", "食品", "营养", "热量", "净含量", "规格", "克", "g", "ml", "kcal",
		"冰淇淋", "蛋筒", "酸奶", "牛奶", "啤酒", "可乐", "饮料", "蛋糕", "饼干", "零食",
	}...)
	return uniqueNonEmptyStrings(terms, 32)
}

func splitFoodSearchTerms(name string) []string {
	name = strings.TrimSpace(name)
	if name == "" || name == "<nil>" {
		return nil
	}
	replacer := strings.NewReplacer("（", " ", "）", " ", "(", " ", ")", " ", "-", " ", "_", " ", "/", " ", "、", " ")
	fields := strings.Fields(replacer.Replace(name))
	terms := make([]string, 0, len(fields)+1)
	if len([]rune(name)) <= 12 {
		terms = append(terms, name)
	}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if len([]rune(field)) >= 2 {
			terms = append(terms, field)
		}
	}
	for _, keyword := range []string{"蜜雪冰城", "巧乐兹", "八喜", "BAXY", "光明", "伊利", "哈尔滨", "冰淇淋", "雪糕", "蛋筒", "酸奶", "啤酒", "可乐"} {
		if strings.Contains(name, keyword) {
			terms = append(terms, keyword)
		}
	}
	return terms
}

func uniqueNonEmptyStrings(values []string, limit int) []string {
	if limit <= 0 {
		limit = len(values)
	}
	capacity := len(values)
	if capacity > limit {
		capacity = limit
	}
	out := make([]string, 0, capacity)
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func isRelevantFoodSearchResult(query string, result WebSearchResult, foodTerms []string) bool {
	resultText := strings.ToLower(result.Title + " " + result.Snippet)
	if hasIrrelevantSearchNoise(resultText) {
		return false
	}
	foodHit := false
	for _, term := range foodTerms {
		term = strings.ToLower(strings.TrimSpace(term))
		if term != "" && strings.Contains(resultText, term) {
			foodHit = true
			break
		}
	}
	if !foodHit {
		return false
	}
	if hasSearchResultSpecOrNutritionSignal(resultText) {
		return true
	}
	return false
}

func hasIrrelevantSearchNoise(text string) bool {
	noises := []string{
		"汉语", "字义", "词典", "成语", "百度百科", "原神", "游戏", "官网-米哈游", "开放世界", "手持 的意思", "为什么男人",
		"招聘", "校园招聘", "社会招聘", "人才", "职位", "热招", "简历", "求职", "hotjob", "career", "job",
		"集团新闻", "签约仪式", "投资者关系", "企业文化",
	}
	for _, noise := range noises {
		if strings.Contains(text, strings.ToLower(noise)) {
			return true
		}
	}
	return false
}

func hasSearchResultSpecOrNutritionSignal(text string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return false
	}
	if weightSpecRe.MatchString(text) || kcalSpecRe.MatchString(text) || kjSpecRe.MatchString(text) {
		return true
	}
	if productTitleSpecRe.MatchString(text) {
		return true
	}
	if nutritionValueRe.MatchString(text) {
		return true
	}
	return false
}

var (
	weightSpecRe       = regexp.MustCompile(`(?i)(?:净含量|规格|重量|商品规格|content|net\s*weight|net\s*wt\.?)\s*(?:为|是|约|:|：)?\s*(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克|ml|毫升|mL|ML)`)
	productTitleSpecRe = regexp.MustCompile(`(?i)(?:^|[^\d])(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克|ml|毫升|mL|ML)(?:\s*(?:[*x×]\s*\d+)?\s*(?:装|支|杯|瓶|袋|盒|根|条|只|个|规格|参数|口味|风味|六合一|$))?`)
	kcalSpecRe         = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:kcal|千卡|大卡)`)
	kjSpecRe           = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:kj|kJ|千焦)`)
	nutritionValueRe   = regexp.MustCompile(`(?i)(?:能量|热量|蛋白质|脂肪|碳水化合物|碳水|钠|营养成分)[^。；;\n]{0,20}\d+(?:\.\d+)?\s*(?:kcal|千卡|大卡|kj|千焦|g|克|mg|毫克)`)
)

func applyRuleBasedWebSearchCalibration(baseParsed map[string]any, evidence []WebSearchEvidence) (map[string]any, []map[string]any) {
	merged := copyAnyMap(baseParsed)
	baseItems := parseItems(baseParsed)
	out := make([]map[string]any, 0, len(baseItems))
	rows := []map[string]any{}
	for index, item := range baseItems {
		next := copyAnyMap(item)
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		best, ok := findBestSpecForItem(name, evidence)
		if ok && best.WeightGrams > 0 && shouldApplySpecWeight(item, best.WeightGrams) {
			next["grossWeightGrams"] = best.WeightGrams
			next["estimatedWeightGrams"] = best.WeightGrams
			next["originalWeightGrams"] = best.WeightGrams
			if best.Unit == "ml" {
				next["waterMl"] = best.WeightGrams
			}
			next["weightEvidence"] = fmt.Sprintf("搜索结果“%s”提到%s，按规格校准为%.0fg。", best.Title, best.RawText, best.WeightGrams)
			next["evidenceSource"] = "search:" + best.Query
			next["searchEvidenceUsed"] = []string{best.Query, best.Title}
			rows = append(rows, map[string]any{
				"index":             index,
				"name":              name,
				"applied":           true,
				"weight_g":          best.WeightGrams,
				"source_query":      best.Query,
				"source_title":      best.Title,
				"source_spec":       best.RawText,
				"calibration_field": "estimatedWeightGrams",
			})
		} else {
			rows = append(rows, map[string]any{
				"index":   index,
				"name":    name,
				"applied": false,
				"reason":  "未找到可安全应用的规格或净含量",
			})
		}
		out = append(out, next)
	}
	merged["items"] = out
	return merged, rows
}

func countAppliedCalibrationRows(rows []map[string]any) int {
	count := 0
	for _, row := range rows {
		if applied, ok := row["applied"].(bool); ok && applied {
			count++
		}
	}
	return count
}

type webSearchSpec struct {
	Query       string
	Title       string
	RawText     string
	WeightGrams float64
	Unit        string
}

func findBestSpecForItem(name string, evidence []WebSearchEvidence) (webSearchSpec, bool) {
	itemTerms := splitFoodSearchTerms(name)
	for _, row := range evidence {
		for _, result := range row.Results {
			text := result.Title + " " + result.Snippet
			if !textMatchesAnyTerm(text, itemTerms) {
				continue
			}
			if !textMatchesProductEvidence(name, text) {
				continue
			}
			if spec, ok := extractSpecFromText(row.Query, result.Title, text); ok {
				return spec, true
			}
		}
	}
	return webSearchSpec{}, false
}

func textMatchesProductEvidence(name, text string) bool {
	name = strings.TrimSpace(name)
	text = strings.ToLower(strings.TrimSpace(text))
	if name == "" || text == "" {
		return false
	}
	if hasConflictingProductVariant(name, text) {
		return false
	}
	compactName := strings.ReplaceAll(strings.ToLower(name), " ", "")
	compactText := strings.ReplaceAll(text, " ", "")
	if compactName != "" && strings.Contains(compactText, compactName) {
		return true
	}
	tokens := productSearchTokens(name)
	if len(tokens) == 0 {
		return textMatchesAnyTerm(text, splitFoodSearchTerms(name))
	}
	hits := 0
	for _, token := range tokens {
		token = strings.ToLower(strings.TrimSpace(token))
		if token != "" && strings.Contains(text, token) {
			hits++
		}
	}
	switch {
	case len(tokens) >= 3:
		return hits >= 3
	case len(tokens) == 2:
		return hits >= 2
	default:
		return hits >= 1
	}
}

func hasConflictingProductVariant(name, text string) bool {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	lowerText := strings.ToLower(strings.TrimSpace(text))
	if strings.Contains(lowerName, "巧乐兹") {
		for _, variant := range []string{"巧恋果", "四个圈", "迷你", "mini", "脆筒", "经典巧脆棒"} {
			if strings.Contains(lowerText, strings.ToLower(variant)) && !strings.Contains(lowerName, strings.ToLower(variant)) {
				return true
			}
		}
	}
	return false
}

func textMatchesAnyTerm(text string, terms []string) bool {
	text = strings.ToLower(text)
	for _, term := range terms {
		term = strings.ToLower(strings.TrimSpace(term))
		if term != "" && strings.Contains(text, term) {
			return true
		}
	}
	return false
}

func extractSpecFromText(query, title, text string) (webSearchSpec, bool) {
	for _, match := range weightSpecRe.FindAllStringSubmatch(text, -1) {
		if len(match) < 3 {
			continue
		}
		value := numberFromString(match[1])
		unit := normalizeSpecUnit(match[2])
		grams := value
		switch unit {
		case "kg":
			grams = value * 1000
		case "g", "ml":
		default:
			continue
		}
		if grams <= 0 || grams > 2000 {
			continue
		}
		return webSearchSpec{
			Query:       query,
			Title:       title,
			RawText:     strings.TrimSpace(match[0]),
			WeightGrams: grams,
			Unit:        unit,
		}, true
	}
	for _, match := range productTitleSpecRe.FindAllStringSubmatch(title, -1) {
		if len(match) < 3 {
			continue
		}
		if isPerUnitSpecText(match[0]) {
			continue
		}
		value := numberFromString(match[1])
		unit := normalizeSpecUnit(match[2])
		grams := value
		switch unit {
		case "kg":
			grams = value * 1000
		case "g", "ml":
		default:
			continue
		}
		if grams <= 0 || grams > 2000 {
			continue
		}
		return webSearchSpec{
			Query:       query,
			Title:       title,
			RawText:     strings.TrimSpace(match[0]),
			WeightGrams: grams,
			Unit:        unit,
		}, true
	}
	if kcalSpecRe.MatchString(text) {
		return webSearchSpec{}, false
	}
	return webSearchSpec{}, false
}

func isPerUnitSpecText(text string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	return strings.Contains(text, "每") || strings.Contains(text, "per")
}

func normalizeSpecUnit(unit string) string {
	unit = strings.ToLower(strings.TrimSpace(unit))
	switch unit {
	case "kg", "千克", "公斤":
		return "kg"
	case "g", "克":
		return "g"
	case "ml", "毫升":
		return "ml"
	default:
		return unit
	}
}

func numberFromString(value string) float64 {
	var out float64
	_, _ = fmt.Sscanf(strings.TrimSpace(value), "%f", &out)
	return out
}

func shouldApplySpecWeight(item map[string]any, specWeight float64) bool {
	current := numberFromAny(item["estimatedWeightGrams"])
	if current <= 0 {
		return true
	}
	if specWeight < 10 || specWeight > 2000 {
		return false
	}
	ratio := specWeight / current
	return ratio >= 0.45 && ratio <= 2.2
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
			"如果疑似包装对象只露出很小一角、只有色块/封边/局部花纹，既读不到可靠文字，也无法确认是完整独立包装，不要输出为具体零食名；应视为证据不足并忽略。",
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

func buildLowCostWebSearchRefinePrompt(input AnalyzeInput, baseParsed map[string]any, searchEvidence []WebSearchEvidence, executionMode string) string {
	contextPayload := map[string]any{
		"task":              "基于原图和低成本搜索结果，对第一轮食物识别结果做轻量校准。重点只校准包装食品、品牌商品、小众水果、饮品容量、明确净含量和可作为空间锚点的物体。",
		"executionMode":     executionMode,
		"firstPassResult":   baseParsed,
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
			"搜索结果只作为外部佐证，不能替代图片证据；不可把搜索到但图片中不可见的食物新增到结果中。",
			"如果搜索结果给出明确商品规格、净含量、杯型容量、单个常见重量，且与图片 OCR/包装/视觉证据一致，可以据此修正 estimatedWeightGrams 或 waterMl。",
			"如果搜索证据与图片可见文字冲突，以图片 OCR、用户补充和原图为准；不确定时保持第一轮结果。",
			"包装食品未开封且搜索/OCR 指向明确净含量时，estimatedWeightGrams 优先采用净含量；若可见已开封或已食用，按可见剩余比例扣减，并写入 weightEvidence。",
			"搜索结果可作为空间锚点：若某个可见包装/杯/罐的规格已知，可用它校准旁边盘、碗、锅、杯的尺寸，但必须保守。",
			"不要仅凭 Logo 颜色或图案猜品牌；品牌名必须来自图片 OCR、用户补充或搜索证据与图片包装共同支持。",
			"每个被你修改名称、重量或 waterMl 的 item，必须写 evidenceSource：search:<搜索query或标题>、image_ocr、visual_estimate 或 first_pass_kept。",
			"如果没有搜索结果直接支撑某个商品规格，不要在 weightEvidence 中写“搜索显示/搜索证据显示”；只能写图片OCR、视觉估算或保持第一轮结果。",
			"searchEvidenceUsed 只填写真实使用过的搜索 query 或搜索结果标题；未使用搜索证据时必须返回空数组。",
			"只返回 JSON，不要输出 Markdown，不要输出解释性正文。",
		},
		"responseSchema": map[string]any{
			"description":    "简短餐食描述",
			"insight":        "一句自然健康建议",
			"context_advice": "",
			"modelAgreement": "agree|name_changed|weight_changed|conflict",
			"ocrText":        []string{},
			"items": []map[string]any{{
				"name":                 "食物名称",
				"type":                 "normal",
				"estimatedWeightGrams": 100,
				"waterMl":              0,
				"suggestedRatio":       100,
				"groupId":              1,
				"confidence":           0.8,
				"recognitionEvidence":  "为什么是这个食物",
				"weightEvidence":       "为什么是这个重量，搜索证据如何支持或为什么未采用搜索结果",
				"evidenceSource":       "search:<query或标题>|image_ocr|visual_estimate|first_pass_kept",
				"searchEvidenceUsed":   []string{},
				"alternativeNames":     []string{},
			}},
		},
	}
	bytes, _ := json.Marshal(contextPayload)
	return "你是食物图片低成本联网搜索校准助手。请同时查看原图和下列搜索证据，只做保守校准。\n" + string(bytes)
}

func mergeHybridReviewParsed(base, review map[string]any) map[string]any {
	merged := copyAnyMap(base)
	for _, key := range []string{"description", "insight", "context_advice", "pfc_ratio_comment", "eating_order_advice", "absorption_notes"} {
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

type MultiWebSearcher struct {
	searchers []WebSearcher
}

func NewMultiWebSearcher(searchers ...WebSearcher) *MultiWebSearcher {
	nonNil := make([]WebSearcher, 0, len(searchers))
	for _, searcher := range searchers {
		if searcher != nil {
			nonNil = append(nonNil, searcher)
		}
	}
	return &MultiWebSearcher{searchers: nonNil}
}

func (s *MultiWebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	var lastErr error
	for _, searcher := range s.searchers {
		results, err := searcher.Search(ctx, query, limit)
		if err != nil {
			lastErr = err
			continue
		}
		if len(results) > 0 {
			return results, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, nil
}

type So360WebSearcher struct {
	client *http.Client
}

func NewSo360WebSearcher() *So360WebSearcher {
	return &So360WebSearcher{client: &http.Client{Timeout: webSearchTimeout}}
}

func (s *So360WebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > webSearchMaxResults {
		limit = webSearchMaxResults
	}
	endpoint := "https://www.so.com/s?" + url.Values{"q": []string{query}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FoodLinkBot/1.0; +https://healthymax.cn)")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("360 search status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseSo360HTMLResults(string(data), limit), nil
}

type SogouWebSearcher struct {
	client *http.Client
}

func NewSogouWebSearcher() *SogouWebSearcher {
	return &SogouWebSearcher{client: &http.Client{Timeout: webSearchTimeout}}
}

func (s *SogouWebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > webSearchMaxResults {
		limit = webSearchMaxResults
	}
	endpoint := "https://www.sogou.com/web?" + url.Values{"query": []string{query}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FoodLinkBot/1.0; +https://healthymax.cn)")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("sogou search status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseSogouHTMLResults(string(data), limit), nil
}

type BingWebSearcher struct {
	client *http.Client
}

func NewBingWebSearcher() *BingWebSearcher {
	return &BingWebSearcher{client: &http.Client{Timeout: webSearchTimeout}}
}

func (s *BingWebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > webSearchMaxResults {
		limit = webSearchMaxResults
	}
	endpoint := "https://cn.bing.com/search?" + url.Values{"q": []string{query}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FoodLinkBot/1.0; +https://healthymax.cn)")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("bing search status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseBingHTMLResults(string(data), limit), nil
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
	bingResultBlockRe   = regexp.MustCompile(`(?is)<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>(.*?)</li>`)
	bingTitleRe         = regexp.MustCompile(`(?is)<h2[^>]*>\s*<a[^>]+href="([^"]*)"[^>]*>(.*?)</a>\s*</h2>`)
	bingSnippetRe       = regexp.MustCompile(`(?is)<p[^>]*>(.*?)</p>`)
	so360ResultBlockRe  = regexp.MustCompile(`(?is)<li[^>]+class="[^"]*res-list[^"]*"[^>]*>(.*?)</li>`)
	so360TitleRe        = regexp.MustCompile(`(?is)<a[^>]+href="([^"]*)"[^>]*>(.*?)</a>`)
	so360SnippetRe      = regexp.MustCompile(`(?is)<p[^>]+class="[^"]*res-desc[^"]*"[^>]*>(.*?)</p>`)
	sogouResultStartRe  = regexp.MustCompile(`(?is)<div[^>]+class="[^"]*(?:vrwrap|results)[^"]*"[^>]*>`)
	sogouTitleRe        = regexp.MustCompile(`(?is)<a[^>]+href="([^"]*)"[^>]*>(.*?)</a>`)
	sogouSnippetRe      = regexp.MustCompile(`(?is)<(?:p|div)[^>]+class="[^"]*(?:str_info|fz-mid|text-layout)[^"]*"[^>]*>(.*?)</(?:p|div)>`)
	htmlTagRe           = regexp.MustCompile(`(?is)<[^>]+>`)
	htmlWhitespaceRe    = regexp.MustCompile(`\s+`)
	duckRedirectParamRe = regexp.MustCompile(`[?&]uddg=([^&]+)`)
)

func parseSo360HTMLResults(raw string, limit int) []WebSearchResult {
	if limit <= 0 {
		limit = webSearchMaxResults
	}
	blocks := so360ResultBlockRe.FindAllStringSubmatch(raw, -1)
	results := make([]WebSearchResult, 0, limit)
	for _, blockMatch := range blocks {
		if len(blockMatch) < 2 {
			continue
		}
		block := blockMatch[1]
		titleMatch := so360TitleRe.FindStringSubmatch(block)
		if len(titleMatch) < 3 {
			continue
		}
		title := cleanHTMLText(titleMatch[2])
		if title == "" {
			continue
		}
		snippet := ""
		if snippetMatch := so360SnippetRe.FindStringSubmatch(block); len(snippetMatch) >= 2 {
			snippet = cleanHTMLText(snippetMatch[1])
		}
		results = append(results, WebSearchResult{
			Title:   truncateRunes(title, 80),
			Snippet: truncateRunes(snippet, 180),
			URL:     strings.TrimSpace(html.UnescapeString(titleMatch[1])),
		})
		if len(results) >= limit {
			break
		}
	}
	return results
}

func parseSogouHTMLResults(raw string, limit int) []WebSearchResult {
	if limit <= 0 {
		limit = webSearchMaxResults
	}
	blocks := splitSogouResultBlocks(raw)
	results := make([]WebSearchResult, 0, limit)
	for _, block := range blocks {
		titleMatch := sogouTitleRe.FindStringSubmatch(block)
		if len(titleMatch) < 3 {
			continue
		}
		title := cleanHTMLText(titleMatch[2])
		if title == "" {
			continue
		}
		snippet := ""
		if snippetMatch := sogouSnippetRe.FindStringSubmatch(block); len(snippetMatch) >= 2 {
			snippet = cleanHTMLText(snippetMatch[1])
		}
		results = append(results, WebSearchResult{
			Title:   truncateRunes(title, 80),
			Snippet: truncateRunes(snippet, 180),
			URL:     strings.TrimSpace(html.UnescapeString(titleMatch[1])),
		})
		if len(results) >= limit {
			break
		}
	}
	return results
}

func splitSogouResultBlocks(raw string) []string {
	matches := sogouResultStartRe.FindAllStringIndex(raw, -1)
	if len(matches) == 0 {
		return nil
	}
	blocks := make([]string, 0, len(matches))
	for index, match := range matches {
		start := match[0]
		end := len(raw)
		if index+1 < len(matches) {
			end = matches[index+1][0]
		}
		if start < end {
			blocks = append(blocks, raw[start:end])
		}
	}
	return blocks
}

func parseBingHTMLResults(raw string, limit int) []WebSearchResult {
	if limit <= 0 {
		limit = webSearchMaxResults
	}
	blocks := bingResultBlockRe.FindAllStringSubmatch(raw, -1)
	results := make([]WebSearchResult, 0, limit)
	for _, blockMatch := range blocks {
		if len(blockMatch) < 2 {
			continue
		}
		block := blockMatch[1]
		titleMatch := bingTitleRe.FindStringSubmatch(block)
		if len(titleMatch) < 3 {
			continue
		}
		title := cleanHTMLText(titleMatch[2])
		if title == "" {
			continue
		}
		snippet := ""
		if snippetMatch := bingSnippetRe.FindStringSubmatch(block); len(snippetMatch) >= 2 {
			snippet = cleanHTMLText(snippetMatch[1])
		}
		results = append(results, WebSearchResult{
			Title:   truncateRunes(title, 80),
			Snippet: truncateRunes(snippet, 180),
			URL:     strings.TrimSpace(html.UnescapeString(titleMatch[1])),
		})
		if len(results) >= limit {
			break
		}
	}
	return results
}

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
			logger.Warn(ctx, "标准图片联网搜索失败",
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
	highPriorityCandidates := []string{}
	normalCandidates := []string{}
	contextCandidates := []string{}
	if text := strings.TrimSpace(input.AdditionalContext); text != "" {
		contextCandidates = append(contextCandidates, text)
	}
	for _, item := range parseItems(doubaoParsed) {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name != "" && name != "未知食物" {
			if isHighPrioritySearchItem(item) {
				highPriorityCandidates = append(highPriorityCandidates, name)
			} else {
				normalCandidates = append(normalCandidates, name)
			}
		}
		for _, alt := range stringSliceFromAny(item["alternativeNames"]) {
			if isHighPrioritySearchItem(item) {
				highPriorityCandidates = append(highPriorityCandidates, alt)
			} else {
				normalCandidates = append(normalCandidates, alt)
			}
		}
	}
	if desc := strings.TrimSpace(fmt.Sprintf("%v", doubaoParsed["description"])); desc != "" && desc != "<nil>" {
		contextCandidates = append(contextCandidates, desc)
	}
	queries := []string{}
	seen := map[string]bool{}
	add := func(value string) {
		value = normalizeSearchQuery(value)
		if value == "" || seen[value] || len(queries) >= webSearchMaxQueries {
			return
		}
		seen[value] = true
		queries = append(queries, value)
	}
	for _, candidate := range highPriorityCandidates {
		add(buildProductSearchQuery(candidate) + " 型号 规格 多少克")
	}
	for _, candidate := range highPriorityCandidates {
		add(buildProductSearchQuery(candidate) + " 营养成分")
	}
	for _, candidate := range normalCandidates {
		add(candidate + " 食物 外观 营养")
	}
	for _, candidate := range contextCandidates {
		add(candidate + " 食物 外观 营养")
		add(candidate + " 包装 净含量 营养成分")
	}
	return limitStrings(queries, webSearchMaxQueries)
}

func isHighPrioritySearchItem(item map[string]any) bool {
	itemType := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["type"], item["food_type"]))))
	if strings.Contains(itemType, "pack") || strings.Contains(itemType, "snack") || strings.Contains(itemType, "包装") || strings.Contains(itemType, "预包装") {
		return true
	}
	name := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", item["name"])))
	terms := []string{
		"酸奶", "牛奶", "乳", "奶酪", "啤酒", "可乐", "饮料", "汽水", "果汁", "咖啡", "奶茶", "茶饮",
		"冰淇淋", "蛋筒", "甜筒", "蜜雪冰城",
		"光明", "伊利", "蒙牛", "哈尔滨", "雪花", "青岛", "百事", "可口可乐", "member", "mark",
		"净含量", "规格", "包装", "罐", "瓶", "盒", "杯", "袋",
	}
	for _, term := range terms {
		if strings.Contains(name, term) {
			return true
		}
	}
	return false
}

func buildProductSearchQuery(name string) string {
	tokens := productSearchTokens(name)
	if len(tokens) == 0 {
		return name
	}
	return strings.Join(tokens, " ")
}

func productSearchTokens(name string) []string {
	name = strings.TrimSpace(name)
	if name == "" || name == "<nil>" {
		return nil
	}
	lowerName := strings.ToLower(name)
	tokens := []string{}
	addIfContains := func(keyword string) {
		if strings.Contains(lowerName, strings.ToLower(keyword)) {
			tokens = append(tokens, keyword)
		}
	}
	if strings.Contains(name, "巧乐兹") {
		for _, keyword := range []string{"巧乐兹", "低糖", "抹茶", "可可", "巧克力", "雪糕", "冰淇淋"} {
			addIfContains(keyword)
		}
		return uniqueNonEmptyStrings(tokens, 8)
	}
	if strings.Contains(name, "八喜") || strings.Contains(lowerName, "baxy") {
		for _, keyword := range []string{"八喜", "BAXY", "牛奶", "香草", "草莓", "巧克力", "绿茶", "冰淇淋", "雪糕"} {
			addIfContains(keyword)
		}
		return uniqueNonEmptyStrings(tokens, 8)
	}
	for _, keyword := range []string{
		"蜜雪冰城", "光明", "伊利", "蒙牛", "雀巢", "哈尔滨", "哈啤", "雪花", "青岛", "百事", "可口可乐", "Member", "Mark",
		"低糖", "无糖", "抹茶", "可可", "巧克力", "草莓", "香草", "牛奶", "大粒", "原味", "绿茶",
		"冰淇淋", "雪糕", "蛋筒", "甜筒", "酸奶", "啤酒", "可乐", "咖啡", "饮料", "汽水", "奶茶", "饼干", "蛋糕",
	} {
		addIfContains(keyword)
	}
	if len(tokens) > 0 {
		return uniqueNonEmptyStrings(tokens, 10)
	}
	return splitFoodSearchTerms(name)
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
	if userID != "" && s.users != nil {
		user, _ = s.users.FindByID(ctx, userID)
	}
	prompt := buildPrompt(input, user, executionMode)
	provider, model := resolveModelConfig(input.ModelName)
	var client LLMClient
	if strings.TrimSpace(input.ModelName) == "" {
		if s.dashscopeClient != nil {
			provider = "qwen"
			model = qwen36FlashModel
			client = s.dashscopeClient
		} else if s.deepseek != nil && strings.TrimSpace(s.deepseek.APIKey) != "" {
			provider = "deepseek"
			model = s.deepseek.Model
			client = s.deepseek
		} else {
			return nil, fmt.Errorf("文字输入模式大模型未配置")
		}
	} else if provider == "deepseek" {
		if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
			return nil, fmt.Errorf("文字输入模式使用 DeepSeek，请配置 DEEPSEEK_API_KEY")
		}
		client = s.deepseek
		model = s.deepseek.Model
	} else if provider == "qwen" {
		if s.dashscopeClient == nil {
			return nil, fmt.Errorf("文字输入模式使用千问时，请配置 DASHSCOPE_API_KEY")
		}
		client = s.dashscopeClient
		model = qwen36FlashModel
	} else if provider == "doubao" {
		client = s.doubaoClient
	} else if provider == "gemini" || provider == "openai" {
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
	apm.AddEvent(ctx, "文字食物大模型识别开始",
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
	result, err := s.finalizeAnalyzeResponse(ctx, userID, parsed, input, executionMode, provider, model, durationMs)
	if err != nil {
		metrics.ObserveFoodAnalysis("text", provider, model, "finalize_error", time.Since(start), -1)
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "finalize"))
		return nil, err
	}
	apm.AddEvent(ctx, "文字食物识别结果收尾完成",
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
	if userID != "" && s.users != nil {
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
	if userID != "" && s.users != nil {
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
	} else if provider == "gemini" || provider == "openai" {
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
		"eating_order_advice":  optStr(parsed["eating_order_advice"]),
		"absorption_notes":     optStr(parsed["absorption_notes"]),
		"context_advice":       optStr(parsed["context_advice"]),
		"analysis_engine":      "db_first",
		"analysis_duration_ms": durationMs,
		"resolved_count":       len(items),
		"unresolved_count":     0,
	}

	if executionMode != validExecutionMode {
		resp["pfc_ratio_comment"] = nil
		resp["eating_order_advice"] = nil
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
			weight := numberFromAny(firstNonNil(item["estimatedWeightGrams"], item["weight"], item["estimated_weight_g"]))
			grossWeight := numberFromAny(firstNonNil(item["grossWeightGrams"], item["gross_weight_grams"], item["rawWeightGrams"], item["raw_weight_grams"]))
			if grossWeight <= 0 {
				grossWeight = numberFromAny(firstNonNil(item["originalGrossWeightGrams"], item["original_gross_weight_grams"]))
			}
			if grossWeight <= 0 {
				grossWeight = numberFromAny(firstNonNil(item["originalWeightGrams"], item["original_weight_g"], item["originalWeight"]))
			}
			if grossWeight <= 0 {
				grossWeight = weight
			}
			itemCount := numberFromAny(firstNonNil(item["itemCount"], item["item_count"]))
			unitWeight := numberFromAny(firstNonNil(item["estimatedUnitWeightGrams"], item["estimated_unit_weight_grams"], item["unitWeightGrams"]))
			unitWeight, unitWeightCalibrated := calibrateCountedProduceUnitWeight(name, unitWeight, item)
			if itemCount >= 1 && itemCount <= 100 && unitWeight > 0 {
				countedGrossWeight := itemCount * unitWeight
				if unitWeightCalibrated || grossWeight <= 0 || math.Abs(grossWeight-countedGrossWeight)/countedGrossWeight > 0.12 {
					if weight <= 0 || grossWeight <= 0 || math.Abs(weight-grossWeight)/grossWeight <= 0.12 {
						weight = countedGrossWeight
					}
					grossWeight = countedGrossWeight
				}
			}
			edibleRatio := numberFromAny(firstNonNil(item["ediblePortionRatio"], item["edible_portion_ratio"]))
			hasExplicitEdibleRatio := edibleRatio > 0 && edibleRatio <= 100
			if !hasExplicitEdibleRatio {
				if grossWeight > 0 && weight > 0 && weight <= grossWeight*1.05 {
					edibleRatio = clampRange(weight/grossWeight*100, 1, 100)
				} else {
					edibleRatio = 100
				}
			}
			if (hasExplicitEdibleRatio || unitWeightCalibrated) && grossWeight > 0 {
				weight = grossWeight * edibleRatio / 100
			}
			if weight <= 0 && grossWeight > 0 {
				weight = grossWeight * edibleRatio / 100
			}
			if grossWeight < weight {
				grossWeight = weight
				edibleRatio = 100
			}
			originalWeight := numberFromAny(firstNonNil(item["originalWeightGrams"], item["original_weight_g"], item["originalWeight"]))
			if originalWeight <= 0 || hasExplicitEdibleRatio || unitWeightCalibrated {
				originalWeight = weight
			}
			waterMl := numberFromAny(item["waterMl"])
			if waterMl <= 0 {
				waterMl = numberFromAny(item["water_ml"])
			}
			if waterMl < 0 {
				waterMl = 0
			}
			if weight > 0 && waterMl > weight {
				waterMl = weight
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
			suggestedRatio := numberFromAny(item["suggestedRatio"])
			if suggestedRatio < 0 || suggestedRatio > 100 {
				suggestedRatio = 100
			}
			next["name"] = name
			if unitWeightCalibrated {
				next["weightCalibrationReason"] = "鲜桃缺少称重或超大尺寸证据，单枚视觉估重按180g上限校准"
			}
			if itemCount >= 1 && itemCount <= 100 {
				next["itemCount"] = round2(itemCount)
			}
			if unitWeight > 0 {
				next["estimatedUnitWeightGrams"] = round2(unitWeight)
			}
			next["grossWeightGrams"] = round2(grossWeight)
			next["ediblePortionRatio"] = round2(edibleRatio)
			next["estimatedWeightGrams"] = round2(weight)
			next["originalWeightGrams"] = round2(originalWeight)
			next["waterMl"] = waterMl
			next["suggestedRatio"] = suggestedRatio
			next["nutrients"] = nutrients
			next["ingredients"] = normalizeItemIngredients(item["ingredients"])
			out = append(out, next)
		}
	}
	return out
}

func calibrateCountedProduceUnitWeight(name string, unitWeight float64, item map[string]any) (float64, bool) {
	if unitWeight <= 180 {
		return unitWeight, false
	}
	normalizedName := strings.ToLower(strings.TrimSpace(name))
	if !containsAnyAnalyzeText(normalizedName, []string{"桃子", "水蜜桃", "毛桃", "黄桃", "油桃"}) ||
		containsAnyAnalyzeText(normalizedName, []string{"樱桃", "猕猴桃", "桃子糖", "果脯", "果干", "罐头", "果酱", "果汁"}) {
		return unitWeight, false
	}
	evidence := strings.Join([]string{
		strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightEvidence"], item["weight_evidence"]))),
		strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["recognitionEvidence"], item["recognition_evidence"]))),
	}, " ")
	if containsAnyAnalyzeText(evidence, []string{"电子秤", "称重", "秤显示", "净含量", "净重", "包装规格", "明显超大", "特大果", "超大果"}) {
		return unitWeight, false
	}
	return 180, true
}

func normalizeItemIngredients(value any) map[string]any {
	if value == nil {
		return nil
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	text := cleanAnalyzeText(m["ingredientsText"])
	serving := cleanAnalyzeText(m["servingSize"])
	nutrition, _ := m["nutritionPer100g"].(map[string]any)
	if text == "" && serving == "" && len(nutrition) == 0 {
		return nil
	}
	normalized := map[string]any{}
	if text != "" {
		normalized["ingredientsText"] = text
	}
	if serving != "" {
		normalized["servingSize"] = serving
	}
	if len(nutrition) > 0 {
		normalized["nutritionPer100g"] = nutrition
	}
	return normalized
}

func ingredientLabelNutritionFromItem(item map[string]any) map[string]any {
	ingredients := mapFromAny(item["ingredients"])
	if len(ingredients) == 0 {
		return nil
	}
	nutrition := mapFromAny(ingredients["nutritionPer100g"])
	if len(nutrition) == 0 {
		return nil
	}
	nutrition, _ = normalizeIngredientLabelNutrition(nutrition)
	// Require at least one core macro to consider the label usable.
	hasCore := false
	for _, key := range []string{"calories", "protein", "fat", "carbs"} {
		if numberFromAny(nutrition[key]) > 0 {
			hasCore = true
			break
		}
	}
	if !hasCore {
		return nil
	}
	return nutrition
}

func normalizeIngredientLabelNutrition(nutrition map[string]any) (map[string]any, bool) {
	if len(nutrition) == 0 {
		return nutrition, false
	}
	out := copyAnyMap(nutrition)
	energyKj := numberFromAny(firstNonNil(
		out["energyKj"],
		out["energy_kj"],
		out["kilojoules"],
		out["kj"],
	))
	calories := numberFromAny(out["calories"])
	macroCalories := foodrecorddomain.MacroCalories(
		numberFromAny(out["protein"]),
		numberFromAny(out["carbs"]),
		numberFromAny(out["fat"]),
	)

	converted := false
	if energyKj > 0 {
		out["energyKj"] = round2(energyKj)
		calories = energyKj / kilojoulesPerKilocalorie
		converted = true
	} else if ingredientLabelCaloriesLooksLikeKilojoules(calories, macroCalories) {
		out["energyKj"] = round2(calories)
		calories /= kilojoulesPerKilocalorie
		converted = true
	}
	if converted {
		out["calories"] = round2(calories)
	}
	return out, converted
}

func ingredientLabelCaloriesLooksLikeKilojoules(calories, macroCalories float64) bool {
	if calories <= 0 || macroCalories <= 0 {
		return false
	}
	ratio := calories / macroCalories
	if ratio < 3.6 || ratio > 4.8 {
		return false
	}
	converted := calories / kilojoulesPerKilocalorie
	return math.Abs(converted-macroCalories)/macroCalories <= 0.12
}

func normalizeIngredientLabelEnergyInResult(result map[string]any) bool {
	changed := false
	var walk func(any)
	walk = func(value any) {
		switch current := value.(type) {
		case []any:
			for _, child := range current {
				walk(child)
			}
		case []map[string]any:
			for _, child := range current {
				walk(child)
			}
		case map[string]any:
			if normalizeIngredientLabelEnergyInItem(current) {
				changed = true
			}
			for _, child := range current {
				walk(child)
			}
		}
	}
	walk(result)
	return changed
}

func normalizeIngredientLabelEnergyInItem(item map[string]any) bool {
	if len(item) == 0 {
		return false
	}
	nutritionSource := strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source"]))
	resolveStatus := strings.TrimSpace(fmt.Sprintf("%v", item["resolve_status"]))
	if nutritionSource != "ingredient_label" && resolveStatus != "ingredient_label" {
		return false
	}
	ingredients := mapFromAny(item["ingredients"])
	label := mapFromAny(item["unit_nutrition_per_100g"])
	if len(label) == 0 && len(ingredients) > 0 {
		label = mapFromAny(ingredients["nutritionPer100g"])
	}
	if len(label) == 0 {
		return false
	}
	normalized, converted := normalizeIngredientLabelNutrition(label)
	if !converted {
		return false
	}
	item["unit_nutrition_per_100g"] = normalized
	if len(ingredients) > 0 {
		ingredients["nutritionPer100g"] = normalized
		item["ingredients"] = ingredients
	}
	weight := nutritionWeightFromItem(item)
	if weight > 0 {
		item["nutrients"] = scaleNutrition(normalized, weight)
	}
	return true
}

func buildIngredientLabelOutput(lookup lookupItem) map[string]any {
	next := copyAnyMap(lookup.item)
	next["resolve_status"] = "ingredient_label"
	next["resolve_score"] = 1.0
	next["is_unresolved"] = false
	next["nutrition_source"] = "ingredient_label"
	next["nutrition_source_category"] = "user_image_label"
	next["matched_food_id"] = nil
	next["matched_food_name"] = nil
	next["packaged_food_id"] = nil
	next["unit_nutrition_per_100g"] = lookup.ingredientLabel
	if ingredients := mapFromAny(next["ingredients"]); len(ingredients) > 0 {
		ingredients["nutritionPer100g"] = lookup.ingredientLabel
		next["ingredients"] = ingredients
	}
	next["nutrients"] = scaleNutrition(lookup.ingredientLabel, lookup.weight)
	next["estimatedWeightGrams"] = lookup.weight
	next["originalWeightGrams"] = lookup.weight
	ensureGrossWeightField(next, lookup.weight)
	return next
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

func (s *AnalyzeService) finalizeAnalyzeResponse(ctx context.Context, userID string, parsed map[string]any, input AnalyzeInput, executionMode, provider, model string, durationMs float64) (map[string]any, error) {
	resp := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	if strings.EqualFold(input.AnalysisEngine, "legacy_direct") {
		resp["analysis_engine"] = "legacy_direct"
		return s.applySuggestedRatios(ctx, resp, input), nil
	}
	fastMode := isFastExecutionMode(executionMode)
	postprocessCtx := ctx
	postprocessCancel := func() {}
	if fastMode {
		postprocessCtx, postprocessCancel = context.WithTimeout(ctx, fastPostprocessTimeout)
	}
	defer postprocessCancel()
	if fastMode {
		resp["items"] = withDefaultEdiblePortions(toItems(resp["items"]), "fast_default")
		resp["edible_portion_status"] = "fast_default"
		resp["edible_portion_applied_count"] = 0
	} else {
		resp = s.applyEdiblePortionRatios(postprocessCtx, resp, input)
	}
	resp = s.applyDBFirstNutritionWithOptions(postprocessCtx, resp, dbFirstNutritionOptions{
		additionalContext:            input.AdditionalContext,
		packagedIntegrationEnabled:   true,
		packagedExperimentCompatMode: isPackagedExperimentExecutionMode(executionMode),
		// Even fast mode may only reuse a non-exact library row after the small
		// no-thinking identity model confirms full equivalence. On timeout it
		// falls through to fresh nutrition estimation instead of fuzzy reuse.
		skipSemanticRerank:       false,
		nutritionFallbackTimeout: fastModeDuration(fastMode, fastNutritionFallbackTimeout),
	})
	resp = s.applySuggestedRatios(postprocessCtx, resp, input)
	return resp, nil
}

func fastModeDuration(enabled bool, value time.Duration) time.Duration {
	if enabled {
		return value
	}
	return 0
}

func (s *AnalyzeService) applyEdiblePortionRatios(ctx context.Context, resp map[string]any, input AnalyzeInput) map[string]any {
	items := toItems(resp["items"])
	if len(items) == 0 {
		resp["edible_portion_status"] = "no_items"
		return resp
	}
	base := withDefaultEdiblePortions(items, "default")
	if !needsEdiblePortionModel(base, input) {
		resp["items"] = withDefaultEdiblePortions(base, "deterministic")
		resp["edible_portion_status"] = "deterministic"
		resp["edible_portion_applied_count"] = 0
		return resp
	}
	client, provider, model := s.ediblePortionPostprocessClient()
	if client == nil {
		if strings.TrimSpace(input.Text) == "" && hasVisualEdiblePortionEstimate(items) {
			resp["items"] = withDefaultEdiblePortions(items, "vision_fallback")
		} else {
			resp["items"] = withFallbackEdiblePortions(items, "unavailable")
		}
		resp["edible_portion_status"] = "unavailable"
		return resp
	}
	prompt := buildEdiblePortionPrompt(base, input)
	callCtx, cancel := context.WithTimeout(ctx, ediblePortionTimeout)
	defer cancel()
	parsed, err := analyzePostprocess(callCtx, client, prompt)
	if err != nil {
		logger.Warn(ctx, "可食比例模型判定失败",
			logger.Err(err),
			slog.String("provider", provider),
			slog.String("model", model),
			slog.Int("item_count", len(items)),
		)
		if strings.TrimSpace(input.Text) == "" && hasVisualEdiblePortionEstimate(items) {
			resp["items"] = withDefaultEdiblePortions(items, "vision_fallback")
		} else {
			resp["items"] = withFallbackEdiblePortions(items, "failed")
		}
		resp["edible_portion_status"] = "fallback"
		resp["edible_portion_fallback_reason"] = "generation_failed"
		return resp
	}
	rows := parseEdiblePortionRows(parsed)
	out := make([]map[string]any, 0, len(base))
	applied := 0
	for index, item := range base {
		next := copyAnyMap(item)
		grossWeight := numberFromAny(next["grossWeightGrams"])
		if grossWeight <= 0 {
			grossWeight = numberFromAny(next["estimatedWeightGrams"])
		}
		ratio := numberFromAny(next["ediblePortionRatio"])
		reason := strings.TrimSpace(fmt.Sprintf("%v", next["ediblePortionReason"]))
		source := strings.TrimSpace(fmt.Sprintf("%v", next["ediblePortionSource"]))
		if row, ok := rows[index]; ok {
			ratio = row.ratio
			reason = row.reason
			source = provider
			applied++
		}
		if ratio <= 0 || ratio > 100 {
			ratio = 100
		}
		edibleWeight := grossWeight * ratio / 100
		if edibleWeight <= 0 {
			edibleWeight = numberFromAny(next["estimatedWeightGrams"])
		}
		if grossWeight < edibleWeight {
			grossWeight = edibleWeight
			ratio = 100
		}
		next["grossWeightGrams"] = round2(grossWeight)
		next["ediblePortionRatio"] = round2(ratio)
		next["estimatedWeightGrams"] = round2(edibleWeight)
		next["originalWeightGrams"] = round2(edibleWeight)
		capItemWaterMlToWeight(next)
		if reason != "" && reason != "<nil>" {
			next["ediblePortionReason"] = truncateEdiblePortionReason(reason)
		} else if ratio < 100 {
			next["ediblePortionReason"] = "已按不可食部分折算"
		} else {
			delete(next, "ediblePortionReason")
		}
		if source == "" || source == "<nil>" {
			source = "default"
		}
		next["ediblePortionSource"] = source
		out = append(out, next)
	}
	resp["items"] = out
	resp["edible_portion_status"] = "applied"
	resp["edible_portion_applied_count"] = applied
	return resp
}

var ediblePortionModelKeywords = []string{
	"小龙虾", "龙虾", "螃蟹", "蟹", "虾", "贝", "蛤", "牡蛎", "生蚝", "扇贝", "鱼",
	"鸡翅", "鸡腿", "鸡爪", "凤爪", "鸭腿", "鸭脖", "排骨", "羊排", "猪蹄", "带骨", "骨头", "整鸡", "烤鸡",
	"香蕉", "橙", "橘", "柚", "芒果", "牛油果", "榴莲", "西瓜", "哈密瓜", "菠萝", "凤梨", "椰",
	"桃", "李子", "杏", "樱桃", "荔枝", "龙眼", "桂圆", "山竹", "石榴", "火龙果", "苹果", "梨", "猕猴桃", "百香果",
	"玉米", "花生", "瓜子", "核桃", "板栗", "开心果", "带壳", "果核", "果皮", "鸡蛋", "鸭蛋", "鹅蛋",
}

func needsEdiblePortionModel(items []map[string]any, input AnalyzeInput) bool {
	if strings.TrimSpace(input.Text) == "" {
		allItemsHaveVisualStructure := len(items) > 0
		for _, item := range items {
			if ratio := numberFromAny(item["ediblePortionRatio"]); ratio > 0 && ratio < 99.5 {
				return true
			}
			hasInedibleParts, ok := item["hasInedibleParts"].(bool)
			if !ok {
				allItemsHaveVisualStructure = false
				continue
			}
			if hasInedibleParts {
				return true
			}
		}
		if allItemsHaveVisualStructure {
			return false
		}
	}
	for _, item := range items {
		ratio := numberFromAny(firstNonNil(item["ediblePortionRatio"], item["edible_portion_ratio"]))
		if ratio > 0 && ratio < 99.5 {
			continue
		}
		foodType := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", item["type"])))
		foodState := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["foodState"], item["food_state"]))))
		weightBasis := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightBasis"], item["weight_basis"]))))
		if foodType == "packaged" || foodState == "packaged" || weightBasis == "package_net" {
			continue
		}
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		name = strings.ReplaceAll(name, "鱼香", "")
		name = strings.ReplaceAll(name, "鸡腿菇", "")
		for _, keyword := range ediblePortionModelKeywords {
			if strings.Contains(name, keyword) {
				return true
			}
		}
	}
	return false
}

func hasVisualEdiblePortionEstimate(items []map[string]any) bool {
	for _, item := range items {
		if _, ok := item["hasInedibleParts"].(bool); !ok {
			continue
		}
		if ratio := numberFromAny(item["ediblePortionRatio"]); ratio > 0 && ratio <= 100 {
			return true
		}
	}
	return false
}

type dbFirstNutritionOptions struct {
	additionalContext            string
	packagedIntegrationEnabled   bool
	packagedExperimentCompatMode bool
	skipSemanticRerank           bool
	nutritionFallbackTimeout     time.Duration
}

type lookupItem struct {
	index              int
	item               map[string]any
	name               string
	nutritionName      string
	weight             float64
	resolve            *foodrecordrepo.ResolveResult
	packaged           *foodrecordrepo.PackagedResolveResult
	packagedCandidates []foodrecorddomain.PackagedFood
	ingredientLabel    map[string]any
}

type nutritionCandidateQuery struct {
	QueryName           string `json:"queryName"`
	OriginalName        string `json:"originalName"`
	FoodState           string `json:"foodState,omitempty"`
	WeightBasis         string `json:"weightBasis,omitempty"`
	RecognitionEvidence string `json:"recognitionEvidence,omitempty"`
}

type nutritionFallbackResult struct {
	rows map[int]map[string]any
	err  error
}

func (s *AnalyzeService) applyDBFirstNutrition(ctx context.Context, resp map[string]any, additionalContext ...string) map[string]any {
	options := dbFirstNutritionOptions{packagedIntegrationEnabled: true}
	if len(additionalContext) > 0 {
		options.additionalContext = additionalContext[0]
	}
	return s.applyDBFirstNutritionWithOptions(ctx, resp, options)
}

func (options dbFirstNutritionOptions) packagedResolverEnabled() bool {
	return options.packagedIntegrationEnabled || options.packagedExperimentCompatMode
}

func (s *AnalyzeService) applyDBFirstNutritionWithOptions(ctx context.Context, resp map[string]any, options dbFirstNutritionOptions) map[string]any {
	start := time.Now()
	resolveStatus := "success"
	defer func() {
		metrics.ObserveNutritionResolve("db_first", resolveStatus, time.Since(start))
	}()
	resp["analysis_engine"] = "db_first"
	items := toItems(resp["items"])
	if len(items) == 0 {
		resp["resolved_count"] = 0
		resp["unresolved_count"] = 0
		resolveStatus = "empty"
		return resp
	}

	lookups := make([]lookupItem, 0, len(items))
	lookupByIndex := map[int]lookupItem{}
	handled := map[int]bool{}
	fallbackCandidates := []UnresolvedNutritionCandidate{}
	semanticCandidates := map[int][]foodrecordrepo.SearchCandidate{}
	semanticQueries := map[int]nutritionCandidateQuery{}
	semanticEmbeddingEligible := map[int]bool{}
	resolvedCount := 0
	unresolvedCount := 0
	packagedResolutionTriggered := 0
	packagedResolutionMatched := 0
	packagedResolutionWeightApplied := 0
	packagedResolutionFallback := 0
	logger.Info(ctx, "营养库优先回算开始",
		slog.Int("item_count", len(items)),
		slog.Any("items", analyzeItemLogSummary(items, 12)),
	)
	apm.AddEvent(ctx, "营养库优先回算开始",
		attribute.Int("analysis.item_count", len(items)),
		attribute.String("analysis.items", summarizeAnalyzeItemsForTrace(items, 12)),
	)
	// Pass 1: detect ingredient labels first because they do not depend on the nutrition repo.
	ingredientLabelByIndex := map[int]map[string]any{}
	for index, item := range items {
		if labelNutrition := ingredientLabelNutritionFromItem(item); len(labelNutrition) > 0 {
			resolvedCount++
			handled[index] = true
			name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
			weight := nutritionWeightFromItem(item)
			logger.Info(ctx, "配料表营养标签已识别，优先用于最终计算",
				slog.String("food_name", name),
				slog.Float64("weight_g", round2(weight)),
			)
			ingredientLabelByIndex[index] = labelNutrition
		}
	}
	// Build lookups in original item order so the output preserves item order.
	for index, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		nutritionName := nutritionResolveName(item, name, options.additionalContext)
		weight := nutritionWeightFromItem(item)
		lookup := lookupItem{index: index, item: item, name: name, nutritionName: nutritionName, weight: weight}
		if labelNutrition, ok := ingredientLabelByIndex[index]; ok {
			lookup.ingredientLabel = labelNutrition
		}
		lookups = append(lookups, lookup)
		lookupByIndex[index] = lookup
	}
	if s.nutrition == nil {
		resolveStatus = "skipped_no_repo"
		logger.Warn(ctx, "营养回算已跳过：营养库未初始化",
			slog.Int("item_count", len(items)),
			slog.Int("resolved_count", resolvedCount),
			slog.Int("unresolved_count", len(items)-resolvedCount),
		)
		apm.AddEvent(ctx, "营养回算已跳过：营养库未初始化",
			attribute.Int("analysis.item_count", len(items)),
			attribute.Int("analysis.resolved_count", resolvedCount),
			attribute.Int("analysis.unresolved_count", len(items)-resolvedCount),
		)
		out := make([]map[string]any, 0, len(items))
		for index, item := range items {
			if lookup, ok := lookupByIndex[index]; ok {
				out = append(out, buildIngredientLabelOutput(lookup))
				continue
			}
			weight := nutritionWeightFromItem(item)
			next := copyAnyMap(item)
			next["resolve_status"] = "unresolved"
			next["is_unresolved"] = true
			next["resolve_score"] = 0
			next["nutrition_source"] = "unresolved"
			next["nutrition_source_category"] = ""
			next["matched_food_id"] = nil
			next["matched_food_name"] = nil
			next["packaged_food_id"] = nil
			unit := zeroUnitNutritionPer100g()
			next["unit_nutrition_per_100g"] = unit
			next["nutrients"] = scaleNutrition(unit, weight)
			next["estimatedWeightGrams"] = weight
			next["originalWeightGrams"] = weight
			ensureGrossWeightField(next, weight)
			out = append(out, next)
		}
		resp["items"] = out
		resp["resolved_count"] = resolvedCount
		resp["unresolved_count"] = len(items) - resolvedCount
		return resp
	}
	// Pass 2: database/packaged resolution for items without an ingredient label.
	for i := range lookups {
		if len(lookups[i].ingredientLabel) > 0 {
			continue
		}
		index := lookups[i].index
		item := lookups[i].item
		name := lookups[i].name
		weight := lookups[i].weight
		packagedResolveQuery := packagedFoodResolveQuery(item)
		packagedResolverEnabled := options.packagedResolverEnabled()
		packagedProbe := packagedFoodResolveEnabled && packagedResolverEnabled && shouldResolvePackagedFoodForDBFirst(item, packagedResolverEnabled)
		if packagedProbe {
			packagedResolutionTriggered++
			logger.Info(ctx, "包装食品库解析开始",
				slog.String("food_name", name),
				slog.String("food_type", strings.TrimSpace(fmt.Sprintf("%v", item["type"]))),
				slog.Float64("ai_estimated_weight_g", round2(weight)),
			)
			resolveWeight := weight
			if !hasStrongPackagedExperimentEvidence(item, "") {
				resolveWeight = 0
			}
			if packagedResolve, packagedErr := s.nutrition.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
				Name:       packagedResolveQuery,
				Brand:      strings.TrimSpace(fmt.Sprintf("%v", item["brand"])),
				FlavorText: strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["flavorText"], item["flavor_text"], item["flavor"]))),
				SpecText:   strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["specText"], item["spec_text"], item["packageSpec"]))),
				NetWeightG: resolveWeight,
				Barcode:    strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["barcode"], item["ean"], item["gtin"]))),
			}); packagedErr != nil {
				logger.Warn(ctx, "零食营养库查询失败",
					logger.Err(packagedErr),
					slog.String("food_name", name),
				)
			} else if packagedResolve != nil && packagedResolve.Food != nil {
				packagedCandidates := searchPackagedExperimentCandidates(ctx, s.nutrition, packagedResolveQuery, packagedResolve.Food)
				packagedResolutionMatched++
				logger.Info(ctx, "包装食品库命中",
					slog.String("food_name", name),
					slog.String("match_status", packagedResolve.Status),
					slog.Float64("match_score", round2(packagedResolve.Score)),
					slog.String("matched_food_id", packagedResolve.Food.ID),
					slog.String("matched_food_name", packagedFoodDisplayName(packagedResolve.Food)),
					slog.Float64("package_net_weight_g", round2(packagedFoodNetWeightForNutrition(packagedResolve.Food))),
					slog.Int("candidate_count", len(packagedCandidates)),
				)
				resolvedCount++
				lookups[i] = lookupItem{index: index, item: item, name: name, weight: weight, resolve: &foodrecordrepo.ResolveResult{Status: packagedResolve.Status, Score: packagedResolve.Score}, packaged: packagedResolve, packagedCandidates: packagedCandidates}
				continue
			}
			packagedCandidates := searchPackagedExperimentCandidates(ctx, s.nutrition, packagedResolveQuery, nil)
			if representative, exactCandidates, needsSelection := packagedCandidatesNeedSelection(packagedResolveQuery, item, packagedCandidates); needsSelection {
				packagedResolutionMatched++
				resolvedCount++
				lookups[i] = lookupItem{
					index:              index,
					item:               item,
					name:               name,
					nutritionName:      lookups[i].nutritionName,
					weight:             weight,
					resolve:            &foodrecordrepo.ResolveResult{Status: "multiple_candidates", Score: 1},
					packaged:           &foodrecordrepo.PackagedResolveResult{Food: representative, Status: "multiple_candidates", MatchSource: "exact_candidates", Score: 1},
					packagedCandidates: exactCandidates,
				}
				logger.Info(ctx, "包装食品存在多个精确规格候选，等待用户确认",
					slog.String("food_name", name),
					slog.Int("candidate_count", len(exactCandidates)),
				)
				continue
			}
			item["package_match_status"] = "not_found"
			item["package_weight_source"] = "ai_estimate"
			item["package_weight_applied"] = false
			item["package_weight_reason"] = "包装库未命中，已回退普通营养库"
			if len(packagedCandidates) > 0 {
				item["package_match_status"] = "candidates_only"
				item["package_weight_reason"] = "包装库找到候选但未达到自动命中，已回退普通营养库"
				item["packaged_candidates"] = resolvePackagedCandidateImageURLs(packagedCandidateDebugList(nil, packagedCandidates, "candidate"), s.storage)
			}
			logger.Info(ctx, "包装食品库未命中",
				slog.String("food_name", name),
				slog.Int("candidate_count", len(packagedCandidates)),
				slog.String("package_match_status", strings.TrimSpace(fmt.Sprintf("%v", item["package_match_status"]))),
			)
			packagedResolutionFallback++
		}
		resolve, err := s.nutrition.ResolveFood(ctx, lookups[i].nutritionName)
		if err != nil || resolve == nil || resolve.Food == nil {
			if err == nil && strings.TrimSpace(lookups[i].nutritionName) != "" {
				semanticQueries[index] = nutritionCandidateQuery{
					QueryName:           lookups[i].nutritionName,
					OriginalName:        name,
					FoodState:           strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["foodState"], item["food_state"]))),
					WeightBasis:         strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightBasis"], item["weight_basis"]))),
					RecognitionEvidence: strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["recognitionEvidence"], item["recognition_evidence"]))),
				}
				semanticEmbeddingEligible[index] = !shouldResolvePackagedFoodForDBFirst(item, options.packagedResolverEnabled())
				if candidates, candidateErr := s.nutrition.SearchCandidates(ctx, lookups[i].nutritionName, resolveFoodCandidateLimit); candidateErr == nil && len(candidates) > 0 {
					semanticCandidates[index] = candidates
				}
			}
			unresolvedCount++
			if weight > 0 {
				fallbackCandidates = append(fallbackCandidates, UnresolvedNutritionCandidate{
					Index:                index,
					Name:                 lookups[i].nutritionName,
					EstimatedWeightGrams: weight,
					FoodState:            strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["foodState"], item["food_state"]))),
					WeightBasis:          strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightBasis"], item["weight_basis"]))),
					BasisEvidence:        strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["basisEvidence"], item["basis_evidence"]))),
				})
			}
			lookups[i] = lookupItem{index: index, item: item, name: name, nutritionName: lookups[i].nutritionName, weight: weight, resolve: &foodrecordrepo.ResolveResult{Status: "unresolved", Score: 0}}
		} else {
			resolvedCount++
			lookups[i] = lookupItem{index: index, item: item, name: name, nutritionName: lookups[i].nutritionName, weight: weight, resolve: resolve}
		}
	}
	// Start fresh nutrition estimation at the same time as the semantic gate.
	// The result is used only for candidates that remain unresolved, so strict
	// library reuse stays authoritative without serially adding both timeouts.
	var fallbackResultCh <-chan nutritionFallbackResult
	fallbackCancel := func() {}
	if len(fallbackCandidates) > 0 {
		contextText := options.additionalContext
		logger.Info(ctx, "营养库未命中，并行启动模型营养补全",
			slog.Int("candidate_count", len(fallbackCandidates)),
			slog.Any("candidates", unresolvedNutritionCandidateLogSummary(fallbackCandidates, 12)),
		)
		apm.AddEvent(ctx, "营养库未命中，并行启动模型营养补全",
			attribute.Int("analysis.candidate_count", len(fallbackCandidates)),
			attribute.String("analysis.candidates", summarizeUnresolvedNutritionCandidates(fallbackCandidates, 12)),
		)
		fallbackCtx := ctx
		if options.nutritionFallbackTimeout > 0 {
			fallbackCtx, fallbackCancel = context.WithTimeout(ctx, options.nutritionFallbackTimeout)
		} else {
			fallbackCtx, fallbackCancel = context.WithCancel(ctx)
		}
		defer fallbackCancel()
		resultCh := make(chan nutritionFallbackResult, 1)
		fallbackResultCh = resultCh
		candidates := append([]UnresolvedNutritionCandidate(nil), fallbackCandidates...)
		go func() {
			rows, err := s.estimateNutritionWithFallback(fallbackCtx, candidates, contextText)
			resultCh <- nutritionFallbackResult{rows: rows, err: err}
		}()
	}

	// Exact trusted matches have already returned above. For every remaining
	// eligible query, combine lexical and embedding recall before the strict AI
	// equivalence gate. The two retrievers expose incomparable score scales, so
	// fuse their ranks instead of adding raw scores.
	if s.nutritionSemantic != nil && !options.skipSemanticRerank && len(semanticQueries) > 0 {
		eligibleIndices := make([]int, 0, len(semanticQueries))
		for index := range semanticQueries {
			if semanticEmbeddingEligible[index] {
				eligibleIndices = append(eligibleIndices, index)
			}
		}
		sort.Ints(eligibleIndices)
		if len(eligibleIndices) > 0 {
			queries := make([]string, 0, len(eligibleIndices))
			for _, index := range eligibleIndices {
				queries = append(queries, semanticQueries[index].QueryName)
			}
			embeddingCtx, embeddingCancel := context.WithTimeout(ctx, resolveFoodEmbeddingTimeout)
			embeddingCandidates, embeddingErr := s.nutritionSemantic.SearchCandidates(embeddingCtx, queries, resolveFoodCandidateLimit)
			embeddingCancel()
			if embeddingErr != nil {
				logger.Warn(ctx, "营养向量候选召回失败，保留原有回退链路",
					logger.Err(embeddingErr),
					slog.Int("query_count", len(queries)),
				)
			} else {
				for position, index := range eligibleIndices {
					var embeddingRows []foodrecordrepo.SearchCandidate
					if position < len(embeddingCandidates) {
						embeddingRows = embeddingCandidates[position]
					}
					merged := mergeNutritionCandidateRecall(semanticCandidates[index], embeddingRows, resolveFoodCandidateLimit)
					if len(merged) > 0 {
						semanticCandidates[index] = merged
					}
				}
			}
		}
	}

	if len(semanticCandidates) > 0 && !options.skipSemanticRerank {
		if decisions, err := s.rerankNutritionCandidatesWithAI(ctx, semanticQueries, semanticCandidates); err != nil {
			logger.Warn(ctx, "营养候选复用模型判定失败",
				logger.Err(err),
				slog.Int("candidate_group_count", len(semanticCandidates)),
			)
		} else {
			for index, decision := range decisions {
				if !isStrictNutritionReuseDecision(decision) {
					continue
				}
				for lookupIndex := range lookups {
					if lookups[lookupIndex].index != index {
						continue
					}
					candidates := semanticCandidates[index]
					if decision.SelectedCandidateIndex < 0 || decision.SelectedCandidateIndex >= len(candidates) {
						continue
					}
					selected := candidates[decision.SelectedCandidateIndex]
					food := selected.Food
					lookups[lookupIndex].resolve = &foodrecordrepo.ResolveResult{
						Food:        &food,
						Status:      "semantic_rerank",
						MatchSource: selected.MatchSource,
						Score:       decision.Confidence,
					}
					if decision.Reason != "" {
						lookups[lookupIndex].item["resolve_reason"] = decision.Reason
					}
					lookups[lookupIndex].item["standardized_food_name"] = food.CanonicalName
					if decision.Confidence >= 0.95 {
						if proposer, ok := s.nutrition.(nutritionAliasCandidateProposer); ok {
							_, _, model := s.runtimePostprocessClient()
							if strings.TrimSpace(model) == "" {
								model = deepSeekNutritionFallbackModel
							}
							if err := proposer.ProposeNutritionAliasCandidate(ctx, food.ID, lookups[lookupIndex].name, model, decision.Confidence, decision.Reason); err != nil {
								logger.Warn(ctx, "营养别名候选写入待审队列失败",
									slog.String("food_id", food.ID), slog.String("alias_name", lookups[lookupIndex].name),
									slog.String("reason", err.Error()))
							} else {
								logger.Info(ctx, "营养语义命中已进入别名待审队列",
									slog.String("food_id", food.ID), slog.String("alias_name", lookups[lookupIndex].name),
									slog.Float64("confidence", decision.Confidence))
							}
						}
					}
					if decision.ShouldAddAlias {
						logger.Info(ctx, "已跳过模型建议的永久营养别名写入",
							slog.String("food_id", food.ID),
							slog.String("alias_name", strings.TrimSpace(decision.AliasName)),
						)
					}
					resolvedCount++
					if unresolvedCount > 0 {
						unresolvedCount--
					}
					delete(semanticCandidates, index)
					break
				}
			}
		}
	}
	fallbackCandidates = unresolvedNutritionFallbackCandidates(lookups, fallbackCandidates)

	fallbacks := map[int]map[string]any{}
	if fallbackResultCh != nil {
		if len(fallbackCandidates) == 0 {
			fallbackCancel()
		} else {
			result := <-fallbackResultCh
			fallbackCancel()
			remaining := make(map[int]struct{}, len(fallbackCandidates))
			for _, candidate := range fallbackCandidates {
				remaining[candidate.Index] = struct{}{}
			}
			for index, row := range result.rows {
				if _, ok := remaining[index]; ok {
					fallbacks[index] = row
				}
			}
			if result.err == nil {
				logger.Info(ctx, "模型营养补全完成",
					slog.Int("candidate_count", len(fallbackCandidates)),
					slog.Int("generated_count", len(fallbacks)),
					slog.Any("generated_indexes", sortedIntKeys(fallbacks)),
				)
				apm.AddEvent(ctx, "模型营养补全完成",
					attribute.Int("analysis.candidate_count", len(fallbackCandidates)),
					attribute.Int("analysis.generated_count", len(fallbacks)),
				)
			} else {
				failedCount := len(fallbackCandidates) - len(fallbacks)
				metrics.AddNutritionResolveItems("db_first", "deepseek_fallback_failed", failedCount)
				logger.Warn(ctx, "营养补全模型部分或全部失败",
					logger.Err(result.err),
					slog.Int("candidate_count", len(fallbackCandidates)),
					slog.Int("generated_count", len(fallbacks)),
					slog.Int("failed_count", failedCount),
					slog.Any("generated_indexes", sortedIntKeys(fallbacks)),
				)
			}
		}
	}

	out := make([]map[string]any, 0, len(items))
	deepseekGeneratedCount := 0
	qwenGeneratedCount := 0
	geminiGeneratedCount := 0
	deepseekPersistedCount := 0
	deepseekPersistFailedCount := 0
	for _, lookup := range lookups {
		next := copyAnyMap(lookup.item)
		if len(lookup.ingredientLabel) > 0 {
			out = append(out, buildIngredientLabelOutput(lookup))
			continue
		}
		if lookup.packaged != nil && lookup.packaged.Food != nil {
			food := lookup.packaged.Food
			unit := packagedNutritionUnit(food)
			weight, weightMeta := packagedExperimentWeightForItem(lookup.item, food, lookup.packagedCandidates, lookup.packaged.Status, lookup.weight, options.packagedResolverEnabled(), s.storage)
			for key, value := range weightMeta {
				next[key] = value
			}
			if packagedCandidateNeedsConfirmation(weightMeta) {
				pendingWeight := packagedFallbackWeightForItem(lookup.item, lookup.weight)
				next["type"] = "snack"
				next["matched_food_id"] = nil
				next["matched_food_name"] = nil
				next["packaged_food_id"] = nil
				next["resolve_status"] = "packaged_needs_confirmation"
				next["resolve_score"] = lookup.packaged.Score
				next["is_unresolved"] = false
				next["nutrition_source"] = "packaged_candidate_pending"
				next["unit_nutrition_per_100g"] = zeroUnitNutritionPer100g()
				next["nutrients"] = zeroUnitNutritionPer100g()
				next["estimatedWeightGrams"] = round2(pendingWeight)
				next["originalWeightGrams"] = round2(pendingWeight)
				next["grossWeightGrams"] = round2(pendingWeight)
				next["ediblePortionRatio"] = 100.0
				next["ediblePortionSource"] = "packaged_candidate_pending"
				next["ediblePortionReason"] = "预包装食品待选择规格，不按带壳/带骨可食部扣减"
				out = append(out, next)
				continue
			}
			next["type"] = "snack"
			next["matched_food_id"] = food.ID
			next["packaged_food_id"] = food.ID
			next["matched_food_name"] = packagedFoodDisplayName(food)
			next["standardized_food_name"] = packagedFoodDisplayName(food)
			next["resolve_status"] = lookup.packaged.Status
			next["resolve_score"] = lookup.packaged.Score
			next["is_unresolved"] = false
			next["nutrition_source"] = "packaged_food_library"
			next["unit_nutrition_per_100g"] = unit
			next["nutrients"] = scaleNutrition(unit, weight)
			next["estimatedWeightGrams"] = weight
			next["originalWeightGrams"] = weight
			next["grossWeightGrams"] = weight
			next["ediblePortionRatio"] = 100.0
			next["ediblePortionSource"] = "packaged_food_library"
			next["ediblePortionReason"] = "预包装食品按确认净含量计入"
			if boolFromAny(weightMeta["package_weight_applied"]) {
				packagedResolutionWeightApplied++
			}
			out = append(out, next)
			continue
		}
		resolve := lookup.resolve
		if resolve == nil || resolve.Food == nil {
			unit := zeroUnitNutritionPer100g()
			next["matched_food_id"] = nil
			next["matched_food_name"] = nil
			next["resolve_status"] = "unresolved"
			next["is_unresolved"] = true
			next["resolve_score"] = 0
			next["nutrition_source"] = "unresolved"
			if fallbackUnit, ok := fallbacks[lookup.index]; ok && len(fallbackUnit) > 0 {
				fallbackSource := popFallbackSource(fallbackUnit, "deepseek_generated")
				if fallbackSource == "qwen_generated" {
					qwenGeneratedCount++
				} else if fallbackSource == "gemini_generated" {
					geminiGeneratedCount++
				} else {
					deepseekGeneratedCount++
				}
				unit = fallbackUnit
				next["resolve_status"] = fallbackSource
				next["is_unresolved"] = false
				next["nutrition_source"] = fallbackSource
				next["nutrition_persisted"] = false
				resolvedCount++
				if unresolvedCount > 0 {
					unresolvedCount--
				}
				if foodID, err := s.nutrition.UpsertDeepSeekNutrition(ctx, lookup.nutritionName, fallbackUnit, fallbackSource); err != nil {
					deepseekPersistFailedCount++
					logger.Warn(ctx, "智能营养补全写库失败",
						logger.Err(err),
						slog.String("food_name", lookup.name),
						slog.String("nutrition_source", fallbackSource),
						slog.Any("unit_nutrition_per_100g", fallbackUnit),
					)
				} else {
					deepseekPersistedCount++
					next["nutrition_persisted"] = true
					next["matched_food_id"] = foodID
					logger.Info(ctx, "智能营养补全写库成功",
						slog.String("food_name", lookup.name),
						slog.String("food_id", foodID),
						slog.String("nutrition_source", fallbackSource),
						slog.Any("unit_nutrition_per_100g", unit),
					)
				}
			} else {
				_ = s.nutrition.LogUnresolved(ctx, lookup.name)
			}
			if strings.TrimSpace(lookup.nutritionName) != "" {
				next["standardized_food_name"] = lookup.nutritionName
			}
			next["unit_nutrition_per_100g"] = unit
			next["nutrients"] = scaleGeneratedNutrition(unit, lookup.weight)
			next["estimatedWeightGrams"] = lookup.weight
			next["originalWeightGrams"] = lookup.weight
			ensureGrossWeightField(next, lookup.weight)
			out = append(out, next)
			continue
		}
		unit := nutritionUnit(resolve.Food)
		next["matched_food_id"] = resolve.Food.ID
		next["matched_food_name"] = resolve.Food.CanonicalName
		next["standardized_food_name"] = resolve.Food.CanonicalName
		next["resolve_status"] = resolve.Status
		next["resolve_score"] = resolve.Score
		next["is_unresolved"] = false
		resolvedNutritionSource := nutritionSource(resolve.Status)
		if foodrecorddomain.IsAIGeneratedNutritionSource(resolve.Food.Source) {
			resolvedNutritionSource = resolve.Food.Source
		}
		next["nutrition_source"] = resolvedNutritionSource
		next["unit_nutrition_per_100g"] = unit
		if foodrecorddomain.IsAIGeneratedNutritionSource(resolve.Food.Source) {
			next["nutrients"] = scaleGeneratedNutrition(unit, lookup.weight)
		} else {
			next["nutrients"] = scaleNutrition(unit, lookup.weight)
		}
		next["estimatedWeightGrams"] = lookup.weight
		next["originalWeightGrams"] = lookup.weight
		ensureGrossWeightField(next, lookup.weight)
		_ = resolve.MatchSource
		out = append(out, next)
	}
	for _, item := range out {
		capItemWaterMlToWeight(item)
		item["nutrition_source_category"] = nutritionSourceCategory(stringFromAny(item["nutrition_source"]))
	}
	resp["items"] = out
	resp["resolved_count"] = resolvedCount
	resp["unresolved_count"] = unresolvedCount
	if options.packagedResolverEnabled() {
		packagedMeta := map[string]any{
			"enabled":              true,
			"triggered_count":      packagedResolutionTriggered,
			"matched_count":        packagedResolutionMatched,
			"weight_applied_count": packagedResolutionWeightApplied,
			"fallback_count":       packagedResolutionFallback,
			"mode":                 "integrated",
		}
		resp["packaged_food_resolution"] = packagedMeta
		if options.packagedExperimentCompatMode {
			resp["packaged_experiment"] = map[string]any{
				"enabled":              true,
				"triggered_count":      packagedResolutionTriggered,
				"matched_count":        packagedResolutionMatched,
				"weight_applied_count": packagedResolutionWeightApplied,
				"fallback_count":       packagedResolutionFallback,
			}
		}
	}
	metrics.AddNutritionResolveItems("db_first", "resolved", resolvedCount)
	metrics.AddNutritionResolveItems("db_first", "unresolved", unresolvedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_generated", deepseekGeneratedCount)
	metrics.AddNutritionResolveItems("db_first", "qwen_generated", qwenGeneratedCount)
	metrics.AddNutritionResolveItems("db_first", "gemini_generated", geminiGeneratedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_persisted", deepseekPersistedCount)
	metrics.AddNutritionResolveItems("db_first", "deepseek_persist_failed", deepseekPersistFailedCount)
	logger.Info(ctx, "营养库优先回算完成",
		slog.Int("item_count", len(out)),
		slog.Int("resolved_count", resolvedCount),
		slog.Int("unresolved_count", unresolvedCount),
		slog.Int("deepseek_generated_count", deepseekGeneratedCount),
		slog.Int("qwen_generated_count", qwenGeneratedCount),
		slog.Int("gemini_generated_count", geminiGeneratedCount),
		slog.Int("deepseek_persisted_count", deepseekPersistedCount),
		slog.Int("deepseek_persist_failed_count", deepseekPersistFailedCount),
		slog.Any("items", analyzeItemLogSummary(out, 12)),
	)
	apm.AddEvent(ctx, "营养库优先回算完成",
		attribute.Int("analysis.item_count", len(out)),
		attribute.Int("analysis.resolved_count", resolvedCount),
		attribute.Int("analysis.unresolved_count", unresolvedCount),
		attribute.Int("analysis.deepseek_generated_count", deepseekGeneratedCount),
		attribute.Int("analysis.qwen_generated_count", qwenGeneratedCount),
		attribute.Int("analysis.gemini_generated_count", geminiGeneratedCount),
		attribute.Int("analysis.deepseek_persisted_count", deepseekPersistedCount),
		attribute.Int("analysis.deepseek_persist_failed_count", deepseekPersistFailedCount),
		attribute.String("analysis.items", summarizeAnalyzeItemsForTrace(out, 12)),
	)
	logDBFirstNutritionSummary(ctx, out, resolvedCount, unresolvedCount)
	return resp
}

func nutritionResolveName(item map[string]any, name, additionalContext string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	state := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["foodState"], item["food_state"]))))
	basis := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["weightBasis"], item["weight_basis"]))))
	itemEvidence := strings.Join([]string{
		name,
		strings.TrimSpace(fmt.Sprintf("%v", item["recognitionEvidence"])),
		strings.TrimSpace(fmt.Sprintf("%v", item["weightEvidence"])),
	}, " ")
	contextEvidence := strings.TrimSpace(additionalContext)
	contextAppliesToItem := strings.Contains(name, "燕麦") && strings.Contains(contextEvidence, "燕麦")

	explicitDryBasis := basis == "dry" || basis == "dry_weight" || containsAnyAnalyzeText(itemEvidence, []string{"干重", "干燕麦", "干麦片", "未泡"}) ||
		(contextAppliesToItem && containsAnyAnalyzeText(contextEvidence, []string{"干重", "干燕麦", "干麦片", "未泡"}))
	if explicitDryBasis {
		if strings.Contains(name, "燕麦") {
			return "燕麦片"
		}
		if base, ok := nutritionHydrationSensitiveBaseName(name); ok {
			return "干" + base
		}
		return name
	}
	cooked := state == "cooked" || containsAnyAnalyzeText(itemEvidence, []string{"煮熟", "熟制", "熟重"}) ||
		(contextAppliesToItem && containsAnyAnalyzeText(contextEvidence, []string{"煮熟", "熟制", "熟重"}))
	if cooked {
		if base, ok := nutritionHydrationSensitiveBaseName(name); ok {
			// 米粉库中明确区分干态和熟态，优先使用可直接精确命中的标准名。
			if base == "米粉" {
				return "米粉(熟)"
			}
			return "熟" + base
		}
	}
	weight := nutritionWeightFromItem(item)
	water := numberFromAny(firstNonNil(item["waterMl"], item["water_ml"]))
	highWaterOats := strings.Contains(name, "燕麦") && weight > 0 && water/weight >= 0.5
	hydrated := state == "hydrated" || state == "soaked" || highWaterOats || containsAnyAnalyzeText(itemEvidence, []string{"泡发", "泡开", "泡好", "水泡", "泡水", "浸泡", "泡过", "熟重", "湿重", "粥", "粥状"}) ||
		(contextAppliesToItem && containsAnyAnalyzeText(contextEvidence, []string{"泡发", "泡开", "泡好", "水泡", "泡水", "浸泡", "泡过", "熟重", "湿重", "粥", "粥状"}))
	if !hydrated {
		return name
	}
	if strings.Contains(name, "燕麦") {
		if strings.Contains(name, "奇亚籽") {
			return "奇亚籽燕麦粥"
		}
		return "燕麦粥"
	}
	if strings.Contains(name, "粥") || strings.Contains(name, "糊") {
		return name
	}
	if base, ok := nutritionHydrationSensitiveBaseName(name); ok {
		return "泡发" + base
	}
	return "泡发" + name
}

var nutritionHydrationSensitiveBaseNames = []string{
	"意大利面", "荞麦面", "乌冬面", "燕麦片",
	"米粉", "米线", "面条", "挂面", "粉条", "宽粉", "粉丝", "河粉", "意面",
	"燕麦", "木耳", "银耳", "腐竹",
}

func nutritionHydrationSensitiveBaseName(name string) (string, bool) {
	base := strings.TrimSpace(name)
	for _, suffix := range []string{"（熟）", "(熟)", "（干）", "(干)"} {
		base = strings.TrimSpace(strings.TrimSuffix(base, suffix))
	}
	for _, prefix := range []string{"泡发的", "泡好的", "泡发", "泡开", "浸泡", "煮熟的", "熟的", "煮熟", "熟", "干燥的", "干的", "干"} {
		if strings.HasPrefix(base, prefix) && len(base) > len(prefix) {
			base = strings.TrimSpace(strings.TrimPrefix(base, prefix))
			break
		}
	}
	for _, candidate := range nutritionHydrationSensitiveBaseNames {
		if base == candidate {
			return candidate, true
		}
	}
	return "", false
}

func containsAnyAnalyzeText(text string, tokens []string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	for _, token := range tokens {
		if token != "" && strings.Contains(text, strings.ToLower(token)) {
			return true
		}
	}
	return false
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
	if !needsSuggestedRatioModel(items, input) {
		resp["items"] = withDefaultSuggestedRatios(items, "not_needed")
		resp["suggest_ratio_enabled"] = true
		resp["suggest_ratio_status"] = "not_needed"
		resp["suggest_ratio_applied_count"] = 0
		return resp
	}
	client, provider, modelName := s.runtimePostprocessClient()
	if client == nil && s != nil && s.ofoxAIClient != nil {
		client = s.ofoxAIClient
		provider = "gemini"
		modelName = "gemini"
		if ofoxClient, ok := s.ofoxAIClient.(*OfoxAIClient); ok && strings.TrimSpace(ofoxClient.Model) != "" {
			modelName = ofoxClient.Model
		}
	}
	if client == nil {
		resp["items"] = withDefaultSuggestedRatios(items, "unavailable")
		resp["suggest_ratio_enabled"] = true
		resp["suggest_ratio_status"] = "unavailable"
		return resp
	}

	prompt := buildSuggestedRatioPrompt(items, input)
	callCtx, cancel := context.WithTimeout(ctx, ratioSuggestionTimeout)
	defer cancel()
	parsed, err := analyzeWithJSONParseRetryPolicy(callCtx, "suggest_ratio", provider, modelName, postprocessRetryPolicy, func(innerCtx context.Context) (map[string]any, error) {
		return analyzePostprocess(innerCtx, client, prompt)
	})
	if err != nil {
		logger.Warn(ctx, "建议摄入比例生成失败",
			logger.Err(err),
			slog.Int("item_count", len(items)),
		)
		resp["items"] = withDefaultSuggestedRatios(items, "failed")
		resp["suggest_ratio_enabled"] = true
		resp["suggest_ratio_status"] = "fallback"
		resp["suggest_ratio_fallback_reason"] = "generation_failed"
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

func needsSuggestedRatioModel(items []map[string]any, input AnalyzeInput) bool {
	if input.RemainingCalories == nil {
		return false
	}
	totalCalories := 0.0
	for _, item := range items {
		totalCalories += numberFromAny(mapFromAny(item["nutrients"])["calories"])
	}
	if totalCalories <= 0 {
		return false
	}
	remainingCalories := math.Max(0, *input.RemainingCalories)
	return totalCalories > remainingCalories+5
}

type suggestedRatioRow struct {
	ratio  float64
	reason string
}

type ediblePortionRow struct {
	ratio  float64
	reason string
}

func withDefaultEdiblePortions(items []map[string]any, source string) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		next := copyAnyMap(item)
		grossWeight := numberFromAny(firstNonNil(next["grossWeightGrams"], next["gross_weight_grams"], next["rawWeightGrams"], next["estimatedWeightGrams"]))
		if grossWeight < 0 {
			grossWeight = 0
		}
		edibleWeight := numberFromAny(next["estimatedWeightGrams"])
		ratio := numberFromAny(firstNonNil(next["ediblePortionRatio"], next["edible_portion_ratio"]))
		if ratio <= 0 || ratio > 100 {
			if grossWeight > 0 && edibleWeight > 0 && edibleWeight <= grossWeight*1.05 {
				ratio = clampRange(edibleWeight/grossWeight*100, 1, 100)
			} else {
				ratio = 100
			}
		}
		if edibleWeight <= 0 && grossWeight > 0 {
			edibleWeight = grossWeight * ratio / 100
		}
		if grossWeight < edibleWeight {
			grossWeight = edibleWeight
			ratio = 100
		}
		next["grossWeightGrams"] = round2(grossWeight)
		next["ediblePortionRatio"] = round2(ratio)
		next["estimatedWeightGrams"] = round2(edibleWeight)
		if numberFromAny(next["originalWeightGrams"]) <= 0 {
			next["originalWeightGrams"] = round2(edibleWeight)
		}
		if source != "" {
			next["ediblePortionSource"] = source
		}
		out = append(out, next)
	}
	return out
}

func withFallbackEdiblePortions(items []map[string]any, source string) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		next := copyAnyMap(item)
		weight := numberFromAny(firstNonNil(next["grossWeightGrams"], next["gross_weight_grams"], next["rawWeightGrams"], next["estimatedWeightGrams"]))
		if weight < 0 {
			weight = 0
		}
		next["grossWeightGrams"] = round2(weight)
		next["estimatedWeightGrams"] = round2(weight)
		if numberFromAny(next["originalWeightGrams"]) <= 0 {
			next["originalWeightGrams"] = round2(weight)
		}
		next["ediblePortionRatio"] = 100.0
		if source != "" {
			next["ediblePortionSource"] = source
		}
		delete(next, "ediblePortionReason")
		out = append(out, next)
	}
	return out
}

func parseEdiblePortionRows(parsed map[string]any) map[int]ediblePortionRow {
	out := map[int]ediblePortionRow{}
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
		rawRatio := numberFromAny(firstNonNil(row["ediblePortionRatio"], row["edible_ratio"], row["ratio"]))
		if rawRatio <= 0 || rawRatio > 100 {
			continue
		}
		reason := strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(row["reason"], row["ediblePortionReason"])))
		if reason == "<nil>" {
			reason = ""
		}
		out[index] = ediblePortionRow{
			ratio:  math.Round(rawRatio),
			reason: truncateEdiblePortionReason(reason),
		}
	}
	return out
}

func truncateEdiblePortionReason(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= 48 {
		return string(runes)
	}
	return string(runes[:48])
}

func ensureGrossWeightField(item map[string]any, fallbackWeight float64) {
	if item == nil {
		return
	}
	grossWeight := numberFromAny(item["grossWeightGrams"])
	if grossWeight <= 0 {
		grossWeight = fallbackWeight
		item["grossWeightGrams"] = round2(grossWeight)
	}
	ratio := numberFromAny(item["ediblePortionRatio"])
	if ratio <= 0 || ratio > 100 {
		if grossWeight > 0 && fallbackWeight > 0 && fallbackWeight <= grossWeight*1.05 {
			ratio = clampRange(fallbackWeight/grossWeight*100, 1, 100)
		} else {
			ratio = 100
		}
		item["ediblePortionRatio"] = round2(ratio)
	}
	if _, ok := item["ediblePortionSource"]; !ok {
		item["ediblePortionSource"] = "default"
	}
}

func buildEdiblePortionPrompt(items []map[string]any, input AnalyzeInput) string {
	payloadItems := make([]map[string]any, 0, len(items))
	for index, item := range items {
		payloadItems = append(payloadItems, map[string]any{
			"index":                      index,
			"name":                       strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			"type":                       firstNonNil(item["type"], item["food_type"]),
			"foodState":                  firstNonNil(item["foodState"], item["food_state"]),
			"weightBasis":                firstNonNil(item["weightBasis"], item["weight_basis"]),
			"grossWeightGrams":           round2(numberFromAny(item["grossWeightGrams"])),
			"visualHasInedibleParts":     firstNonNil(item["hasInedibleParts"], item["has_inedible_parts"]),
			"visualEdiblePortionRatio":   round2(numberFromAny(item["ediblePortionRatio"])),
			"visualEdiblePortionReason":  cleanAnalyzeText(item["ediblePortionReason"]),
			"visualEstimatedWeightGrams": round2(numberFromAny(item["estimatedWeightGrams"])),
			"waterMl":                    round2(numberFromAny(item["waterMl"])),
			"recognitionEvidence": strings.TrimSpace(fmt.Sprintf("%v",
				firstNonNil(item["recognitionEvidence"], item["recognition_evidence"]))),
			"weightEvidence": strings.TrimSpace(fmt.Sprintf("%v",
				firstNonNil(item["weightEvidence"], item["weight_evidence"]))),
		})
	}
	contextPayload := map[string]any{
		"task": "复核视觉模型基于原图给出的不可食结构、可食率和可食净重；必要时修正，输出最终可食部分比例。只返回 JSON。",
		"rules": []string{
			"第一步视觉模型已经看过原图；visualHasInedibleParts、visualEdiblePortionRatio、visualEdiblePortionReason 和 visualEstimatedWeightGrams 是它基于原图呈现状态给出的初判，不得忽略后仅按食物名称重新猜测。",
			"先检查视觉初判是否满足：只扣原图中实际存在的不可食结构、毛重与可食净重口径一致、grossWeightGrams × ediblePortionRatio / 100 等于可食净重。",
			"若视觉理由包含外皮/壳/骨/核/硬芯的厚度、体积、数量、包装或称重证据，应把它作为主要依据；常见食物出成率只用于校验明显偏差。",
			"不要按食物名称套固定比例；同一种食物在完整、已去皮、切块、去骨或包装净含量状态下可以有不同可食率。",
			"视觉初判自洽且没有明显违反常见物理结构时，保持 visualEdiblePortionRatio；只有存在明确结构或口径矛盾时才修正，并在 reason 写清修正依据。",
			"ediblePortionRatio 表示最终计入营养计算的比例，范围 1-100。",
			"不要根据减脂、控糖、多人分享或剩余热量调整比例；那些属于 suggestedRatio，不属于 ediblePortionRatio。",
			"不能因为不确定就机械改成 50 或 100；证据不足时优先保留视觉初判。",
		},
		"context": map[string]any{
			"mealType":          input.MealType,
			"additionalContext": strings.TrimSpace(input.AdditionalContext),
		},
		"items": payloadItems,
		"responseSchema": map[string]any{
			"items": []map[string]any{{
				"index":              0,
				"ediblePortionRatio": 100,
				"reason":             "",
			}},
		},
	}
	bytes, _ := json.Marshal(contextPayload)
	return "你是食物可食部比例复核助手。第一步视觉模型已经依据原图完成初估；请校验其结构和口径，只在有明确依据时修正，不做营养估算或摄入建议。\n" + string(bytes)
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
		"task": "为本餐每个食物生成建议摄入比例。该比例只作为结果页建议，不直接作为滑块初始值。",
		"rules": []string{
			"只返回 JSON，不要输出解释性正文。",
			"suggestedRatio 必须是 0 到 100 的整数；无法判断时填 100。",
			"suggestedRatio 只是建议摄入比例，不会自动改动用户最终滑块值；不要把它和可食部比例、去壳去骨比例混淆。",
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
	return "你是健康饮食决策助手。请根据用户上下文和本餐最终营养数据，给出每个食物的建议摄入比例。\n" + string(bytes)
}

func (s *AnalyzeService) estimateNutritionWithFallback(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	if s.nutritionAI != nil {
		return s.nutritionAI.Estimate(ctx, candidates, additionalContext)
	}
	if s.deepseek == nil || strings.TrimSpace(s.deepseek.APIKey) == "" {
		return nil, fmt.Errorf("DeepSeek 营养补全客户端未配置")
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
	logger.Info(ctx, "营养库优先查询汇总", fields...)
	apm.AddEvent(ctx, "营养库优先查询汇总",
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

func nutritionWeightFromItem(item map[string]any) float64 {
	weight := numberFromAny(item["estimatedWeightGrams"])
	if weight > 0 {
		return weight
	}
	weight = numberFromAny(item["originalWeightGrams"])
	if weight > 0 {
		return weight
	}
	waterMl := waterMlFromItem(item)
	if waterMl > 0 {
		return waterMl
	}
	return 0
}

func waterMlFromItem(item map[string]any) float64 {
	waterMl := numberFromAny(firstNonNil(item["waterMl"], item["water_ml"]))
	if waterMl > 0 {
		return waterMl
	}
	if nutrients := mapFromAny(item["nutrients"]); len(nutrients) > 0 {
		waterMl = numberFromAny(firstNonNil(nutrients["waterMl"], nutrients["water_ml"]))
		if waterMl > 0 {
			return waterMl
		}
	}
	return 0
}

func capItemWaterMlToWeight(item map[string]any) {
	if item == nil {
		return
	}
	weight := numberFromAny(firstNonNil(item["estimatedWeightGrams"], item["weight"], item["estimated_weight_g"], item["originalWeightGrams"]))
	if weight <= 0 {
		return
	}
	waterMl := waterMlFromItem(item)
	if waterMl <= weight {
		return
	}
	waterMl = round2(weight)
	item["waterMl"] = waterMl
	if _, ok := item["water_ml"]; ok {
		item["water_ml"] = waterMl
	}
	if nutrients := mapFromAny(item["nutrients"]); len(nutrients) > 0 {
		if _, ok := nutrients["waterMl"]; ok {
			nutrients["waterMl"] = waterMl
		}
		if _, ok := nutrients["water_ml"]; ok {
			nutrients["water_ml"] = waterMl
		}
	}
}

func nutritionUnit(food *foodrecorddomain.FoodNutrition) map[string]any {
	unit := map[string]any{
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
	if foodrecorddomain.IsAIGeneratedNutritionSource(food.Source) {
		unit["calories"] = foodrecorddomain.MacroCalories(food.ProteinPer100g, food.CarbsPer100g, food.FatPer100g)
	}
	return unit
}

func packagedNutritionUnit(food *foodrecorddomain.PackagedFood) map[string]any {
	if food == nil {
		return zeroUnitNutritionPer100g()
	}
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

func modelDeclaredPackagedFood(item map[string]any) bool {
	itemType := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["type"], item["food_type"]))))
	switch itemType {
	case "snack", "packaged", "package", "packaged_food", "packaged_snack", "prepackaged", "prepackaged_food", "pre_packaged", "pre_packaged_food", "pre-packaged", "pre-packaged food", "零食", "包装食品", "预包装", "预包装食品":
		item["type"] = "snack"
		return true
	}
	return false
}

func shouldResolvePackagedFoodForDBFirst(item map[string]any, resolverEnabled bool) bool {
	if modelDeclaredPackagedFood(item) {
		return true
	}
	if !resolverEnabled {
		return false
	}
	for _, key := range []string{"barcode", "ean", "gtin", "brand", "specText", "spec_text", "packageSpec", "flavorText", "flavor_text"} {
		if strings.TrimSpace(fmt.Sprintf("%v", item[key])) != "" && strings.TrimSpace(fmt.Sprintf("%v", item[key])) != "<nil>" {
			item["type"] = "snack"
			return true
		}
	}
	name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
	if looksLikePackagedFoodName(name) {
		item["type"] = "snack"
		return true
	}
	evidenceText := packagedFoodEvidenceText(item)
	if looksLikePackagedFoodName(strings.TrimSpace(name + " " + evidenceText)) {
		item["type"] = "snack"
		return true
	}
	return false
}

func looksLikePackagedFoodName(name string) bool {
	text := strings.ToLower(strings.TrimSpace(name))
	if text == "" {
		return false
	}
	brandKeywords := []string{
		"八喜", "baxy", "巧乐兹", "伊利", "蒙牛", "光明", "喜之郎", "cici", "乐事", "可比克", "奥利奥", "旺旺", "三只松鼠", "良品铺子", "雀巢", "nescafe", "三得利", "suntory", "百事", "可口可乐", "元气森林", "农夫山泉", "康师傅", "统一", "哈尔滨", "哈啤", "雪花", "青岛", "蜜雪冰城", "桃李", "士力架", "snickers", "达利园", "卫龙", "有友", "君乐宝", "味全", "ritter",
	}
	categoryKeywords := []string{
		"冰淇淋", "雪糕", "蛋筒", "果冻", "果冻爽", "果汁", "薯片", "饼干", "巧克力", "蛋糕", "面包", "豆沙", "小饼", "奶茶", "咖啡", "酸奶", "牛乳", "乳", "饮料", "汽水", "啤酒", "辣条", "小面筋", "锅巴", "竹笋", "棒", "条", "袋", "罐", "瓶", "盒",
	}
	hasBrand := false
	for _, keyword := range brandKeywords {
		if strings.Contains(text, strings.ToLower(keyword)) {
			hasBrand = true
			break
		}
	}
	if !hasBrand {
		return false
	}
	for _, keyword := range categoryKeywords {
		if strings.Contains(text, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func packagedFoodResolveQuery(item map[string]any) string {
	name := cleanAnalyzeText(item["name"])
	evidence := packagedFoodEvidenceText(item)
	parts := nonEmptyStringParts(name, evidence)
	if len(parts) == 0 {
		return ""
	}
	return truncateRunes(strings.Join(parts, " "), 360)
}

func packagedFoodEvidenceText(item map[string]any) string {
	if len(item) == 0 {
		return ""
	}
	parts := make([]string, 0, 16)
	seen := map[string]struct{}{}
	add := func(value any) {
		text := cleanAnalyzeText(value)
		if text == "" {
			return
		}
		key := strings.ToLower(text)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		parts = append(parts, text)
	}
	for _, key := range []string{
		"brand", "brandName", "brand_name",
		"flavorText", "flavor_text", "flavor",
		"specText", "spec_text", "packageSpec", "package_spec",
		"barcode", "ean", "gtin",
		"ocrRawText", "ocr_raw_text", "packageText", "package_text", "rawText", "raw_text",
		"recognitionEvidence", "recognition_evidence", "visualEvidence", "visual_evidence",
		"weightEvidence", "weight_evidence", "itemHint", "item_hint",
	} {
		if values := stringSliceFromAny(item[key]); len(values) > 0 {
			for _, value := range values {
				add(value)
			}
			continue
		}
		add(item[key])
	}
	for _, key := range []string{"ocrText", "ocr_text", "ocr"} {
		for _, value := range stringSliceFromAny(item[key]) {
			add(value)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return truncateRunes(strings.Join(parts, " "), 300)
}

func searchPackagedExperimentCandidates(ctx context.Context, repo NutritionResolver, name string, matched *foodrecorddomain.PackagedFood) []foodrecorddomain.PackagedFood {
	candidates := []foodrecorddomain.PackagedFood{}
	if repo != nil && strings.TrimSpace(name) != "" {
		if rows, err := repo.SearchPackagedFood(ctx, name, 10); err == nil {
			candidates = append(candidates, filterPackagedExperimentRelevantCandidates(name, rows)...)
		}
	}
	if matched != nil {
		found := false
		for _, candidate := range candidates {
			if candidate.ID == matched.ID {
				found = true
				break
			}
		}
		if !found {
			candidates = append([]foodrecorddomain.PackagedFood{*matched}, candidates...)
		}
	}
	if len(candidates) > 10 {
		candidates = candidates[:10]
	}
	return candidates
}

func filterPackagedExperimentRelevantCandidates(name string, candidates []foodrecorddomain.PackagedFood) []foodrecorddomain.PackagedFood {
	name = strings.TrimSpace(name)
	if name == "" || len(candidates) <= 1 {
		return candidates
	}
	queryFlavors := packagedExperimentFlavorGroups(name)
	out := make([]foodrecorddomain.PackagedFood, 0, len(candidates))
	for _, candidate := range candidates {
		if len(queryFlavors) > 0 {
			candidateText := candidate.Brand + candidate.ProductName + stringPtrValue(candidate.FlavorText) + stringPtrValue(candidate.OCRRawText)
			candidateFlavors := packagedExperimentFlavorGroups(candidateText)
			matchedFlavor := false
			for group := range queryFlavors {
				if candidateFlavors[group] {
					matchedFlavor = true
					break
				}
			}
			if !matchedFlavor && len(candidateFlavors) > 0 {
				continue
			}
		}
		out = append(out, candidate)
	}
	if len(out) == 0 {
		return candidates
	}
	return out
}

// packagedCandidatesNeedSelection keeps multiple package specifications visible
// without promoting one fuzzy candidate to a nutrition match. Only candidates
// whose product identity is an exact normalized match are eligible; the actual
// package specification remains pending until stronger evidence or user choice.
func packagedCandidatesNeedSelection(query string, item map[string]any, candidates []foodrecorddomain.PackagedFood) (*foodrecorddomain.PackagedFood, []foodrecorddomain.PackagedFood, bool) {
	if hasStrongPackagedExperimentEvidence(item, "") || len(candidates) < 2 {
		return nil, nil, false
	}
	normalizedQuery := normalizePackagedExperimentText(query)
	if normalizedQuery == "" {
		return nil, nil, false
	}
	exact := make([]foodrecorddomain.PackagedFood, 0, len(candidates))
	for _, candidate := range candidates {
		identities := []string{
			candidate.ProductName,
			candidate.NormalizedName,
			strings.TrimSpace(candidate.Brand + candidate.ProductName),
		}
		matched := false
		for _, identity := range identities {
			if normalizePackagedExperimentText(identity) == normalizedQuery {
				matched = true
				break
			}
		}
		if matched {
			exact = append(exact, candidate)
		}
	}
	if len(exact) < 2 || !hasAmbiguousPackagedExperimentWeights(exact) {
		return nil, nil, false
	}
	for index := 1; index < len(exact); index++ {
		if !samePackagedProduct(&exact[0], &exact[index]) {
			return nil, nil, false
		}
	}
	representative := exact[0]
	return &representative, exact, true
}

func packagedExperimentWeightForItem(item map[string]any, food *foodrecorddomain.PackagedFood, candidates []foodrecorddomain.PackagedFood, matchStatus string, fallbackWeight float64, experimentEnabled bool, storageClient *storage.Client) (float64, map[string]any) {
	meta := map[string]any{}
	if !experimentEnabled || food == nil {
		return fallbackWeight, meta
	}
	fallbackWeight = packagedFallbackWeightForItem(item, fallbackWeight)
	sameProductCandidates := samePackagedProductCandidates(food, candidates)
	meta["package_match_status"] = "matched"
	meta["package_match_confidence"] = 1.0
	meta["package_weight_applied"] = false
	meta["package_weight_source"] = "ai_estimate"
	meta["package_weight_reason"] = "包装库命中，但未找到可安全应用的规格重量"
	meta["packaged_candidates"] = resolvePackagedCandidateImageURLs(packagedCandidateDebugList(food, candidates, matchStatus), storageClient)

	userWeight, userReason := explicitWeightFromAnalyzeItem(item)
	if userWeight > 0 {
		meta["package_weight_applied"] = true
		meta["package_weight_source"] = "user_context"
		meta["package_weight_reason"] = userReason
		return round2(userWeight), meta
	}
	if hasAmbiguousPackagedExperimentWeights(sameProductCandidates) && !hasStrongPackagedExperimentEvidence(item, matchStatus) {
		meta["package_match_status"] = "packaged_needs_confirmation"
		meta["package_weight_source"] = "candidate_pending"
		meta["package_weight_reason"] = "包装库存在多个可能规格，且本次没有条码、OCR净含量或用户规格，需要用户选择规格"
		meta["packaged_candidates"] = resolvePackagedCandidateImageURLs(packagedCandidateDebugList(food, sameProductCandidates, matchStatus), storageClient)
		return fallbackWeight, meta
	}
	if packageWeight := packagedFoodNetWeightForNutrition(food); packageWeight > 0 {
		if conflict, reason := packagedWeightConflictsWithVisualEstimate(food, packageWeight, fallbackWeight); conflict && !hasStrongPackagedExperimentEvidence(item, matchStatus) {
			meta["package_match_status"] = "matched_weight_conflict"
			meta["package_weight_source"] = "ai_estimate"
			meta["package_weight_reason"] = reason
			return round2(fallbackWeight), meta
		}
		meta["package_weight_applied"] = true
		meta["package_weight_source"] = "packaged_food_library"
		meta["package_weight_reason"] = fmt.Sprintf("命中包装库规格/净含量 %s，按完整包装计入", packagedFoodNetContentLabel(food))
		return round2(packageWeight), meta
	}
	return fallbackWeight, meta
}

func samePackagedProductCandidates(matched *foodrecorddomain.PackagedFood, candidates []foodrecorddomain.PackagedFood) []foodrecorddomain.PackagedFood {
	if matched == nil {
		return candidates
	}
	out := make([]foodrecorddomain.PackagedFood, 0, len(candidates)+1)
	seen := map[string]bool{}
	add := func(food foodrecorddomain.PackagedFood) {
		if food.ID != "" && seen[food.ID] {
			return
		}
		if food.ID != "" {
			seen[food.ID] = true
		}
		out = append(out, food)
	}
	add(*matched)
	for _, candidate := range candidates {
		if samePackagedProduct(matched, &candidate) {
			add(candidate)
		}
	}
	return out
}

func samePackagedProduct(a, b *foodrecorddomain.PackagedFood) bool {
	if a == nil || b == nil {
		return false
	}
	if a.ID != "" && a.ID == b.ID {
		return true
	}
	familyA := normalizePackagedExperimentText(a.ProductFamilyKey)
	familyB := normalizePackagedExperimentText(b.ProductFamilyKey)
	if familyA != "" && familyA == familyB {
		return true
	}
	brandA := normalizePackagedExperimentText(a.Brand)
	brandB := normalizePackagedExperimentText(b.Brand)
	productA := normalizePackagedExperimentText(a.ProductName)
	productB := normalizePackagedExperimentText(b.ProductName)
	if brandA != "" && brandA == brandB && productA != "" && productA == productB {
		return true
	}
	return false
}

func packagedCandidateNeedsConfirmation(meta map[string]any) bool {
	status := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", meta["package_match_status"])))
	switch status {
	case "packaged_needs_confirmation", "multiple_candidates":
		return true
	default:
		return false
	}
}

func packagedFallbackWeightForItem(item map[string]any, fallbackWeight float64) float64 {
	best := fallbackWeight
	for _, key := range []string{"grossWeightGrams", "gross_weight_grams", "originalGrossWeightGrams", "original_gross_weight_grams"} {
		weight := numberFromAny(item[key])
		if weight > best && weight <= 5000 {
			best = weight
		}
	}
	return best
}

func packagedWeightConflictsWithVisualEstimate(food *foodrecorddomain.PackagedFood, packageWeight, visualWeight float64) (bool, string) {
	if food == nil || packageWeight <= 0 || visualWeight <= 0 {
		return false, ""
	}
	if packageWeight <= visualWeight {
		return false, ""
	}
	ratio := packageWeight / visualWeight
	delta := packageWeight - visualWeight
	if !(ratio >= 1.8 && delta >= 60) && !(packageWeight >= 500 && ratio >= 1.4) {
		return false, ""
	}
	contentLabel := packagedFoodNetContentLabel(food)
	if contentLabel == "" {
		contentLabel = fmt.Sprintf("%sg", formatNumberCompact(packageWeight))
	}
	return true, fmt.Sprintf("包装库命中 %s 规格，但图片估重约 %sg，且缺少条码/OCR净含量/用户规格证据，暂按图片估重计入", contentLabel, formatNumberCompact(visualWeight))
}

func hasStrongPackagedExperimentEvidence(item map[string]any, matchStatus string) bool {
	switch strings.ToLower(strings.TrimSpace(matchStatus)) {
	case "barcode":
		return true
	}
	for _, key := range []string{"barcode", "ean", "gtin", "ocrNetWeightGrams", "ocr_net_weight_grams", "netWeightGrams", "net_weight_g", "userWeightGrams", "user_weight_grams", "specText", "spec_text", "packageSpec"} {
		if strings.TrimSpace(fmt.Sprintf("%v", item[key])) != "" && strings.TrimSpace(fmt.Sprintf("%v", item[key])) != "<nil>" {
			return true
		}
	}
	if hasPackagedNetContentEvidence(packagedFoodEvidenceText(item)) {
		return true
	}
	return false
}

func hasPackagedNetContentEvidence(text string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return false
	}
	if weightSpecRe.MatchString(text) {
		return true
	}
	packageContext := []string{
		"包装", "袋", "瓶", "盒", "罐", "整包", "独立包装", "小包",
		"条装", "支装", "包/袋", "净含量", "净重", "规格",
		"net weight", "net wt", "content",
	}
	for _, keyword := range packageContext {
		if strings.Contains(text, strings.ToLower(keyword)) && productTitleSpecRe.MatchString(text) {
			return true
		}
	}
	return false
}

func packagedExperimentFlavorGroups(value string) map[string]bool {
	value = normalizePackagedExperimentText(value)
	if value == "" {
		return nil
	}
	groups := map[string][]string{
		"orange":     {"橙", "橙味", "橙汁", "橘", "柑橘"},
		"grape":      {"葡萄", "葡萄味", "葡萄汁", "红葡萄", "白葡萄"},
		"peach":      {"桃", "蜜桃", "黄桃", "桃味", "蜜桃味", "黄桃味"},
		"apple":      {"苹果", "苹果味", "苹果汁"},
		"strawberry": {"草莓", "草莓味"},
		"lemon":      {"柠檬", "柠檬味", "柠檬汁"},
	}
	out := map[string]bool{}
	for group, keywords := range groups {
		for _, keyword := range keywords {
			if strings.Contains(value, normalizePackagedExperimentText(keyword)) {
				out[group] = true
				break
			}
		}
	}
	return out
}

func normalizePackagedExperimentText(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range raw {
		if unicode.Is(unicode.Han, r) || unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hasAmbiguousPackagedExperimentWeights(candidates []foodrecorddomain.PackagedFood) bool {
	seen := map[int]bool{}
	for _, candidate := range candidates {
		weight := packagedFoodNetWeightForNutrition(&candidate)
		if weight <= 0 {
			continue
		}
		seen[int(math.Round(weight))] = true
		if len(seen) > 1 {
			return true
		}
	}
	return false
}

func packagedCandidateDebugList(matched *foodrecorddomain.PackagedFood, candidates []foodrecorddomain.PackagedFood, matchStatus string) []map[string]any {
	if len(candidates) == 0 {
		return []map[string]any{packagedCandidateDebug(matched, matchStatus, 1)}
	}
	out := make([]map[string]any, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate.ID == "" || seen[candidate.ID] {
			continue
		}
		seen[candidate.ID] = true
		status := "candidate"
		score := 0.72
		if matched != nil && candidate.ID == matched.ID {
			status = matchStatus
			score = 1
		}
		food := candidate
		out = append(out, packagedCandidateDebug(&food, status, score))
	}
	if len(out) == 0 {
		return []map[string]any{packagedCandidateDebug(matched, matchStatus, 1)}
	}
	return out
}

func resolvePackagedCandidateImageURLs(candidates []map[string]any, storageClient *storage.Client) []map[string]any {
	if len(candidates) == 0 || storageClient == nil {
		return candidates
	}
	out := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		next := copyAnyMap(candidate)
		urls := stringSliceFromAny(firstNonNil(candidate["source_image_urls"], candidate["sourceImageUrls"]))
		resolvedURLs := storageClient.ResolveReferenceURLs("food-images", urls)
		if len(resolvedURLs) > 0 {
			next["source_image_urls"] = resolvedURLs
			next["image_url"] = resolvedURLs[0]
		} else if raw := strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(candidate["image_url"], candidate["imageUrl"]))); raw != "" && raw != "<nil>" {
			next["image_url"] = storageClient.ResolveReferenceURL("food-images", raw)
		}
		out = append(out, next)
	}
	return out
}

func explicitWeightFromAnalyzeItem(item map[string]any) (float64, string) {
	for _, key := range []string{"userWeightGrams", "user_weight_grams", "ocrNetWeightGrams", "ocr_net_weight_grams", "netWeightGrams", "net_weight_g"} {
		weight := numberFromAny(item[key])
		if weight > 0 && weight <= 5000 {
			return weight, fmt.Sprintf("使用用户/OCR 明确规格 %.0fg", weight)
		}
	}
	return 0, ""
}

func packagedCandidateDebug(food *foodrecorddomain.PackagedFood, status string, score float64) map[string]any {
	if food == nil {
		return map[string]any{}
	}
	imageURL := ""
	if len(food.SourceImageURLs) > 0 {
		imageURL = strings.TrimSpace(food.SourceImageURLs[0])
	}
	unit := packagedNutritionUnit(food)
	return map[string]any{
		"id":                      food.ID,
		"packaged_food_id":        food.ID,
		"name":                    food.ProductName,
		"display_name":            packagedFoodDisplayName(food),
		"brand":                   food.Brand,
		"spec_text":               stringPtrValue(food.SpecText),
		"flavor_text":             stringPtrValue(food.FlavorText),
		"net_weight_g":            round2(food.NetWeightG),
		"net_content_value":       round2(food.NetContentValue),
		"net_content_unit":        stringPtrValue(food.NetContentUnit),
		"net_content_label":       packagedFoodNetContentLabel(food),
		"unit_count":              round2(food.UnitCount),
		"image_url":               imageURL,
		"source_image_urls":       food.SourceImageURLs,
		"nutrition_basis_unit":    stringPtrValue(food.NutritionBasisUnit),
		"kcal_per_100g":           round2(food.KcalPer100g),
		"protein_per_100g":        round2(food.ProteinPer100g),
		"carbs_per_100g":          round2(food.CarbsPer100g),
		"fat_per_100g":            round2(food.FatPer100g),
		"unit_nutrition_per_100g": unit,
		"match_status":            status,
		"score":                   round2(score),
	}
}

func packagedFoodDisplayName(food *foodrecorddomain.PackagedFood) string {
	if food == nil {
		return ""
	}
	if displayName := strings.TrimSpace(food.DisplayName); displayName != "" {
		return displayName
	}
	parts := []string{strings.TrimSpace(food.Brand), strings.TrimSpace(food.ProductName)}
	if flavor := stringPtrValue(food.FlavorText); flavor != "" && !strings.Contains(normalizePackagedExperimentText(food.ProductName), normalizePackagedExperimentText(flavor)) {
		parts = append(parts, flavor)
	}
	if label := packagedFoodNetContentLabel(food); label != "" {
		parts = append(parts, label)
	} else if spec := stringPtrValue(food.SpecText); spec != "" {
		parts = append(parts, spec)
	}
	return strings.Join(nonEmptyStringParts(parts...), " ")
}

func packagedFoodNetContentLabel(food *foodrecorddomain.PackagedFood) string {
	if food == nil {
		return ""
	}
	if food.NetContentValue > 0 {
		unit := strings.TrimSpace(stringPtrValue(food.NetContentUnit))
		if unit == "" && food.NetWeightG > 0 {
			unit = "g"
		}
		if unit != "" {
			return fmt.Sprintf("%s%s", formatNumberCompact(food.NetContentValue), unit)
		}
	}
	if food.NetWeightG > 0 {
		return fmt.Sprintf("%sg", formatNumberCompact(food.NetWeightG))
	}
	return ""
}

func packagedFoodNetWeightForNutrition(food *foodrecorddomain.PackagedFood) float64 {
	if food == nil {
		return 0
	}
	if food.NetWeightG > 0 {
		return food.NetWeightG
	}
	unit := strings.ToLower(strings.TrimSpace(stringPtrValue(food.NetContentUnit)))
	if food.NetContentValue > 0 && (unit == "g" || unit == "ml") {
		return food.NetContentValue
	}
	return 0
}

func formatNumberCompact(value float64) string {
	if math.Abs(value-math.Round(value)) < 0.005 {
		return fmt.Sprintf("%.0f", math.Round(value))
	}
	return fmt.Sprintf("%.2f", value)
}

func nonEmptyStringParts(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func scaleNutrition(unit map[string]any, weight float64) map[string]any {
	factor := weight / 100.0
	out := map[string]any{}
	for key, value := range unit {
		out[key] = math.Round(numberFromAny(value)*factor*100) / 100
	}
	return out
}

func scaleGeneratedNutrition(unit map[string]any, weight float64) map[string]any {
	out := scaleNutrition(unit, weight)
	out["calories"] = round2(foodrecorddomain.MacroCalories(
		numberFromAny(out["protein"]),
		numberFromAny(out["carbs"]),
		numberFromAny(out["fat"]),
	))
	return out
}

func ItemLogSummary(items []map[string]any, limit int) []map[string]any {
	return analyzeItemLogSummary(items, limit)
}

func analyzeItemLogSummary(items []map[string]any, limit int) []map[string]any {
	if limit <= 0 || len(items) == 0 {
		return nil
	}
	originalLen := len(items)
	truncated := false
	if len(items) > limit {
		items = items[:limit]
		truncated = true
	}
	out := make([]map[string]any, 0, len(items)+1)
	for index, item := range items {
		nutrients := mapFromAny(item["nutrients"])
		out = append(out, map[string]any{
			"index":                  index,
			"name":                   strings.TrimSpace(fmt.Sprintf("%v", item["name"])),
			"type":                   strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(item["type"], item["food_type"]))),
			"estimated_weight_g":     round2(numberFromAny(item["estimatedWeightGrams"])),
			"original_weight_g":      round2(numberFromAny(item["originalWeightGrams"])),
			"calories":               round2(numberFromAny(nutrients["calories"])),
			"protein":                round2(numberFromAny(nutrients["protein"])),
			"carbs":                  round2(numberFromAny(nutrients["carbs"])),
			"fat":                    round2(numberFromAny(nutrients["fat"])),
			"nutrition_source":       strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source"])),
			"resolve_status":         strings.TrimSpace(fmt.Sprintf("%v", item["resolve_status"])),
			"matched_food_name":      strings.TrimSpace(fmt.Sprintf("%v", item["matched_food_name"])),
			"is_unresolved":          boolFromAny(item["is_unresolved"]),
			"suggested_ratio":        round2(numberFromAny(item["suggestedRatio"])),
			"suggested_ratio_source": strings.TrimSpace(fmt.Sprintf("%v", item["suggestedRatioSource"])),
			"package_match_status":   strings.TrimSpace(fmt.Sprintf("%v", item["package_match_status"])),
			"package_weight_source":  strings.TrimSpace(fmt.Sprintf("%v", item["package_weight_source"])),
			"package_weight_applied": boolFromAny(item["package_weight_applied"]),
			"package_weight_reason":  strings.TrimSpace(fmt.Sprintf("%v", item["package_weight_reason"])),
		})
	}
	if truncated {
		out = append(out, map[string]any{"more_count": originalLen - limit})
	}
	return out
}

func summarizeAnalyzeItemsForTrace(items []map[string]any, limit int) string {
	summary := analyzeItemLogSummary(items, limit)
	if len(summary) == 0 {
		return ""
	}
	bytes, err := json.Marshal(summary)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func unresolvedNutritionCandidateLogSummary(candidates []UnresolvedNutritionCandidate, limit int) []map[string]any {
	if limit <= 0 || len(candidates) == 0 {
		return nil
	}
	originalLen := len(candidates)
	truncated := false
	if len(candidates) > limit {
		candidates = candidates[:limit]
		truncated = true
	}
	out := make([]map[string]any, 0, len(candidates)+1)
	for _, candidate := range candidates {
		out = append(out, map[string]any{
			"index":              candidate.Index,
			"name":               candidate.Name,
			"estimated_weight_g": round2(candidate.EstimatedWeightGrams),
		})
	}
	if truncated {
		out = append(out, map[string]any{"more_count": originalLen - limit})
	}
	return out
}

func summarizeUnresolvedNutritionCandidates(candidates []UnresolvedNutritionCandidate, limit int) string {
	summary := unresolvedNutritionCandidateLogSummary(candidates, limit)
	if len(summary) == 0 {
		return ""
	}
	bytes, err := json.Marshal(summary)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func sortedIntKeys(values map[int]map[string]any) []int {
	keys := make([]int, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Ints(keys)
	return keys
}

func nutritionSource(status string) string {
	switch status {
	case "exact_alias":
		return "library_exact_alias"
	case "exact_canonical":
		return "library_exact_canonical"
	case "semantic_rerank":
		return "library_semantic_rerank"
	case "fuzzy":
		return "library_fuzzy"
	default:
		return "unresolved"
	}
}

// nutritionSourceCategory maps the internal nutrition_source to one of the
// user-facing five categories required by the product:
//   - user_image_label : from an ingredient label captured in the user's image
//   - user_text        : nutrition facts explicitly provided by the user in text
//   - llm_generated    : generated by an LLM fallback
//   - database         : from the internal nutrition or packaged-food library
//   - web_search       : from external web search
//
// Items that are truly unresolved have no nutrition source, so the category is empty.
func nutritionSourceCategory(source string) string {
	source = strings.TrimSpace(source)
	if foodrecorddomain.IsAIGeneratedNutritionSource(source) {
		return "llm_generated"
	}
	switch source {
	case "ingredient_label":
		return "user_image_label"
	case "user_text":
		return "user_text"
	case "web_search":
		return "web_search"
	case "packaged_food_library", "packaged_candidate_pending",
		"library_exact_alias", "library_exact_canonical",
		"library_semantic_rerank", "library_fuzzy":
		return "database"
	default:
		if source != "" && source != "unresolved" {
			// Conservative default: anything that came from a known source is treated as database.
			return "database"
		}
		return ""
	}
}

type foodCandidateReuseDecision struct {
	Index                    int     `json:"index"`
	ReuseExisting            bool    `json:"reuseExisting"`
	SelectedCandidateIndex   int     `json:"selectedCandidateIndex"`
	IdentityEquivalent       bool    `json:"identityEquivalent"`
	PreparationEquivalent    bool    `json:"preparationEquivalent"`
	CompositionEquivalent    bool    `json:"compositionEquivalent"`
	NutritionBasisEquivalent bool    `json:"nutritionBasisEquivalent"`
	Confidence               float64 `json:"confidence"`
	Reason                   string  `json:"reason"`
	ShouldAddAlias           bool    `json:"shouldAddAlias"`
	AliasName                string  `json:"aliasName"`
}

func isStrictNutritionReuseDecision(decision *foodCandidateReuseDecision) bool {
	return decision != nil &&
		decision.ReuseExisting &&
		decision.SelectedCandidateIndex >= 0 &&
		decision.IdentityEquivalent &&
		decision.PreparationEquivalent &&
		decision.CompositionEquivalent &&
		decision.NutritionBasisEquivalent &&
		decision.Confidence >= resolveFoodSemanticThreshold
}

// mergeNutritionCandidateRecall combines lexical and embedding candidate
// rankings with reciprocal-rank fusion. Raw lexical and cosine scores are not
// directly comparable, while rank fusion rewards candidates supported by both
// channels and still keeps each channel's strongest independent candidates.
func mergeNutritionCandidateRecall(lexical, embedding []foodrecordrepo.SearchCandidate, limit int) []foodrecordrepo.SearchCandidate {
	if limit <= 0 {
		limit = resolveFoodCandidateLimit
	}
	if len(lexical) == 0 {
		return append([]foodrecordrepo.SearchCandidate(nil), embedding[:min(limit, len(embedding))]...)
	}
	if len(embedding) == 0 {
		return append([]foodrecordrepo.SearchCandidate(nil), lexical[:min(limit, len(lexical))]...)
	}

	type fusedCandidate struct {
		candidate foodrecordrepo.SearchCandidate
		rrfScore  float64
		lexical   bool
		embedding bool
	}
	keyFor := func(candidate foodrecordrepo.SearchCandidate) string {
		if id := strings.TrimSpace(candidate.Food.ID); id != "" {
			return "id:" + id
		}
		return "name:" + strings.TrimSpace(candidate.Food.CanonicalName)
	}
	fused := make(map[string]*fusedCandidate, len(lexical)+len(embedding))
	addRanked := func(rows []foodrecordrepo.SearchCandidate, lexicalChannel bool) {
		seen := make(map[string]struct{}, len(rows))
		for rank, candidate := range rows {
			key := keyFor(candidate)
			if key == "name:" {
				continue
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			entry, exists := fused[key]
			if !exists {
				entry = &fusedCandidate{candidate: candidate}
				fused[key] = entry
			}
			entry.rrfScore += 1 / (resolveFoodCandidateRRFK + float64(rank+1))
			if lexicalChannel {
				entry.lexical = true
			} else {
				entry.embedding = true
				if !entry.lexical {
					entry.candidate = candidate
				}
			}
		}
	}
	addRanked(lexical, true)
	addRanked(embedding, false)

	maxRRFScore := 2 / (resolveFoodCandidateRRFK + 1)
	merged := make([]fusedCandidate, 0, len(fused))
	for _, entry := range fused {
		entry.candidate.Score = entry.rrfScore / maxRRFScore
		switch {
		case entry.lexical && entry.embedding:
			entry.candidate.MatchSource = "hybrid_candidate"
		case entry.embedding:
			entry.candidate.MatchSource = "embedding_candidate"
		}
		merged = append(merged, *entry)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].rrfScore == merged[j].rrfScore {
			return merged[i].candidate.Food.CanonicalName < merged[j].candidate.Food.CanonicalName
		}
		return merged[i].rrfScore > merged[j].rrfScore
	})
	if len(merged) > limit {
		merged = merged[:limit]
	}
	out := make([]foodrecordrepo.SearchCandidate, 0, len(merged))
	for _, entry := range merged {
		out = append(out, entry.candidate)
	}
	return out
}

func unresolvedNutritionFallbackCandidates(lookups []lookupItem, candidates []UnresolvedNutritionCandidate) []UnresolvedNutritionCandidate {
	if len(candidates) == 0 {
		return candidates
	}
	resolved := make(map[int]bool, len(lookups))
	for _, lookup := range lookups {
		resolved[lookup.index] = lookup.resolve != nil && lookup.resolve.Food != nil
	}
	out := make([]UnresolvedNutritionCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if !resolved[candidate.Index] {
			out = append(out, candidate)
		}
	}
	return out
}

func (s *AnalyzeService) rerankNutritionCandidatesWithAI(ctx context.Context, queries map[int]nutritionCandidateQuery, candidates map[int][]foodrecordrepo.SearchCandidate) (map[int]*foodCandidateReuseDecision, error) {
	client, _, _ := s.runtimePostprocessClient()
	if client == nil || len(candidates) == 0 {
		return map[int]*foodCandidateReuseDecision{}, nil
	}
	type requestItem struct {
		Index      int                     `json:"index"`
		Query      nutritionCandidateQuery `json:"query"`
		Candidates []map[string]any        `json:"candidates"`
	}
	requestItems := make([]requestItem, 0, len(candidates))
	for index, rows := range candidates {
		if len(rows) == 0 {
			continue
		}
		query := queries[index]
		query.QueryName = strings.TrimSpace(query.QueryName)
		query.OriginalName = strings.TrimSpace(query.OriginalName)
		if query.QueryName == "" {
			query.QueryName = strings.TrimSpace(rows[0].Food.CanonicalName)
		}
		if query.OriginalName == "" {
			query.OriginalName = query.QueryName
		}
		candidateRows := make([]map[string]any, 0, len(rows))
		for candidateIndex, row := range rows {
			candidateRows = append(candidateRows, map[string]any{
				"candidateIndex": candidateIndex,
				"foodID":         row.Food.ID,
				"canonicalName":  row.Food.CanonicalName,
				"matchSource":    row.MatchSource,
				"searchScore":    round4(row.Score),
				"kcalPer100g":    round4(row.Food.KcalPer100g),
				"proteinPer100g": round4(row.Food.ProteinPer100g),
				"carbsPer100g":   round4(row.Food.CarbsPer100g),
				"fatPer100g":     round4(row.Food.FatPer100g),
				"source":         row.Food.Source,
			})
		}
		requestItems = append(requestItems, requestItem{
			Index:      index,
			Query:      query,
			Candidates: candidateRows,
		})
	}
	if len(requestItems) == 0 {
		return map[int]*foodCandidateReuseDecision{}, nil
	}
	sort.SliceStable(requestItems, func(i, j int) bool {
		return requestItems[i].Index < requestItems[j].Index
	})
	systemPrompt := "你是低延迟食物身份核验器，不是相似度排序器。给定识别名称、食物状态、重量口径和最多5个营养库候选，只能在候选与输入是同一种食物、同一加工/烹饪状态、同一配方组成、同一干湿营养口径时复用。共享关键词、属于同类或营养看起来接近都不算匹配。任何关键字段不确定都必须拒绝复用。只返回JSON。"
	userPrompt := map[string]any{
		"task": "逐项判断候选中是否存在可以按同一每100克营养口径直接复用的完全同一食物",
		"rules": []string{
			"先比较食物主体，再比较加工/烹饪状态、配方组成、干湿/生熟营养口径；四项必须全部等价。",
			"名称包含关系不代表同一食物，例如单一原料与糖果、饮料、酸奶、代餐粉或混合菜不能互相复用。",
			"品牌包装食品还必须是同一品牌、产品、口味和规格；缺少证据时拒绝复用。",
			"普通自然食物允许常见规范同义名，但品种或状态会显著改变每100克营养时拒绝复用。",
			"只有四个equivalent字段都为true且把握极高时 reuseExisting 才能为true。",
			"confidence 取 0 到 1。",
			"selectedCandidateIndex 必须使用输入里的 candidateIndex；如果不复用填 -1。",
			"系统不会自动写入永久别名，shouldAddAlias 必须为 false，aliasName 必须为空。",
		},
		"items": requestItems,
		"responseSchema": map[string]any{
			"items": []map[string]any{{
				"index":                    0,
				"reuseExisting":            false,
				"selectedCandidateIndex":   -1,
				"identityEquivalent":       false,
				"preparationEquivalent":    false,
				"compositionEquivalent":    false,
				"nutritionBasisEquivalent": false,
				"confidence":               0.0,
				"reason":                   "",
				"shouldAddAlias":           false,
				"aliasName":                "",
			}},
		},
	}
	userBytes, _ := json.Marshal(userPrompt)
	callCtx, cancel := context.WithTimeout(ctx, resolveFoodSemanticTimeout)
	defer cancel()
	parsed, err := analyzePostprocess(callCtx, client, systemPrompt+"\n"+string(userBytes))
	if err != nil {
		return nil, err
	}
	rawItems, ok := parsed["items"].([]any)
	if !ok {
		return map[int]*foodCandidateReuseDecision{}, nil
	}
	out := map[int]*foodCandidateReuseDecision{}
	for _, raw := range rawItems {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		index := int(numberFromAny(row["index"]))
		out[index] = &foodCandidateReuseDecision{
			Index:                    index,
			ReuseExisting:            boolFromAny(row["reuseExisting"]),
			SelectedCandidateIndex:   int(numberFromAny(row["selectedCandidateIndex"])),
			IdentityEquivalent:       boolFromAny(row["identityEquivalent"]),
			PreparationEquivalent:    boolFromAny(row["preparationEquivalent"]),
			CompositionEquivalent:    boolFromAny(row["compositionEquivalent"]),
			NutritionBasisEquivalent: boolFromAny(row["nutritionBasisEquivalent"]),
			Confidence:               clampRange(numberFromAny(row["confidence"]), 0, 1),
			Reason:                   strings.TrimSpace(fmt.Sprintf("%v", row["reason"])),
			ShouldAddAlias:           boolFromAny(row["shouldAddAlias"]),
			AliasName:                strings.TrimSpace(fmt.Sprintf("%v", row["aliasName"])),
		}
	}
	return out, nil
}

func mergeBatchResults(results []map[string]any, executionMode string) map[string]any {
	allItems := []map[string]any{}
	descriptions := []string{}
	insights := []string{}
	pfcComments := []string{}
	eatingOrderList := []string{}
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
		if eatingOrder, ok := parsed["eating_order_advice"].(string); ok && eatingOrder != "" {
			eatingOrderList = append(eatingOrderList, eatingOrder)
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
		"eating_order_advice": nil,
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
	if len(eatingOrderList) > 0 {
		merged["eating_order_advice"] = eatingOrderList[0]
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
		merged["eating_order_advice"] = nil
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
