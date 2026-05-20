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
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type mockLLMClient struct {
	result   map[string]any
	err      error
	calls    int
	prompt   string
	imageURL string
}

func (m *mockLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	m.calls++
	m.prompt = prompt
	m.imageURL = imageURL
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
	prompts       []string
}

func (m *multiImageLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	m.imageURLCalls = append(m.imageURLCalls, imageURL)
	return m.result, m.err
}

func (m *multiImageLLMClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	copied := append([]string(nil), imageURLs...)
	m.imageSetCalls = append(m.imageSetCalls, copied)
	m.prompts = append(m.prompts, prompt)
	return m.result, m.err
}

type mockWebSearcher struct {
	results []WebSearchResult
	queries []string
	err     error
}

func (m *mockWebSearcher) Search(ctx context.Context, query string, limit int) ([]WebSearchResult, error) {
	m.queries = append(m.queries, query)
	if m.err != nil {
		return nil, m.err
	}
	return m.results, nil
}

type mockDoubaoWebSearchClient struct {
	result   map[string]any
	meta     map[string]any
	prompt   string
	imageURL []string
	err      error
}

func (m *mockDoubaoWebSearchClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	return m.result, m.err
}

func (m *mockDoubaoWebSearchClient) AnalyzeWithImagesWebSearch(ctx context.Context, prompt string, imageURLs []string, options DoubaoWebSearchOptions) (map[string]any, map[string]any, error) {
	m.prompt = prompt
	m.imageURL = append([]string(nil), imageURLs...)
	return m.result, m.meta, m.err
}

func setupAnalyzeServiceTestDB(t *testing.T) (*gorm.DB, *authrepo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}))
	return db, authrepo.NewUserRepo(db)
}

func TestNormalizeExecutionMode(t *testing.T) {
	strict := "strict"
	experimental := "experimental"
	gemini35 := "gemini35_flash"
	gemini35Grouped := "gemini35_flash_grouped"
	lite := "lite"
	standard := "standard"
	invalid := "invalid"
	assert.Equal(t, "strict", normalizeExecutionMode(&strict))
	assert.Equal(t, "standard", normalizeExecutionMode(&experimental))
	assert.Equal(t, "strict", normalizeExecutionMode(&gemini35))
	assert.Equal(t, "strict", normalizeExecutionMode(&gemini35Grouped))
	assert.Equal(t, "standard", normalizeExecutionMode(&lite))
	assert.Equal(t, "standard", normalizeExecutionMode(&standard))
	assert.Equal(t, "standard", normalizeExecutionMode(&invalid))
	assert.Equal(t, "standard", normalizeExecutionMode(nil))
}

func TestBuildPromptGemini35Modes(t *testing.T) {
	input := AnalyzeInput{
		MealType:          "lunch",
		AdditionalContext: "包装上可能有鹅胗",
	}
	prompt := buildPrompt(input, nil, "gemini35_flash")
	assert.Contains(t, prompt, "Gemini 3.5 Flash 直接识别")
	assert.Contains(t, prompt, "包装食品")
	assert.Contains(t, prompt, "鹅胗/鹅肫/鹅珍")

	groupedPrompt := buildPrompt(input, nil, "gemini35_flash_grouped")
	assert.Contains(t, groupedPrompt, "第一阶段")
	assert.Contains(t, groupedPrompt, "锁定食物清单")
	assert.Contains(t, groupedPrompt, "最多 2 组")
	assert.Contains(t, groupedPrompt, `"groups"`)
}

func TestBuildGemini35GroupedWeightPromptLocksPlanItems(t *testing.T) {
	plan := map[string]any{
		"items": []map[string]any{
			{"name": "龙贡果", "estimatedWeightGrams": 10, "groupId": 1, "position": "左下", "recognitionEvidence": "圆形浅黄果实"},
			{"name": "鹅胗", "estimatedWeightGrams": 10, "groupId": 2, "position": "右侧红袋", "recognitionEvidence": "倒置包装文字"},
		},
		"groups": []map[string]any{{"groupId": 1, "description": "左下水果"}, {"groupId": 2, "description": "右侧包装"}},
	}
	prompt := buildGemini35GroupedWeightPrompt(AnalyzeInput{AdditionalContext: "红色包装是鹅胗"}, plan)
	assert.Contains(t, prompt, "第一阶段已锁定的食物清单")
	assert.Contains(t, prompt, "主要估重量")
	assert.Contains(t, prompt, "不要随意新增、删除或改名")
	assert.Contains(t, prompt, "龙贡果")
	assert.Contains(t, prompt, "鹅胗")
	assert.Contains(t, prompt, "groupId")
}

func TestMergeGemini35GroupedPlanAndWeightsKeepsPlanNamesAndUsesWeights(t *testing.T) {
	plan := map[string]any{
		"description": "混合零食",
		"items": []map[string]any{
			{
				"name":                 "龙贡果",
				"estimatedWeightGrams": 10.0,
				"groupId":              1.0,
				"position":             "左下",
				"recognitionEvidence":  "圆形浅黄果实",
				"alternativeNames":     []any{"龙宫果"},
			},
			{
				"name":                 "鹅胗",
				"estimatedWeightGrams": 10.0,
				"groupId":              2.0,
				"position":             "右侧红袋",
				"recognitionEvidence":  "倒置包装文字像鹅胗",
			},
		},
		"groups":  []map[string]any{{"groupId": 1.0, "description": "左下水果"}, {"groupId": 2.0, "description": "右侧包装"}},
		"ocrText": []any{"鹅胗"},
	}
	weights := map[string]any{
		"items": []map[string]any{
			{
				"name":                 "无花果",
				"estimatedWeightGrams": 55.0,
				"groupId":              1.0,
				"weightEvidence":       "5个小果，去皮后约55g",
				"alternativeNames":     []any{"longkong"},
			},
			{
				"name":                 "阿胶糕",
				"estimatedWeightGrams": 35.0,
				"groupId":              2.0,
				"weightEvidence":       "红色包装小袋约35g",
			},
		},
		"ocrText": []any{"鹅肫"},
	}

	merged := mergeGemini35GroupedPlanAndWeights(plan, weights)
	items := parseItems(merged)
	require.Len(t, items, 2)
	assert.Equal(t, "龙贡果", items[0]["name"])
	assert.Equal(t, 55.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "鹅胗", items[1]["name"])
	assert.Equal(t, 35.0, items[1]["estimatedWeightGrams"])
	assert.Equal(t, 2, normalizeGemini35GroupID(items[1]["groupId"]))
	assert.Contains(t, stringSliceFromAny(merged["ocrText"]), "鹅胗")
	assert.Contains(t, stringSliceFromAny(merged["ocrText"]), "鹅肫")
}

func TestResolveModelConfig(t *testing.T) {
	p, m := resolveModelConfig("")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3-flash-preview", m)

	p, m = resolveModelConfig("doubao")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("doubao-seed-2-0-lite-260428")
	assert.Equal(t, "doubao", p)
	assert.Equal(t, "doubao-seed-2-0-lite-260428", m)

	p, m = resolveModelConfig("deepseek")
	assert.Equal(t, "deepseek", p)
	assert.Equal(t, "deepseek-v4-flash", m)

	p, m = resolveModelConfig("gemini")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3-flash-preview", m)

	p, m = resolveModelConfig("ofox-gemini")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3-flash-preview", m)

	p, m = resolveModelConfig("gemini-3.5-flash")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3.5-flash", m)

	p, m = resolveModelConfig("unknown-model")
	assert.Equal(t, "gemini", p)
	assert.Equal(t, "gemini-3-flash-preview", m)
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
	assert.Contains(t, prompt, "包装食品、袋装食品、盒装食品")
	assert.Contains(t, prompt, "请按区域逐一扫描画面")
	assert.Contains(t, prompt, "配料表")
	assert.Contains(t, prompt, "营养成分表")
	assert.Contains(t, prompt, "文字证据优先级高于包装正面插画")
}

func TestBuildPromptStrictModeUsesDBFirstPrompt(t *testing.T) {
	input := AnalyzeInput{
		MealType: "dinner",
		UserGoal: "fat_loss",
	}
	prompt := buildPrompt(input, nil, "strict")
	assert.Contains(t, prompt, "Gemini 3.5 Flash 直接识别")
	assert.Contains(t, prompt, "营养由后端数据库查表补充")
	assert.Contains(t, prompt, "配料表")
	assert.Contains(t, prompt, "营养成分表")
	assert.Contains(t, prompt, "最终名称优先采用包装文字和配料证据")
}

func TestBuildPromptExperimentalMode(t *testing.T) {
	input := AnalyzeInput{
		MealType: "dinner",
		UserGoal: "fat_loss",
	}
	prompt := buildPrompt(input, nil, "experimental")
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

func TestBuildDBFirstPromptsUseEdibleNetWeight(t *testing.T) {
	imagePrompt := buildImageDBFirstPrompt(AnalyzeInput{ImageURL: "https://example.com/shrimp.jpg"}, nil)
	for _, expected := range []string{"营养库按可食部计算", "去壳/去骨/去核后的可食净重", "虾/螃蟹/贝类按去壳肉重", "花生/瓜子/坚果按去壳仁重"} {
		assert.Contains(t, imagePrompt, expected)
	}

	textPrompt := buildTextDBFirstPrompt(AnalyzeInput{Text: "吃了十只虾和一把花生"}, nil)
	for _, expected := range []string{"可食部净重", "带壳、带骨、带核食物", "去壳/去骨/去核后的可食重量"} {
		assert.Contains(t, textPrompt, expected)
	}
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

func TestAnalyzeService_ApplySuggestedRatiosDisabledDefaultsTo100(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	resp := map[string]any{
		"items": []map[string]any{
			{"name": "rice", "estimatedWeightGrams": 180.0, "suggestedRatio": 35.0},
		},
	}

	result := svc.applySuggestedRatios(context.Background(), resp, AnalyzeInput{SuggestRatioEnabled: false})
	items := result["items"].([]map[string]any)

	assert.Equal(t, false, result["suggest_ratio_enabled"])
	assert.Equal(t, "disabled", result["suggest_ratio_status"])
	assert.Equal(t, 100.0, items[0]["suggestedRatio"])
	assert.Equal(t, "disabled", items[0]["suggestedRatioSource"])
}

func TestAnalyzeService_ApplySuggestedRatiosUsesGeminiSuggestion(t *testing.T) {
	ratioClient := &mockLLMClient{result: map[string]any{
		"items": []any{
			map[string]any{"index": 0.0, "suggestedRatio": 70.0, "reason": "主食稍微控制"},
			map[string]any{"index": 1.0, "suggestedRatio": 100.0, "reason": "保留蛋白质"},
		},
	}}
	svc := NewAnalyzeService(nil, ratioClient, nil)
	resp := map[string]any{
		"items": []map[string]any{
			{
				"name":                 "米饭",
				"estimatedWeightGrams": 200.0,
				"nutrients":            map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6},
			},
			{
				"name":                 "鸡胸肉",
				"estimatedWeightGrams": 120.0,
				"nutrients":            map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0},
			},
		},
	}

	result := svc.applySuggestedRatios(context.Background(), resp, AnalyzeInput{
		SuggestRatioEnabled: true,
		DietGoal:            "fat_loss",
		RemainingCalories:   floatPtr(400),
	})
	items := result["items"].([]map[string]any)

	assert.Equal(t, true, result["suggest_ratio_enabled"])
	assert.Equal(t, "applied", result["suggest_ratio_status"])
	assert.Equal(t, 2, result["suggest_ratio_applied_count"])
	assert.Equal(t, 70.0, items[0]["suggestedRatio"])
	assert.Equal(t, "主食稍微控制", items[0]["suggestedRatioReason"])
	assert.Equal(t, "ai", items[0]["suggestedRatioSource"])
	assert.Equal(t, 100.0, items[1]["suggestedRatio"])
	assert.Equal(t, "ai", items[1]["suggestedRatioSource"])
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

	errResult := modelResultFrom(nil, assert.AnError, "doubao")
	assert.Equal(t, false, errResult["success"])
	assert.NotEmpty(t, errResult["error"])
}

func TestAnalyzeService_Analyze(t *testing.T) {
	gemini31Client := &mockLLMClient{result: map[string]any{"description": "test", "items": []any{map[string]any{"name": "rice", "estimatedWeightGrams": 100.0, "nutrients": map[string]any{"calories": 130.0}}}}}
	svc := NewAnalyzeService(nil, gemini31Client, nil)
	svc.gemini31LiteClient = gemini31Client
	ctx := context.Background()

	result, err := svc.Analyze(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestAnalyzeService_AnalyzeUsesSingleLLMRequestForMultipleImages(t *testing.T) {
	client := &multiImageLLMClient{result: map[string]any{"description": "multi", "items": []any{}}}
	svc := NewAnalyzeService(client, nil, nil)
	svc.doubaoClient = client

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/1.jpg",
		ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"},
		ModelName: "doubao",
	})

	require.NoError(t, err)
	assert.Equal(t, "multi", result["description"])
	require.Len(t, client.imageSetCalls, 1)
	assert.Equal(t, []string{"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"}, client.imageSetCalls[0])
	assert.Empty(t, client.imageURLCalls)
}

func TestAnalyzeService_AnalyzeText(t *testing.T) {
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "text test", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, doubaoClient, nil)
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
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "should not be used", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, doubaoClient, nil)

	_, err := svc.AnalyzeText(context.Background(), "", AnalyzeInput{Text: "一碗米饭"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEEPSEEK_API_KEY")
}

func TestAnalyzeService_AnalyzeImageGeminiAliasUsesGemini3FlashInStandardMode(t *testing.T) {
	doubaoClient := &mockLLMClient{err: assert.AnError}
	gemini3Client := &mockLLMClient{result: map[string]any{"description": "gemini3 image", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(nil)

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "gemini",
	})

	require.NoError(t, err)
	assert.Equal(t, "gemini3 image", result["description"])
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 1, gemini3Client.calls)
}

func TestAnalyzeService_AnalyzeImageStandardUsesGemini3Flash(t *testing.T) {
	doubaoClient := &mockLLMClient{err: assert.AnError}
	gemini3Client := &mockLLMClient{result: map[string]any{"description": "gemini3 image", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureImageProvider("gemini")
	svc.ConfigureWebSearcher(nil)

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL: "https://example.com/img.jpg",
	})

	require.NoError(t, err)
	assert.Equal(t, "gemini3 image", result["description"])
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 1, gemini3Client.calls)
}

func TestAnalyzeService_AnalyzeImageStandardIgnoresExplicitDoubaoAndUsesGemini3Flash(t *testing.T) {
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "doubao image", "items": []any{}}}
	gemini3Client := &mockLLMClient{result: map[string]any{"description": "gemini3 image", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureImageProvider("gemini")
	svc.ConfigureWebSearcher(nil)

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "doubao",
	})

	require.NoError(t, err)
	assert.Equal(t, "gemini3 image", result["description"])
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 1, gemini3Client.calls)
}

func TestAnalyzeService_AnalyzeImageStandardDoesNotFallbackToDoubaoWhenGeminiFails(t *testing.T) {
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "doubao fallback", "items": []any{}}}
	gemini3Client := &mockLLMClient{err: errors.New("ofoxai api error 429: Resource exhausted. Please try again later")}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(nil)

	_, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "ofox-gemini",
	})

	require.Error(t, err)
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 3, gemini3Client.calls)
}

func TestAnalyzeService_AnalyzeImageStrictUsesGemini35SinglePass(t *testing.T) {
	strict := "strict"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini35Client := &multiImageLLMClient{result: map[string]any{
		"description":    "包装鸡胸肉",
		"modelAgreement": "weight_changed",
		"ocrText":        []any{"净含量100g"},
		"items": []any{
			map[string]any{
				"name":                 "即食鸡胸肉",
				"estimatedWeightGrams": 100.0,
				"waterMl":              55.0,
				"confidence":           0.92,
				"recognitionEvidence":  "包装文字显示鸡胸肉",
				"weightEvidence":       "包装标注净含量100g",
				"alternativeNames":     []any{"鸡胸肉"},
			},
		},
	}}
	svc := NewAnalyzeService(doubaoClient, nil, nil)
	svc.gemini35Client = gemini35Client
	svc.ConfigureWebSearcher(nil)

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/chicken.jpg",
		ExecutionMode: &strict,
	})

	require.NoError(t, err)
	assert.Equal(t, "包装鸡胸肉", result["description"])
	assert.Equal(t, "strict_db_first", result["food_image_strategy"])
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "applied", meta["status"])
	assert.Equal(t, "gemini", meta["base_provider"])
	assert.Equal(t, gemini35FlashModel, meta["base_model"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "即食鸡胸肉", items[0]["name"])
	assert.Equal(t, 100.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "包装标注净含量100g", items[0]["weightEvidence"])
	assert.Equal(t, "包装文字显示鸡胸肉", items[0]["recognitionEvidence"])
	require.Empty(t, doubaoClient.imageSetCalls)
	require.Len(t, gemini35Client.imageSetCalls, 1)
	assert.Contains(t, gemini35Client.prompts[0], "Gemini 3.5 Flash 直接识别")
}

func TestAnalyzeService_AnalyzeImageStrictDoesNotFallbackToDoubaoWhenGemini35Fails(t *testing.T) {
	strict := "strict"
	doubaoClient := &multiImageLLMClient{result: map[string]any{
		"description": "豆包结果",
		"items": []any{
			map[string]any{"name": "米饭", "estimatedWeightGrams": 120.0},
		},
	}}
	gemini35Client := &multiImageLLMClient{err: errors.New("gemini timeout")}
	svc := NewAnalyzeService(doubaoClient, nil, nil)
	svc.gemini35Client = gemini35Client
	svc.ConfigureWebSearcher(nil)

	_, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/rice.jpg",
		ExecutionMode: &strict,
	})

	require.Error(t, err)
	require.Empty(t, doubaoClient.imageSetCalls)
	require.Len(t, gemini35Client.imageSetCalls, 1)
}

func TestAnalyzeService_AnalyzeImageLegacyLiteUsesStandardGemini3Flash(t *testing.T) {
	lite := "lite"
	doubaoClient := &mockDoubaoWebSearchClient{err: assert.AnError}
	gemini3Client := &multiImageLLMClient{result: map[string]any{
		"description": "普通识别",
		"items": []any{
			map[string]any{"name": "龙宫果", "estimatedWeightGrams": 45.0},
		},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/longkong.jpg",
		ExecutionMode: &lite,
	})

	require.NoError(t, err)
	assert.Equal(t, "普通识别", result["description"])
	assert.Equal(t, "gemini_db_first", result["food_image_strategy"])
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "skipped", meta["status"])
	assert.Equal(t, "gemini_db_first", meta["strategy"])
	require.Len(t, gemini3Client.imageSetCalls, 1)
	assert.Empty(t, doubaoClient.prompt)
	assert.Empty(t, doubaoClient.imageURL)
}

func TestAnalyzeService_AnalyzeImageCorrectionUsesGemini31Lite(t *testing.T) {
	doubaoClient := &mockLLMClient{err: assert.AnError}
	gemini3Client := &mockLLMClient{err: assert.AnError}
	gemini31Client := &multiImageLLMClient{result: map[string]any{
		"description": "纠错识别",
		"items": []any{
			map[string]any{"name": "龙宫果", "estimatedWeightGrams": 45.0},
		},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.gemini31LiteClient = gemini31Client

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL: "https://example.com/longkong.jpg",
		CorrectionItems: []map[string]any{
			{"name": "龙宫果", "weight": 45},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "纠错识别", result["description"])
	require.Len(t, gemini31Client.imageSetCalls, 1)
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 0, gemini3Client.calls)
}

func TestBuildStandardImageHybridReviewPromptIncludesIndependentReviewAndSearchEvidence(t *testing.T) {
	prompt := buildStandardImageHybridReviewPrompt(AnalyzeInput{
		MealType:          "snack",
		AdditionalContext: "用户说可能是龙宫果和鹅胗",
	}, map[string]any{
		"description": "盘子里有水果和包装零食",
		"items": []any{
			map[string]any{"name": "无花果", "estimatedWeightGrams": 125.0, "waterMl": 80.0},
		},
	}, []WebSearchEvidence{{
		Query: "龙宫果 外观 营养",
		Results: []WebSearchResult{{
			Title:   "龙宫果/Longkong 外观",
			Snippet: "龙宫果常呈浅黄褐色圆形，成串或多个摆放。",
			URL:     "https://example.com/longkong",
		}},
	}})

	assert.Contains(t, prompt, "必须先独立观察图片和 OCR 信息")
	assert.Contains(t, prompt, "倒置")
	assert.Contains(t, prompt, "鹅胗/鹅肫/鹅珍")
	assert.Contains(t, prompt, "不要把低置信度 OCR 片段直接当作食物名")
	assert.Contains(t, prompt, "不要被 Doubao 的单一候选锚定")
	assert.Contains(t, prompt, "webSearchEvidence")
	assert.Contains(t, prompt, "龙宫果/Longkong 外观")
	assert.Contains(t, prompt, "用户说可能是龙宫果和鹅胗")
}

func TestParseDuckDuckGoHTMLResults(t *testing.T) {
	raw := `
<div class="result results_links">
  <div class="result__body">
    <h2><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Ffood">龙宫果 Longkong 外观</a></h2>
    <a class="result__snippet">龙宫果通常为浅黄褐色小圆果，果肉半透明。</a>
  </div>
</div>
<div class="result results_links">
  <div class="result__body">
    <h2><a class="result__a" href="https://example.com/nutrition">鹅胗 营养</a></h2>
    <a class="result__snippet">鹅胗属于动物内脏，常见真空包装熟食。</a>
  </div>
</div>`

	results := parseDuckDuckGoHTMLResults(raw, 2)

	require.Len(t, results, 2)
	assert.Equal(t, "龙宫果 Longkong 外观", results[0].Title)
	assert.Equal(t, "https://example.com/food", results[0].URL)
	assert.Contains(t, results[0].Snippet, "半透明")
	assert.Equal(t, "鹅胗 营养", results[1].Title)
}

func TestBuildStandardImageSearchQueries(t *testing.T) {
	queries := buildStandardImageSearchQueries(AnalyzeInput{
		AdditionalContext: "龙宫果\n鹅胗",
	}, map[string]any{
		"description": "零食和水果混合",
		"items": []any{
			map[string]any{
				"name":             "无花果",
				"alternativeNames": []any{"龙宫果", "longkong"},
			},
		},
	})

	require.Len(t, queries, 3)
	assert.Equal(t, "龙宫果 鹅胗 食物 外观 营养", queries[0])
	assert.Equal(t, "龙宫果 鹅胗 包装 净含量 营养成分", queries[1])
	assert.Equal(t, "零食和水果混合 食物 外观 营养", queries[2])
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
		ModelName: "doubao",
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
		ModelName: "doubao",
	})

	require.Error(t, err)
	assert.True(t, IsLLMJSONParseError(err))
	assert.Equal(t, maxLLMJSONParseRetries+1, client.calls)
}

func TestAnalyzeWithJSONParseRetry_RetriesTransientDoubaoError(t *testing.T) {
	calls := 0
	result, err := analyzeWithJSONParseRetry(context.Background(), "food_image", "doubao", "doubao-seed-2-0-lite-260428", func(context.Context) (map[string]any, error) {
		calls++
		if calls == 1 {
			return nil, errors.New(`doubao api error 500: {"error":{"code":"InternalServiceError","message":"The service encountered an unexpected internal error"}}`)
		}
		return map[string]any{"description": "retry success", "items": []any{}}, nil
	})

	require.NoError(t, err)
	assert.Equal(t, "retry success", result["description"])
	assert.Equal(t, 2, calls)
}

func TestAnalyzeService_RunPrecisionJSONFallsBackToDoubaoOnGeminiTransientError(t *testing.T) {
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "doubao precision fallback", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: errors.New(`Post "https://api.ofox.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`)}
	svc := NewAnalyzeService(doubaoClient, ofoxClient, nil)
	svc.doubaoClient = doubaoClient

	result, err := svc.RunPrecisionJSONWithImages(context.Background(), "image", "prompt", []string{"https://example.com/img.jpg"}, "ofox-gemini")

	require.NoError(t, err)
	assert.Equal(t, "doubao precision fallback", result["description"])
}

func TestAnalyzeService_RunPrecisionJSONNoFallbackKeepsGeminiError(t *testing.T) {
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "doubao fallback", "items": []any{}}}
	ofoxClient := &mockLLMClient{err: errors.New(`Post "https://api.ofox.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`)}
	svc := NewAnalyzeService(doubaoClient, ofoxClient, nil)
	svc.doubaoClient = doubaoClient

	_, err := svc.RunPrecisionJSONWithImagesNoFallback(context.Background(), "image", "prompt", []string{"https://example.com/img.jpg"}, "ofox-gemini")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "context deadline exceeded")
}

func TestAnalyzeService_AnalyzeCompare(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "doubao result", "items": []any{}}}
	ofoxClient := &mockLLMClient{result: map[string]any{"description": "gemini result", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, ofoxClient, userRepo)
	svc.doubaoClient = doubaoClient
	ctx := context.Background()

	result, err := svc.AnalyzeCompare(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotNil(t, result["doubao_result"])
	assert.NotNil(t, result["gemini_result"])
}

func TestAnalyzeService_AnalyzeCompareEngines(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	doubaoClient := &mockLLMClient{result: map[string]any{"description": "test", "items": []any{}}}
	svc := NewAnalyzeService(doubaoClient, doubaoClient, userRepo)
	svc.doubaoClient = doubaoClient
	ctx := context.Background()

	result, err := svc.AnalyzeCompareEngines(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotNil(t, result["legacy_result"])
	assert.NotNil(t, result["db_first_result"])
}

func TestAnalyzeService_AnalyzeBatch(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	doubaoClient := &multiImageLLMClient{result: map[string]any{"description": "batch", "items": []any{map[string]any{"name": "apple", "estimatedWeightGrams": 100.0, "nutrients": map[string]any{"calories": 50.0}}}}}
	svc := NewAnalyzeService(doubaoClient, doubaoClient, userRepo)
	svc.doubaoClient = doubaoClient
	ctx := context.Background()

	_, err := svc.AnalyzeBatch(ctx, "", AnalyzeInput{ImageURLs: []string{}})
	assert.Error(t, err)

	result, err := svc.AnalyzeBatch(ctx, "", AnalyzeInput{ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}})
	require.NoError(t, err)
	assert.NotNil(t, result["description"])
	require.Len(t, doubaoClient.imageSetCalls, 1)
	assert.Equal(t, []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}, doubaoClient.imageSetCalls[0])
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

	experimental := "experimental"
	mode = svc.resolveExecutionMode(ctx, "", &experimental)
	assert.Equal(t, "experimental", mode)
}

func TestBuildAnalyzeResponse(t *testing.T) {
	resp := buildAnalyzeResponse(map[string]any{"description": "d", "items": []any{}}, "standard", "doubao", "doubao-seed-2-0-lite-260428", 100)
	assert.Equal(t, "d", resp["description"])
	assert.Equal(t, "db_first", resp["analysis_engine"])

	resp2 := buildAnalyzeResponse(map[string]any{"description": "d", "items": []any{}, "pfc_ratio_comment": "good"}, "experimental", "doubao", "doubao-seed-2-0-lite-260428", 100)
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

func TestAnalyzeService_ApplyDBFirstUsesPackagedFoodWeightForSnack(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
		ID:             "snack-1",
		Brand:          "BrandA",
		ProductName:    "BrandA 蛋白棒",
		NormalizedName: "branda蛋白棒",
		NetWeightG:     100,
		KcalPer100g:    420,
		ProteinPer100g: 28,
		CarbsPer100g:   42,
		FatPer100g:     14,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFoodAlias{
		ID:              "alias-1",
		FoodID:          "snack-1",
		AliasName:       "蛋白棒",
		NormalizedAlias: "蛋白棒",
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "蛋白棒",
		"type":                 "snack",
		"estimatedWeightGrams": 80.0,
	}}, "")

	require.Len(t, items, 1)
	assert.Equal(t, "snack", items[0]["type"])
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, 100.0, items[0]["estimatedWeightGrams"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 420.0, nutrients["calories"])
	assert.Equal(t, 28.0, nutrients["protein"])
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
