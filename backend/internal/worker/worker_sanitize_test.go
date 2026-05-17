package worker

import (
	"errors"
	"strings"
	"testing"

	"food_link/backend/internal/analyze/domain"
)

func TestSanitizeTaskErrorMessage_HTML(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`ofoxai api error 405: <html><head><title>Ofox AI</title></head><body>home</body></html>`))
	if strings.Contains(msg, "<html") {
		t.Fatalf("html leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 服务返回了网页") {
		t.Fatalf("unexpected sanitized error: %s", msg)
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

func TestPrecisionPrompts_ForceFoodTypeCandidates(t *testing.T) {
	plan := buildPrecisionPlanPrompt("image", "图片输入", "", nil, nil)
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
