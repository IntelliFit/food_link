package worker

import (
	"context"
	"errors"
	"testing"

	"food_link/backend/internal/analyze/domain"
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

// 与真实服务一致：渠道回答先过调用方给的校验，不合格就当作这次调用失败。
func (f *reestimateRunner) RunPrecisionJSONWithImagesValidated(_ context.Context, sourceType, prompt string, imageURLs []string, _ string, _ float64, validate func(map[string]any) error) (map[string]any, error) {
	f.calls++
	f.sourceType, f.prompt, f.images = sourceType, prompt, imageURLs
	if f.err != nil {
		return nil, f.err
	}
	if err := validate(f.result); err != nil {
		return nil, err
	}
	return f.result, nil
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

	items, disputes, _, err := runner.reestimateCorrectionItems(context.Background(), input, "qwen3.8-flash")
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
	items, _, _, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{CorrectionItems: correction}, "")
	require.NoError(t, err)
	require.Zero(t, analyze.calls, "文字记录没有照片，只改重量时不调用模型")
	require.Equal(t, 250.0, items[1]["weight"])

	analyze = &reestimateRunner{err: errors.New("upstream timeout")}
	items, _, _, err = (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{ImageURL: "https://img.example/meal.jpg", CorrectionItems: correction}, "")
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

	items, disputes, _, err := runner.reestimateCorrectionItems(context.Background(), input, "")
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
			_, _, _, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{CorrectionItems: correction}, "")
			require.ErrorContains(t, err, "没能重新估算「驴肉馄饨」的营养")
			require.Equal(t, "text", analyze.sourceType, "没有照片时按菜名和说明估营养")
		})
	}
}

func TestReestimateCorrectionRecordsUserLabelValuesForReview(t *testing.T) {
	previous, correction := donkeyMeal()
	correction[1]["correctionCalories"] = 502.0
	analyze := &reestimateRunner{}
	_, disputes, _, err := (&Runner{analyze: analyze}).reestimateCorrectionItems(context.Background(), analyzeservice.AnalyzeInput{PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}, "")
	require.NoError(t, err)
	require.Zero(t, analyze.calls)
	require.Len(t, disputes, 1)
	require.Equal(t, "user_value", disputes[0]["kind"])
	require.Equal(t, map[string]any{"calories": 502.0}, disputes[0]["values"])
	require.Equal(t, "food-1", disputes[0]["matched_food_id"])
}

// 线上实例：均衡路由用“带菜名和重量的识别清单”的规则检查重估回答，两个渠道的正常回答都被判无效。
func TestCorrectionReestimateValidatorJudgesTheReestimateAnswerShape(t *testing.T) {
	_, correction := donkeyMeal()
	weightOnly := []correctionReestimateTarget{{index: 1, weight: true}}
	nutritionOnly := []correctionReestimateTarget{{index: 1, nutrition: true}}
	both := []correctionReestimateTarget{{index: 0, weight: true}, {index: 1, weight: true, nutrition: true}}
	rows := func(list ...map[string]any) map[string]any {
		out := make([]any, len(list))
		for index, row := range list {
			out[index] = row
		}
		return map[string]any{"items": out}
	}
	cases := []struct {
		name     string
		targets  []correctionReestimateTarget
		hasImage bool
		answer   map[string]any
		valid    bool
	}{
		{"只重估重量", weightOnly, true, rows(map[string]any{"index": 1.0, "weight_grams": 260.0, "reason": "约一半是汤"}), true},
		{"重量与原来相同也是有效回答", weightOnly, true, rows(map[string]any{"index": 1.0, "weight_grams": 400.0}), true},
		{"只重估营养", nutritionOnly, true, rows(map[string]any{"index": 1.0, "calories": 60.0, "protein": 4.0, "carbs": 2.0, "fat": 3.0}), true},
		{"没有照片时不要求重量", weightOnly, false, rows(), true},
		{"两道菜都答了", both, true, rows(map[string]any{"index": 0.0, "weight_grams": 200.0}, map[string]any{"index": 1.0, "weight_grams": 300.0, "protein": 20.0, "carbs": 50.0, "fat": 15.0}), true},
		{"服务商通知不是回答", weightOnly, true, map[string]any{"message": "this model has been retired"}, false},
		{"空清单", weightOnly, true, rows(), false},
		{"答的不是要重估的那道菜", weightOnly, true, rows(map[string]any{"index": 0.0, "weight_grams": 200.0}), false},
		{"重量无效", weightOnly, true, rows(map[string]any{"index": 1.0, "weight_grams": 0.0}), false},
		{"要营养却只给了重量", nutritionOnly, true, rows(map[string]any{"index": 1.0, "weight_grams": 300.0}), false},
		{"营养超过重量", nutritionOnly, true, rows(map[string]any{"index": 1.0, "protein": 200.0, "carbs": 200.0, "fat": 100.0}), false},
		{"两道菜只答了一道", both, true, rows(map[string]any{"index": 0.0, "weight_grams": 200.0}), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := correctionReestimateValidator(correction, tc.targets, tc.hasImage)(tc.answer)
			if tc.valid {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, analyzeservice.ErrUnusableVisionAnswer)
		})
	}
}

// plannedCorrectionRunner 模拟“理解说明”这一步给出的计划（真实环境由文字模型完成），看图一步沿用 reestimateRunner。
type plannedCorrectionRunner struct {
	reestimateRunner
	plan func(items []map[string]any)
}

func (f *plannedCorrectionRunner) ResolveCorrectionInstructions(_ context.Context, _ string, input analyzeservice.AnalyzeInput) ([]map[string]any, error) {
	items := make([]map[string]any, len(input.CorrectionItems))
	for index, item := range input.CorrectionItems {
		items[index] = copyAnyMap(item)
	}
	f.plan(items)
	return items, nil
}

// 线上任务 aea18113（2026-11-26）：卤肉夹饼 + 驴肉清汤（上一轮生成了 31.5 克蛋白质）。
func brothCorrectionTask(note string) (*domain.AnalysisTask, []any) {
	previous := []any{
		map[string]any{"itemId": 1.0, "name": "卤肉夹饼", "estimatedWeightGrams": 210.0, "intakeRatio": 100.0, "intakeGrams": 210.0, "nutrition_source": "ai_direct",
			"nutrients": map[string]any{"calories": 520.0, "protein": 22.0, "carbs": 66.0, "fat": 17.0}},
		map[string]any{"itemId": 2.0, "name": "驴肉清汤", "estimatedWeightGrams": 420.0, "intakeRatio": 100.0, "intakeGrams": 420.0, "nutrition_source": "qwen_generated",
			"nutrients": map[string]any{"calories": 196.56, "protein": 31.5, "carbs": 6.3, "fat": 5.04, "sodiumMg": 840.0}},
	}
	rows := make([]any, len(previous))
	for index, raw := range previous {
		row := copyAnyMap(raw.(map[string]any))
		row["sourceItemId"], row["sourceName"], row["weight"] = row["itemId"], row["name"], row["estimatedWeightGrams"]
		row["nameEdited"], row["weightEdited"], row["nutritionEdited"] = false, false, false
		rows[index] = row
	}
	return &domain.AnalysisTask{ID: "task-broth", UserID: "user-1", TaskType: "food", ImagePaths: []string{"https://img.example/meal.jpg"}, Payload: map[string]any{
		"additionalContext": note, "is_correction": true, "previousResult": map[string]any{"items": previous}, "correctionItems": rows,
	}}, previous
}

func flagSoupPortion(items []map[string]any) {
	items[1][analyzeservice.CorrectionReestimateWeightKey] = true
	items[1][analyzeservice.CorrectionHintKey] = "汤没喝完"
}

// 线上实例：只要求对照照片重估汤的分量，计划没有给新分量；看图失败后什么都没改，
// 用户却被告知“请在纠错清单中填写需要修改的食物名称或重量”。
func TestResolveCorrectionTaskSaysSoWhenPhotoFailsAndNothingChanged(t *testing.T) {
	task, _ := brothCorrectionTask("汤没喝完")
	analyze := &plannedCorrectionRunner{plan: flagSoupPortion}
	analyze.err = errors.New("Gemini 渠道调度达到总截止时间")

	_, err := (&Runner{analyze: analyze}).resolveCorrectionTask(context.Background(), task, "", nil)
	require.ErrorContains(t, err, "没能对照照片重新估算「驴肉清汤」的分量")
	require.ErrorContains(t, err, "稍后重试")
	require.NotContains(t, err.Error(), "未应用任何更正")

	// 同一份提交，看图成功时按照片结果处理。
	analyze = &plannedCorrectionRunner{plan: flagSoupPortion}
	analyze.result = map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": 210.0}}}
	outcome, err := (&Runner{analyze: analyze}).resolveCorrectionTask(context.Background(), task, "", nil)
	require.NoError(t, err)
	soup := extractItems(outcome.result["items"])[1]
	require.Equal(t, 210.0, soup["estimatedWeightGrams"])
	require.Equal(t, 15.75, mapFromAny(soup["nutrients"])["protein"], "营养按新分量缩放")
}

// 看图失败不能连带丢掉用户这次的其他修改。
func TestResolveCorrectionTaskKeepsOtherEditsWhenPhotoFails(t *testing.T) {
	task, previous := brothCorrectionTask("汤没喝完，夹饼是150克")
	analyze := &plannedCorrectionRunner{plan: func(items []map[string]any) {
		flagSoupPortion(items)
		items[0]["weight"], items[0]["estimatedWeightGrams"], items[0]["weightEdited"] = 150.0, 150.0, true
	}}
	analyze.err = errors.New("Gemini 渠道调度达到总截止时间")

	outcome, err := (&Runner{analyze: analyze}).resolveCorrectionTask(context.Background(), task, "", nil)
	require.NoError(t, err, "夹饼的修改照常生效")
	items := extractItems(outcome.result["items"])
	require.Equal(t, 150.0, items[0]["estimatedWeightGrams"])
	require.Equal(t, previous[1], items[1], "没估出来的汤保持原样")
}

func TestCorrectionReestimateValidatorChecksNutritionAgainstTheNewWeight(t *testing.T) {
	_, correction := donkeyMeal()
	targets := []correctionReestimateTarget{{index: 1, weight: true, nutrition: true}}
	answer := func(weight float64) map[string]any {
		return map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": weight, "protein": 150.0, "carbs": 200.0, "fat": 100.0}}}
	}
	validate := correctionReestimateValidator(correction, targets, true)
	require.NoError(t, validate(answer(600)), "三大营养素 450 克不超过重估后的 600 克（计划里的旧分量是 400 克）")
	require.ErrorIs(t, validate(answer(300)), analyzeservice.ErrUnusableVisionAnswer, "超过重估后的分量")
	require.Equal(t, 400.0, correction[1]["weight"], "校验不改写清单")
}

// 线上实例（2026-11-26，任务 aea18113）整条流程：卤肉夹饼 + 驴肉清汤（上一轮生成了 31.5 克蛋白质），
// 用户说“驴肉清汤里面没有肉，纯是汤”。照片重估的回答只有序号和营养数值，必须被采用。
func TestResolveCorrectionTaskAppliesCompositionDisputeFromPhoto(t *testing.T) {
	task, previous := brothCorrectionTask("驴肉清汤里面没有肉，纯是汤")
	// 理解说明这一步对这句话应给出的计划：质疑第 2 项的营养，不动分量。
	analyze := &plannedCorrectionRunner{plan: func(items []map[string]any) {
		items[1][analyzeservice.CorrectionDisputeNutritionKey] = true
		items[1][analyzeservice.CorrectionHintKey] = "里面没有肉，纯是汤"
	}}
	analyze.result = map[string]any{"items": []any{map[string]any{"index": 1.0, "calories": 25.0, "protein": 2.5, "carbs": 1.0, "fat": 1.2, "fiber": 0.0, "reason": "清汤没有肉"}}}

	outcome, err := (&Runner{analyze: analyze}).resolveCorrectionTask(context.Background(), task, "", nil)
	require.NoError(t, err)
	require.Equal(t, 1, analyze.calls)
	require.Equal(t, "image", analyze.sourceType)
	require.Contains(t, analyze.prompt, "index 1 驴肉清汤：重新估算这一份的营养总量。用户说明：里面没有肉，纯是汤")
	items := extractItems(outcome.result["items"])
	require.Len(t, items, 2)
	require.Equal(t, previous[0], items[0], "夹饼没有被提到，原样保留")
	soup := mapFromAny(items[1]["nutrients"])
	require.Equal(t, 420.0, items[1]["estimatedWeightGrams"], "说的是成分，分量不变")
	require.Equal(t, 2.5, soup["protein"])
	require.Equal(t, 24.8, soup["calories"], "热量由三大营养素折算：2.5*4+1*4+1.2*9")
	require.Equal(t, 840.0, soup["sodiumMg"], "没有重估的微量营养沿用原值")
	require.Len(t, outcome.disputes, 1)
	require.Equal(t, "里面没有肉，纯是汤", outcome.disputes[0]["hint"])
}
