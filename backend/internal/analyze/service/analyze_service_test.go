package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	authrepo "food_link/backend/internal/auth/repo"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type mockLLMClient struct {
	result map[string]any
	err    error
}

func (m *mockLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	return m.result, m.err
}

type sequenceLLMClient struct {
	results []map[string]any
	errs    []error
	calls   int
}

func (m *sequenceLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	index := m.calls
	m.calls++
	if index < len(m.errs) && m.errs[index] != nil {
		return nil, m.errs[index]
	}
	if index < len(m.results) && m.results[index] != nil {
		return m.results[index], nil
	}
	if len(m.results) > 0 {
		return m.results[len(m.results)-1], nil
	}
	return map[string]any{}, nil
}

type multiImageLLMClient struct {
	result        map[string]any
	err           error
	imageURLCalls []string
	imageSetCalls [][]string
}

func (m *multiImageLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	m.imageURLCalls = append(m.imageURLCalls, imageURL)
	return m.result, m.err
}

func (m *multiImageLLMClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	copied := append([]string(nil), imageURLs...)
	m.imageSetCalls = append(m.imageSetCalls, copied)
	return m.result, m.err
}

func setupAnalyzeServiceTestDB(t *testing.T) (*gorm.DB, *authrepo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}))
	return db, authrepo.NewUserRepo(db)
}

func TestNormalizeExecutionMode(t *testing.T) {
	strict := "strict"
	standard := "standard"
	invalid := "invalid"
	assert.Equal(t, "strict", normalizeExecutionMode(&strict))
	assert.Equal(t, "standard", normalizeExecutionMode(&standard))
	assert.Equal(t, "standard", normalizeExecutionMode(&invalid))
	assert.Equal(t, "standard", normalizeExecutionMode(nil))
}

func TestResolveModelConfig(t *testing.T) {
	p, m := resolveModelConfig("")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("qwen")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("qwen-vl-max")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("deepseek")
	assert.Equal(t, "deepseek", p)
	assert.Equal(t, "deepseek-v4-flash", m)

	p, m = resolveModelConfig("gemini")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("ofox-gemini")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3-flash-preview", m)

	p, m = resolveModelConfig("unknown-model")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)
}

func TestParseLLMJSON(t *testing.T) {
	jsonStr := `{"description":"test","items":[{"name":"rice","estimatedWeightGrams":100,"nutrients":{"calories":130}}]}`
	parsed, err := parseLLMJSON(jsonStr)
	assert.NoError(t, err)
	assert.Equal(t, "test", parsed["description"])

	// with markdown fences
	fenced := "```json\n" + jsonStr + "\n```"
	parsed2, err := parseLLMJSON(fenced)
	assert.NoError(t, err)
	assert.Equal(t, "test", parsed2["description"])
}

func TestNormalizePayload(t *testing.T) {
	m := normalizePayload(map[string]any{"name": "apple"})
	assert.Equal(t, "apple", m["name"])

	arr := []any{map[string]any{"name": "apple"}, map[string]any{"name": "banana"}}
	m2 := normalizePayload(arr)
	items, ok := m2["items"].([]any)
	assert.True(t, ok)
	assert.Len(t, items, 2)
}

func TestBuildLocationText(t *testing.T) {
	assert.Equal(t, "北京 朝阳", buildLocationText("北京", "北京", "朝阳"))
	assert.Equal(t, "上海 浦东", buildLocationText("上海", "上海", "浦东"))
	assert.Equal(t, "广东 深圳 南山", buildLocationText("广东", "深圳", "南山"))
}

func TestBuildPromptStandardMode(t *testing.T) {
	input := AnalyzeInput{
		MealType:          "lunch",
		Province:          "北京",
		City:              "北京",
		District:          "朝阳",
		DietGoal:          "fat_loss",
		ActivityTiming:    "post_workout",
		RemainingCalories: floatPtr(500),
	}
	prompt := buildPrompt(input, nil, "standard")
	assert.Contains(t, prompt, "识别图片中的食物")
	assert.Contains(t, prompt, "餐次:午餐")
	assert.Contains(t, prompt, "状态:fat_loss/post_workout")
	assert.Contains(t, prompt, "剩余:500kcal")
	assert.Contains(t, prompt, "位置:北京 朝阳")
}

func TestBuildPromptStrictMode(t *testing.T) {
	input := AnalyzeInput{
		MealType: "dinner",
		UserGoal: "fat_loss",
	}
	prompt := buildPrompt(input, nil, "strict")
	assert.Contains(t, prompt, "请作为专业的营养师分析这张图片")
	assert.Contains(t, prompt, "pfc_ratio_comment")
	assert.Contains(t, prompt, "absorption_notes")
}

func TestBuildDBFirstPromptIncludesCorrectionContext(t *testing.T) {
	input := AnalyzeInput{
		ImageURL:          "https://example.com/meal.jpg",
		AdditionalContext: "米饭只有薄薄一层，肉丸其实是鸡肉块",
		PreviousResult: map[string]any{
			"description": "米饭肉丸",
			"items": []map[string]any{
				{"name": "白米饭", "estimatedWeightGrams": 220},
				{"name": "肉丸", "estimatedWeightGrams": 120},
			},
		},
		CorrectionItems: []map[string]any{
			{
				"name":       "白米饭",
				"weight":     90,
				"nameEdited": false,
			},
			{
				"name":       "青椒炒鸡块",
				"weight":     80,
				"sourceName": "肉丸",
				"nameEdited": true,
			},
		},
	}

	prompt := buildImageDBFirstPrompt(input, nil)

	assert.Contains(t, prompt, "二次纠错分析")
	assert.Contains(t, prompt, "米饭只有薄薄一层")
	assert.Contains(t, prompt, "上一轮识别结果")
	assert.Contains(t, prompt, "白米饭 220g")
	assert.Contains(t, prompt, "用户在纠错列表中提交的结构化清单")
	assert.Contains(t, prompt, "白米饭 90g")
	assert.Contains(t, prompt, "青椒炒鸡块 80g")
	assert.Contains(t, prompt, "原识别：肉丸")
	assert.Contains(t, prompt, "仍要让 AI 重新分析")
	assert.Contains(t, prompt, `"waterMl":0`)
}

func TestMergeBatchResults(t *testing.T) {
	results := []map[string]any{
		{
			"description": "desc1",
			"insight":     "insight1",
			"items": []map[string]any{
				{"name": "rice", "estimatedWeightGrams": 100.0, "waterMl": 65.0, "nutrients": map[string]any{"calories": 100.0}},
			},
			"pfc_ratio_comment": "good",
		},
		{
			"description": "desc2",
			"insight":     "insight2",
			"items": []map[string]any{
				{"name": "chicken", "estimatedWeightGrams": 150.0, "nutrients": map[string]any{"calories": 200.0}},
			},
		},
	}
	merged := mergeBatchResults(results, "standard")
	assert.Contains(t, merged["description"], "2 张图片")
	assert.Contains(t, merged["description"], "2 种食物")
	items := merged["items"].([]map[string]any)
	assert.Len(t, items, 2)
	assert.Equal(t, 65.0, items[0]["waterMl"])
}

func TestParseItems(t *testing.T) {
	parsed := map[string]any{
		"items": []any{
			map[string]any{
				"name":                 "apple",
				"estimatedWeightGrams": 150.0,
				"waterMl":              126.0,
				"nutrients": map[string]any{
					"calories": 80.0,
					"protein":  0.5,
					"carbs":    20.0,
					"fat":      0.3,
					"fiber":    4.0,
					"sugar":    16.0,
				},
			},
		},
	}
	items := parseItems(parsed)
	assert.Len(t, items, 1)
	assert.Equal(t, "apple", items[0]["name"])
	assert.Equal(t, 126.0, items[0]["waterMl"])
}

func TestMergeUniqueTextLists(t *testing.T) {
	result := mergeUniqueTextLists([]string{"a", "b"}, []string{"b", "c"})
	assert.Equal(t, []string{"a", "b", "c"}, result)

	empty := mergeUniqueTextLists()
	assert.Nil(t, empty)
}

func TestToStringSlice(t *testing.T) {
	assert.Equal(t, []string{"a", "b"}, toStringSlice([]any{"a", "b"}))
	assert.Nil(t, toStringSlice([]any{}))
	assert.Nil(t, toStringSlice("not array"))
}

func TestModelResultFrom(t *testing.T) {
	result := modelResultFrom(map[string]any{"description": "test"}, nil, "gemini")
	assert.Equal(t, "gemini", result["model_name"])
	assert.Equal(t, true, result["success"])

	errResult := modelResultFrom(nil, assert.AnError, "qwen")
	assert.Equal(t, false, errResult["success"])
	assert.NotEmpty(t, errResult["error"])
}

func TestAnalyzeService_Analyze(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "test", "items": []any{map[string]any{"name": "rice", "estimatedWeightGrams": 100.0, "nutrients": map[string]any{"calories": 130.0}}}}}
	svc := NewAnalyzeService(dashScopeClient, dashScopeClient, userRepo)
	svc.doubaoClient = dashScopeClient
	ctx := context.Background()

	result, err := svc.Analyze(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestAnalyzeService_AnalyzeUsesSingleLLMRequestForMultipleImages(t *testing.T) {
	client := &multiImageLLMClient{result: map[string]any{"description": "multi", "items": []any{}}}
	svc := NewAnalyzeService(client, client, nil)
	svc.doubaoClient = client

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/1.jpg",
		ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"},
		ModelName: "qwen",
	})

	require.NoError(t, err)
	assert.Equal(t, "multi", result["description"])
	require.Len(t, client.imageSetCalls, 1)
	assert.Equal(t, []string{"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"}, client.imageSetCalls[0])
	assert.Empty(t, client.imageURLCalls)
}

func TestAnalyzeService_AnalyzeText(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "text test", "items": []any{}}}
	svc := NewAnalyzeService(dashScopeClient, dashScopeClient, nil)
	svc.ConfigureDeepSeekFallback("fake-key")
	svc.deepseek.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"description\":\"text test\",\"items\":[]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}
	ctx := context.Background()

	result, err := svc.AnalyzeText(ctx, "", AnalyzeInput{Text: "一碗米饭"})
	require.NoError(t, err)
	assert.Equal(t, "text test", result["description"])
}

func TestAnalyzeService_AnalyzeTextRequiresDeepSeekByDefault(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "should not be used", "items": []any{}}}
	svc := NewAnalyzeService(dashScopeClient, dashScopeClient, nil)

	_, err := svc.AnalyzeText(context.Background(), "", AnalyzeInput{Text: "一碗米饭"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEEPSEEK_API_KEY")
}

func TestAnalyzeService_AnalyzeImageGeminiAliasRoutesToDoubao(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao image", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: assert.AnError}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "gemini",
	})

	require.NoError(t, err)
	assert.Equal(t, "doubao image", result["description"])
}

func TestAnalyzeService_AnalyzeImageStandardIgnoresConfiguredGeminiProvider(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao image", "items": []any{}}}
	ofoxClient := &mockLLMClient{result: map[string]any{"description": "gemini image", "items": []any{}}}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient
	svc.ConfigureImageProvider("gemini")

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "gemini",
	})

	require.NoError(t, err)
	assert.Equal(t, "doubao image", result["description"])
}

func TestAnalyzeService_AnalyzeImageStandardUsesDoubaoForExplicitQwen(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao image", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: assert.AnError}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient
	svc.ConfigureImageProvider("gemini")

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "qwen",
	})

	require.NoError(t, err)
	assert.Equal(t, "doubao image", result["description"])
}

func TestAnalyzeService_AnalyzeImageStandardForcesDoubaoInsteadOfGemini(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao standard", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: errors.New("ofoxai api error 429: Resource exhausted. Please try again later")}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "ofox-gemini",
	})

	require.NoError(t, err)
	assert.Equal(t, "doubao standard", result["description"])
}

func TestAnalyzeService_AnalyzeRetriesInvalidLLMJSON(t *testing.T) {
	_, parseErr := parseLLMJSON(`{"description":"broken"`)
	require.Error(t, parseErr)
	require.True(t, IsLLMJSONParseError(parseErr))
	client := &sequenceLLMClient{
		errs: []error{parseErr, parseErr, nil},
		results: []map[string]any{
			nil,
			nil,
			{"description": "retry success", "items": []any{}},
		},
	}
	svc := NewAnalyzeService(client, client, nil)
	svc.doubaoClient = client

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "qwen",
	})

	require.NoError(t, err)
	assert.Equal(t, "retry success", result["description"])
	assert.Equal(t, 3, client.calls)
}

func TestAnalyzeService_AnalyzeStopsAfterInvalidJSONRetries(t *testing.T) {
	_, parseErr := parseLLMJSON(`{"description":"broken"`)
	require.Error(t, parseErr)
	client := &sequenceLLMClient{
		errs: []error{parseErr, parseErr, parseErr, parseErr, nil},
	}
	svc := NewAnalyzeService(client, client, nil)
	svc.doubaoClient = client

	_, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "qwen",
	})

	require.Error(t, err)
	assert.True(t, IsLLMJSONParseError(err))
	assert.Equal(t, maxLLMJSONParseRetries+1, client.calls)
}

func TestAnalyzeService_RunPrecisionJSONFallsBackToDoubaoOnGeminiTransientError(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao precision fallback", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: errors.New(`Post "https://api.ofox.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`)}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient

	result, err := svc.RunPrecisionJSONWithImages(context.Background(), "image", "prompt", []string{"https://example.com/img.jpg"}, "ofox-gemini")

	require.NoError(t, err)
	assert.Equal(t, "doubao precision fallback", result["description"])
}

func TestAnalyzeService_RunPrecisionJSONNoFallbackKeepsGeminiError(t *testing.T) {
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao fallback", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: errors.New(`Post "https://api.ofox.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`)}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, nil)
	svc.doubaoClient = dashScopeClient

	_, err := svc.RunPrecisionJSONWithImagesNoFallback(context.Background(), "image", "prompt", []string{"https://example.com/img.jpg"}, "ofox-gemini")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "context deadline exceeded")
}

func TestAnalyzeService_AnalyzeCompare(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "doubao result", "items": []any{}}}
	ofoxClient := &mockLLMClient{result: map[string]any{"description": "gemini result", "items": []any{}}}
	svc := NewAnalyzeService(dashScopeClient, ofoxClient, userRepo)
	svc.doubaoClient = dashScopeClient
	ctx := context.Background()

	result, err := svc.AnalyzeCompare(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotNil(t, result["doubao_result"])
	assert.NotNil(t, result["gemini_result"])
}

func TestAnalyzeService_AnalyzeCompareEngines(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	dashScopeClient := &mockLLMClient{result: map[string]any{"description": "test", "items": []any{}}}
	svc := NewAnalyzeService(dashScopeClient, dashScopeClient, userRepo)
	svc.doubaoClient = dashScopeClient
	ctx := context.Background()

	result, err := svc.AnalyzeCompareEngines(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotNil(t, result["legacy_result"])
	assert.NotNil(t, result["db_first_result"])
}

func TestAnalyzeService_AnalyzeBatch(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	dashScopeClient := &multiImageLLMClient{result: map[string]any{"description": "batch", "items": []any{map[string]any{"name": "apple", "estimatedWeightGrams": 100.0, "nutrients": map[string]any{"calories": 50.0}}}}}
	svc := NewAnalyzeService(dashScopeClient, dashScopeClient, userRepo)
	svc.doubaoClient = dashScopeClient
	ctx := context.Background()

	_, err := svc.AnalyzeBatch(ctx, "", AnalyzeInput{ImageURLs: []string{}})
	assert.Error(t, err)

	result, err := svc.AnalyzeBatch(ctx, "", AnalyzeInput{ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}})
	require.NoError(t, err)
	assert.NotNil(t, result["description"])
	require.Len(t, dashScopeClient.imageSetCalls, 1)
	assert.Equal(t, []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}, dashScopeClient.imageSetCalls[0])
}

func TestAnalyzeService_AnalyzeBatch_TooMany(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo)
	ctx := context.Background()

	_, err := svc.AnalyzeBatch(ctx, "", AnalyzeInput{ImageURLs: []string{"1", "2", "3", "4", "5", "6"}})
	assert.Error(t, err)
}

func TestAnalyzeService_ResolveExecutionMode(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo)
	ctx := context.Background()

	mode := svc.resolveExecutionMode(ctx, "", nil)
	assert.Equal(t, "standard", mode)

	strict := "strict"
	mode = svc.resolveExecutionMode(ctx, "", &strict)
	assert.Equal(t, "strict", mode)
}

func TestBuildAnalyzeResponse(t *testing.T) {
	resp := buildAnalyzeResponse(map[string]any{"description": "d", "items": []any{}}, "standard", "qwen", "qwen-vl-max", 100)
	assert.Equal(t, "d", resp["description"])
	assert.Equal(t, "db_first", resp["analysis_engine"])

	resp2 := buildAnalyzeResponse(map[string]any{"description": "d", "items": []any{}, "pfc_ratio_comment": "good"}, "strict", "qwen", "qwen-vl-max", 100)
	assert.Equal(t, "good", *resp2["pfc_ratio_comment"].(*string))
}

func TestNutritionUnitIncludesMicronutrients(t *testing.T) {
	food := &foodrecorddomain.FoodNutrition{
		KcalPer100g:           100,
		ProteinPer100g:        2,
		CarbsPer100g:          20,
		FatPer100g:            1,
		FiberPer100g:          3,
		CalciumMgPer100g:      40,
		IronMgPer100g:         1.2,
		VitaminCMgPer100g:     12,
		VitaminARaeMcgPer100g: 30,
		VitaminB12McgPer100g:  0.6,
	}
	unit := nutritionUnit(food)
	scaled := scaleNutrition(unit, 50)

	assert.Equal(t, 20.0, scaled["calciumMg"])
	assert.Equal(t, 0.6, scaled["ironMg"])
	assert.Equal(t, 6.0, scaled["vitaminCMg"])
	assert.Equal(t, 15.0, scaled["vitaminARaeMcg"])
	assert.Equal(t, 0.3, scaled["vitaminB12Mcg"])
}

func TestParseItems_Empty(t *testing.T) {
	items := parseItems(map[string]any{})
	assert.Len(t, items, 0)
}

func TestToItems(t *testing.T) {
	arr := []map[string]any{{"name": "a"}}
	assert.Len(t, toItems(arr), 1)
	assert.Len(t, toItems([]any{map[string]any{"name": "a"}}), 1)
	assert.Nil(t, toItems("string"))
}

func floatPtr(v float64) *float64 {
	return &v
}
