package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"github.com/stretchr/testify/require"
)

type smartLibrary struct {
	mu       sync.Mutex
	foods    map[string]foodrecorddomain.FoodNutrition
	packaged map[string]foodrecorddomain.PackagedFood
	search   []foodrecorddomain.PackagedFood
	failAll  bool
	queries  []string
}

func newSmartLibrary() *smartLibrary {
	row := func(name string, kcal, protein, carbs, fat float64) foodrecorddomain.FoodNutrition {
		return foodrecorddomain.FoodNutrition{ID: "id-" + name, CanonicalName: name, KcalPer100g: kcal, ProteinPer100g: protein, CarbsPer100g: carbs, FatPer100g: fat, IsActive: true, QualityTier: "legacy_curated", Source: "项目内置初始营养数据"}
	}
	foods := map[string]foodrecorddomain.FoodNutrition{}
	for _, food := range []foodrecorddomain.FoodNutrition{
		row("白米饭", 116, 2.6, 25.9, 0.3),
		row("香蕉", 89, 1.1, 22.8, 0.3),
		row("鸡蛋(全蛋)", 144, 13.3, 2.8, 8.8),
		row("番茄", 18, 0.9, 3.9, 0.2),
		row("花生油", 884, 0, 0, 100),
		row("燕麦片", 389, 16.9, 66.3, 6.9),
		row("宫保鸡丁", 220, 15, 10, 13),
		row("南瓜", 26, 1, 6.5, 0.1),
	} {
		foods[food.CanonicalName] = food
	}
	foods["燕麦"] = foods["燕麦片"] // the live catalog aliases 燕麦 to the dry flakes row
	return &smartLibrary{foods: foods, packaged: map[string]foodrecorddomain.PackagedFood{}}
}

func (l *smartLibrary) ResolveFood(_ context.Context, name string) (*foodrecordrepo.ResolveResult, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.queries = append(l.queries, name)
	if l.failAll {
		return nil, errors.New("db down")
	}
	if food, ok := l.foods[strings.TrimSpace(name)]; ok {
		return &foodrecordrepo.ResolveResult{Food: &food, Status: "exact_canonical", Score: 1}, nil
	}
	return &foodrecordrepo.ResolveResult{Status: "unresolved"}, nil
}

func (l *smartLibrary) ResolvePackagedFood(_ context.Context, input foodrecordrepo.PackagedFoodResolveInput) (*foodrecordrepo.PackagedResolveResult, error) {
	if food, ok := l.packaged[input.Name]; ok {
		return &foodrecordrepo.PackagedResolveResult{Food: &food, Status: "exact_canonical", Score: 1}, nil
	}
	return &foodrecordrepo.PackagedResolveResult{Status: "unresolved"}, nil
}

func (l *smartLibrary) SearchPackagedFood(context.Context, string, int) ([]foodrecorddomain.PackagedFood, error) {
	return l.search, nil
}

func (l *smartLibrary) SearchCandidates(context.Context, string, int) ([]foodrecordrepo.SearchCandidate, error) {
	return nil, nil
}
func (l *smartLibrary) EnsureNutritionAlias(context.Context, string, string) error { return nil }
func (l *smartLibrary) LogUnresolved(context.Context, string) error                { return nil }
func (l *smartLibrary) UpsertDeepSeekNutrition(context.Context, string, map[string]any, ...string) (string, error) {
	return "", errors.New("smart engine must not write to the library")
}

func newSmartService(library *smartLibrary) *AnalyzeService {
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureNutritionResolver(library)
	return s
}

func smartItem(name, state string, weight, kcal float64, extra map[string]any) map[string]any {
	item := map[string]any{
		"name": name, "type": "normal", "foodState": state, "weightBasis": "as_served",
		"isComposite": false, "addedIngredients": []any{}, "estimatedWeightGrams": weight,
		"nutrients": map[string]any{"calories": kcal, "protein": kcal * 0.15 / 4, "carbs": kcal * 0.55 / 4, "fat": kcal * 0.30 / 9, "vitaminCMg": 3.0},
	}
	for key, value := range extra {
		item[key] = value
	}
	return item
}

func runSmart(t *testing.T, library *smartLibrary, items ...map[string]any) []map[string]any {
	t.Helper()
	resp := map[string]any{"items": items}
	out := newSmartService(library).applySmartNutrition(context.Background(), resp)
	require.Equal(t, analysisEngineSmart, out["analysis_engine"])
	return toItems(out["items"])
}

func TestSmartEngineIsOptIn(t *testing.T) {
	require.Equal(t, analysisEngineSmart, normalizeAnalysisEngine("smart", "standard", false))
	require.Equal(t, analysisEngineSmart, normalizeAnalysisEngine("auto", "strict", false))
	require.Equal(t, analysisEngineAIDirect, normalizeAnalysisEngine("", "standard", false), "existing clients keep their default")
	require.True(t, analysisEngineProducesNutrition(analysisEngineSmart))
}

func TestSmartPromptAsksForRoutingFieldsOnlyForSmartEngine(t *testing.T) {
	smart := buildPrompt(AnalyzeInput{AnalysisEngine: analysisEngineSmart}, nil, "standard")
	require.Contains(t, smart, `"components":[]`)
	require.NotContains(t, smart, `"brand":""`, "asking for package fields inflated weights to the whole package")
	plain := buildPrompt(AnalyzeInput{AnalysisEngine: analysisEngineAIDirect}, nil, "standard")
	require.NotContains(t, plain, `"components":[]`)
}

func TestSmartNutritionMatchesStatelessStaplesFruitAndEggs(t *testing.T) {
	items := runSmart(t, newSmartLibrary(),
		smartItem("米饭", "熟制", 200, 260, nil),
		smartItem("香蕉", "熟", 100, 95, nil),
		smartItem("水煮蛋", "cooked", 50, 70, nil),
		smartItem("蒸南瓜", "熟食", 100, 45, nil),
	)
	require.Equal(t, "白米饭", items[0]["matched_food_name"])
	require.InDelta(t, 232, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.01)
	require.Equal(t, "database", items[0]["nutrition_source_category"])
	require.Equal(t, "香蕉", items[1]["matched_food_name"], "熟香蕉 means ripe, not cooked")
	require.Equal(t, "鸡蛋(全蛋)", items[2]["matched_food_name"])
	require.Equal(t, "南瓜", items[3]["matched_food_name"], "steamed vegetables use the raw row")
	require.InDelta(t, 3.0, numberFromAny(mapFromAny(items[0]["nutrients"])["vitaminCMg"]), 0.01, "blank catalog vitamins keep the model value")
}

func TestSmartNutritionKeepsEstimateWhenIdentityOrStateDiffers(t *testing.T) {
	items := runSmart(t, newSmartLibrary(),
		smartItem("煮鸡蛋（去蛋黄）", "熟制", 100, 52, nil),
		smartItem("燕麦", "浸泡", 200, 140, nil),
		smartItem("宫保鸡丁", "熟制", 200, 380, nil),
		smartItem("煎鸡蛋", "熟制", 60, 120, nil),
	)
	for _, item := range items {
		require.Nil(t, item["matched_food_name"], item["name"])
		require.Equal(t, analysisEngineAIDirect, item["nutrition_source"], item["name"])
	}
	require.Equal(t, "dish_average_not_used", items[2]["smart_match_status"])
}

func TestSmartNutritionRecomputesDishFromIngredients(t *testing.T) {
	dish := smartItem("番茄炒蛋", "熟制", 250, 260, map[string]any{
		"isComposite": true, "addedIngredients": []any{"植物油"},
		"components": []any{
			map[string]any{"name": "番茄", "grams": 150, "foodState": "熟"},
			map[string]any{"name": "鸡蛋", "grams": 90, "foodState": "熟"},
			map[string]any{"name": "植物油", "grams": 10, "foodState": "液体"},
		},
	})
	items := runSmart(t, newSmartLibrary(), dish)
	got := items[0]
	require.Equal(t, "component_library", got["nutrition_source"])
	// Every ingredient is in the standard table: 150 g tomato 27 kcal + 90 g
	// cooked egg 135 kcal + 10 g oil 89.9 kcal.
	require.InDelta(t, 251.9, numberFromAny(mapFromAny(got["nutrients"])["calories"]), 0.5)
	require.InDelta(t, 1.0, numberFromAny(got["component_coverage"]), 0.001)
	require.Len(t, got["component_nutrition"], 3)
}

func TestSmartNutritionKeepsDishEstimateWhenSplitIsUnreliable(t *testing.T) {
	lowCoverage := smartItem("咖喱牛肉饭", "熟制", 400, 700, map[string]any{
		"isComposite": true,
		"components": []any{
			map[string]any{"name": "白米饭", "grams": 200, "foodState": "熟"},
			map[string]any{"name": "咖喱牛肉", "grams": 200, "foodState": "熟"},
		},
	})
	wrongWeight := smartItem("番茄炒蛋", "熟制", 250, 260, map[string]any{
		"isComposite": true,
		"components": []any{
			map[string]any{"name": "番茄", "grams": 50},
			map[string]any{"name": "鸡蛋", "grams": 40},
		},
	})
	items := runSmart(t, newSmartLibrary(), lowCoverage, wrongWeight)
	require.Equal(t, "dish_low_coverage", items[0]["smart_match_status"])
	require.Equal(t, "dish_components_weight_mismatch", items[1]["smart_match_status"])
	require.InDelta(t, 700, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.01)
}

func TestSmartNutritionMatchesPackagedProductLine(t *testing.T) {
	library := newSmartLibrary()
	chip := func(id, name string, kcal float64) foodrecorddomain.PackagedFood {
		return foodrecorddomain.PackagedFood{ID: id, Brand: "乐事", ProductName: name, DisplayName: "乐事 " + name, KcalPer100g: kcal, ProteinPer100g: 6, CarbsPer100g: 52, FatPer100g: 34, SodiumMgPer100g: 600, IsActive: true}
	}
	library.search = []foodrecorddomain.PackagedFood{
		chip("a", "德克萨斯烧烤味薯片", 538), chip("b", "原味薯片", 546), chip("c", "海盐黑胡椒味薯片", 530),
		{ID: "d", Brand: "乐事", ProductName: "柠檬味饮料", KcalPer100g: 40, IsActive: true},
	}
	items := runSmart(t, library,
		smartItem("乐事黄瓜味薯片", "packaged", 70, 360, map[string]any{"type": "snack", "brand": "乐事", "productName": "黄瓜味薯片"}),
		smartItem("薯片", "packaged", 30, 160, map[string]any{"type": "snack"}),
	)
	require.Equal(t, "packaged_food_library", items[0]["nutrition_source"])
	require.Equal(t, "matched_packaged_brand_family", items[0]["smart_match_status"])
	require.InDelta(t, 538*0.7, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.5)
	require.Equal(t, "packaged_without_brand", items[1]["smart_match_status"], "an unbranded snack cannot pick a product")
}

func TestSmartNutritionRejectsMixedProductLine(t *testing.T) {
	library := newSmartLibrary()
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "a", Brand: "卫龙", ProductName: "大面筋", KcalPer100g: 404, IsActive: true},
		{ID: "b", Brand: "卫龙", ProductName: "小面筋", KcalPer100g: 300, IsActive: true},
	}
	items := runSmart(t, library, smartItem("卫龙面筋", "packaged", 50, 200, map[string]any{"type": "snack", "brand": "卫龙", "productName": "面筋"}))
	require.Equal(t, "packaged_family_inconsistent", items[0]["smart_match_status"])
	require.Equal(t, analysisEngineAIDirect, items[0]["nutrition_source"])
}

func TestSmartNutritionKeepsEstimatesWhenLibraryFails(t *testing.T) {
	library := newSmartLibrary()
	library.failAll = true
	resp := newSmartService(library).applySmartNutrition(context.Background(), map[string]any{"items": []map[string]any{smartItem("米饭", "熟制", 200, 260, nil)}})
	items := toItems(resp["items"])
	require.Equal(t, "lookup_error", items[0]["smart_match_status"])
	require.InDelta(t, 260, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.01)
	require.Len(t, resp["library_backfill_candidates"], 1)
}

func TestSmartCleanFoodName(t *testing.T) {
	require.Equal(t, "小香蕉", smartCleanFoodName("小香蕉（半根）"))
	require.Equal(t, "米饭", smartCleanFoodName("米饭(含加饭)"))
	require.Equal(t, "煮鸡蛋（去蛋黄）", smartCleanFoodName("煮鸡蛋（去蛋黄）"))
	require.Equal(t, "苹果", smartCleanFoodName("切块苹果"))
}

func TestSmartNutritionRejectsPackagedRowOfAnotherBrand(t *testing.T) {
	library := newSmartLibrary()
	library.packaged["牛奶巧克力"] = foodrecorddomain.PackagedFood{ID: "hershey", Brand: "好时", ProductName: "牛奶巧克力", DisplayName: "好时 牛奶巧克力 110g", KcalPer100g: 540, IsActive: true}
	items := runSmart(t, library, smartItem("德芙牛奶巧克力", "packaged", 14, 76, map[string]any{"type": "snack", "brand": "德芙", "productName": "牛奶巧克力"}))
	require.NotEqual(t, "packaged_food_library", items[0]["nutrition_source"])
	require.Nil(t, items[0]["packaged_food_id"])
}

func TestSmartNutritionSeasoningsDoNotBlockDishCoverage(t *testing.T) {
	dish := smartItem("番茄炒蛋", "熟制", 250, 260, map[string]any{
		"isComposite": true,
		"components": []any{
			map[string]any{"name": "番茄", "grams": 140},
			map[string]any{"name": "鸡蛋", "grams": 85},
			map[string]any{"name": "植物油", "grams": 10},
			map[string]any{"name": "盐", "grams": 2},
			map[string]any{"name": "葱花", "grams": 5},
			map[string]any{"name": "水", "grams": 8},
		},
	})
	items := runSmart(t, newSmartLibrary(), dish)
	require.Equal(t, "component_library", items[0]["nutrition_source"])
	require.False(t, smartIsSeasoning("洋葱"), "an onion is a vegetable, not a seasoning")
	require.True(t, smartIsSeasoning("生抽"))
}

type smartBatchLibrary struct {
	*smartLibrary
	batchCalls int
}

func (l *smartBatchLibrary) ResolveFoods(ctx context.Context, names []string) (map[string]*foodrecordrepo.ResolveResult, error) {
	l.batchCalls++
	out := map[string]*foodrecordrepo.ResolveResult{}
	for _, name := range names {
		result, _ := l.smartLibrary.ResolveFood(ctx, name)
		out[name] = result
	}
	l.smartLibrary.queries = nil
	return out, nil
}

func TestSmartNutritionPrefetchesAllNamesInOneBatch(t *testing.T) {
	library := &smartBatchLibrary{smartLibrary: newSmartLibrary()}
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureNutritionResolver(library)
	dish := smartItem("番茄炒蛋", "熟制", 250, 260, map[string]any{"isComposite": true, "components": []any{
		map[string]any{"name": "番茄", "grams": 150}, map[string]any{"name": "鸡蛋", "grams": 90}, map[string]any{"name": "植物油", "grams": 10},
	}})
	resp := s.applySmartNutrition(context.Background(), map[string]any{"items": []map[string]any{smartItem("米饭", "熟制", 200, 260, nil), dish}})
	items := toItems(resp["items"])
	require.Equal(t, 1, library.batchCalls)
	require.Empty(t, library.smartLibrary.queries, "matching must not fall back to per-name queries")
	require.Equal(t, "白米饭", items[0]["matched_food_name"])
	require.Equal(t, "component_library", items[1]["nutrition_source"])
}

func TestSmartPromptPutsComponentsAfterWeightAndNutrients(t *testing.T) {
	prompt := buildPrompt(AnalyzeInput{AnalysisEngine: analysisEngineSmart}, nil, "standard")
	weight := strings.Index(prompt, `"estimatedWeightGrams":0`)
	nutrients := strings.Index(prompt, `"nutrients":{`)
	components := strings.Index(prompt, `"components":[]`)
	require.True(t, weight >= 0 && nutrients > weight && components > nutrients, "the split must not lead the weight estimate")
	require.Contains(t, prompt, `"components":[],"oilVisibility":""}]`)
}

func TestSmartDetectsBrandInsideItemName(t *testing.T) {
	keys := smartBuildBrandKeys([]string{"乐事（Lay's）", "金百味", "T.O.GETHER", "统一", "德芙"})
	brand, key := smartDetectBrand("乐事黄瓜味薯片", keys)
	require.Equal(t, "乐事（Lay's）", brand)
	require.Equal(t, "黄瓜味薯片", smartStripBrandKey("乐事黄瓜味薯片", key))
	brand, key = smartDetectBrand("T.O.GETHER 黑浓咖啡饮料", keys)
	require.Equal(t, "T.O.GETHER", brand)
	require.Equal(t, "黑浓咖啡饮料", smartStripBrandKey("T.O.GETHER 黑浓咖啡饮料", key))
	brand, _ = smartDetectBrand("统一鲜橙多橙汁饮料", keys)
	require.Equal(t, "统一", brand)
	brand, _ = smartDetectBrand("咸鸭蛋", keys)
	require.Empty(t, brand)
}

type smartBrandLibrary struct{ *smartLibrary }

func (smartBrandLibrary) ListPackagedBrands(context.Context) ([]string, error) {
	return []string{"德芙", "好时"}, nil
}

func TestSmartNutritionUsesBrandFromNameForPackagedFood(t *testing.T) {
	smartBrandIndex.mu.Lock()
	smartBrandIndex.loadedAt = time.Time{}
	smartBrandIndex.mu.Unlock()
	library := newSmartLibrary()
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "dove-milk", Brand: "德芙", ProductName: "丝滑牛奶巧克力", KcalPer100g: 542, ProteinPer100g: 6, CarbsPer100g: 56, FatPer100g: 32, IsActive: true},
		{ID: "hershey", Brand: "好时", ProductName: "牛奶巧克力", KcalPer100g: 520, IsActive: true},
	}
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureNutritionResolver(smartBrandLibrary{library})
	resp := s.applySmartNutrition(context.Background(), map[string]any{"items": []map[string]any{
		smartItem("德芙丝滑牛奶巧克力", "packaged", 14, 76, map[string]any{"type": "snack"}),
	}})
	item := toItems(resp["items"])[0]
	require.Equal(t, "德芙", item["brand"])
	require.Equal(t, "dove-milk", item["packaged_food_id"])
	require.InDelta(t, 14, numberFromAny(item["estimatedWeightGrams"]), 0.01, "the library never changes the portion weight")
}
