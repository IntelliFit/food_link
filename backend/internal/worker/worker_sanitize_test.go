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

func TestShouldRefinePrecisionWeights_TriggersForPythonConditions(t *testing.T) {
	cases := [][]map[string]any{
		{{"item_name": "白米饭", "uncertainty_level": "low"}},
		{{"item_name": "清炒冬瓜", "uncertainty_level": "high"}},
		{{"item_name": "苹果", "requires_reference": true}},
	}
	for _, items := range cases {
		if !shouldRefinePrecisionWeights(items) {
			t.Fatalf("expected refine trigger for %#v", items)
		}
	}
	if shouldRefinePrecisionWeights([]map[string]any{{"item_name": "鸡蛋", "uncertainty_level": "low"}}) {
		t.Fatalf("did not expect refine for simple low uncertainty item")
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
