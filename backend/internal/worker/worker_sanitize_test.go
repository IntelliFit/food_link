package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/require"
)

type fakeWorkerAnalyzeRunner struct {
	userID      string
	input       analyzeservice.AnalyzeInput
	result      map[string]any
	err         error
	preciseErr  error
	preciseRuns int
}

func (f *fakeWorkerAnalyzeRunner) Analyze(ctx context.Context, userID string, input analyzeservice.AnalyzeInput) (map[string]any, error) {
	f.userID = userID
	f.input = input
	return f.result, f.err
}

func (f *fakeWorkerAnalyzeRunner) AnalyzeText(ctx context.Context, userID string, input analyzeservice.AnalyzeInput) (map[string]any, error) {
	f.userID = userID
	f.input = input
	return f.result, f.err
}

func (f *fakeWorkerAnalyzeRunner) RunPrecisionJSONWithImages(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return f.result, f.err
}

func (f *fakeWorkerAnalyzeRunner) RunPrecisionJSONWithImagesNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string) (map[string]any, error) {
	return f.result, f.err
}

func (f *fakeWorkerAnalyzeRunner) RunPrecisionJSONWithImagesTemperatureNoFallback(ctx context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	return f.result, f.err
}

func (f *fakeWorkerAnalyzeRunner) ApplyDBFirstToItems(ctx context.Context, items []map[string]any, additionalContext string) []map[string]any {
	return items
}

func (f *fakeWorkerAnalyzeRunner) ApplyDBFirstToItemsWithPreciseMicronutrients(ctx context.Context, items []map[string]any, additionalContext string) ([]map[string]any, error) {
	return f.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, additionalContext)
}

func (f *fakeWorkerAnalyzeRunner) ApplyPreciseMicronutrientsToResolvedItems(ctx context.Context, items []map[string]any, additionalContext string) ([]map[string]any, error) {
	f.preciseRuns++
	if f.preciseErr != nil {
		return nil, f.preciseErr
	}
	for _, item := range items {
		nutrients := mapFromAny(item["nutrients"])
		if len(nutrients) == 0 {
			nutrients = map[string]any{}
		}
		for _, key := range []string{
			"fiber", "sugar", "saturatedFat", "cholesterolMg", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "zincMg",
			"vitaminARaeMcg", "vitaminCMg", "vitaminDMcg", "vitaminEMg", "vitaminKMcg", "thiaminMg", "riboflavinMg", "niacinMg", "vitaminB6Mg", "folateMcg", "vitaminB12Mcg",
		} {
			if _, ok := nutrients[key]; !ok {
				nutrients[key] = 1.0
			}
		}
		item["nutrients"] = nutrients
		item["micronutrient_analysis"] = "ai_precise_v1"
		item["micronutrient_source"] = "test_generated"
	}
	return items, nil
}

func TestEnrichCampusPreciseMicronutrientsUsesResolvedSingleTaskResult(t *testing.T) {
	analyze := &fakeWorkerAnalyzeRunner{}
	runner := &Runner{analyze: analyze}
	task := &domain.AnalysisTask{
		ID: "task-campus-standard-1", UserID: "system-user-1", TaskType: "food",
		Payload: map[string]any{
			"public_food_source_type": "campus_public_food", "micronutrient_analysis_required": true,
			"additionalContext": "菜品名称：白米饭",
		},
	}
	result := map[string]any{"items": []any{map[string]any{
		"name": "白米饭", "nutrients": map[string]any{"calories": 232.0, "protein": 5.2, "carbs": 51.8, "fat": 0.6},
	}}}

	require.NoError(t, runner.enrichCampusPreciseMicronutrients(context.Background(), task, result))
	require.Equal(t, 1, analyze.preciseRuns)
	items := extractItems(result["items"])
	require.Len(t, items, 1)
	require.Equal(t, "ai_precise_v1", items[0]["micronutrient_analysis"])
	require.NoError(t, analyzeservice.ValidatePreciseMicronutrientItems(items))
}

func TestEnrichCampusPreciseMicronutrientsSkipsOrdinaryUserAnalysis(t *testing.T) {
	analyze := &fakeWorkerAnalyzeRunner{}
	runner := &Runner{analyze: analyze}
	task := &domain.AnalysisTask{ID: "task-user-standard-1", TaskType: "food", Payload: map[string]any{}}
	result := map[string]any{"items": []any{map[string]any{"name": "白米饭"}}}

	require.NoError(t, runner.enrichCampusPreciseMicronutrients(context.Background(), task, result))
	require.Zero(t, analyze.preciseRuns)
}

type workerMixedMealLLMClient struct {
	calls int
}

func (c *workerMixedMealLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	c.calls++
	if strings.Contains(prompt, "suggestedRatio") && strings.Contains(prompt, "健康饮食决策助手") {
		return map[string]any{
			"items": []any{
				map[string]any{"index": 0.0, "suggestedRatio": 80.0, "reason": "主食稍微控制"},
				map[string]any{"index": 1.0, "suggestedRatio": 60.0, "reason": "包装面包按需食用"},
			},
		}, nil
	}
	return map[string]any{
		"description": "米饭配面包",
		"items": []any{
			map[string]any{
				"name":                 "白米饭",
				"type":                 "normal",
				"estimatedWeightGrams": 200.0,
				"grossWeightGrams":     200.0,
			},
			map[string]any{
				"name":                 "桃李豆沙小饼面包",
				"type":                 "packaged",
				"foodState":            "packaged",
				"weightBasis":          "package_net",
				"estimatedWeightGrams": 80.0,
				"grossWeightGrams":     80.0,
			},
		},
	}, nil
}

func (c *workerMixedMealLLMClient) AnalyzeWithImagesDashScopeWebSearch(ctx context.Context, prompt string, imageURLs []string, options analyzeservice.DashScopeWebSearchOptions) (map[string]any, map[string]any, error) {
	parsed, err := c.Analyze(ctx, prompt, "")
	return parsed, map[string]any{
		"native_search":   true,
		"forced_search":   options.ForcedSearch,
		"search_strategy": options.SearchStrategy,
	}, err
}

type workerPackagedMissLLMClient struct {
	calls int
}

func (c *workerPackagedMissLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	c.calls++
	if strings.Contains(prompt, "suggestedRatio") && strings.Contains(prompt, "健康饮食决策助手") {
		return map[string]any{
			"items": []any{
				map[string]any{"index": 0.0, "suggestedRatio": 90.0, "reason": "主食保守食用"},
				map[string]any{"index": 1.0, "suggestedRatio": 70.0, "reason": "未收录包装食品按保守估算"},
			},
		}, nil
	}
	return map[string]any{
		"description": "米饭配未收录包装豆干",
		"items": []any{
			map[string]any{
				"name":                 "白米饭",
				"type":                 "normal",
				"estimatedWeightGrams": 200.0,
				"grossWeightGrams":     200.0,
			},
			map[string]any{
				"name":                 "未收录包装豆干",
				"type":                 "snack",
				"estimatedWeightGrams": 30.0,
				"grossWeightGrams":     30.0,
			},
		},
	}, nil
}

func (c *workerPackagedMissLLMClient) AnalyzeWithImagesDashScopeWebSearch(ctx context.Context, prompt string, imageURLs []string, options analyzeservice.DashScopeWebSearchOptions) (map[string]any, map[string]any, error) {
	parsed, err := c.Analyze(ctx, prompt, "")
	return parsed, map[string]any{
		"native_search":   true,
		"forced_search":   options.ForcedSearch,
		"search_strategy": options.SearchStrategy,
	}, err
}

type workerEmptyWebSearcher struct{}

func (workerEmptyWebSearcher) Search(ctx context.Context, query string, limit int) ([]analyzeservice.WebSearchResult, error) {
	return nil, nil
}

type workerFakeNutritionFallbackEstimator struct {
	candidates        []analyzeservice.UnresolvedNutritionCandidate
	additionalContext string
	rows              map[int]map[string]any
}

func (f *workerFakeNutritionFallbackEstimator) Estimate(ctx context.Context, candidates []analyzeservice.UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	f.candidates = append([]analyzeservice.UnresolvedNutritionCandidate(nil), candidates...)
	f.additionalContext = additionalContext
	return f.rows, nil
}

type workerFakeNutritionResolver struct {
	rice     foodrecorddomain.FoodNutrition
	packaged foodrecorddomain.PackagedFood
}

func newWorkerFakeNutritionResolver() *workerFakeNutritionResolver {
	return &workerFakeNutritionResolver{
		rice: foodrecorddomain.FoodNutrition{
			ID:             "rice-1",
			CanonicalName:  "白米饭",
			NormalizedName: "白米饭",
			KcalPer100g:    116,
			ProteinPer100g: 2.6,
			CarbsPer100g:   25.9,
			FatPer100g:     0.3,
			IsActive:       true,
		},
		packaged: foodrecorddomain.PackagedFood{
			ID:             "pkg-taoli-dousha",
			Brand:          "桃李",
			ProductName:    "豆沙小饼面包",
			NormalizedName: "桃李豆沙小饼面包",
			DisplayName:    "桃李 豆沙小饼面包 55g",
			NetWeightG:     55,
			KcalPer100g:    320,
			ProteinPer100g: 7,
			CarbsPer100g:   58,
			FatPer100g:     6,
			IsActive:       true,
		},
	}
}

func (r *workerFakeNutritionResolver) ResolvePackagedFood(ctx context.Context, input foodrecordrepo.PackagedFoodResolveInput) (*foodrecordrepo.PackagedResolveResult, error) {
	if strings.Contains(input.Name, "桃李") || strings.Contains(input.Name, "豆沙小饼") {
		food := r.packaged
		return &foodrecordrepo.PackagedResolveResult{Food: &food, Status: "fuzzy", MatchSource: "worker_fake", Score: 0.92}, nil
	}
	return &foodrecordrepo.PackagedResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *workerFakeNutritionResolver) SearchPackagedFood(ctx context.Context, query string, limit int) ([]foodrecorddomain.PackagedFood, error) {
	if strings.Contains(query, "桃李") || strings.Contains(query, "豆沙小饼") {
		return []foodrecorddomain.PackagedFood{r.packaged}, nil
	}
	return nil, nil
}

func (r *workerFakeNutritionResolver) ResolveFood(ctx context.Context, name string) (*foodrecordrepo.ResolveResult, error) {
	if strings.TrimSpace(name) == "白米饭" {
		food := r.rice
		return &foodrecordrepo.ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "worker_fake", Score: 1}, nil
	}
	return &foodrecordrepo.ResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *workerFakeNutritionResolver) SearchCandidates(ctx context.Context, query string, limit int) ([]foodrecordrepo.SearchCandidate, error) {
	return nil, nil
}

func (r *workerFakeNutritionResolver) EnsureNutritionAlias(ctx context.Context, foodID, rawName string) error {
	return nil
}

func (r *workerFakeNutritionResolver) LogUnresolved(ctx context.Context, rawName string) error {
	return nil
}

func (r *workerFakeNutritionResolver) UpsertDeepSeekNutrition(ctx context.Context, rawName string, unit map[string]any, sources ...string) (string, error) {
	return "generated-food", nil
}

func TestSanitizeTaskErrorMessage_HTML(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`ofoxai api error 405: <html><head><title>Ofox AI</title></head><body>home</body></html>`))
	if strings.Contains(msg, "<html") {
		t.Fatalf("html leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 服务返回了网页") {
		t.Fatalf("unexpected sanitized error: %s", msg)
	}
}

func TestPackagedFoodQualifiesForRewardRequiresNetContent(t *testing.T) {
	food := rewardablePackagedFood()
	food.NetContentValue = 0
	food.NetContentUnit = nil
	food.NetWeightG = 0

	if packagedFoodQualifiesForReward(food) {
		t.Fatal("missing net content should not qualify for reward")
	}
}

func TestPackagedFoodQualifiesForRewardRejectsKJAsKcal(t *testing.T) {
	food := rewardablePackagedFood()
	food.KcalPer100g = 1668

	if packagedFoodQualifiesForReward(food) {
		t.Fatal("implausible kcal should not qualify for reward")
	}
}

func TestPackagedFoodQualifiesForRewardAllowsCompleteSku(t *testing.T) {
	food := rewardablePackagedFood()

	if !packagedFoodQualifiesForReward(food) {
		t.Fatal("complete packaged food should qualify for reward")
	}
}

func TestPackagedFoodQualifiesForRewardAllowsVerifiedZeroDrink(t *testing.T) {
	unit := "ml"
	converted := "converted"
	ocr := "营养成分表 每100ml 能量 0kJ 蛋白质 0g 脂肪 0g 碳水化合物 0g"
	food := &foodrecorddomain.PackagedFood{
		ProductName:      "无糖荷叶茉莉花味风味饮料",
		SourceImageURLs:  []string{"https://example.com/front.jpg", "https://example.com/nutrition.jpg"},
		NetContentValue:  500,
		NetContentUnit:   &unit,
		ConversionStatus: &converted,
		KcalPer100g:      0,
		ProteinPer100g:   0,
		CarbsPer100g:     0,
		FatPer100g:       0,
		OCRRawText:       &ocr,
		IsActive:         true,
	}

	if !packagedFoodQualifiesForReward(food) {
		t.Fatal("verified zero drink should qualify for reward")
	}
}

func TestPackagedFoodQualifiesForRewardRejectsZeroNutritionWithoutEvidence(t *testing.T) {
	food := rewardablePackagedFood()
	food.KcalPer100g = 0
	food.ProteinPer100g = 0
	food.CarbsPer100g = 0
	food.FatPer100g = 0

	if packagedFoodQualifiesForReward(food) {
		t.Fatal("zero nutrition without label evidence should not qualify for reward")
	}
}

func TestAnalyzeInputFromTaskPreservesModeSuggestRatioAndCorrectionPayload(t *testing.T) {
	imageURL := "https://example.com/mixed-meal.jpg"
	task := &domain.AnalysisTask{
		ImageURL:   &imageURL,
		ImagePaths: []string{"https://example.com/mixed-meal.jpg", "https://example.com/package-label.jpg"},
		Payload: map[string]any{
			"execution_mode":        "strict_separate",
			"suggest_ratio_enabled": true,
			"remaining_calories":    520.5,
			"additionalContext":     "面包只吃半包，米饭吃完",
			"previousResult": map[string]any{
				"items": []any{
					map[string]any{"name": "桃李豆沙小饼面包", "estimatedWeightGrams": 55.0},
				},
			},
			"correctionItems": []any{
				map[string]any{
					"name":                 "桃李豆沙小饼面包",
					"estimatedWeightGrams": 27.5,
					"weightEdited":         true,
					"nutritionEdited":      true,
					"nutrients": map[string]any{
						"calories": 88.0,
						"protein":  3.5,
						"carbs":    14.0,
						"fat":      2.2,
					},
				},
			},
		},
	}

	input := analyzeInputFromTask(task)

	if input.ExecutionMode == nil || *input.ExecutionMode != "strict_separate" {
		t.Fatalf("execution mode was not preserved: %#v", input.ExecutionMode)
	}
	if !input.SuggestRatioEnabled {
		t.Fatal("suggest ratio flag should be preserved")
	}
	if input.RemainingCalories == nil || *input.RemainingCalories != 520.5 {
		t.Fatalf("remaining calories not preserved: %#v", input.RemainingCalories)
	}
	if input.ImageURL != imageURL {
		t.Fatalf("image url not preserved: %s", input.ImageURL)
	}
	if len(input.ImageURLs) != 2 {
		t.Fatalf("image urls not preserved: %#v", input.ImageURLs)
	}
	if input.AdditionalContext != "面包只吃半包，米饭吃完" {
		t.Fatalf("additional context not preserved: %s", input.AdditionalContext)
	}
	if len(input.CorrectionItems) != 1 {
		t.Fatalf("correction items not preserved: %#v", input.CorrectionItems)
	}
	item := input.CorrectionItems[0]
	if !boolFromAny(item["weightEdited"]) || !boolFromAny(item["nutritionEdited"]) {
		t.Fatalf("correction edit flags not preserved: %#v", item)
	}
	nutrients := mapFromAny(item["nutrients"])
	calories, _ := floatFromAny(nutrients["calories"])
	protein, _ := floatFromAny(nutrients["protein"])
	if calories != 88.0 || protein != 3.5 {
		t.Fatalf("correction nutrients not preserved: %#v", nutrients)
	}
	if len(extractItems(input.PreviousResult["items"])) != 1 {
		t.Fatalf("previous result not preserved: %#v", input.PreviousResult)
	}
}

func TestRunFoodAnalysisPassesIntegratedPackagedPayloadToAnalyze(t *testing.T) {
	mode := "fast_web_search"
	imageURL := "https://example.com/mixed-meal.jpg"
	fakeAnalyze := &fakeWorkerAnalyzeRunner{result: map[string]any{
		"items": []any{
			map[string]any{"name": "白米饭", "nutrition_source": "library_exact_canonical"},
			map[string]any{"name": "桃李豆沙小饼面包", "nutrition_source": "packaged_food_library", "estimatedWeightGrams": 55.0},
		},
		"packaged_food_resolution": map[string]any{"matched_count": 1},
	}}
	runner := &Runner{analyze: fakeAnalyze}
	task := &domain.AnalysisTask{
		ID:         "task-mixed-packaged",
		UserID:     "user1",
		TaskType:   "food",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL, "https://example.com/package-label.jpg"},
		Payload: map[string]any{
			"execution_mode":        mode,
			"suggest_ratio_enabled": true,
			"remaining_calories":    520.5,
			"additionalContext":     "桃李豆沙小饼面包只吃半包",
			"previousResult": map[string]any{
				"items": []any{map[string]any{"itemId": 12, "name": "桃李豆沙小饼面包"}},
			},
			"correctionItems": []any{
				map[string]any{
					"sourceItemId":         12,
					"name":                 "桃李豆沙小饼面包（半包）",
					"estimatedWeightGrams": 27.5,
					"weightEdited":         true,
					"nutritionEdited":      true,
					"nutrients":            map[string]any{"calories": 90.0},
				},
			},
		},
	}

	result, err := runner.runFoodAnalysis(context.Background(), task, time.Now())
	if err != nil {
		t.Fatalf("runFoodAnalysis returned error: %v", err)
	}
	if fakeAnalyze.userID != "user1" {
		t.Fatalf("expected user id to reach analyze service, got %s", fakeAnalyze.userID)
	}
	if fakeAnalyze.input.ExecutionMode == nil || *fakeAnalyze.input.ExecutionMode != mode {
		t.Fatalf("execution mode not passed to analyze: %#v", fakeAnalyze.input.ExecutionMode)
	}
	if !fakeAnalyze.input.SuggestRatioEnabled {
		t.Fatal("suggest ratio flag not passed to analyze")
	}
	if fakeAnalyze.input.RemainingCalories == nil || *fakeAnalyze.input.RemainingCalories != 520.5 {
		t.Fatalf("remaining calories not passed to analyze: %#v", fakeAnalyze.input.RemainingCalories)
	}
	if len(fakeAnalyze.input.ImageURLs) != 2 {
		t.Fatalf("image urls not passed to analyze: %#v", fakeAnalyze.input.ImageURLs)
	}
	if len(fakeAnalyze.input.CorrectionItems) != 1 || !boolFromAny(fakeAnalyze.input.CorrectionItems[0]["nutritionEdited"]) {
		t.Fatalf("correction payload not passed to analyze: %#v", fakeAnalyze.input.CorrectionItems)
	}
	items := extractItems(result["items"])
	if len(items) != 2 || stringFromMap(items[1], "nutrition_source") != "packaged_food_library" {
		t.Fatalf("expected mixed packaged result to return from worker analysis path, got %#v", result)
	}
}

func TestRunFoodAnalysisWithAnalyzeServiceIntegratesPackagedFood(t *testing.T) {
	modes := []string{
		"fast",
		"standard",
		"strict",
		"strict_separate",
		"fast_web_search",
		"standard_web_search",
		"strict_web_search",
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			imageURL := "https://example.com/mixed-meal.jpg"
			llm := &workerMixedMealLLMClient{}
			analyzeSvc := analyzeservice.NewAnalyzeService(llm, llm, nil)
			analyzeSvc.ConfigureDashScopeLLMClient(llm)
			analyzeSvc.ConfigureGemini35LLMClient(llm)
			analyzeSvc.ConfigureNutritionResolver(newWorkerFakeNutritionResolver())
			analyzeSvc.ConfigureWebSearcher(workerEmptyWebSearcher{})
			runner := &Runner{analyze: analyzeSvc}
			task := &domain.AnalysisTask{
				ID:         "task-real-analyze-service-" + mode,
				UserID:     "user1",
				TaskType:   "food",
				ImageURL:   &imageURL,
				ImagePaths: []string{imageURL},
				Payload: map[string]any{
					"execution_mode":        mode,
					"suggest_ratio_enabled": true,
					"analysis_engine":       "db_first",
				},
			}

			result, err := runner.runFoodAnalysis(context.Background(), task, time.Now())
			if err != nil {
				t.Fatalf("runFoodAnalysis returned error: %v", err)
			}
			// This fixture has no food that needs edible-portion inference and no
			// remaining-calorie budget that would require a suggested-ratio call.
			// The only LLM call should therefore be the initial vision analysis;
			// nutrition is resolved deterministically from the configured libraries.
			if llm.calls != 1 {
				t.Fatalf("expected one vision model call for %s mode, got %d", mode, llm.calls)
			}
			items := extractItems(result["items"])
			if len(items) != 2 {
				t.Fatalf("expected two items, got %#v", items)
			}
			if source := stringFromMap(items[0], "nutrition_source"); source != "library_exact_canonical" {
				t.Fatalf("expected rice to use normal nutrition library, got %s", source)
			}
			if source := stringFromMap(items[1], "nutrition_source"); source != "packaged_food_library" {
				t.Fatalf("expected bread to use packaged library, got %s", source)
			}
			if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 55 {
				t.Fatalf("expected packaged weight anchor 55g, got %v", got)
			}
			if !boolFromAny(items[1]["package_weight_applied"]) {
				t.Fatalf("expected packaged weight to be applied: %#v", items[1])
			}
			if got, _ := floatFromAny(items[1]["suggestedRatio"]); got != 100 {
				t.Fatalf("expected default suggested ratio without a remaining-calorie budget, got %v", got)
			}
			if source := stringFromMap(items[1], "suggestedRatioSource"); source != "not_needed" {
				t.Fatalf("expected suggested ratio to be marked not_needed, got %s", source)
			}
			meta := mapFromAny(result["packaged_food_resolution"])
			if intFromAny(meta["matched_count"]) != 1 {
				t.Fatalf("expected packaged match meta, got %#v", meta)
			}
		})
	}
}

func TestRunFoodAnalysisWithAnalyzeServiceFallsBackToAIWhenPackagedFoodMisses(t *testing.T) {
	modes := []string{
		"fast",
		"standard",
		"strict",
		"strict_separate",
		"fast_web_search",
		"standard_web_search",
		"strict_web_search",
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			imageURL := "https://example.com/mixed-meal-packaged-miss.jpg"
			llm := &workerPackagedMissLLMClient{}
			fallback := &workerFakeNutritionFallbackEstimator{
				rows: map[int]map[string]any{
					1: {
						"calories": 250.0,
						"protein":  12.0,
						"carbs":    30.0,
						"fat":      8.0,
					},
				},
			}
			analyzeSvc := analyzeservice.NewAnalyzeService(llm, llm, nil)
			analyzeSvc.ConfigureDashScopeLLMClient(llm)
			analyzeSvc.ConfigureGemini35LLMClient(llm)
			analyzeSvc.ConfigureNutritionResolver(newWorkerFakeNutritionResolver())
			analyzeSvc.ConfigureNutritionFallbackEstimator(fallback)
			analyzeSvc.ConfigureWebSearcher(workerEmptyWebSearcher{})
			runner := &Runner{analyze: analyzeSvc}
			task := &domain.AnalysisTask{
				ID:         "task-real-analyze-service-packaged-miss-" + mode,
				UserID:     "user1",
				TaskType:   "food",
				ImageURL:   &imageURL,
				ImagePaths: []string{imageURL},
				Payload: map[string]any{
					"execution_mode":        mode,
					"suggest_ratio_enabled": true,
					"analysis_engine":       "db_first",
					"additionalContext":     "包装库没有命中时允许 AI 保守估算",
				},
			}

			result, err := runner.runFoodAnalysis(context.Background(), task, time.Now())
			if err != nil {
				t.Fatalf("runFoodAnalysis returned error: %v", err)
			}
			// This fixture has no food that needs edible-portion inference and no
			// remaining-calorie budget that would require a suggested-ratio call.
			// The only LLM call should therefore be the initial vision analysis;
			// nutrition fallback is provided by the dedicated estimator below.
			if llm.calls != 1 {
				t.Fatalf("expected one vision model call for %s mode, got %d", mode, llm.calls)
			}
			if len(fallback.candidates) != 1 {
				t.Fatalf("expected one nutrition fallback candidate, got %#v", fallback.candidates)
			}
			if fallback.candidates[0].Name != "未收录包装豆干" || fallback.candidates[0].EstimatedWeightGrams != 30 {
				t.Fatalf("unexpected fallback candidate: %#v", fallback.candidates[0])
			}
			if fallback.additionalContext != "包装库没有命中时允许 AI 保守估算" {
				t.Fatalf("additional context not passed to nutrition fallback: %s", fallback.additionalContext)
			}
			items := extractItems(result["items"])
			if len(items) != 2 {
				t.Fatalf("expected two items, got %#v", items)
			}
			if source := stringFromMap(items[0], "nutrition_source"); source != "library_exact_canonical" {
				t.Fatalf("expected rice to use normal nutrition library, got %s", source)
			}
			if source := stringFromMap(items[1], "nutrition_source"); source != "deepseek_generated" {
				t.Fatalf("expected packaged miss to use AI nutrition fallback, got %s in %#v", source, items[1])
			}
			if status := stringFromMap(items[1], "package_match_status"); status != "not_found" {
				t.Fatalf("expected package miss status, got %s", status)
			}
			if boolFromAny(items[1]["package_weight_applied"]) {
				t.Fatalf("packaged miss should not apply package weight: %#v", items[1])
			}
			if matched := stringFromMap(items[1], "matched_food_id"); matched != "generated-food" {
				t.Fatalf("expected generated nutrition to be persisted, got matched id %s", matched)
			}
			nutrients := mapFromAny(items[1]["nutrients"])
			if got, _ := floatFromAny(nutrients["calories"]); got != 72 {
				t.Fatalf("expected macro-derived 30g calories 72, got %v", got)
			}
			if got, _ := floatFromAny(nutrients["protein"]); got != 3.6 {
				t.Fatalf("expected 30g scaled generated protein 3.6, got %v", got)
			}
			if got, _ := floatFromAny(items[1]["suggestedRatio"]); got != 100 {
				t.Fatalf("expected default suggested ratio without a remaining-calorie budget, got %v", got)
			}
			if source := stringFromMap(items[1], "suggestedRatioSource"); source != "not_needed" {
				t.Fatalf("expected suggested ratio to be marked not_needed, got %s", source)
			}
			meta := mapFromAny(result["packaged_food_resolution"])
			if intFromAny(meta["triggered_count"]) != 1 || intFromAny(meta["matched_count"]) != 0 || intFromAny(meta["fallback_count"]) != 1 {
				t.Fatalf("expected packaged miss resolution meta, got %#v", meta)
			}
			if unresolved := intFromAny(result["unresolved_count"]); unresolved != 0 {
				t.Fatalf("AI fallback should resolve generated nutrition, unresolved=%d result=%#v", unresolved, result)
			}
		})
	}
}

func rewardablePackagedFood() *foodrecorddomain.PackagedFood {
	unit := "g"
	converted := "converted"
	return &foodrecorddomain.PackagedFood{
		ProductName:      "完整零食",
		SourceImageURLs:  []string{"https://example.com/front.jpg", "https://example.com/nutrition.jpg"},
		NetContentValue:  100,
		NetContentUnit:   &unit,
		NetWeightG:       100,
		ConversionStatus: &converted,
		KcalPer100g:      420,
		ProteinPer100g:   6,
		CarbsPer100g:     60,
		FatPer100g:       12,
		IsActive:         true,
	}
}

func TestSanitizeTaskErrorMessage_Timeout(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`Post "https://api.ofox.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`))
	if strings.Contains(msg, "https://api.ofox.ai") || strings.Contains(msg, "Client.Timeout") {
		t.Fatalf("raw timeout leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务响应超时") {
		t.Fatalf("unexpected sanitized timeout: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_EOF(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`Post "https://yunwu.ai/v1/chat/completions": EOF`))
	if strings.Contains(msg, "yunwu.ai") || strings.Contains(msg, "chat/completions") || strings.Contains(msg, "EOF") {
		t.Fatalf("raw eof error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务连接中断") {
		t.Fatalf("unexpected sanitized eof error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_ResourceExhausted(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`ofoxai api error 429: {"error":{"message":"Resource exhausted. Please try again later"}}`))
	if !strings.Contains(msg, "AI 识别服务当前繁忙") {
		t.Fatalf("unexpected sanitized busy error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_InternalServiceError(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`doubao api error 500: {"error":{"code":"InternalServiceError","message":"The service encountered an unexpected internal error","request_id":"0217790020120823db2ae"}}`))
	if strings.Contains(msg, "InternalServiceError") || strings.Contains(msg, "request_id") {
		t.Fatalf("raw upstream error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务暂时不可用") {
		t.Fatalf("unexpected sanitized internal service error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_APIKey(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`doubao api error 401: {"error":{"message":"Incorrect API key provided. For details, see: https://www.volcengine.com/docs/error-code#apikey-error"}}`))
	if strings.Contains(strings.ToLower(msg), "apikey") || strings.Contains(msg, "volcengine.com") {
		t.Fatalf("raw api key error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务配置异常") {
		t.Fatalf("unexpected sanitized api key error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_ModelNotFound(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`doubao api error 400: model not found`))
	if strings.Contains(strings.ToLower(msg), "doubao") || strings.Contains(strings.ToLower(msg), "model not found") {
		t.Fatalf("raw model error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务配置异常") {
		t.Fatalf("unexpected sanitized model error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_DoubaoResponsesAuthenticationError(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`doubao responses api error 401: {"error":{"code":"AuthenticationError","message":"The API key format is incorrect. Request id: 021779210783873f3cee0c2e226f4d0a5"}}`))
	if strings.Contains(msg, "AuthenticationError") || strings.Contains(msg, "Request id") {
		t.Fatalf("raw authentication error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 识别服务配置异常") {
		t.Fatalf("unexpected sanitized authentication error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_DoubaoWebSearchToolNotOpen(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`doubao responses api error 404: {"error":{"code":"ToolNotOpen","message":"Your account has not activated web search. You may activate it at https://console.volcengine.com/"}}`))
	if strings.Contains(msg, "ToolNotOpen") || strings.Contains(msg, "volcengine.com") {
		t.Fatalf("raw web search activation error leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "Web Search") || !strings.Contains(msg, "标准模式") {
		t.Fatalf("unexpected sanitized web search error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_TruncatesLongText(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(strings.Repeat("x", 400)))
	if len([]rune(msg)) > 303 {
		t.Fatalf("expected truncated message, got %d runes", len([]rune(msg)))
	}
}

func TestFilterPrecisionResultToPlanned_RemovesRepeatedWholeMeal(t *testing.T) {
	result := map[string]any{
		"items": []map[string]any{
			{"name": "白米饭", "estimatedWeightGrams": 200},
			{"name": "红烧肉丸", "estimatedWeightGrams": 90},
			{"name": "青椒炒鸡块", "estimatedWeightGrams": 80},
			{"name": "炒豆干", "estimatedWeightGrams": 60},
			{"name": "清炒冬瓜", "estimatedWeightGrams": 100},
		},
	}
	payload := map[string]any{
		"items_to_estimate": []map[string]any{
			{"item_key": "rice", "item_name": "白米饭"},
			{"item_key": "chicken", "item_name": "青椒炒鸡块"},
			{"item_key": "tofu", "item_name": "炒豆干"},
		},
	}

	filtered := filterPrecisionResultToPlanned(result, payload)
	items := extractItems(filtered["items"])
	if len(items) != 3 {
		t.Fatalf("expected 3 filtered items, got %d: %#v", len(items), items)
	}
	names := []string{stringFromMap(items[0], "name"), stringFromMap(items[1], "name"), stringFromMap(items[2], "name")}
	joined := strings.Join(names, ",")
	for _, expected := range []string{"白米饭", "青椒炒鸡块", "炒豆干"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected %s in filtered names %v", expected, names)
		}
	}
	if strings.Contains(joined, "红烧肉丸") || strings.Contains(joined, "清炒冬瓜") {
		t.Fatalf("unexpected off-group items in filtered names %v", names)
	}
}

func TestFilterPrecisionResultToPlanned_SingleItemConvertsItemsToItem(t *testing.T) {
	result := map[string]any{
		"items": []map[string]any{
			{"name": "白米饭", "estimatedWeightGrams": 180},
			{"name": "辣椒炒鸡肉", "estimatedWeightGrams": 60},
		},
	}
	payload := map[string]any{
		"items_to_estimate": []map[string]any{
			{"item_key": "chicken", "item_name": "青椒炒鸡块"},
		},
	}

	filtered := filterPrecisionResultToPlanned(result, payload)
	if _, ok := filtered["items"]; ok {
		t.Fatalf("single planned item should not keep items array: %#v", filtered)
	}
	item, ok := filtered["item"].(map[string]any)
	if !ok {
		t.Fatalf("expected item result, got %#v", filtered["item"])
	}
	if got := stringFromMap(item, "name"); got != "辣椒炒鸡肉" {
		t.Fatalf("expected similar chicken item, got %s", got)
	}
}

func TestAttachPlannedItemMetadata_SingleItem(t *testing.T) {
	result := map[string]any{
		"item": map[string]any{"name": "辣椒炒鸡肉", "estimatedWeightGrams": 60},
	}
	payload := map[string]any{
		"items_to_estimate": []map[string]any{
			{"item_key": "chicken", "item_name": "青椒炒鸡块", "uncertainty_level": "medium"},
		},
	}

	attached := attachPlannedItemMetadata(result, payload)
	item := attached["item"].(map[string]any)
	if got := stringFromMap(item, "item_key"); got != "chicken" {
		t.Fatalf("expected item metadata attached, got %s", got)
	}
}

func TestNormalizePrecisionPlanResult_AutoSingleShot(t *testing.T) {
	normalized := normalizePrecisionPlanResult(map[string]any{
		"precisionStatus":      "needs_user_input",
		"splitStrategy":        "single_item",
		"detectedItemsSummary": []any{"白米饭", "青椒炒鸡块"},
	})

	if got := stringFromMap(normalized, "precisionStatus"); got != "ready_for_estimate" {
		t.Fatalf("expected ready_for_estimate, got %s", got)
	}
	if got := stringFromMap(normalized, "splitStrategy"); got != "single_shot" {
		t.Fatalf("expected single_shot for <=3 non-high items, got %s", got)
	}
	items := extractItems(normalized["itemsToEstimate"])
	if len(items) != 2 {
		t.Fatalf("expected detected summary converted to 2 estimate items, got %#v", items)
	}
}

func TestNormalizePrecisionPlanResult_AutoGroupedParallelForHigh(t *testing.T) {
	normalized := normalizePrecisionPlanResult(map[string]any{
		"splitStrategy": "multi_item_parallel",
		"itemsToEstimate": []map[string]any{
			{"item_key": "rice", "item_name": "白米饭", "uncertainty_level": "low"},
			{"item_key": "stew", "item_name": "红烧肉", "uncertainty_level": "high"},
		},
	})

	if got := stringFromMap(normalized, "splitStrategy"); got != "grouped_parallel" {
		t.Fatalf("expected grouped_parallel when high uncertainty exists, got %s", got)
	}
}

func TestForceSeparateMixedDishPlan_SplitsCompoundDishName(t *testing.T) {
	plan := normalizePrecisionPlanResult(map[string]any{
		"splitStrategy": "single_item",
		"itemsToEstimate": []map[string]any{
			{"item_key": "meal", "item_name": "鸡肉胡萝卜烩意面", "uncertainty_level": "high"},
		},
	})

	split := forceSeparateMixedDishPlan(plan)
	items := extractItems(split["itemsToEstimate"])
	if len(items) != 3 {
		t.Fatalf("expected 3 component items, got %#v", items)
	}
	names := []string{
		stringFromMap(items[0], "item_name"),
		stringFromMap(items[1], "item_name"),
		stringFromMap(items[2], "item_name"),
	}
	joined := strings.Join(names, ",")
	for _, expected := range []string{"意大利面", "鸡肉", "胡萝卜"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected %s in split names %v", expected, names)
		}
	}
	if got := stringFromMap(split, "splitStrategy"); got != "single_shot" {
		t.Fatalf("expected single_shot split strategy, got %s", got)
	}
	if strings.Contains(joined, "鸡肉胡萝卜烩意面") {
		t.Fatalf("whole dish should not remain as item name: %v", names)
	}
}

func TestParsePrecisionEstimateItems_SingleItem(t *testing.T) {
	items, err := parsePrecisionEstimateItems(map[string]any{
		"item": map[string]any{"name": "白米饭", "estimatedWeightGrams": float64(180)},
	}, []map[string]any{{"item_name": "白米饭"}}, nil)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if len(items) != 1 || stringFromMap(items[0], "name") != "白米饭" {
		t.Fatalf("unexpected parsed items: %#v", items)
	}
	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 180 {
		t.Fatalf("unexpected weight: %v", got)
	}
}

func TestParsePrecisionEstimateItems_MultiItems(t *testing.T) {
	items, err := parsePrecisionEstimateItems(map[string]any{
		"items": []map[string]any{
			{"name": "白米饭", "estimatedWeightGrams": 180},
			{"name": "青椒炒鸡块", "weight": 75},
		},
	}, []map[string]any{{"item_name": "白米饭"}, {"item_name": "青椒炒鸡块"}}, nil)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected two parsed items, got %#v", items)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 75 {
		t.Fatalf("expected weight fallback from weight field, got %v", got)
	}
}

func TestParsePrecisionEstimateItems_FiltersToPlannedItems(t *testing.T) {
	items, err := parsePrecisionEstimateItems(map[string]any{
		"items": []map[string]any{
			{"name": "剁椒鱼块", "estimatedWeightGrams": 85},
			{"name": "米饭", "estimatedWeightGrams": 135},
			{"name": "西兰花", "estimatedWeightGrams": 75},
		},
	}, []map[string]any{{"item_name": "剁椒鱼块"}}, nil)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one planned item, got %#v", items)
	}
	if got := stringFromMap(items[0], "name"); got != "剁椒鱼块" {
		t.Fatalf("expected planned item preserved, got %s", got)
	}
}

func TestAttachPrecisionItemMetadata_MatchesByNameThenIndex(t *testing.T) {
	items := attachPrecisionItemMetadata(
		[]map[string]any{
			{"name": "青椒炒鸡块", "estimatedWeightGrams": 80},
			{"name": "白米饭", "estimatedWeightGrams": 180},
		},
		[]map[string]any{
			{"item_key": "rice", "item_name": "白米饭", "uncertainty_level": "low"},
			{"item_key": "chicken", "item_name": "青椒炒鸡块", "uncertainty_level": "medium"},
		},
	)

	if got := stringFromMap(items[0], "item_key"); got != "chicken" {
		t.Fatalf("expected chicken metadata on first item, got %s", got)
	}
	if got := stringFromMap(items[1], "item_key"); got != "rice" {
		t.Fatalf("expected rice metadata on second item, got %s", got)
	}
}

func TestShouldRefinePrecisionWeights_RefinesEveryPrecisionItem(t *testing.T) {
	cases := [][]map[string]any{
		{{"item_name": "白米饭", "uncertainty_level": "low"}},
		{{"item_name": "清炒冬瓜", "uncertainty_level": "high"}},
		{{"item_name": "苹果", "requires_reference": true}},
		{{"item_name": "鸡蛋", "uncertainty_level": "low"}},
	}
	for _, items := range cases {
		if !shouldRefinePrecisionWeights(items) {
			t.Fatalf("expected refine trigger for %#v", items)
		}
	}
	if shouldRefinePrecisionWeights(nil) {
		t.Fatalf("did not expect refine for empty plan")
	}
}

func TestPrecisionStaplePrompts_ForceContainerDepthAndThinLayer(t *testing.T) {
	single := buildPrecisionItemEstimatePromptSingle("image", "白米饭", "", "图片输入", "", nil)
	multi := buildPrecisionItemEstimatePromptMulti("image", []map[string]any{{"item_name": "白米饭"}}, "图片输入", "", nil)
	refine := buildPrecisionWeightRefinePrompt([]map[string]any{{"name": "白米饭", "estimatedWeightGrams": 200}}, "图片输入", "", nil)

	for label, prompt := range map[string]string{"single": single, "multi": multi, "refine": refine} {
		for _, expected := range []string{"容器容量", "填充比例", "薄薄一层", "可见面积", "平均厚度", "不要使用固定区间"} {
			if !strings.Contains(prompt, expected) {
				t.Fatalf("%s prompt missing staple volume rule %q:\n%s", label, expected, prompt)
			}
		}
		if strings.Contains(prompt, "50-120g") {
			t.Fatalf("%s prompt should not hard-code thin-layer weight range:\n%s", label, prompt)
		}
	}
}

func TestPrecisionPrompts_ForceEdibleNetWeight(t *testing.T) {
	plan := buildPrecisionPlanPrompt("image", "图片输入", "", nil, nil, false)
	single := buildPrecisionItemEstimatePromptSingle("image", "带壳虾", "", "图片输入", "", nil)
	multi := buildPrecisionItemEstimatePromptMulti("image", []map[string]any{{"item_name": "花生"}}, "图片输入", "", nil)
	refine := buildPrecisionWeightRefinePrompt([]map[string]any{{"name": "螃蟹", "estimatedWeightGrams": 300}}, "图片输入", "", nil)

	for label, prompt := range map[string]string{"plan": plan, "single": single, "multi": multi, "refine": refine} {
		for _, expected := range []string{"可食部净重", "带壳", "去壳/去骨/去核", "果核"} {
			if !strings.Contains(prompt, expected) {
				t.Fatalf("%s prompt missing edible-weight rule %q:\n%s", label, expected, prompt)
			}
		}
	}
}

func TestPrecisionPrompts_ForceFoodTypeCandidates(t *testing.T) {
	plan := buildPrecisionPlanPrompt("image", "图片输入", "", nil, nil, false)
	for _, expected := range []string{"候选食物", "莴苣", "百叶包", "蒸饺", "visual_evidence", "alternative_name"} {
		if !strings.Contains(plan, expected) {
			t.Fatalf("plan prompt missing food type candidate rule %q:\n%s", expected, plan)
		}
	}

	single, err := buildPrecisionItemEstimatePromptFromPayload("image", map[string]any{
		"items_to_estimate": []map[string]any{{
			"item_name":        "青菜",
			"candidate_names":  []string{"莴苣片", "青菜", "小白菜"},
			"alternative_name": "莴苣片",
			"visual_evidence":  "浅绿色厚片状茎部为主",
		}},
	}, "图片输入", "", nil)
	if err != nil {
		t.Fatalf("unexpected prompt error: %v", err)
	}
	for _, expected := range []string{"候选：青菜/莴苣片/小白菜", "视觉证据：浅绿色厚片状茎部为主", "莴苣/莴笋片", "青菜/小白菜"} {
		if !strings.Contains(single, expected) {
			t.Fatalf("single item prompt missing candidate context %q:\n%s", expected, single)
		}
	}
}

func TestPrecisionPrompts_StrictSeparateMixedDishRules(t *testing.T) {
	plan := buildPrecisionPlanPrompt("image", "图片输入", "", nil, nil, true)
	for _, expected := range []string{"精准分项模式额外要求", "不要把明显混合食物只作为一道整菜输出", "鸡肉胡萝卜烩意面", "牛肉面", "只估计该成分"} {
		if !strings.Contains(plan, expected) {
			t.Fatalf("strict separate plan prompt missing rule %q:\n%s", expected, plan)
		}
	}

	single := buildPrecisionItemEstimatePromptSingle("image", "意大利面", "来自混合菜的意大利面部分；只估计该成分", "图片输入", "", nil)
	if !strings.Contains(single, "不要把鸡肉、胡萝卜、酱汁重量并入") {
		t.Fatalf("single item prompt missing mixed component rule:\n%s", single)
	}
}

func TestNormalizePrecisionPlanItems_PreservesRecognitionCandidates(t *testing.T) {
	items := normalizePrecisionPlanItems([]map[string]any{{
		"item_key":         "veg",
		"item_name":        "莴苣片",
		"candidate_names":  []string{"莴苣片", "青菜", "小白菜"},
		"alternative_name": "青菜",
		"visual_evidence":  "浅绿色厚片状茎部为主",
	}})
	if len(items) != 1 {
		t.Fatalf("expected one item, got %#v", items)
	}
	candidates := stringSliceFromAny(items[0]["candidate_names"])
	if strings.Join(candidates, ",") != "莴苣片,青菜,小白菜" {
		t.Fatalf("unexpected candidates: %#v", candidates)
	}
	if got := stringFromMap(items[0], "visual_evidence"); got != "浅绿色厚片状茎部为主" {
		t.Fatalf("expected visual evidence preserved, got %s", got)
	}
	if got := stringFromMap(items[0], "alternative_name"); got != "青菜" {
		t.Fatalf("expected alternative preserved, got %s", got)
	}
}

func TestNormalizePrecisionPlanItems_QualifiesHydrationSensitiveNames(t *testing.T) {
	items := normalizePrecisionPlanItems([]map[string]any{
		{
			"item_key":      "cooked_rice_noodle",
			"item_name":     "米粉",
			"foodState":     "cooked",
			"weightBasis":   "as_served",
			"basisEvidence": "餐碗内已煮熟",
		},
		{
			"item_key":    "dry_rice_noodle",
			"item_name":   "米粉",
			"foodState":   "dry",
			"weightBasis": "dry",
		},
	})
	if len(items) != 2 {
		t.Fatalf("expected two items, got %#v", items)
	}
	if got := stringFromMap(items[0], "item_name"); got != "熟米粉" {
		t.Fatalf("expected cooked state in display name, got %s", got)
	}
	if got := stringFromMap(items[0], "foodState"); got != "cooked" {
		t.Fatalf("expected cooked foodState, got %s", got)
	}
	if got := stringFromMap(items[0], "weightBasis"); got != "as_served" {
		t.Fatalf("expected as_served weightBasis, got %s", got)
	}
	if got := stringFromMap(items[0], "basisEvidence"); got != "餐碗内已煮熟" {
		t.Fatalf("expected basis evidence preserved, got %s", got)
	}
	if got := stringFromMap(items[1], "item_name"); got != "干米粉" {
		t.Fatalf("expected dry state in display name, got %s", got)
	}
}

func TestParsePrecisionEstimateItems_PreservesCookedWeightBasis(t *testing.T) {
	items, err := parsePrecisionEstimateItems(map[string]any{
		"item": map[string]any{
			"name":                 "米粉",
			"foodState":            "cooked",
			"weightBasis":          "as_served",
			"basisEvidence":        "汤碗内为柔软熟制米粉",
			"estimatedWeightGrams": 220,
		},
	}, []map[string]any{{
		"item_name":     "熟米粉",
		"foodState":     "cooked",
		"weightBasis":   "as_served",
		"basisEvidence": "汤碗内为柔软熟制米粉",
	}}, nil)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one item, got %#v", items)
	}
	if got := stringFromMap(items[0], "name"); got != "熟米粉" {
		t.Fatalf("expected state-qualified name, got %s", got)
	}
	if got := stringFromMap(items[0], "foodState"); got != "cooked" {
		t.Fatalf("expected cooked foodState, got %s", got)
	}
	if got := stringFromMap(items[0], "weightBasis"); got != "as_served" {
		t.Fatalf("expected as_served basis, got %s", got)
	}
}

func TestParsePrecisionRefinedItems_PreservesStateMetadataFromFallback(t *testing.T) {
	fallback := []map[string]any{{
		"name":                 "熟米粉",
		"foodState":            "cooked",
		"weightBasis":          "as_served",
		"basisEvidence":        "餐碗内已煮熟",
		"estimatedWeightGrams": 200,
	}}
	items, _ := parsePrecisionRefinedItems(map[string]any{
		"items": []map[string]any{{
			"name":                 "米粉",
			"estimatedWeightGrams": 220,
		}},
	}, fallback)
	if len(items) != 1 {
		t.Fatalf("expected one refined item, got %#v", items)
	}
	for key, expected := range map[string]string{
		"name":          "熟米粉",
		"foodState":     "cooked",
		"weightBasis":   "as_served",
		"basisEvidence": "餐碗内已煮熟",
	} {
		if got := stringFromMap(items[0], key); got != expected {
			t.Fatalf("expected %s=%s, got %s in %#v", key, expected, got, items[0])
		}
	}
}

func TestPrecisionPrompts_RequireStateQualifiedNutritionBasis(t *testing.T) {
	plan := buildPrecisionPlanPrompt("image", "图片输入", "", nil, nil, true)
	single, err := buildPrecisionItemEstimatePromptFromPayload("image", map[string]any{
		"items_to_estimate": []map[string]any{{
			"item_name":     "米粉",
			"foodState":     "cooked",
			"weightBasis":   "as_served",
			"basisEvidence": "餐碗内已煮熟",
		}},
	}, "图片输入", "", nil)
	if err != nil {
		t.Fatalf("unexpected prompt error: %v", err)
	}
	refine := buildPrecisionWeightRefinePrompt([]map[string]any{{
		"name":                 "熟米粉",
		"foodState":            "cooked",
		"weightBasis":          "as_served",
		"estimatedWeightGrams": 220,
	}}, "图片输入", "", nil)

	for label, prompt := range map[string]string{"plan": plan, "single": single, "refine": refine} {
		for _, expected := range []string{"foodState", "weightBasis", "basisEvidence", "熟米粉", "干料"} {
			if !strings.Contains(prompt, expected) {
				t.Fatalf("%s prompt missing state/basis rule %q:\n%s", label, expected, prompt)
			}
		}
	}
}

func TestParsePrecisionRefinedItems_UsesFallbackWhenNoItems(t *testing.T) {
	fallback := []map[string]any{{"name": "白米饭", "estimatedWeightGrams": 180}}
	items, notes := parsePrecisionRefinedItems(map[string]any{
		"uncertaintyNotes": []any{"视角不清"},
	}, fallback)

	if len(items) != 1 || stringFromMap(items[0], "name") != "白米饭" {
		t.Fatalf("expected fallback items, got %#v", items)
	}
	if len(notes) != 1 || notes[0] != "视角不清" {
		t.Fatalf("expected uncertainty note, got %#v", notes)
	}
}

func TestParsePrecisionRefinedItems_ParsesWeights(t *testing.T) {
	items, notes := parsePrecisionRefinedItems(map[string]any{
		"items": []map[string]any{
			{"name": "白米饭", "estimatedWeightGrams": 220},
			{"name": "红烧肉", "weight": 95},
		},
		"uncertaintyNotes": []any{"米饭按碗深修正"},
	}, nil)

	if len(items) != 2 {
		t.Fatalf("expected refined items, got %#v", items)
	}
	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 220 {
		t.Fatalf("expected refined rice weight, got %v", got)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 95 {
		t.Fatalf("expected refined meat weight, got %v", got)
	}
	if len(notes) != 1 {
		t.Fatalf("expected note, got %#v", notes)
	}
}

func TestParsePrecisionRefinedItems_DoesNotExpandBeyondFallback(t *testing.T) {
	fallback := []map[string]any{{"name": "剁椒鱼块", "estimatedWeightGrams": 95}}
	items, _ := parsePrecisionRefinedItems(map[string]any{
		"items": []map[string]any{
			{"name": "剁椒鱼块", "estimatedWeightGrams": 85},
			{"name": "米饭", "estimatedWeightGrams": 135},
			{"name": "西兰花", "estimatedWeightGrams": 75},
			{"name": "青菜", "estimatedWeightGrams": 55},
			{"name": "抄手", "estimatedWeightGrams": 65},
		},
	}, fallback)

	if len(items) != 1 {
		t.Fatalf("expected refine to keep one fallback item, got %#v", items)
	}
	if got := stringFromMap(items[0], "name"); got != "剁椒鱼块" {
		t.Fatalf("expected fallback-matched item, got %s", got)
	}
	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 85 {
		t.Fatalf("expected refined planned weight, got %v", got)
	}
}

func TestBuildItemsFromCorrection_KeepsUserNutrition(t *testing.T) {
	items := buildItemsFromCorrection([]map[string]any{
		{
			"name":           "白米饭",
			"weight":         120,
			"sourceItemId":   7,
			"sourceName":     "米饭",
			"calorie":        156,
			"protein":        3.1,
			"carbs":          34.2,
			"fat":            0.4,
			"originalWeight": 180,
		},
	})

	if len(items) != 1 {
		t.Fatalf("expected one correction item, got %#v", items)
	}
	if got := stringFromMap(items[0], "name"); got != "白米饭" {
		t.Fatalf("expected corrected name, got %s", got)
	}
	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 120 {
		t.Fatalf("expected corrected weight, got %v", got)
	}
	nutrients, _ := items[0]["nutrients"].(map[string]any)
	if got, _ := floatFromAny(nutrients["calories"]); got != 156 {
		t.Fatalf("expected user calories to be preserved, got %v", got)
	}
}

func TestBuildItemsFromCorrection_MarksEditedWeightAsUserWeight(t *testing.T) {
	items := buildItemsFromCorrection([]map[string]any{
		{
			"name":         "桃李豆沙小饼面包",
			"weight":       30,
			"weightEdited": true,
		},
	})

	if len(items) != 1 {
		t.Fatalf("expected one correction item, got %#v", items)
	}
	if got, _ := floatFromAny(items[0]["userWeightGrams"]); got != 30 {
		t.Fatalf("expected userWeightGrams to protect correction from package anchor, got %v", got)
	}
	if !boolFromAny(items[0]["weightEdited"]) {
		t.Fatalf("expected weightEdited marker")
	}
}

func TestApplyCorrectionContextOverrides_UsesExplicitWeightAndKJ(t *testing.T) {
	correctionItems := []map[string]any{
		{
			"name":    "八喜牛奶冰淇淋",
			"weight":  75,
			"calorie": 158,
			"nutrients": map[string]any{
				"calories": 158,
				"protein":  3,
				"carbs":    18,
				"fat":      8,
			},
		},
		{
			"name":    "巧乐兹低糖抹茶口味雪糕",
			"weight":  65,
			"calorie": 148,
			"nutrients": map[string]any{
				"calories": 148,
				"protein":  2,
				"carbs":    17,
				"fat":      7,
			},
		},
	}
	overrides := parseCorrectionContextOverrides("八喜牛奶冰淇淋60克，532千焦。巧乐兹低糖抹茶口味雪糕50克，799千焦。", correctionItems)
	merged := applyCorrectionContextOverrides(correctionItems, overrides)
	items := buildItemsFromCorrection(merged)

	if len(items) != 2 {
		t.Fatalf("expected two correction items, got %#v", items)
	}
	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected first item weight from context, got %v", got)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 50 {
		t.Fatalf("expected second item weight from context, got %v", got)
	}
	firstNutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(firstNutrients["calories"]); got < 127 || got > 128 {
		t.Fatalf("expected first item kcal converted from 532kJ, got %v", got)
	}
	secondNutrients := mapFromAny(items[1]["nutrients"])
	if got, _ := floatFromAny(secondNutrients["calories"]); got < 190 || got > 192 {
		t.Fatalf("expected second item kcal converted from 799kJ, got %v", got)
	}
}

func TestApplyCorrectionOverridesToResultItems_OverridesAfterDBFirst(t *testing.T) {
	dbItems := []map[string]any{
		{
			"name":                 "八喜牛奶冰淇淋",
			"estimatedWeightGrams": 75,
			"nutrition_source":     "library_exact_canonical",
			"nutrients": map[string]any{
				"calories": 157.5,
				"protein":  3.2,
				"carbs":    20.1,
				"fat":      6.5,
			},
		},
	}
	weight := 60.0
	kcal := 532.0 / 4.184

	items := applyCorrectionOverridesToResultItems(dbItems, map[int]correctionContextOverride{
		0: {WeightGrams: &weight, Calories: &kcal},
	})

	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected user context to override db-first weight, got %v", got)
	}
	nutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(nutrients["calories"]); got < 127 || got > 128 {
		t.Fatalf("expected user context to override db-first calories, got %v", got)
	}
	if got, _ := floatFromAny(nutrients["protein"]); got != 3.2 {
		t.Fatalf("expected db-first protein to be preserved, got %v", got)
	}
	if source := stringFromMap(items[0], "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected correction source marker, got %s", source)
	}
}

func TestApplyCorrectionNutritionEditsToResultItems_OverridesEditedMacrosAfterDBFirst(t *testing.T) {
	previous := []map[string]any{{
		"itemId":               1,
		"name":                 "白米饭",
		"estimatedWeightGrams": 100,
		"nutrients": map[string]any{
			"calories": 116.0,
			"protein":  2.6,
			"carbs":    25.9,
			"fat":      0.3,
		},
	}}
	correction := []map[string]any{{
		"sourceItemId": 1,
		"name":         "白米饭",
		"weight":       100,
		"nutrients": map[string]any{
			"calories": 116.0,
			"protein":  8.0,
			"carbs":    25.9,
			"fat":      0.3,
		},
	}}
	dbItems := []map[string]any{{
		"itemId":               1,
		"name":                 "白米饭",
		"estimatedWeightGrams": 100,
		"nutrition_source":     "library_exact_canonical",
		"nutrients": map[string]any{
			"calories": 116.0,
			"protein":  2.6,
			"carbs":    25.9,
			"fat":      0.3,
		},
	}}

	items := applyCorrectionNutritionEditsToResultItems(dbItems, correction, previous)

	nutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(nutrients["protein"]); got != 8 {
		t.Fatalf("expected edited protein to override DB-first, got %v", got)
	}
	if source := stringFromMap(items[0], "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected correction nutrition source, got %s", source)
	}
}

func TestApplyCorrectionNutritionEditsToResultItems_IgnoresPureWeightScaling(t *testing.T) {
	previous := []map[string]any{{
		"itemId":               1,
		"name":                 "白米饭",
		"estimatedWeightGrams": 100,
		"nutrients": map[string]any{
			"calories": 100.0,
			"protein":  10.0,
		},
	}}
	correction := []map[string]any{{
		"sourceItemId":   1,
		"name":           "白米饭",
		"weight":         50,
		"weightEdited":   true,
		"originalWeight": 100,
		"nutrients": map[string]any{
			"calories": 50.0,
			"protein":  5.0,
		},
	}}
	dbItems := []map[string]any{{
		"itemId":               1,
		"name":                 "白米饭",
		"estimatedWeightGrams": 50,
		"nutrition_source":     "library_exact_canonical",
		"nutrients": map[string]any{
			"calories": 55.0,
			"protein":  4.0,
		},
	}}

	items := applyCorrectionNutritionEditsToResultItems(dbItems, correction, previous)

	nutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(nutrients["protein"]); got != 4 {
		t.Fatalf("expected pure weight scaling to keep DB-first nutrition, got %v", got)
	}
	if source := stringFromMap(items[0], "nutrition_source"); source != "library_exact_canonical" {
		t.Fatalf("expected DB-first source to remain, got %s", source)
	}
}

func TestApplyCorrectionNutritionEditsToResultItems_DoesNotOverrideNewItemWithZeroNutrients(t *testing.T) {
	correction := []map[string]any{{
		"name":   "新增米饭",
		"weight": 100,
		"nutrients": map[string]any{
			"calories": 0.0,
			"protein":  0.0,
			"carbs":    0.0,
			"fat":      0.0,
		},
	}}
	dbItems := []map[string]any{{
		"name":                 "新增米饭",
		"estimatedWeightGrams": 100,
		"nutrition_source":     "library_exact_canonical",
		"nutrients": map[string]any{
			"calories": 116.0,
			"protein":  2.6,
			"carbs":    25.9,
			"fat":      0.3,
		},
	}}

	items := applyCorrectionNutritionEditsToResultItems(dbItems, correction, nil)

	nutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(nutrients["calories"]); got != 116 {
		t.Fatalf("expected DB-first calories to remain, got %v", got)
	}
	if source := stringFromMap(items[0], "nutrition_source"); source != "library_exact_canonical" {
		t.Fatalf("expected DB-first source to remain, got %s", source)
	}
}

func TestApplyCorrectionIdentityAndWeightEditsToResultItems_UserEditsWinAfterDBFirst(t *testing.T) {
	dbItems := []map[string]any{
		{
			"itemId":               1,
			"name":                 "白米饭",
			"estimatedWeightGrams": 150.0,
			"nutrition_source":     "library_exact_canonical",
		},
		{
			"itemId":                 12,
			"name":                   "桃李豆沙小饼面包",
			"estimatedWeightGrams":   55.0,
			"grossWeightGrams":       55.0,
			"nutrition_source":       "packaged_food_library",
			"package_weight_source":  "packaged_food_library",
			"package_weight_applied": true,
		},
	}
	correction := []map[string]any{
		{
			"sourceItemId":         1,
			"sourceName":           "白米饭",
			"name":                 "白米饭",
			"estimatedWeightGrams": 150.0,
		},
		{
			"sourceItemId":         12,
			"sourceName":           "桃李豆沙小饼面包",
			"name":                 "桃李豆沙小饼面包（半包）",
			"estimatedWeightGrams": 27.5,
			"nameEdited":           true,
			"weightEdited":         true,
		},
	}

	items := applyCorrectionIdentityAndWeightEditsToResultItems(dbItems, correction)

	if name := stringFromMap(items[0], "name"); name != "白米饭" {
		t.Fatalf("expected first item to stay unchanged, got %s", name)
	}
	if name := stringFromMap(items[1], "name"); name != "桃李豆沙小饼面包（半包）" {
		t.Fatalf("expected corrected package name, got %s", name)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 27.5 {
		t.Fatalf("expected corrected package weight 27.5g, got %v", got)
	}
	if got, _ := floatFromAny(items[1]["grossWeightGrams"]); got != 27.5 {
		t.Fatalf("expected corrected gross weight 27.5g, got %v", got)
	}
	if source := stringFromMap(items[1], "package_weight_source"); source != "user_context" {
		t.Fatalf("expected user weight source, got %s", source)
	}
	if !boolFromAny(items[1]["nameEdited"]) || !boolFromAny(items[1]["weightEdited"]) {
		t.Fatalf("expected edited markers on corrected item: %#v", items[1])
	}
}

func TestApplyCorrectionPostProcessingToResult_AppliesNameWeightAndNutritionTogether(t *testing.T) {
	result := map[string]any{
		"items": []any{
			map[string]any{
				"itemId":               1,
				"name":                 "白米饭",
				"estimatedWeightGrams": 150.0,
				"nutrition_source":     "library_exact_canonical",
			},
			map[string]any{
				"itemId":                12,
				"name":                  "桃李豆沙小饼面包",
				"estimatedWeightGrams":  55.0,
				"grossWeightGrams":      55.0,
				"nutrition_source":      "packaged_food_library",
				"package_weight_source": "packaged_food_library",
				"nutrients": map[string]any{
					"calories": 88.0,
					"protein":  1.93,
					"carbs":    15.95,
					"fat":      1.65,
				},
			},
		},
	}
	previous := []map[string]any{{
		"itemId":               12,
		"name":                 "桃李豆沙小饼面包",
		"estimatedWeightGrams": 55.0,
		"nutrients": map[string]any{
			"calories": 176.0,
			"protein":  3.85,
			"carbs":    31.9,
			"fat":      3.3,
		},
	}}
	correction := []map[string]any{
		{
			"sourceItemId":         1,
			"sourceName":           "白米饭",
			"name":                 "白米饭",
			"estimatedWeightGrams": 150.0,
		},
		{
			"sourceItemId":         12,
			"sourceName":           "桃李豆沙小饼面包",
			"name":                 "桃李豆沙小饼面包（半包）",
			"estimatedWeightGrams": 27.5,
			"nameEdited":           true,
			"weightEdited":         true,
			"nutritionEdited":      true,
			"nutrients": map[string]any{
				"calories": 90.0,
				"protein":  4.2,
				"carbs":    13.0,
				"fat":      2.5,
			},
		},
	}

	processed := applyCorrectionPostProcessingToResult(result, correction, previous, nil)
	items := extractItems(processed["items"])

	if len(items) != 2 {
		t.Fatalf("expected two items, got %#v", items)
	}
	if name := stringFromMap(items[1], "name"); name != "桃李豆沙小饼面包（半包）" {
		t.Fatalf("expected corrected name, got %s", name)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 27.5 {
		t.Fatalf("expected corrected weight 27.5g, got %v", got)
	}
	nutrients := mapFromAny(items[1]["nutrients"])
	if got, _ := floatFromAny(nutrients["calories"]); got != 90 {
		t.Fatalf("expected edited calories to win, got %v", got)
	}
	if got, _ := floatFromAny(nutrients["protein"]); got != 4.2 {
		t.Fatalf("expected edited protein to win, got %v", got)
	}
	if source := stringFromMap(items[1], "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected user correction nutrition source, got %s", source)
	}
	if source := stringFromMap(items[1], "package_weight_source"); source != "user_context" {
		t.Fatalf("expected user package weight source, got %s", source)
	}
}

func TestApplyCorrectionPostProcessingToResult_EditsNormalItemInMixedPackagedResult(t *testing.T) {
	result := map[string]any{
		"items": []any{
			map[string]any{
				"itemId":               1,
				"name":                 "白米饭",
				"estimatedWeightGrams": 150.0,
				"nutrition_source":     "library_exact_canonical",
				"nutrients": map[string]any{
					"calories": 174.0,
					"protein":  3.9,
					"carbs":    38.85,
					"fat":      0.45,
				},
			},
			map[string]any{
				"itemId":                 2,
				"name":                   "喜之郎CiCi果粒爽橙汁饮料",
				"estimatedWeightGrams":   258.0,
				"nutrition_source":       "packaged_food_library",
				"packaged_food_id":       "packaged:cici-orange-258g",
				"package_weight_source":  "packaged_food_library",
				"package_weight_applied": true,
				"packaged_candidates": []any{
					map[string]any{"id": "packaged:cici-orange-258g"},
				},
				"nutrients": map[string]any{
					"calories": 178.0,
					"protein":  1.2,
					"carbs":    42.0,
					"fat":      0.0,
				},
			},
		},
	}
	previous := []map[string]any{
		{
			"itemId":               1,
			"name":                 "白米饭",
			"estimatedWeightGrams": 150.0,
			"nutrients": map[string]any{
				"calories": 174.0,
				"protein":  3.9,
				"carbs":    38.85,
				"fat":      0.45,
			},
		},
		{
			"itemId":               2,
			"name":                 "喜之郎CiCi果粒爽橙汁饮料",
			"estimatedWeightGrams": 258.0,
			"nutrition_source":     "packaged_food_library",
			"nutrients": map[string]any{
				"calories": 178.0,
				"protein":  1.2,
				"carbs":    42.0,
				"fat":      0.0,
			},
		},
	}
	correction := []map[string]any{
		{
			"sourceItemId":         1,
			"sourceName":           "白米饭",
			"name":                 "糙米饭",
			"estimatedWeightGrams": 120.0,
			"weight":               120.0,
			"nameEdited":           true,
			"weightEdited":         true,
			"nutritionEdited":      true,
			"nutrients": map[string]any{
				"calories": 132.0,
				"protein":  3.2,
				"carbs":    27.6,
				"fat":      1.0,
			},
		},
		{
			"sourceItemId":         2,
			"sourceName":           "喜之郎CiCi果粒爽橙汁饮料",
			"name":                 "喜之郎CiCi果粒爽橙汁饮料",
			"estimatedWeightGrams": 258.0,
		},
	}

	processed := applyCorrectionPostProcessingToResult(result, correction, previous, nil)
	items := extractItems(processed["items"])
	if len(items) != 2 {
		t.Fatalf("expected two items, got %#v", items)
	}
	rice := items[0]
	if name := stringFromMap(rice, "name"); name != "糙米饭" {
		t.Fatalf("expected normal item rename to win, got %s", name)
	}
	if got, _ := floatFromAny(rice["estimatedWeightGrams"]); got != 120 {
		t.Fatalf("expected normal item corrected weight 120g, got %v", got)
	}
	riceNutrients := mapFromAny(rice["nutrients"])
	if got, _ := floatFromAny(riceNutrients["calories"]); got != 132 {
		t.Fatalf("expected edited rice calories, got %v in %#v", got, riceNutrients)
	}
	if source := stringFromMap(rice, "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected normal item user nutrition source, got %s", source)
	}
	if source := stringFromMap(rice, "package_weight_source"); source != "user_context" {
		t.Fatalf("expected normal item user weight source after correction, got %s", source)
	}
	packaged := items[1]
	if name := stringFromMap(packaged, "name"); name != "喜之郎CiCi果粒爽橙汁饮料" {
		t.Fatalf("expected packaged item unchanged, got %s", name)
	}
	if source := stringFromMap(packaged, "nutrition_source"); source != "packaged_food_library" {
		t.Fatalf("expected packaged nutrition source to remain, got %s", source)
	}
	if source := stringFromMap(packaged, "package_weight_source"); source != "packaged_food_library" {
		t.Fatalf("expected packaged weight source to remain, got %s", source)
	}
	if !boolFromAny(packaged["package_weight_applied"]) {
		t.Fatalf("expected packaged weight applied marker to remain: %#v", packaged)
	}
	if stringFromMap(packaged, "packaged_food_id") != "packaged:cici-orange-258g" {
		t.Fatalf("expected packaged food id to remain: %#v", packaged)
	}
}

func TestApplyCorrectionPostProcessingToResult_MatchesGraySuiteCorrectionWithoutSourceID(t *testing.T) {
	result := map[string]any{
		"items": []any{
			map[string]any{
				"name":                 "炸猪排",
				"estimatedWeightGrams": 120.0,
				"nutrition_source":     "library_exact_canonical",
				"nutrients": map[string]any{
					"calories": 312.0,
					"protein":  18.0,
					"carbs":    12.0,
					"fat":      21.0,
				},
			},
			map[string]any{
				"name":                 "卷心菜丝",
				"estimatedWeightGrams": 40.0,
				"nutrition_source":     "library_exact_canonical",
				"nutrients": map[string]any{
					"calories": 10.0,
					"protein":  0.5,
					"carbs":    2.0,
					"fat":      0.1,
				},
			},
			map[string]any{
				"name":                 "芝麻酱",
				"estimatedWeightGrams": 15.0,
				"nutrition_source":     "deepseek_generated",
				"nutrients": map[string]any{
					"calories": 90.0,
					"protein":  2.5,
					"carbs":    3.0,
					"fat":      8.0,
				},
			},
			map[string]any{
				"name":                   "雀巢咖啡1+2奶香（半包）",
				"estimatedWeightGrams":   52.5,
				"originalWeightGrams":    52.5,
				"grossWeightGrams":       52.5,
				"weight":                 52.5,
				"nutrition_source":       "packaged_food_library",
				"package_weight_source":  "packaged_food_library",
				"package_weight_applied": true,
				"suggestedRatio":         75.0,
				"suggestedRatioSource":   "ai",
				"nutrients": map[string]any{
					"calories": 21.08,
					"protein":  0.28,
					"carbs":    4.62,
					"fat":      0.18,
				},
			},
		},
	}
	previous := []map[string]any{
		{
			"name":                 "炸猪排",
			"estimatedWeightGrams": 120.0,
			"nutrients": map[string]any{
				"calories": 312.0,
				"protein":  18.0,
				"carbs":    12.0,
				"fat":      21.0,
			},
		},
		{
			"name":                 "卷心菜丝",
			"estimatedWeightGrams": 40.0,
			"nutrients": map[string]any{
				"calories": 10.0,
				"protein":  0.5,
				"carbs":    2.0,
				"fat":      0.1,
			},
		},
		{
			"name":                 "芝麻酱",
			"estimatedWeightGrams": 15.0,
			"nutrients": map[string]any{
				"calories": 90.0,
				"protein":  2.5,
				"carbs":    3.0,
				"fat":      8.0,
			},
		},
		{
			"name":                 "雀巢咖啡1+2奶香固体饮料",
			"estimatedWeightGrams": 105.0,
			"nutrition_source":     "packaged_food_library",
			"nutrients": map[string]any{
				"calories": 42.16,
				"protein":  0.56,
				"carbs":    9.24,
				"fat":      0.36,
			},
		},
	}
	correction := []map[string]any{{
		"name":                 "雀巢咖啡1+2奶香（半包）",
		"sourceName":           "雀巢咖啡1+2奶香",
		"estimatedWeightGrams": 52.5,
		"weight":               52.5,
		"nameEdited":           true,
		"weightEdited":         true,
		"nutritionEdited":      true,
		"nutrients": map[string]any{
			"calories": 52.5,
			"protein":  1.0,
			"carbs":    10.0,
			"fat":      1.0,
		},
	}}

	processed := applyCorrectionPostProcessingToResult(result, correction, previous, nil)
	items := extractItems(processed["items"])
	if len(items) != 4 {
		t.Fatalf("expected four result items, got %#v", items)
	}
	for index, item := range items[:3] {
		if source := stringFromMap(item, "nutrition_source"); source == "user_correction_context" {
			t.Fatalf("expected normal item %d to stay outside user nutrition override: %#v", index, item)
		}
	}
	corrected := items[3]
	if name := stringFromMap(corrected, "name"); name != "雀巢咖啡1+2奶香（半包）" {
		t.Fatalf("expected corrected package name, got %s", name)
	}
	if got, _ := floatFromAny(corrected["estimatedWeightGrams"]); got != 52.5 {
		t.Fatalf("expected corrected package weight 52.5g, got %v", got)
	}
	nutrients := mapFromAny(corrected["nutrients"])
	for key, want := range map[string]float64{
		"calories": 52.5,
		"protein":  1.0,
		"carbs":    10.0,
		"fat":      1.0,
	} {
		got, _ := floatFromAny(nutrients[key])
		if got != want {
			t.Fatalf("expected edited %s=%v to override packaged DB-first, got %v in %#v", key, want, got, nutrients)
		}
	}
	if source := stringFromMap(corrected, "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected user nutrition source, got %s", source)
	}
	if source := stringFromMap(corrected, "package_weight_source"); source != "user_context" {
		t.Fatalf("expected corrected weight to be user sourced, got %s", source)
	}
	if !boolFromAny(corrected["package_weight_applied"]) {
		t.Fatalf("expected package weight applied marker after user correction: %#v", corrected)
	}
	if got, _ := floatFromAny(corrected["suggestedRatio"]); got != 75 {
		t.Fatalf("expected AI suggested ratio to survive correction post-processing, got %v", got)
	}
	if source := stringFromMap(corrected, "suggestedRatioSource"); source != "ai" {
		t.Fatalf("expected AI suggested ratio source to survive correction post-processing, got %s", source)
	}
}

func TestApplyCorrectionNutritionEditsToResultItems_UsesSourceIDAfterNameWeightAndNutritionEdit(t *testing.T) {
	previous := []map[string]any{{
		"itemId":               12,
		"name":                 "桃李豆沙小饼面包",
		"estimatedWeightGrams": 55,
		"nutrients": map[string]any{
			"calories": 176.0,
			"protein":  3.85,
			"carbs":    31.9,
			"fat":      3.3,
		},
	}}
	correction := []map[string]any{{
		"sourceItemId":         12,
		"sourceName":           "桃李豆沙小饼面包",
		"name":                 "桃李豆沙小饼面包（半包）",
		"estimatedWeightGrams": 27.5,
		"nameEdited":           true,
		"weightEdited":         true,
		"nutritionEdited":      true,
		"nutrients": map[string]any{
			"calories": 90.0,
			"protein":  4.2,
			"carbs":    13.0,
			"fat":      2.5,
		},
	}}
	dbItems := []map[string]any{{
		"itemId":               12,
		"name":                 "桃李豆沙小饼面包（半包）",
		"estimatedWeightGrams": 27.5,
		"nutrition_source":     "packaged_food_library",
		"nutrients": map[string]any{
			"calories": 88.0,
			"protein":  1.93,
			"carbs":    15.95,
			"fat":      1.65,
		},
	}}

	items := applyCorrectionNutritionEditsToResultItems(dbItems, correction, previous)

	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 27.5 {
		t.Fatalf("expected corrected weight to remain, got %v", got)
	}
	nutrients := mapFromAny(items[0]["nutrients"])
	if got, _ := floatFromAny(nutrients["calories"]); got != 90 {
		t.Fatalf("expected edited calories to override packaged DB-first, got %v", got)
	}
	if got, _ := floatFromAny(nutrients["protein"]); got != 4.2 {
		t.Fatalf("expected edited protein to override packaged DB-first, got %v", got)
	}
	if source := stringFromMap(items[0], "nutrition_source"); source != "user_correction_context" {
		t.Fatalf("expected user correction nutrition source, got %s", source)
	}
	if !boolFromAny(items[0]["nutritionEdited"]) {
		t.Fatalf("expected nutritionEdited marker")
	}
}

func TestApplyCorrectionOverridesToResultItems_MatchesRenamedDBFirstItems(t *testing.T) {
	correctionItems := []map[string]any{
		{"name": "八喜牛奶冰淇淋", "weight": 75},
		{"name": "巧乐兹低糖抹茶口味雪糕", "weight": 65},
	}
	overrides := parseCorrectionContextOverrides("八喜牛奶冰淇淋60克，532千焦。巧乐兹低糖抹茶口味雪糕50克，799千焦。", correctionItems)
	dbItems := []map[string]any{
		{
			"name":                 "八喜牛奶冰淇淋",
			"estimatedWeightGrams": 75,
			"nutrients": map[string]any{
				"calories": 158,
				"protein":  2.1,
			},
		},
		{
			"name":                 "巧乐兹低糖抹茶可可味雪糕",
			"estimatedWeightGrams": 70,
			"nutrients": map[string]any{
				"calories": 112,
				"protein":  2.1,
			},
		},
	}

	items := applyCorrectionOverridesToResultItems(dbItems, overrides)

	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected first item to keep its 60g override, got %v", got)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 50 {
		t.Fatalf("expected renamed second item to use 50g override, got %v", got)
	}
	secondNutrients := mapFromAny(items[1]["nutrients"])
	if got, _ := floatFromAny(secondNutrients["calories"]); got < 190 || got > 192 {
		t.Fatalf("expected renamed second item kcal converted from 799kJ, got %v", got)
	}
}

func TestParseCorrectionContextOverrides_MatchesUserTypedNameVariant(t *testing.T) {
	correctionItems := []map[string]any{
		{"name": "八喜牛奶冰淇淋", "weight": 90},
		{"name": "巧乐兹低糖抹茶可可味雪糕", "weight": 70},
	}

	overrides := parseCorrectionContextOverrides("八喜牛奶冰淇淋60克，532千焦\n巧乐兹低糖抹茶口味雪糕50克，799千焦", correctionItems)
	merged := applyCorrectionContextOverrides(correctionItems, overrides)

	if got, _ := floatFromAny(merged[0]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected first item to use 60g override, got %v", got)
	}
	if got, _ := floatFromAny(merged[1]["estimatedWeightGrams"]); got != 50 {
		t.Fatalf("expected second variant item to use 50g override, got %v", got)
	}
	secondNutrients := mapFromAny(merged[1]["nutrients"])
	if got, _ := floatFromAny(secondNutrients["calories"]); got < 190 || got > 192 {
		t.Fatalf("expected second variant kcal converted from 799kJ, got %v", got)
	}
}

func TestApplyCorrectionOverridesToResultItems_MatchesByNameWhenOrderChanges(t *testing.T) {
	correctionItems := []map[string]any{
		{"name": "八喜牛奶冰淇淋", "weight": 75},
		{"name": "巧乐兹低糖抹茶口味雪糕", "weight": 65},
	}
	overrides := parseCorrectionContextOverrides("八喜牛奶冰淇淋60克。巧乐兹低糖抹茶口味雪糕50克。", correctionItems)
	dbItems := []map[string]any{
		{"name": "巧乐兹低糖抹茶可可味雪糕", "estimatedWeightGrams": 70},
		{"name": "八喜牛奶冰淇淋", "estimatedWeightGrams": 75},
	}

	items := applyCorrectionOverridesToResultItems(dbItems, overrides)

	if got, _ := floatFromAny(items[0]["estimatedWeightGrams"]); got != 50 {
		t.Fatalf("expected first db result item to match 巧乐兹 by name, got %v", got)
	}
	if got, _ := floatFromAny(items[1]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected second db result item to match 八喜 by name, got %v", got)
	}
}

func TestParseCorrectionContextOverrides_ParsesKcalUnitsAndPartialFields(t *testing.T) {
	correctionItems := []map[string]any{
		{"name": "八喜牛奶冰淇淋", "weight": 75},
		{"name": "巧乐兹低糖抹茶口味雪糕", "weight": 65},
	}

	overrides := parseCorrectionContextOverrides("八喜牛奶冰淇淋60g。巧乐兹低糖抹茶口味雪糕127千卡。", correctionItems)
	merged := applyCorrectionContextOverrides(correctionItems, overrides)

	if got, _ := floatFromAny(merged[0]["estimatedWeightGrams"]); got != 60 {
		t.Fatalf("expected g unit to override weight, got %v", got)
	}
	if _, ok := mapFromAny(merged[0]["nutrients"])["calories"]; ok {
		t.Fatalf("did not expect calories override for first item")
	}
	if got, _ := floatFromAny(merged[1]["weight"]); got != 65 {
		t.Fatalf("expected second item weight to remain db/list value, got %v", got)
	}
	secondNutrients := mapFromAny(merged[1]["nutrients"])
	if got, _ := floatFromAny(secondNutrients["calories"]); got != 127 {
		t.Fatalf("expected 千卡 to override calories, got %v", got)
	}

	overrides = parseCorrectionContextOverrides("八喜牛奶冰淇淋128kcal。巧乐兹低糖抹茶口味雪糕130大卡。", correctionItems)
	merged = applyCorrectionContextOverrides(correctionItems, overrides)
	firstNutrients := mapFromAny(merged[0]["nutrients"])
	if got, _ := floatFromAny(firstNutrients["calories"]); got != 128 {
		t.Fatalf("expected kcal to override calories, got %v", got)
	}
	secondNutrients = mapFromAny(merged[1]["nutrients"])
	if got, _ := floatFromAny(secondNutrients["calories"]); got != 130 {
		t.Fatalf("expected 大卡 to override calories, got %v", got)
	}
}

func TestRestoreCorrectionFallbackNutrition_PreventsZeroForUnresolved(t *testing.T) {
	dbItems := []map[string]any{{
		"name":                 "用户自定义菜",
		"estimatedWeightGrams": 100,
		"is_unresolved":        true,
		"resolve_status":       "unresolved",
		"nutrition_source":     "unresolved",
		"nutrients": map[string]any{
			"calories": 0.0,
			"protein":  0.0,
			"carbs":    0.0,
			"fat":      0.0,
		},
	}}
	original := []map[string]any{{
		"name":                 "用户自定义菜",
		"estimatedWeightGrams": 100,
		"nutrients": map[string]any{
			"calories": 210.0,
			"protein":  12.0,
			"carbs":    18.0,
			"fat":      9.0,
		},
	}}

	restored := restoreCorrectionFallbackNutrition(dbItems, original)
	nutrients := restored[0]["nutrients"].(map[string]any)
	if got, _ := floatFromAny(nutrients["calories"]); got != 210 {
		t.Fatalf("expected fallback calories, got %v", got)
	}
	if source := stringFromMap(restored[0], "nutrition_source"); source != "user_correction_fallback" {
		t.Fatalf("expected user correction fallback source, got %s", source)
	}
}

func TestBuildPrecisionFinalResult_HidesInternalProcessText(t *testing.T) {
	result, err := buildPrecisionFinalResult("session-1", 1, "grouped_parallel", []domain.PrecisionItemEstimate{
		{
			ItemIndex: 0,
			Status:    "done",
			Result: map[string]any{
				"items": []map[string]any{
					{
						"name":                 "辣椒炒鸡块",
						"estimatedWeightGrams": 80,
						"nutrition_source":     "deepseek_text_fallback",
						"uncertainty_level":    "high",
					},
					{
						"name":                 "白米饭",
						"estimatedWeightGrams": 180,
						"nutrition_source":     "library_exact_alias",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("unexpected final result error: %v", err)
	}
	insight := stringFromMap(result, "insight")
	for _, forbidden := range []string{"数据库命中", "AI补全", "AI估算", "分组", "参考物", "不确定性"} {
		if strings.Contains(insight, forbidden) {
			t.Fatalf("user-facing insight leaked internal text %q in %q", forbidden, insight)
		}
	}
	if result["context_advice"] != nil {
		t.Fatalf("expected no internal context advice, got %#v", result["context_advice"])
	}
	if summary, ok := result["dbLookupSummary"].(map[string]any); !ok || intFromMap(summary, "total") != 2 {
		t.Fatalf("expected internal db summary to remain for logs/debug, got %#v", result["dbLookupSummary"])
	}
}
