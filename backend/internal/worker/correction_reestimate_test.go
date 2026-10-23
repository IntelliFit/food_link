package worker

import (
	"context"
	"errors"
	"testing"

	analyzeservice "food_link/backend/internal/analyze/service"

	"github.com/stretchr/testify/require"
)

type reestimateRunner struct {
	fakeWorkerAnalyzeRunner
	result     map[string]any
	err        error
	calls      int
	sourceType string
	prompt     string
	images     []string
}

func (f *reestimateRunner) RunPrecisionJSONWithImagesTemperatureNoFallback(_ context.Context, sourceType, prompt string, imageURLs []string, _ string, _ float64) (map[string]any, error) {
	f.calls++
	f.sourceType, f.prompt, f.images = sourceType, prompt, imageURLs
	return f.result, f.err
}

func donkeyMeal() ([]map[string]any, []map[string]any) {
	previous := []map[string]any{
		{"itemId": 1, "name": "驴肉火烧", "estimatedWeightGrams": 240.0, "nutrients": map[string]any{"calories": 620.0, "protein": 28.0, "carbs": 70.0, "fat": 25.0}},
		{"itemId": 2, "name": "驴肉馄饨", "estimatedWeightGrams": 400.0, "matched_food_id": "food-1", "nutrition_source": "standard_library",
			"nutrients": map[string]any{"calories": 600.0, "protein": 30.0, "carbs": 70.0, "fat": 22.0, "sodiumMg": 1200.0}},
	}
	correction := make([]map[string]any, len(previous))
	for index, old := range previous {
		correction[index] = copyAnyMap(old)
		correction[index]["sourceItemId"], correction[index]["sourceName"] = old["itemId"], old["name"]
		correction[index]["weight"] = old["estimatedWeightGrams"]
		correction[index]["nameEdited"], correction[index]["weightEdited"], correction[index]["nutritionEdited"] = false, false, false
	}
	return previous, correction
}

func TestReestimateCorrectionWeightFromPhoto(t *testing.T) {
	previous, correction := donkeyMeal()
	// 纠错计划按常识给出的 250 克只在没有照片时使用。
	correction[1]["weight"], correction[1]["estimatedWeightGrams"], correction[1]["weightEdited"] = 250.0, 250.0, true
	correction[1][analyzeservice.CorrectionReestimateWeightKey] = true
	correction[1][analyzeservice.CorrectionHintKey] = "可食用的部分没有这么多"
	analyze := &reestimateRunner{result: map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": 260.0, "reason": "约三分之一是汤"}}}}
	runner := &Runner{analyze: analyze}
	input := analyzeservice.AnalyzeInput{ImageURLs: []string{"https://img.example/meal.jpg"}, PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}

	items, disputes, err := runner.reestimateCorrectionItems(context.Background(), input, "qwen3.8-flash")
	require.NoError(t, err)
	require.Empty(t, disputes)
	require.Equal(t, 1, analyze.calls)
	require.Equal(t, "image", analyze.sourceType)
	require.Equal(t, []string{"https://img.example/meal.jpg"}, analyze.images)
	require.Contains(t, analyze.prompt, "可食用的部分没有这么多")
	require.Contains(t, analyze.prompt, "index 1 驴肉馄饨：重新估算可食部分重量")
	require.NotContains(t, analyze.prompt, "index 0 驴肉火烧：", "未标出的菜不重估")
	require.Equal(t, 260.0, items[1]["weight"])
	require.NotContains(t, items[1], analyzeservice.CorrectionReestimateWeightKey, "标记不进入结果")
	require.Equal(t, 250.0, correction[1]["weight"], "不改写输入")

	input.CorrectionItems = items
	result, err := runner.resolveScopedCorrection(context.Background(), "", input, nil)
	require.NoError(t, err)
	out := extractItems(result["items"])
	require.Equal(t, previous[0], out[0], "火烧不变")
	require.Equal(t, 260.0, out[1]["estimatedWeightGrams"])
	require.Equal(t, 390.0, mapFromAny(out[1]["nutrients"])["calories"], "营养按新重量缩放")
}

func TestReestimateCorrectionKeepsPlanWeightWithoutPhotoOrOnFailure(t *testing.T) {
	_, correction := donkeyMeal()
	correction[1]["weight"], correction[1][analyzeservice.CorrectionReestimateWeightKey] = 250.0, true

	analyze := &reestimateRunner{}
	items, _, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{CorrectionItems: correction}, "")
	require.NoError(t, err)
	require.Zero(t, analyze.calls, "文字记录没有照片，只改重量时不调用模型")
	require.Equal(t, 250.0, items[1]["weight"])

	analyze = &reestimateRunner{err: errors.New("upstream timeout")}
	items, _, err = (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{ImageURL: "https://img.example/meal.jpg", CorrectionItems: correction}, "")
	require.NoError(t, err, "看图失败时重量退回纠错计划的估计")
	require.Equal(t, 1, analyze.calls)
	require.Equal(t, 250.0, items[1]["weight"])
}

func TestReestimateCorrectionDisputedNutritionFromPhoto(t *testing.T) {
	previous, correction := donkeyMeal()
	correction[1][analyzeservice.CorrectionDisputeNutritionKey] = true
	correction[1][analyzeservice.CorrectionHintKey] = "油比一般多"
	analyze := &reestimateRunner{result: map[string]any{"items": []any{map[string]any{"index": 1.0, "protein": 30.0, "carbs": 70.0, "fat": 40.0, "fiber": 2.0}}}}
	runner := &Runner{analyze: analyze}
	input := analyzeservice.AnalyzeInput{ImageURLs: []string{"https://img.example/meal.jpg"}, PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}

	items, disputes, err := runner.reestimateCorrectionItems(context.Background(), input, "")
	require.NoError(t, err)
	require.Contains(t, analyze.prompt, "油比一般多")
	require.Contains(t, analyze.prompt, "不要照搬常见数据库的值")
	nutrients := mapFromAny(items[1]["nutrients"])
	require.Equal(t, 760.0, nutrients["calories"], "热量由三大营养素折算：30*4+70*4+40*9")
	require.Equal(t, 40.0, nutrients["fat"])
	require.Equal(t, 1200.0, nutrients["sodiumMg"], "微量营养沿用原记录")
	require.Equal(t, true, items[1]["nutritionEdited"])
	require.Len(t, disputes, 1)
	require.Equal(t, "image_reestimate", disputes[0]["kind"])
	require.Equal(t, "food-1", disputes[0]["matched_food_id"], "审核时能找到被质疑的库条目")
	require.Equal(t, "油比一般多", disputes[0]["hint"])

	input.CorrectionItems = items
	result, err := runner.resolveScopedCorrection(context.Background(), "", input, nil)
	require.NoError(t, err)
	out := extractItems(result["items"])
	require.Equal(t, 760.0, mapFromAny(out[1]["nutrients"])["calories"])
	require.Equal(t, 400.0, out[1]["estimatedWeightGrams"])
	require.Equal(t, previous[0], out[0])
}

func TestReestimateCorrectionDisputedNutritionFailsLoudly(t *testing.T) {
	_, correction := donkeyMeal()
	correction[1][analyzeservice.CorrectionDisputeNutritionKey] = true
	for name, analyze := range map[string]*reestimateRunner{
		"模型失败":   {err: errors.New("upstream timeout")},
		"超过重量":   {result: map[string]any{"items": []any{map[string]any{"index": 1.0, "protein": 200.0, "carbs": 200.0, "fat": 100.0}}}},
		"缺少营养":   {result: map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": 300.0}}}},
		"没有对应的菜": {result: map[string]any{"items": []any{map[string]any{"index": 0.0, "protein": 10.0, "carbs": 10.0, "fat": 10.0}}}},
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{CorrectionItems: correction}, "")
			require.ErrorContains(t, err, "没能重新估算「驴肉馄饨」的营养")
			require.Equal(t, "text", analyze.sourceType, "没有照片时按菜名和说明估营养")
		})
	}
}

func TestReestimateCorrectionRecordsUserLabelValuesForReview(t *testing.T) {
	previous, correction := donkeyMeal()
	correction[1]["correctionCalories"] = 502.0
	analyze := &reestimateRunner{}
	_, disputes, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}, "")
	require.NoError(t, err)
	require.Zero(t, analyze.calls)
	require.Len(t, disputes, 1)
	require.Equal(t, "user_value", disputes[0]["kind"])
	require.Equal(t, map[string]any{"calories": 502.0}, disputes[0]["values"])
	require.Equal(t, "food-1", disputes[0]["matched_food_id"])
}
