package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	authrepo "food_link/backend/internal/auth/repo"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gormsqlite "gorm.io/driver/sqlite"
	"gorm.io/gorm"

	_ "modernc.org/sqlite"
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

type sequenceMultiImageLLMClient struct {
	results       []map[string]any
	errs          []error
	imageSetCalls [][]string
	prompts       []string
}

func (m *sequenceMultiImageLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	return m.AnalyzeWithImages(ctx, prompt, []string{imageURL})
}

func (m *sequenceMultiImageLLMClient) AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error) {
	index := len(m.imageSetCalls)
	copied := append([]string(nil), imageURLs...)
	m.imageSetCalls = append(m.imageSetCalls, copied)
	m.prompts = append(m.prompts, prompt)
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

type mockDashScopeNativeSearchClient struct {
	result        map[string]any
	meta          map[string]any
	err           error
	imageSetCalls [][]string
}

func (m *mockDashScopeNativeSearchClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	return m.result, m.err
}

func (m *mockDashScopeNativeSearchClient) AnalyzeWithImagesDashScopeWebSearch(ctx context.Context, prompt string, imageURLs []string, options DashScopeWebSearchOptions) (map[string]any, map[string]any, error) {
	m.imageSetCalls = append(m.imageSetCalls, append([]string(nil), imageURLs...))
	if m.meta != nil {
		return m.result, m.meta, m.err
	}
	return m.result, map[string]any{
		"native_search":   true,
		"forced_search":   options.ForcedSearch,
		"search_strategy": options.SearchStrategy,
	}, m.err
}

type fakeAnalyzeNutritionResolver struct {
	rice                 foodrecorddomain.FoodNutrition
	ordinaryFoods        map[string]foodrecorddomain.FoodNutrition
	packagedFood         foodrecorddomain.PackagedFood
	nescafeFood          foodrecorddomain.PackagedFood
	sugarfreeDrinkFood   foodrecorddomain.PackagedFood
	packagedResolveCalls int
}

func newFakeAnalyzeNutritionResolver() *fakeAnalyzeNutritionResolver {
	return &fakeAnalyzeNutritionResolver{
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
		ordinaryFoods: map[string]foodrecorddomain.FoodNutrition{
			"卫龙小面筋辣条": {
				ID:             "normal-weilong-xiaomianjin",
				CanonicalName:  "卫龙小面筋辣条",
				NormalizedName: "卫龙小面筋辣条",
				KcalPer100g:    385,
				ProteinPer100g: 7.8,
				CarbsPer100g:   48,
				FatPer100g:     17,
				IsActive:       true,
			},
		},
		packagedFood: foodrecorddomain.PackagedFood{
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
		nescafeFood: foodrecorddomain.PackagedFood{
			ID:             "pkg-nescafe-1plus2",
			Brand:          "雀巢",
			ProductName:    "雀巢咖啡1+2 奶香 咖啡固体饮料",
			NormalizedName: "雀巢咖啡1+2奶香咖啡固体饮料",
			DisplayName:    "雀巢 雀巢咖啡1+2 奶香 105g",
			NetWeightG:     105,
			KcalPer100g:    40.15,
			ProteinPer100g: 0,
			CarbsPer100g:   6.6,
			FatPer100g:     1.5,
			IsActive:       true,
		},
		sugarfreeDrinkFood: foodrecorddomain.PackagedFood{
			ID:             "pkg-suntory-sugarfree-drink",
			Brand:          "SUNTORY三得利",
			ProductName:    "纤漾饮荷叶茉莉花味风味饮料（无糖）",
			NormalizedName: "suntory三得利纤漾饮荷叶茉莉花味风味饮料无糖",
			DisplayName:    "SUNTORY三得利 纤漾饮荷叶茉莉花味风味饮料（无糖） 500ml",
			NetWeightG:     500,
			KcalPer100g:    18,
			ProteinPer100g: 0,
			CarbsPer100g:   0,
			FatPer100g:     0,
			IsActive:       true,
		},
	}
}

func (r *fakeAnalyzeNutritionResolver) ResolvePackagedFood(ctx context.Context, input foodrecordrepo.PackagedFoodResolveInput) (*foodrecordrepo.PackagedResolveResult, error) {
	r.packagedResolveCalls++
	if strings.Contains(input.Name, "桃李") || strings.Contains(input.Name, "豆沙小饼") {
		food := r.packagedFood
		return &foodrecordrepo.PackagedResolveResult{Food: &food, Status: "fuzzy", MatchSource: "fake", Score: 0.92}, nil
	}
	if strings.Contains(input.Name, "雀巢") || strings.Contains(strings.ToLower(input.Name), "nescafe") {
		food := r.nescafeFood
		return &foodrecordrepo.PackagedResolveResult{Food: &food, Status: "fuzzy", MatchSource: "fake", Score: 0.94}, nil
	}
	if strings.Contains(input.Name, "三得利") || strings.Contains(strings.ToLower(input.Name), "suntory") || strings.Contains(input.Name, "纤漾饮") {
		food := r.sugarfreeDrinkFood
		return &foodrecordrepo.PackagedResolveResult{Food: &food, Status: "fuzzy", MatchSource: "fake", Score: 0.95}, nil
	}
	return &foodrecordrepo.PackagedResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *fakeAnalyzeNutritionResolver) SearchPackagedFood(ctx context.Context, query string, limit int) ([]foodrecorddomain.PackagedFood, error) {
	if strings.Contains(query, "桃李") || strings.Contains(query, "豆沙小饼") {
		return []foodrecorddomain.PackagedFood{r.packagedFood}, nil
	}
	if strings.Contains(query, "雀巢") || strings.Contains(strings.ToLower(query), "nescafe") {
		return []foodrecorddomain.PackagedFood{r.nescafeFood}, nil
	}
	if strings.Contains(query, "三得利") || strings.Contains(strings.ToLower(query), "suntory") || strings.Contains(query, "纤漾饮") {
		return []foodrecorddomain.PackagedFood{r.sugarfreeDrinkFood}, nil
	}
	return nil, nil
}

func (r *fakeAnalyzeNutritionResolver) ResolveFood(ctx context.Context, name string) (*foodrecordrepo.ResolveResult, error) {
	if strings.TrimSpace(name) == "白米饭" {
		food := r.rice
		return &foodrecordrepo.ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "fake", Score: 1}, nil
	}
	if food, ok := r.ordinaryFoods[strings.TrimSpace(name)]; ok {
		return &foodrecordrepo.ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "fake", Score: 1}, nil
	}
	return &foodrecordrepo.ResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *fakeAnalyzeNutritionResolver) SearchCandidates(ctx context.Context, query string, limit int) ([]foodrecordrepo.SearchCandidate, error) {
	return nil, nil
}

func (r *fakeAnalyzeNutritionResolver) EnsureNutritionAlias(ctx context.Context, foodID, rawName string) error {
	return nil
}

func (r *fakeAnalyzeNutritionResolver) LogUnresolved(ctx context.Context, rawName string) error {
	return nil
}

func (r *fakeAnalyzeNutritionResolver) UpsertDeepSeekNutrition(ctx context.Context, rawName string, unit map[string]any, sources ...string) (string, error) {
	return "generated-food", nil
}

type fakeNutritionFallbackEstimator struct {
	candidates        []UnresolvedNutritionCandidate
	additionalContext string
	rows              map[int]map[string]any
	err               error
}

func (f *fakeNutritionFallbackEstimator) Estimate(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	f.candidates = append([]UnresolvedNutritionCandidate(nil), candidates...)
	f.additionalContext = additionalContext
	return f.rows, f.err
}

func setupAnalyzeServiceTestDB(t *testing.T) (*gorm.DB, *authrepo.UserRepo) {
	db, err := gorm.Open(gormsqlite.New(gormsqlite.Config{
		DriverName: "sqlite",
		DSN:        "file::memory:",
	}), &gorm.Config{})
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
	standardWeb := "standard_web_search"
	fast := "fast"
	fastWeb := "fast_web_search"
	strictWeb := "strict_web_search"
	strictSeparate := "strict_separate"
	packagedExperiment := "standard_packaged_experiment"
	invalid := "invalid"
	assert.Equal(t, "strict", normalizeExecutionMode(&strict))
	assert.Equal(t, "standard", normalizeExecutionMode(&experimental))
	assert.Equal(t, "strict", normalizeExecutionMode(&gemini35))
	assert.Equal(t, "strict", normalizeExecutionMode(&gemini35Grouped))
	assert.Equal(t, "standard", normalizeExecutionMode(&lite))
	assert.Equal(t, "standard", normalizeExecutionMode(&standard))
	assert.Equal(t, "standard_web_search", normalizeExecutionMode(&standardWeb))
	assert.Equal(t, "fast", normalizeExecutionMode(&fast))
	assert.Equal(t, "fast_web_search", normalizeExecutionMode(&fastWeb))
	assert.Equal(t, "strict_separate", normalizeExecutionMode(&strictSeparate))
	assert.Equal(t, "strict_web_search", normalizeExecutionMode(&strictWeb))
	assert.Equal(t, "standard_packaged_experiment", normalizeExecutionMode(&packagedExperiment))
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

	p, m = resolveModelConfig("qwen3.6-flash")
	assert.Equal(t, "qwen", p)
	assert.Equal(t, "qwen3.6-flash", m)

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
	assert.Contains(t, prompt, "只露出很小一角、只有色块/封边/局部花纹")
	assert.Contains(t, prompt, "快速物理空间标定")
	assert.Contains(t, prompt, "严禁凭 Logo 或颜色脑补品牌")
	assert.Contains(t, prompt, "260g")
}

func TestBuildPromptStrictModeUsesDBFirstPrompt(t *testing.T) {
	input := AnalyzeInput{
		MealType: "dinner",
		UserGoal: "fat_loss",
	}
	prompt := buildPrompt(input, nil, "strict")
	assert.Contains(t, prompt, "Gemini 3.5 Flash 直接识别")
	assert.Contains(t, prompt, "营养由后端数据库统一查表补充")
	assert.Contains(t, prompt, "配料表")
	assert.Contains(t, prompt, "营养成分表")
	assert.Contains(t, prompt, "最终名称优先采用包装文字和配料证据")
	assert.Contains(t, prompt, "只露出很小一角、只有色块/封边/局部花纹")
	assert.Contains(t, prompt, "OCR 强覆盖规则")
	assert.Contains(t, prompt, "空间标定")
	assert.Contains(t, prompt, "禁止凭 Logo 图案盲猜品牌")
	assert.Contains(t, prompt, "grossWeightGrams 必须与 weightEvidence 完全吻合")
}

func TestBuildStandardImageHybridReviewPromptRejectsTinyPackageCorners(t *testing.T) {
	doubaoParsed := map[string]any{
		"description": "米饭鸡肉",
		"items": []map[string]any{
			{"name": "白米饭", "estimatedWeightGrams": 220.0, "waterMl": 0.0},
			{"name": "鸡肉", "estimatedWeightGrams": 160.0, "waterMl": 0.0},
		},
	}
	prompt := buildStandardImageHybridReviewPrompt(AnalyzeInput{MealType: "lunch"}, doubaoParsed, nil)
	assert.Contains(t, prompt, "如果疑似包装对象只露出很小一角、只有色块/封边/局部花纹")
	assert.Contains(t, prompt, "不要输出为具体零食名")
}

func TestBuildLowCostWebSearchRefinePrompt(t *testing.T) {
	prompt := buildLowCostWebSearchRefinePrompt(
		AnalyzeInput{AdditionalContext: "酸奶杯完整未开封"},
		map[string]any{"items": []any{map[string]any{"name": "草莓酸奶", "estimatedWeightGrams": 130}}},
		[]WebSearchEvidence{{
			Query:   "光明12mm大粒草莓酸奶 净含量",
			Results: []WebSearchResult{{Title: "光明12mm大粒草莓酸奶 260g", Snippet: "净含量260g"}},
		}},
		standardWebSearchMode,
	)

	assert.Contains(t, prompt, "低成本联网搜索校准")
	assert.Contains(t, prompt, "webSearchEvidence")
	assert.Contains(t, prompt, "净含量260g")
	assert.Contains(t, prompt, "搜索结果只作为外部佐证")
	assert.Contains(t, prompt, "不可把搜索到但图片中不可见的食物新增到结果中")
	assert.Contains(t, prompt, "evidenceSource")
	assert.Contains(t, prompt, "searchEvidenceUsed")
	assert.Contains(t, prompt, "没有搜索结果直接支撑某个商品规格")
}

func TestCompactWebSearchEvidence(t *testing.T) {
	evidence := []WebSearchEvidence{{
		Query: "光明酸奶 净含量",
		Results: []WebSearchResult{
			{Title: "光明酸奶 260g", Snippet: "净含量260g", URL: "https://example.com/yogurt"},
			{Title: "第二条", Snippet: "其他摘要"},
			{Title: "第三条", Snippet: "不应出现"},
		},
	}}

	compacted := compactWebSearchEvidence(evidence, 1, 2)

	require.Len(t, compacted, 1)
	assert.Equal(t, "光明酸奶 净含量", compacted[0]["query"])
	results := compacted[0]["results"].([]map[string]any)
	require.Len(t, results, 2)
	assert.Equal(t, "光明酸奶 260g", results[0]["title"])
	assert.Equal(t, "https://example.com/yogurt", results[0]["url"])
}

func TestCompactHybridItemChanges(t *testing.T) {
	baseItems := []map[string]any{{
		"name":                 "草莓酸奶",
		"estimatedWeightGrams": 130.0,
		"waterMl":              120.0,
	}}
	finalItems := []map[string]any{{
		"name":                 "光明12mm大粒草莓酸奶",
		"estimatedWeightGrams": 260.0,
		"waterMl":              220.0,
		"weightEvidence":       "搜索证据显示净含量260g。",
		"evidenceSource":       "search:光明12mm大粒草莓酸奶 净含量",
		"searchEvidenceUsed":   []any{"光明12mm大粒草莓酸奶 净含量"},
	}}

	changes := compactHybridItemChanges(baseItems, finalItems, 8)

	require.Len(t, changes, 1)
	assert.True(t, changes[0]["changed"].(bool))
	assert.Equal(t, "草莓酸奶", changes[0]["before_name"])
	assert.Equal(t, "光明12mm大粒草莓酸奶", changes[0]["after_name"])
	assert.Equal(t, 130.0, changes[0]["weight_delta_g"])
	assert.Equal(t, "search:光明12mm大粒草莓酸奶 净含量", changes[0]["evidence_source"])
}

func TestParseBingHTMLResults(t *testing.T) {
	raw := `<html><body><ol><li class="b_algo"><h2><a href="https://example.com/yogurt">光明12mm大粒草莓酸奶</a></h2><p>规格 净含量260g，草莓风味发酵乳。</p></li></ol></body></html>`

	results := parseBingHTMLResults(raw, 3)

	require.Len(t, results, 1)
	assert.Equal(t, "光明12mm大粒草莓酸奶", results[0].Title)
	assert.Contains(t, results[0].Snippet, "净含量260g")
	assert.Equal(t, "https://example.com/yogurt", results[0].URL)
}

func TestParseSo360HTMLResults(t *testing.T) {
	raw := `<html><body><ul><li class="res-list"><h3><a href="https://example.com/chocliz">伊利巧乐兹 型号 规格 - 京东</a></h3><p class="res-desc">伊利 巧乐兹 低糖 双享 抹茶 可可 冰淇淋50克*6支。</p></li></ul></body></html>`

	results := parseSo360HTMLResults(raw, 3)

	require.Len(t, results, 1)
	assert.Equal(t, "伊利巧乐兹 型号 规格 - 京东", results[0].Title)
	assert.Contains(t, results[0].Snippet, "50克")
	assert.Equal(t, "https://example.com/chocliz", results[0].URL)
}

func TestParseSogouHTMLResults(t *testing.T) {
	raw := `<html><body><div class="vrwrap"><h3><a href="https://example.com/baxi">八喜 牛奶冰淇淋 经典口味测评</a></h3><p class="str_info">每杯 90g，牛奶香浓，适合夏季囤货。</p></div></body></html>`

	results := parseSogouHTMLResults(raw, 3)

	require.Len(t, results, 1)
	assert.Equal(t, "八喜 牛奶冰淇淋 经典口味测评", results[0].Title)
	assert.Contains(t, results[0].Snippet, "90g")
	assert.Equal(t, "https://example.com/baxi", results[0].URL)
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
	for _, expected := range []string{"grossWeightGrams", "原始可见总重量", "后端会用 DeepSeek Flash 单独计算 ediblePortionRatio"} {
		assert.Contains(t, imagePrompt, expected)
	}

	textPrompt := buildTextDBFirstPrompt(AnalyzeInput{Text: "吃了十只虾和一把花生"}, nil)
	for _, expected := range []string{"可食部净重", "带壳、带骨、带核食物", "去壳/去骨/去核后的可食重量"} {
		assert.Contains(t, textPrompt, expected)
	}
}

func TestImageDBFirstPromptsSeparateWeightFromSuggestedRatio(t *testing.T) {
	input := AnalyzeInput{
		ImageURL:            "https://example.com/meal.jpg",
		RemainingCalories:   floatPtr(300),
		SuggestRatioEnabled: true,
	}
	standardPrompt := buildImageDBFirstPrompt(input, nil)
	strictPrompt := buildPrompt(input, nil, "strict")
	for _, prompt := range []string{standardPrompt, strictPrompt} {
		assert.Contains(t, prompt, "原始")
		assert.Contains(t, prompt, "DeepSeek Flash")
		assert.Contains(t, prompt, "不能改变重量本身")
		assert.Contains(t, prompt, "不能反向影响 estimatedWeightGrams")
		assert.Contains(t, prompt, "grossWeightGrams")
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
	assert.Equal(t, 150.0, items[0]["grossWeightGrams"])
	assert.Equal(t, 100.0, items[0]["ediblePortionRatio"])
}

func TestParseItemsPreservesGrossAndEdibleRatio(t *testing.T) {
	items := parseItems(map[string]any{
		"items": []any{
			map[string]any{
				"name":                 "小龙虾",
				"grossWeightGrams":     600.0,
				"estimatedWeightGrams": 600.0,
				"ediblePortionRatio":   35.0,
			},
		},
	})
	assert.Len(t, items, 1)
	assert.Equal(t, 600.0, items[0]["grossWeightGrams"])
	assert.Equal(t, 600.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 35.0, items[0]["ediblePortionRatio"])
}

func TestWithDefaultEdiblePortionsDerivesEdibleWeight(t *testing.T) {
	items := withDefaultEdiblePortions([]map[string]any{
		{"name": "小龙虾", "grossWeightGrams": 600.0, "estimatedWeightGrams": 210.0},
	}, "test")
	assert.Len(t, items, 1)
	assert.Equal(t, 600.0, items[0]["grossWeightGrams"])
	assert.Equal(t, 35.0, items[0]["ediblePortionRatio"])
	assert.Equal(t, 210.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "test", items[0]["ediblePortionSource"])
}

func TestParseEdiblePortionRows(t *testing.T) {
	rows := parseEdiblePortionRows(map[string]any{
		"items": []any{
			map[string]any{"index": 0.0, "ediblePortionRatio": 35.0, "reason": "去壳后可食肉"},
			map[string]any{"index": 1.0, "ediblePortionRatio": 100.0},
		},
	})
	assert.Equal(t, 35.0, rows[0].ratio)
	assert.Equal(t, "去壳后可食肉", rows[0].reason)
	assert.Equal(t, 100.0, rows[1].ratio)
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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
	ctx := context.Background()

	result, err := svc.Analyze(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestAnalyzeService_AnalyzeUsesSingleLLMRequestForMultipleImages(t *testing.T) {
	client := &multiImageLLMClient{result: map[string]any{"description": "multi", "items": []any{}}}
	svc := NewAnalyzeService(nil, client, nil)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/1.jpg",
		ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"},
		ModelName: "gemini",
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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	_, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:  "https://example.com/img.jpg",
		ModelName: "ofox-gemini",
	})

	require.Error(t, err)
	assert.Equal(t, 0, doubaoClient.calls)
	assert.Equal(t, 3, gemini3Client.calls)
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchRefinesWithSearchEvidence(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "第一轮识别",
		"items": []any{
			map[string]any{"name": "光明12mm大粒草莓酸奶", "type": "packaged", "estimatedWeightGrams": 130.0, "waterMl": 120.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "光明12mm大粒草莓酸奶 净含量260g", Snippet: "商品规格：260g 杯装酸奶", URL: "https://example.com/yogurt"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/yogurt.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	assert.Equal(t, "第一轮识别", result["description"])
	assert.Equal(t, "standard_web_search_single_vision_web_search_db_first", result["food_image_strategy"])
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "applied", meta["status"])
	assert.Equal(t, "standard_web_search_single_vision_web_search_db_first", meta["strategy"])
	assert.Equal(t, "applied", meta["web_search_status"])
	assert.Equal(t, "rule_based_spec_extraction", meta["calibration_method"])
	assert.True(t, meta["second_vision_skipped"].(bool))
	assert.NotEmpty(t, meta["base_items"])
	assert.NotEmpty(t, meta["web_search_evidence"])
	assert.NotEmpty(t, meta["item_changes"])
	require.Len(t, gemini3Client.imageSetCalls, 1)
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "光明12mm大粒草莓酸奶", items[0]["name"])
	assert.Equal(t, 260.0, items[0]["estimatedWeightGrams"])
	assert.Contains(t, fmt.Sprintf("%v", items[0]["weightEvidence"]), "净含量260g")
	require.Empty(t, doubaoClient.imageSetCalls)
	assert.NotEmpty(t, searcher.queries)
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchIgnoresIrrelevantSearchEvidence(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "手持的原味软冰淇淋蛋筒",
		"items": []any{
			map[string]any{"name": "原味软冰淇淋蛋筒", "estimatedWeightGrams": 100.0, "waterMl": 50.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "原 （汉语文字）_百度百科", Snippet: "原字的本义是水的源头", URL: "https://baike.baidu.com/item/%E5%8E%9F/34324"},
		{Title: "《原神》官方网站-米哈游开放世界冒险RPG", Snippet: "开放世界冒险RPG游戏", URL: "https://www.yuanshen.com/"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/icecream.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "no_relevant_evidence", meta["status"])
	assert.Equal(t, "no_relevant_results", meta["web_search_status"])
	assert.Equal(t, "first_pass_kept", meta["calibration_method"])
	require.Len(t, gemini3Client.imageSetCalls, 1)
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "原味软冰淇淋蛋筒", items[0]["name"])
	assert.Equal(t, 100.0, items[0]["estimatedWeightGrams"])
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchRejectsGenericBrandPages(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "八喜牛奶冰淇淋与巧乐兹抹茶雪糕",
		"items": []any{
			map[string]any{"name": "八喜牛奶冰淇淋", "type": "snack", "estimatedWeightGrams": 90.0, "waterMl": 54.0},
			map[string]any{"name": "伊利巧乐兹低糖抹茶可可味雪糕", "type": "snack", "estimatedWeightGrams": 75.0, "waterMl": 45.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "伊利 官网", Snippet: "伊利相信，所有的生命都需要被滋养，才能向这个世界展示多姿多彩的活力。", URL: "https://www.yili.com/"},
		{Title: "伊利 招聘官网", Snippet: "伊利校园招聘，热招职位，投递简历。", URL: "http://yili.hotjob.cn/"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/icecream-bars.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "no_relevant_evidence", meta["status"])
	assert.Equal(t, "no_relevant_results", meta["web_search_status"])
	assert.Equal(t, "first_pass_kept", meta["calibration_method"])
	relevance := meta["web_search_relevance"].([]map[string]any)
	require.NotEmpty(t, relevance)
	for _, row := range relevance {
		assert.Equal(t, "irrelevant", row["status"])
	}
	items := toItems(result["items"])
	require.Len(t, items, 2)
	assert.Equal(t, 90.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 75.0, items[1]["estimatedWeightGrams"])
	require.Empty(t, doubaoClient.imageSetCalls)
	require.Len(t, gemini3Client.imageSetCalls, 1)
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchKeepsFirstPassWhenRelevantButNoSpecApplies(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "八喜牛奶冰淇淋",
		"items": []any{
			map[string]any{"name": "八喜牛奶冰淇淋", "type": "snack", "estimatedWeightGrams": 90.0, "waterMl": 54.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "八喜牛奶冰淇淋 营养成分表", Snippet: "每100g能量约210kcal，蛋白质3.5g，脂肪12g。", URL: "https://example.com/baxi"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/baxi.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "no_applicable_specs", meta["status"])
	assert.Equal(t, "no_applicable_specs", meta["web_search_status"])
	assert.Equal(t, "first_pass_kept", meta["calibration_method"])
	assert.Equal(t, 0, meta["calibration_applied_count"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 90.0, items[0]["estimatedWeightGrams"])
	require.Len(t, gemini3Client.imageSetCalls, 1)
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchAppliesTitleSpecWithoutPrefix(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "巧乐兹抹茶雪糕",
		"items": []any{
			map[string]any{"name": "伊利巧乐兹低糖抹茶可可味雪糕", "type": "snack", "estimatedWeightGrams": 75.0, "waterMl": 45.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "伊利巧乐兹低糖抹茶可可味雪糕 50g", Snippet: "抹茶可可味，营养成分表显示能量799千焦。", URL: "https://example.com/chocliz"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/chocliz.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "applied", meta["status"])
	assert.Equal(t, "applied", meta["web_search_status"])
	assert.Equal(t, 1, meta["calibration_applied_count"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 50.0, items[0]["estimatedWeightGrams"])
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchSpecOverridesGrossWeight(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "巧乐兹抹茶雪糕",
		"items": []any{
			map[string]any{
				"name":                 "伊利巧乐兹低糖抹茶可可味雪糕",
				"type":                 "snack",
				"grossWeightGrams":     75.0,
				"estimatedWeightGrams": 75.0,
				"waterMl":              45.0,
			},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "伊利巧乐兹低糖抹茶可可味雪糕 50克*6支 参数配置", Snippet: "低糖抹茶可可味，6支装。", URL: "https://example.com/chocliz-pack"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/chocliz.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "applied", meta["status"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 50.0, items[0]["grossWeightGrams"])
	assert.Equal(t, 50.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 100.0, items[0]["ediblePortionRatio"])
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchAppliesMultipackTitleSpec(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "巧乐兹抹茶雪糕",
		"items": []any{
			map[string]any{"name": "伊利巧乐兹低糖抹茶可可味雪糕", "type": "snack", "estimatedWeightGrams": 75.0, "waterMl": 45.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "伊利巧乐兹低糖抹茶可可味雪糕 50克*6支 参数配置", Snippet: "低糖抹茶可可味，6支装。", URL: "https://example.com/chocliz-pack"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/chocliz.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "applied", meta["status"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 50.0, items[0]["estimatedWeightGrams"])
}

func TestAnalyzeService_AnalyzeImageStandardWebSearchRejectsDifferentFlavorTitleSpec(t *testing.T) {
	mode := "standard_web_search"
	doubaoClient := &multiImageLLMClient{err: assert.AnError}
	gemini3Client := &sequenceMultiImageLLMClient{results: []map[string]any{{
		"description": "巧乐兹抹茶雪糕",
		"items": []any{
			map[string]any{"name": "伊利巧乐兹低糖抹茶可可味雪糕", "type": "snack", "estimatedWeightGrams": 70.0, "waterMl": 42.0},
		},
	}}}
	searcher := &mockWebSearcher{results: []WebSearchResult{
		{Title: "伊利巧乐兹 巧恋果 雪糕 75g参数配置", Snippet: "巧恋果口味，非低糖抹茶可可味。", URL: "https://example.com/chocliz-other"},
	}}
	svc := NewAnalyzeService(doubaoClient, gemini3Client, nil)
	svc.ConfigureWebSearcher(searcher)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

	result, err := svc.Analyze(context.Background(), "", AnalyzeInput{
		ImageURL:      "https://example.com/chocliz.jpg",
		ExecutionMode: &mode,
	})

	require.NoError(t, err)
	meta := result["hybrid_review"].(map[string]any)
	assert.Equal(t, "no_applicable_specs", meta["status"])
	assert.Equal(t, "no_applicable_specs", meta["web_search_status"])
	items := toItems(result["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 70.0, items[0]["estimatedWeightGrams"])
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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	assert.Equal(t, "无花果 食物 外观 营养", queries[0])
	assert.Equal(t, "龙宫果 食物 外观 营养", queries[1])
	assert.Equal(t, "longkong 食物 外观 营养", queries[2])
}

func TestBuildStandardImageSearchQueriesPrioritizesPackagedFoods(t *testing.T) {
	queries := buildStandardImageSearchQueries(AnalyzeInput{}, map[string]any{
		"description": "丰盛晚餐，包含小龙虾、鸡爪、丝瓜炒蛋、多种水果及饮品",
		"items": []any{
			map[string]any{"name": "麻辣小龙虾", "type": "normal"},
			map[string]any{"name": "光明大粒草莓酸奶", "type": "packaged"},
			map[string]any{"name": "哈尔滨啤酒", "type": "packaged"},
			map[string]any{"name": "可乐", "type": "normal"},
		},
	})

	require.Len(t, queries, 3)
	assert.Contains(t, queries[0], "光明")
	assert.Contains(t, queries[0], "酸奶")
	assert.Contains(t, queries[0], "型号 规格 多少克")
	assert.Contains(t, strings.Join(queries, "\n"), "哈尔滨 啤酒")
	assert.NotContains(t, strings.Join(queries, "\n"), "丰盛晚餐")
}

func TestFilterRelevantWebSearchEvidence(t *testing.T) {
	evidence := []WebSearchEvidence{{
		Query: "原味软冰淇淋蛋筒 食物 外观 营养",
		Results: []WebSearchResult{
			{Title: "原 （汉语文字）_百度百科", Snippet: "原字的本义是水的源头"},
			{Title: "蜜雪冰城冰淇淋蛋筒 热量", Snippet: "原味冰淇淋蛋筒约 100g，营养与规格信息"},
		},
	}}
	baseItems := []map[string]any{{"name": "原味软冰淇淋蛋筒"}}

	filtered, relevance := filterRelevantWebSearchEvidence(evidence, baseItems)

	require.Len(t, filtered, 1)
	require.Len(t, filtered[0].Results, 1)
	assert.Contains(t, filtered[0].Results[0].Title, "冰淇淋蛋筒")
	require.Len(t, relevance, 1)
	assert.Equal(t, "relevant", relevance[0]["status"])
	assert.Equal(t, 1, relevance[0]["relevant_count"])
}

func TestApplyRuleBasedWebSearchCalibration(t *testing.T) {
	baseParsed := map[string]any{
		"description": "酸奶",
		"items": []any{
			map[string]any{"name": "光明12mm大粒草莓酸奶", "estimatedWeightGrams": 130.0, "waterMl": 120.0},
		},
	}
	evidence := []WebSearchEvidence{{
		Query: "光明12mm大粒草莓酸奶 包装 净含量 规格",
		Results: []WebSearchResult{{
			Title:   "光明12mm大粒草莓酸奶",
			Snippet: "净含量260g，杯装酸奶",
		}},
	}}

	merged, rows := applyRuleBasedWebSearchCalibration(baseParsed, evidence)

	items := parseItems(merged)
	require.Len(t, items, 1)
	assert.Equal(t, 260.0, items[0]["estimatedWeightGrams"])
	assert.Contains(t, fmt.Sprintf("%v", items[0]["evidenceSource"]), "search:")
	require.Len(t, rows, 1)
	assert.Equal(t, true, rows[0]["applied"])
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
	svc.ConfigureImageProvider("doubao")
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())

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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
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
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
	ctx := context.Background()

	result, err := svc.AnalyzeCompareEngines(ctx, "", AnalyzeInput{ImageURL: "https://example.com/img.jpg"})
	require.NoError(t, err)
	assert.NotNil(t, result["legacy_result"])
	assert.NotNil(t, result["db_first_result"])
}

func TestAnalyzeService_AnalyzeBatch(t *testing.T) {
	_, userRepo := setupAnalyzeServiceTestDB(t)
	doubaoClient := &multiImageLLMClient{result: map[string]any{"description": "batch", "items": []any{map[string]any{"name": "apple", "estimatedWeightGrams": 100.0, "nutrients": map[string]any{"calories": 50.0}}}}}
	svc := NewAnalyzeService(nil, doubaoClient, userRepo)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
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
	assert.Equal(t, "standard", mode)

	standardWeb := "standard_web_search"
	mode = svc.resolveExecutionMode(ctx, "", &standardWeb)
	assert.Equal(t, "standard_web_search", mode)

	strictWeb := "strict_web_search"
	mode = svc.resolveExecutionMode(ctx, "", &strictWeb)
	assert.Equal(t, "strict_web_search", mode)

	strictSeparate := "strict_separate"
	mode = svc.resolveExecutionMode(ctx, "", &strictSeparate)
	assert.Equal(t, "strict_separate", mode)

	packagedExperiment := "standard_packaged_experiment"
	mode = svc.resolveExecutionMode(ctx, "", &packagedExperiment)
	assert.Equal(t, "standard_packaged_experiment", mode)
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

func TestNutritionWeightFromItemFallsBackToWaterMl(t *testing.T) {
	assert.Equal(t, 165.0, nutritionWeightFromItem(map[string]any{
		"estimatedWeightGrams": 0.0,
		"originalWeightGrams":  0.0,
		"waterMl":              165.0,
	}))
	assert.Equal(t, 120.0, nutritionWeightFromItem(map[string]any{
		"estimatedWeightGrams": 0.0,
		"originalWeightGrams":  120.0,
		"waterMl":              165.0,
	}))
	assert.Equal(t, 90.0, nutritionWeightFromItem(map[string]any{
		"estimatedWeightGrams": 90.0,
		"originalWeightGrams":  120.0,
		"waterMl":              165.0,
	}))
	assert.Equal(t, 88.0, nutritionWeightFromItem(map[string]any{
		"nutrients": map[string]any{"waterMl": 88.0},
	}))
}

func mixedMealWithPackagedFoodParsed() map[string]any {
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
				"estimatedWeightGrams": 80.0,
				"grossWeightGrams":     80.0,
			},
		},
	}
}

func mixedMealWithSugarfreePackagedDrinkParsed() map[string]any {
	return map[string]any{
		"description": "米饭配无糖气泡水",
		"items": []any{
			map[string]any{
				"name":                 "白米饭",
				"type":                 "normal",
				"estimatedWeightGrams": 180.0,
				"grossWeightGrams":     180.0,
			},
			map[string]any{
				"name":                 "SUNTORY三得利纤漾饮荷叶茉莉花味风味饮料（无糖）",
				"estimatedWeightGrams": 500.0,
				"grossWeightGrams":     500.0,
			},
		},
	}
}

func TestAnalyzeService_FinalizeAnalyzeResponseIntegratesPackagedFoodAcrossMainModes(t *testing.T) {
	for _, mode := range []string{fastExecutionMode, defaultExecutionMode, precisionExecutionMode, precisionSeparateExecutionMode} {
		t.Run(mode, func(t *testing.T) {
			svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
			svc.nutrition = newFakeAnalyzeNutritionResolver()

			resp, err := svc.finalizeAnalyzeResponse(context.Background(), mixedMealWithPackagedFoodParsed(), AnalyzeInput{}, mode, "fake", "fake-model", 12)
			require.NoError(t, err)

			items := toItems(resp["items"])
			require.Len(t, items, 2)
			assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
			assert.Equal(t, 200.0, items[0]["estimatedWeightGrams"])

			assert.Equal(t, "snack", items[1]["type"])
			assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
			assert.Equal(t, "pkg-taoli-dousha", items[1]["matched_food_id"])
			assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
			assert.Equal(t, 55.0, items[1]["grossWeightGrams"])
			assert.Equal(t, true, items[1]["package_weight_applied"])
			nutrients := items[1]["nutrients"].(map[string]any)
			assert.Equal(t, 176.0, nutrients["calories"])

			meta, ok := resp["packaged_food_resolution"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, true, meta["enabled"])
			assert.Equal(t, 1, meta["triggered_count"])
			assert.Equal(t, 1, meta["matched_count"])
			assert.Equal(t, 1, meta["weight_applied_count"])
		})
	}
}

func TestAnalyzeService_FinalizeAnalyzeResponseIntegratesSugarfreePackagedDrinkAcrossModes(t *testing.T) {
	modes := []string{
		fastExecutionMode,
		defaultExecutionMode,
		precisionExecutionMode,
		precisionSeparateExecutionMode,
		fastWebSearchMode,
		standardWebSearchMode,
		precisionWebSearchMode,
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			ratioClient := &mockLLMClient{result: map[string]any{
				"items": []any{
					map[string]any{"index": 0.0, "suggestedRatio": 90.0, "reason": "主食按需保留"},
					map[string]any{"index": 1.0, "suggestedRatio": 100.0, "reason": "无糖饮料可按整瓶记录"},
				},
			}}
			svc := NewAnalyzeService(&mockLLMClient{}, ratioClient, nil)
			svc.nutrition = newFakeAnalyzeNutritionResolver()

			resp, err := svc.finalizeAnalyzeResponse(context.Background(), mixedMealWithSugarfreePackagedDrinkParsed(), AnalyzeInput{SuggestRatioEnabled: true}, mode, "fake", "fake-model", 12)
			require.NoError(t, err)

			assert.Equal(t, 2, resp["resolved_count"])
			assert.Equal(t, 0, resp["unresolved_count"])
			assert.Equal(t, true, resp["suggest_ratio_enabled"])
			assert.Equal(t, "applied", resp["suggest_ratio_status"])

			items := toItems(resp["items"])
			require.Len(t, items, 2)
			assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
			assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
			assert.Equal(t, "pkg-suntory-sugarfree-drink", items[1]["matched_food_id"])
			assert.Equal(t, false, items[1]["is_unresolved"])
			assert.Equal(t, 500.0, items[1]["estimatedWeightGrams"])
			assert.Equal(t, "packaged_food_library", items[1]["package_weight_source"])
			assert.Equal(t, true, items[1]["package_weight_applied"])
			assert.Equal(t, 100.0, items[1]["suggestedRatio"])
			assert.Equal(t, "ai", items[1]["suggestedRatioSource"])

			nutrients := items[1]["nutrients"].(map[string]any)
			assert.Equal(t, 90.0, nutrients["calories"])
			assert.Equal(t, 0.0, nutrients["protein"])
			assert.Equal(t, 0.0, nutrients["carbs"])
			assert.Equal(t, 0.0, nutrients["fat"])

			meta, ok := resp["packaged_food_resolution"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, true, meta["enabled"])
			assert.Equal(t, 1, meta["triggered_count"])
			assert.Equal(t, 1, meta["matched_count"])
			assert.Equal(t, 1, meta["weight_applied_count"])
			assert.Equal(t, 0, meta["fallback_count"])
		})
	}
}

func TestAnalyzeService_AnalyzeImageIntegratesPackagedFoodAcrossMainModes(t *testing.T) {
	for _, mode := range []string{fastExecutionMode, defaultExecutionMode, precisionExecutionMode, precisionSeparateExecutionMode} {
		t.Run(mode, func(t *testing.T) {
			modelClient := &mockLLMClient{result: mixedMealWithPackagedFoodParsed()}
			svc := NewAnalyzeService(modelClient, modelClient, nil)
			svc.dashscopeClient = modelClient
			svc.gemini35Client = modelClient
			svc.nutrition = newFakeAnalyzeNutritionResolver()

			modeValue := mode
			resp, err := svc.Analyze(context.Background(), "", AnalyzeInput{
				ImageURL:      "https://example.com/mixed-meal.jpg",
				ExecutionMode: &modeValue,
			})
			require.NoError(t, err)

			items := toItems(resp["items"])
			require.Len(t, items, 2)
			assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
			assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
			assert.Equal(t, "pkg-taoli-dousha", items[1]["matched_food_id"])
			assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
			assert.Equal(t, true, items[1]["package_weight_applied"])

			meta, ok := resp["packaged_food_resolution"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, "integrated", meta["mode"])
			assert.Equal(t, 1, meta["triggered_count"])
			assert.Equal(t, 1, meta["matched_count"])
		})
	}
}

func TestAnalyzeService_AnalyzeImageIntegratesPackagedFoodAcrossWebSearchModes(t *testing.T) {
	for _, mode := range []string{fastWebSearchMode, standardWebSearchMode, precisionWebSearchMode} {
		t.Run(mode, func(t *testing.T) {
			svc := NewAnalyzeService(&multiImageLLMClient{err: assert.AnError}, &multiImageLLMClient{result: mixedMealWithPackagedFoodParsed()}, nil)
			svc.ConfigureWebSearcher(&mockWebSearcher{})
			svc.nutrition = newFakeAnalyzeNutritionResolver()

			var qwenClient *mockDashScopeNativeSearchClient
			switch mode {
			case fastWebSearchMode:
				qwenClient = &mockDashScopeNativeSearchClient{result: mixedMealWithPackagedFoodParsed()}
				svc.dashscopeClient = qwenClient
			case precisionWebSearchMode:
				svc.gemini35Client = &multiImageLLMClient{result: mixedMealWithPackagedFoodParsed()}
			}

			modeValue := mode
			resp, err := svc.Analyze(context.Background(), "", AnalyzeInput{
				ImageURL:      "https://example.com/mixed-meal.jpg",
				ExecutionMode: &modeValue,
			})
			require.NoError(t, err)

			items := toItems(resp["items"])
			require.Len(t, items, 2)
			assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
			assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
			assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
			assert.Equal(t, true, items[1]["package_weight_applied"])

			meta, ok := resp["packaged_food_resolution"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, 1, meta["triggered_count"])
			assert.Equal(t, 1, meta["matched_count"])
			if mode == fastWebSearchMode {
				require.NotNil(t, qwenClient)
				require.Len(t, qwenClient.imageSetCalls, 1)
			}
		})
	}
}

func TestAnalyzeService_FinalizeAnalyzeResponseFallsBackWhenPackagedFoodMisses(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = resolver

	resp, err := svc.finalizeAnalyzeResponse(context.Background(), map[string]any{
		"description": "包装零食未入库",
		"items": []any{
			map[string]any{
				"name":                 "卫龙小面筋辣条",
				"type":                 "snack",
				"estimatedWeightGrams": 40.0,
				"grossWeightGrams":     40.0,
			},
		},
	}, AnalyzeInput{}, defaultExecutionMode, "fake", "fake-model", 12)
	require.NoError(t, err)

	items := toItems(resp["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 1, resolver.packagedResolveCalls)
	assert.Equal(t, "normal-weilong-xiaomianjin", items[0]["matched_food_id"])
	assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
	assert.Equal(t, 40.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "not_found", items[0]["package_match_status"])
	assert.Equal(t, false, items[0]["package_weight_applied"])
	assert.Equal(t, "包装库未命中，已回退普通营养库", items[0]["package_weight_reason"])

	meta, ok := resp["packaged_food_resolution"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 1, meta["triggered_count"])
	assert.Equal(t, 0, meta["matched_count"])
	assert.Equal(t, 1, meta["fallback_count"])
}

func TestAnalyzeService_FinalizeAnalyzeResponseGeneratesNutritionWhenPackagedAndNormalMiss(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	fallback := &fakeNutritionFallbackEstimator{
		rows: map[int]map[string]any{
			0: {
				"calories": 250.0,
				"protein":  12.0,
				"carbs":    30.0,
				"fat":      8.0,
			},
		},
	}
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = resolver
	svc.nutritionAI = fallback

	resp, err := svc.finalizeAnalyzeResponse(context.Background(), map[string]any{
		"description": "包装零食没有入库也没有普通营养库条目",
		"items": []any{
			map[string]any{
				"name":                 "未收录包装豆干",
				"type":                 "snack",
				"estimatedWeightGrams": 30.0,
				"grossWeightGrams":     30.0,
			},
		},
	}, AnalyzeInput{AdditionalContext: "包装库未命中时允许 AI 保守估算"}, defaultExecutionMode, "fake", "fake-model", 12)
	require.NoError(t, err)

	items := toItems(resp["items"])
	require.Len(t, items, 1)
	require.Len(t, fallback.candidates, 1)
	assert.Equal(t, "未收录包装豆干", fallback.candidates[0].Name)
	assert.Equal(t, 30.0, fallback.candidates[0].EstimatedWeightGrams)
	assert.Equal(t, "包装库未命中时允许 AI 保守估算", fallback.additionalContext)
	assert.Equal(t, 1, resolver.packagedResolveCalls)
	assert.Equal(t, "not_found", items[0]["package_match_status"])
	assert.Equal(t, false, items[0]["package_weight_applied"])
	assert.Equal(t, "deepseek_generated", items[0]["nutrition_source"])
	assert.Equal(t, "deepseek_generated", items[0]["resolve_status"])
	assert.Equal(t, false, items[0]["is_unresolved"])
	assert.Equal(t, "generated-food", items[0]["matched_food_id"])
	assert.Equal(t, true, items[0]["nutrition_persisted"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 75.0, nutrients["calories"])
	assert.Equal(t, 3.6, nutrients["protein"])
	assert.Equal(t, 1, resp["resolved_count"])
	assert.Equal(t, 0, resp["unresolved_count"])

	meta, ok := resp["packaged_food_resolution"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 1, meta["triggered_count"])
	assert.Equal(t, 0, meta["matched_count"])
	assert.Equal(t, 1, meta["fallback_count"])
}

func TestAnalyzeService_FinalizeAnalyzeResponseFallsBackToQwenWhenDeepSeekFails(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	deepseekFallback := &fakeNutritionFallbackEstimator{err: errors.New("deepseek timeout")}
	qwenFallback := &fakeNutritionFallbackEstimator{
		rows: map[int]map[string]any{
			0: {
				"calories": 120.0,
				"protein":  8.0,
				"carbs":    10.0,
				"fat":      4.0,
			},
		},
	}
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = resolver
	svc.nutritionAI = newChainedNutritionFallbackEstimator(
		namedNutritionFallbackEstimator{source: "deepseek_generated", estimator: deepseekFallback},
		namedNutritionFallbackEstimator{source: "qwen_generated", estimator: qwenFallback},
	)

	resp, err := svc.finalizeAnalyzeResponse(context.Background(), map[string]any{
		"description": "DeepSeek 不稳定时应继续用 Qwen 兜底",
		"items": []any{
			map[string]any{
				"name":                 "未收录清炒蔬菜",
				"type":                 "normal",
				"estimatedWeightGrams": 50.0,
				"grossWeightGrams":     50.0,
			},
		},
	}, AnalyzeInput{}, defaultExecutionMode, "fake", "fake-model", 12)
	require.NoError(t, err)

	require.Len(t, deepseekFallback.candidates, 1)
	require.Len(t, qwenFallback.candidates, 1)
	items := toItems(resp["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "qwen_generated", items[0]["nutrition_source"])
	assert.Equal(t, "qwen_generated", items[0]["resolve_status"])
	assert.Equal(t, false, items[0]["is_unresolved"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 60.0, nutrients["calories"])
	assert.Equal(t, 4.0, nutrients["protein"])
	assert.Equal(t, 1, resp["resolved_count"])
	assert.Equal(t, 0, resp["unresolved_count"])
}

func TestQwenNutritionEstimatorEstimateParsesNutrition(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{
		"items": []any{
			map[string]any{
				"index": 3,
				"unitNutritionPer100g": map[string]any{
					"calories": 80.0,
					"protein":  3.0,
					"carbs":    12.0,
					"fat":      2.0,
				},
			},
		},
	}}
	estimator := NewQwenNutritionEstimator(client)

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{
		{Index: 3, Name: "未收录蔬菜", EstimatedWeightGrams: 100},
	}, "测试上下文")
	require.NoError(t, err)

	require.Equal(t, 1, client.calls)
	assert.Contains(t, client.prompt, "测试上下文")
	assert.Contains(t, client.prompt, "不要因为不确定就把热量或宏量营养填 0")
	assert.Equal(t, 80.0, rows[3]["calories"])
	assert.Equal(t, 3.0, rows[3]["protein"])
}

func TestAnalyzeService_ApplyDBFirstToItemsIntegratesPackagedFoodForWorkerPrecision(t *testing.T) {
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = newFakeAnalyzeNutritionResolver()

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{
		{
			"name":                 "白米饭",
			"type":                 "normal",
			"estimatedWeightGrams": 150.0,
			"grossWeightGrams":     150.0,
		},
		{
			"name":                 "桃李豆沙小饼面包",
			"estimatedWeightGrams": 90.0,
			"grossWeightGrams":     90.0,
		},
	}, "精准分项估重后统一回算")

	require.Len(t, items, 2)
	assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
	assert.Equal(t, 150.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
	assert.Equal(t, "pkg-taoli-dousha", items[1]["matched_food_id"])
	assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
	assert.Equal(t, true, items[1]["package_weight_applied"])
}

func TestAnalyzeService_ApplyDBFirstToItemsIntegratesNescafeFromPrecisionAggregateName(t *testing.T) {
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = newFakeAnalyzeNutritionResolver()

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "雀巢奶香速溶咖啡固体饮料",
		"estimatedWeightGrams": 105.0,
		"grossWeightGrams":     105.0,
	}}, "精准分项聚合后的包装食品名称")

	require.Len(t, items, 1)
	assert.Equal(t, "snack", items[0]["type"])
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, "pkg-nescafe-1plus2", items[0]["matched_food_id"])
	assert.Equal(t, 105.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "packaged_food_library", items[0]["package_weight_source"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.InDelta(t, 42.16, nutrients["calories"], 0.01)
}

func TestAnalyzeService_ApplyDBFirstToItemsUsesOCREvidenceForGenericPackagedAggregate(t *testing.T) {
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = newFakeAnalyzeNutritionResolver()

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "奶香速溶咖啡固体饮料",
		"estimatedWeightGrams": 96.0,
		"grossWeightGrams":     96.0,
		"ocrText":              []any{"雀巢咖啡1+2奶香", "净含量105克"},
		"recognitionEvidence":  "包装正面可见雀巢咖啡1+2奶香字样",
		"weightEvidence":       "包装显示净含量105克",
	}}, "精准分项聚合名称泛化，但 OCR 保留包装证据")

	require.Len(t, items, 1)
	assert.Equal(t, "snack", items[0]["type"])
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, "pkg-nescafe-1plus2", items[0]["matched_food_id"])
	assert.Equal(t, 105.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "packaged_food_library", items[0]["package_weight_source"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.InDelta(t, 42.16, nutrients["calories"], 0.01)
}

func TestAnalyzeService_ApplyDBFirstToItemsUserCorrectionWeightWinsOverPackagedAnchor(t *testing.T) {
	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, nil)
	svc.nutrition = newFakeAnalyzeNutritionResolver()

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"itemId":               12,
		"name":                 "桃李豆沙小饼面包",
		"estimatedWeightGrams": 27.5,
		"grossWeightGrams":     27.5,
		"userWeightGrams":      27.5,
		"weightEdited":         true,
	}}, "用户纠错为半包")

	require.Len(t, items, 1)
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, 27.5, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 27.5, items[0]["grossWeightGrams"])
	assert.Equal(t, "user_context", items[0]["package_weight_source"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 88.0, nutrients["calories"])
}

func TestAnalyzeService_FinalizeAnalyzeResponseKeepsPackagedWeightWithSuggestRatio(t *testing.T) {
	modes := []string{
		fastExecutionMode,
		defaultExecutionMode,
		precisionExecutionMode,
		precisionSeparateExecutionMode,
		fastWebSearchMode,
		standardWebSearchMode,
		precisionWebSearchMode,
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			ratioClient := &mockLLMClient{result: map[string]any{
				"items": []any{
					map[string]any{"index": 0.0, "suggestedRatio": 80.0, "reason": "主食稍微控制"},
					map[string]any{"index": 1.0, "suggestedRatio": 60.0, "reason": "包装面包按需食用"},
				},
			}}
			svc := NewAnalyzeService(&mockLLMClient{}, ratioClient, nil)
			svc.nutrition = newFakeAnalyzeNutritionResolver()

			resp, err := svc.finalizeAnalyzeResponse(context.Background(), mixedMealWithPackagedFoodParsed(), AnalyzeInput{SuggestRatioEnabled: true}, mode, "fake", "fake-model", 12)
			require.NoError(t, err)

			assert.Equal(t, true, resp["suggest_ratio_enabled"])
			assert.Equal(t, "applied", resp["suggest_ratio_status"])
			items := toItems(resp["items"])
			require.Len(t, items, 2)
			assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
			assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
			assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
			assert.Equal(t, 60.0, items[1]["suggestedRatio"])
			assert.Equal(t, "ai", items[1]["suggestedRatioSource"])
			assert.Equal(t, true, items[1]["package_weight_applied"])
		})
	}
}

func TestAnalyzeService_ApplyDBFirstUsesPackagedNutritionForSnack(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.FoodNutrition{
		ID:             "normal-1",
		CanonicalName:  "蛋白棒",
		NormalizedName: "蛋白棒",
		KcalPer100g:    200,
		ProteinPer100g: 10,
		CarbsPer100g:   20,
		FatPer100g:     6,
		IsActive:       true,
	}).Error)
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
		"name":                 "BrandA 蛋白棒",
		"type":                 "snack",
		"estimatedWeightGrams": 80.0,
	}}, "")

	require.Len(t, items, 1)
	assert.Equal(t, "snack", items[0]["type"])
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, 100.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 420.0, nutrients["calories"])
	assert.Equal(t, 28.0, nutrients["protein"])
}

func TestAnalyzeService_ApplyDBFirstIntegratesPackagedFoodInMixedMeal(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.FoodNutrition{
		ID:             "rice-1",
		CanonicalName:  "白米饭",
		NormalizedName: "白米饭",
		KcalPer100g:    116,
		ProteinPer100g: 2.6,
		CarbsPer100g:   25.9,
		FatPer100g:     0.3,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
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
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{
		{
			"name":                 "白米饭",
			"type":                 "normal",
			"estimatedWeightGrams": 200.0,
		},
		{
			"name":                 "桃李豆沙小饼面包",
			"estimatedWeightGrams": 80.0,
			"grossWeightGrams":     80.0,
		},
	}, "")

	require.Len(t, items, 2)
	assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
	assert.Equal(t, 200.0, items[0]["estimatedWeightGrams"])
	riceNutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 232.0, riceNutrients["calories"])

	assert.Equal(t, "snack", items[1]["type"])
	assert.Equal(t, "packaged_food_library", items[1]["nutrition_source"])
	assert.Equal(t, "pkg-taoli-dousha", items[1]["matched_food_id"])
	assert.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
	assert.Equal(t, 55.0, items[1]["grossWeightGrams"])
	assert.Equal(t, true, items[1]["package_weight_applied"])
	assert.Equal(t, "packaged_food_library", items[1]["package_weight_source"])
	packagedNutrients := items[1]["nutrients"].(map[string]any)
	assert.Equal(t, 176.0, packagedNutrients["calories"])
	assert.Equal(t, 3.85, packagedNutrients["protein"])
}

func TestAnalyzeService_ApplyDBFirstPackagedExperimentUsesNetWeightAnchor(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	spec := "50克*6支"
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
		ID:             "pkg-chocliz-50",
		Brand:          "伊利",
		ProductName:    "伊利巧乐兹低糖抹茶可可味雪糕",
		NormalizedName: "伊利巧乐兹低糖抹茶可可味雪糕",
		SpecText:       &spec,
		NetWeightG:     50,
		KcalPer100g:    244,
		ProteinPer100g: 3.76,
		CarbsPer100g:   28.5,
		FatPer100g:     12.76,
		IsActive:       true,
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	resp := svc.applyDBFirstNutritionWithOptions(context.Background(), map[string]any{
		"items": []map[string]any{{
			"name":                 "伊利巧乐兹低糖抹茶可可味雪糕",
			"type":                 "snack",
			"estimatedWeightGrams": 75.0,
			"grossWeightGrams":     75.0,
		}},
	}, dbFirstNutritionOptions{packagedExperimentCompatMode: true})

	items := toItems(resp["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, 50.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 50.0, items[0]["originalWeightGrams"])
	assert.Equal(t, 50.0, items[0]["grossWeightGrams"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
	assert.Equal(t, "packaged_food_library", items[0]["package_weight_source"])
	assert.Equal(t, "matched", items[0]["package_match_status"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 122.0, nutrients["calories"])
	assert.Equal(t, 1.88, nutrients["protein"])

	debug := resp["packaged_experiment"].(map[string]any)
	assert.Equal(t, true, debug["enabled"])
	assert.Equal(t, 1, debug["triggered_count"])
	assert.Equal(t, 1, debug["matched_count"])
	assert.Equal(t, 1, debug["weight_applied_count"])
}

func TestPackagedExperimentWeightForItemKeepsVisualWeightWhenLibrarySpecIsMuchLarger(t *testing.T) {
	food := &foodrecorddomain.PackagedFood{
		ID:          "pkg-pumpkin-bread-bulk",
		Brand:       "TASTY ELF",
		ProductName: "低糖小南瓜面包",
		NetWeightG:  1100,
	}
	item := map[string]any{
		"name":                 "低糖小南瓜面包",
		"estimatedWeightGrams": 50.0,
		"grossWeightGrams":     50.0,
	}

	weight, meta := packagedExperimentWeightForItem(item, food, []foodrecorddomain.PackagedFood{*food}, "exact_alias", 50, true, nil)

	assert.Equal(t, 50.0, weight)
	assert.Equal(t, "matched_weight_conflict", meta["package_match_status"])
	assert.Equal(t, "ai_estimate", meta["package_weight_source"])
	assert.Equal(t, false, meta["package_weight_applied"])
	assert.Contains(t, fmt.Sprint(meta["package_weight_reason"]), "1100g")
}

func TestAnalyzeService_ApplyDBFirstPackagedExperimentKeepsAIWeightForAmbiguousSpecs(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	spec65 := "65g杯装"
	spec90 := "90g杯装"
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
		ID:             "pkg-baxy-65",
		Brand:          "八喜",
		ProductName:    "八喜牛奶冰淇淋",
		NormalizedName: "八喜牛奶冰淇淋",
		SpecText:       &spec65,
		NetWeightG:     65,
		KcalPer100g:    210,
		ProteinPer100g: 3.5,
		CarbsPer100g:   22,
		FatPer100g:     12,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
		ID:             "pkg-baxy-90",
		Brand:          "八喜",
		ProductName:    "八喜牛奶冰淇淋",
		NormalizedName: "八喜牛奶冰淇淋",
		SpecText:       &spec90,
		NetWeightG:     90,
		KcalPer100g:    210,
		ProteinPer100g: 3.5,
		CarbsPer100g:   22,
		FatPer100g:     12,
		IsActive:       true,
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	resp := svc.applyDBFirstNutritionWithOptions(context.Background(), map[string]any{
		"items": []map[string]any{{
			"name":                 "八喜牛奶冰淇淋",
			"estimatedWeightGrams": 80.0,
			"grossWeightGrams":     80.0,
		}},
	}, dbFirstNutritionOptions{packagedExperimentCompatMode: true})

	items := toItems(resp["items"])
	require.Len(t, items, 1)
	assert.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	assert.Equal(t, 80.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 80.0, items[0]["grossWeightGrams"])
	assert.Equal(t, false, items[0]["package_weight_applied"])
	assert.Equal(t, "multiple_candidates", items[0]["package_match_status"])
	assert.Contains(t, fmt.Sprint(items[0]["package_weight_reason"]), "多个可能规格")
	candidates, ok := items[0]["packaged_candidates"].([]map[string]any)
	require.True(t, ok)
	assert.Len(t, candidates, 2)
}

func TestAnalyzeService_ApplyDBFirstPackagedExperimentUserWeightWinsOverLibrary(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.PackagedFood{
		ID:             "pkg-user-weight",
		Brand:          "伊利",
		ProductName:    "伊利巧乐兹低糖抹茶可可味雪糕",
		NormalizedName: "伊利巧乐兹低糖抹茶可可味雪糕",
		NetWeightG:     70,
		KcalPer100g:    244,
		ProteinPer100g: 3.76,
		CarbsPer100g:   28.5,
		FatPer100g:     12.76,
		IsActive:       true,
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	resp := svc.applyDBFirstNutritionWithOptions(context.Background(), map[string]any{
		"items": []map[string]any{{
			"name":                 "伊利巧乐兹低糖抹茶可可味雪糕",
			"type":                 "snack",
			"estimatedWeightGrams": 75.0,
			"userWeightGrams":      50.0,
		}},
	}, dbFirstNutritionOptions{packagedExperimentCompatMode: true})

	items := toItems(resp["items"])
	require.Len(t, items, 1)
	assert.Equal(t, 50.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, "user_context", items[0]["package_weight_source"])
	assert.Equal(t, true, items[0]["package_weight_applied"])
}

func TestFilterPackagedExperimentRelevantCandidatesPrefersMatchingFlavor(t *testing.T) {
	orangeSpec := "净含量:258克"
	grapeFlavor := "红葡萄"
	grapeSpec := "净含量:258克"
	candidates := []foodrecorddomain.PackagedFood{
		{
			ID:          "pkg-cici-grape",
			Brand:       "喜之郎",
			ProductName: "cici果粒可吸红葡萄汁饮料",
			FlavorText:  &grapeFlavor,
			SpecText:    &grapeSpec,
			NetWeightG:  258,
		},
		{
			ID:          "pkg-cici-orange",
			Brand:       "喜之郎",
			ProductName: "cici果粒爽 橙汁饮料",
			SpecText:    &orangeSpec,
			NetWeightG:  258,
		},
	}

	filtered := filterPackagedExperimentRelevantCandidates("喜之郎Cici果冻爽（橙味）", candidates)

	require.Len(t, filtered, 1)
	assert.Equal(t, "pkg-cici-orange", filtered[0].ID)
	assert.False(t, hasAmbiguousPackagedExperimentWeights(filtered))
}

func TestAnalyzeService_ApplyDBFirstUsesWaterMlAsLiquidWeight(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.FoodNutrition{
		ID:             "drink-1",
		CanonicalName:  "可乐",
		NormalizedName: "可乐",
		KcalPer100g:    42,
		CarbsPer100g:   10.6,
		IsActive:       true,
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "可乐",
		"estimatedWeightGrams": 0.0,
		"originalWeightGrams":  0.0,
		"waterMl":              100.0,
	}}, "")

	require.Len(t, items, 1)
	assert.Equal(t, "library_exact_canonical", items[0]["nutrition_source"])
	assert.Equal(t, 100.0, items[0]["estimatedWeightGrams"])
	assert.Equal(t, 100.0, items[0]["originalWeightGrams"])
	assert.Equal(t, 100.0, items[0]["waterMl"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 42.0, nutrients["calories"])
	assert.Equal(t, 10.6, nutrients["carbs"])
}

func TestAnalyzeService_ApplyDBFirstUsesDeepSeekSemanticReuse(t *testing.T) {
	db, userRepo := setupAnalyzeServiceTestDB(t)
	require.NoError(t, db.AutoMigrate(&foodrecorddomain.FoodNutrition{}, &foodrecorddomain.FoodNutritionAlias{}, &foodrecorddomain.FoodUnresolvedLog{}, &foodrecorddomain.PackagedFood{}, &foodrecorddomain.PackagedFoodAlias{}))
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	require.NoError(t, db.Create(&foodrecorddomain.FoodNutrition{
		ID:             "icecream-1",
		CanonicalName:  "蜜雪冰城原味冰淇淋蛋筒",
		NormalizedName: "蜜雪冰城原味冰淇淋蛋筒",
		KcalPer100g:    220,
		ProteinPer100g: 4,
		CarbsPer100g:   28,
		FatPer100g:     10,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&foodrecorddomain.FoodNutrition{
		ID:             "icecream-2",
		CanonicalName:  "蜜雪冰城蜜瓜冰淇淋",
		NormalizedName: "蜜雪冰城蜜瓜冰淇淋",
		KcalPer100g:    215,
		ProteinPer100g: 4,
		CarbsPer100g:   27,
		FatPer100g:     9,
		IsActive:       true,
	}).Error)

	svc := NewAnalyzeService(&mockLLMClient{}, &mockLLMClient{}, userRepo, nutritionRepo)
	svc.ConfigureDeepSeekFallback("fake-key")
	svc.deepseek.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"reuseExisting\":true,\"selectedCandidateIndex\":0,\"confidence\":0.96,\"reason\":\"甜筒/蛋筒属于同义包装说法\",\"shouldAddAlias\":true,\"aliasName\":\"蜜雪冰城原味冰淇淋\"}]}"}}]}`
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})}

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "蜜雪冰城原味冰淇淋",
		"estimatedWeightGrams": 80.0,
	}}, "")

	require.Len(t, items, 1)
	assert.Equal(t, "icecream-1", items[0]["matched_food_id"])
	assert.Equal(t, "蜜雪冰城原味冰淇淋蛋筒", items[0]["matched_food_name"])
	assert.Equal(t, "semantic_rerank", items[0]["resolve_status"])
	assert.Equal(t, "library_semantic_rerank", items[0]["nutrition_source"])
	assert.Equal(t, "甜筒/蛋筒属于同义包装说法", items[0]["resolve_reason"])
	nutrients := items[0]["nutrients"].(map[string]any)
	assert.Equal(t, 176.0, nutrients["calories"])
}

func TestModelDeclaredPackagedFoodDoesNotInferFromName(t *testing.T) {
	item := map[string]any{"name": "可比克番茄味薯片"}

	assert.False(t, modelDeclaredPackagedFood(item))
	assert.Empty(t, item["type"])
}

func TestModelDeclaredPackagedFoodNormalizesModelType(t *testing.T) {
	item := map[string]any{"name": "可比克番茄味薯片", "type": "packaged"}

	assert.True(t, modelDeclaredPackagedFood(item))
	assert.Equal(t, "snack", item["type"])
}

func TestShouldResolvePackagedFoodForExperimentInfersCiciJellyDrink(t *testing.T) {
	item := map[string]any{"name": "喜之郎Cici果冻爽（橙味）"}

	assert.True(t, shouldResolvePackagedFoodForDBFirst(item, true))
	assert.Equal(t, "snack", item["type"])
}

func TestShouldResolvePackagedFoodIntegratedInfersTaoliBread(t *testing.T) {
	item := map[string]any{"name": "桃李豆沙小饼面包"}

	assert.True(t, shouldResolvePackagedFoodForDBFirst(item, true))
	assert.Equal(t, "snack", item["type"])
}

func TestShouldResolvePackagedFoodIntegratedInfersNescafeCoffee(t *testing.T) {
	item := map[string]any{"name": "雀巢奶香速溶咖啡固体饮料"}

	assert.True(t, shouldResolvePackagedFoodForDBFirst(item, true))
	assert.Equal(t, "snack", item["type"])
}

func TestShouldResolvePackagedFoodIntegratedInfersSuntorySugarfreeDrink(t *testing.T) {
	item := map[string]any{"name": "SUNTORY三得利纤漾饮荷叶茉莉花味风味饮料（无糖）"}

	assert.True(t, shouldResolvePackagedFoodForDBFirst(item, true))
	assert.Equal(t, "snack", item["type"])
}

func TestShouldResolvePackagedFoodIntegratedUsesOCREvidence(t *testing.T) {
	item := map[string]any{
		"name":           "奶香速溶咖啡固体饮料",
		"ocrText":        []any{"雀巢咖啡1+2奶香", "净含量105克"},
		"weightEvidence": "包装显示净含量105克",
	}

	assert.True(t, shouldResolvePackagedFoodForDBFirst(item, true))
	assert.Equal(t, "snack", item["type"])
	assert.Contains(t, packagedFoodResolveQuery(item), "雀巢咖啡1+2奶香")
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
