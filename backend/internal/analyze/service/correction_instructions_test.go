package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveCorrectionInstructionsPreservesConfirmedMeal(t *testing.T) {
	for _, text := range []string{"这个是翘脚牛肉", "这是牛肉啊", "不是羊肉，是牛肉", "牛肉"} {
		t.Run(text, func(t *testing.T) {
			client := &mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "翘脚牛肉"}}}}
			svc := NewAnalyzeService(nil, nil, nil)
			svc.ConfigureDashScopeLLMClient(client)
			items := []map[string]any{
				{"itemId": 1, "sourceName": "羊肉锅", "name": "羊肉锅", "estimatedWeightGrams": 1500.0, "nameEdited": false, "nutritionEdited": true},
				{"itemId": 2, "name": "辣子鸡", "estimatedWeightGrams": 350.0, "nutrients": map[string]any{"calories": 880.0}},
				{"itemId": 3, "name": "米饭", "estimatedWeightGrams": 180.0},
			}
			resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: text, CorrectionItems: items})
			require.NoError(t, err)
			require.Equal(t, "翘脚牛肉", resolved[0]["name"])
			require.Equal(t, 1500.0, resolved[0]["estimatedWeightGrams"])
			require.Equal(t, false, resolved[0]["nutritionEdited"], "更名不得复用旧羊肉营养")
			require.Equal(t, items[1:], resolved[1:])
			require.Equal(t, "羊肉锅", items[0]["name"], "不能修改任务原始输入")
			require.Contains(t, client.prompt, text)
			require.NotContains(t, client.prompt, "880", "意图解析不发送旧营养值")
			require.Empty(t, client.imageURL)
		})
	}
}

func TestResolveCorrectionInstructionsSkipsGeneratedListSummary(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	items := []map[string]any{{"name": "牛肉锅", "weight": 1500.0, "nameEdited": true}}
	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "用户在列表中做了以下修改：将羊肉锅改为牛肉锅", CorrectionItems: items})
	require.NoError(t, err, "直接编辑清单不新增模型依赖")
	require.Equal(t, items, resolved)
	require.Equal(t, "这是牛肉啊", correctionInstructionText("这是牛肉啊\n用户在列表中做了以下修改：将米饭的重量改为200g"))
}

func TestCorrectionInstructionPlanRejectsUnsafeEdits(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "estimatedWeightGrams": 1500.0}, {"name": "辣子鸡", "estimatedWeightGrams": 350.0}}
	for _, test := range []struct {
		name string
		plan map[string]any
	}{
		{"歧义", map[string]any{"needs_clarification": true, "edits": []any{}}},
		{"缺少明确判断", map[string]any{"edits": []any{}}},
		{"无效目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 2.0, "name": "牛肉锅"}}}},
		{"小数目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.5, "name": "牛肉锅"}}}},
		{"重复目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅"}, map[string]any{"index": 0.0, "name": "鸡肉锅"}}}},
		{"零重量", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "weight_grams": 0.0}}}},
		{"空名称", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": ""}}}},
		{"越权营养", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅", "calories": 100.0}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := applyCorrectionInstructionPlan(test.plan, items, "这是牛肉啊")
			require.Error(t, err)
			require.Equal(t, "羊肉锅", items[0]["name"])
		})
	}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅", "weight_grams": 900.0}}}
	for _, locked := range []map[string]any{
		{"name": "鸡肉锅", "estimatedWeightGrams": 1500.0, "nameEdited": true},
		{"name": "羊肉锅", "estimatedWeightGrams": 800.0, "weightEdited": true},
	} {
		_, err := applyCorrectionInstructionPlan(plan, []map[string]any{locked}, "牛肉锅900克")
		require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "不覆盖用户直接编辑的字段")
	}
}

func TestCorrectionInstructionsKeepsCurrentTextAndNumericAuthority(t *testing.T) {
	text := "上一轮纠错上下文：米饭改为200g\n用户在列表中做了以下修改：将米饭改为200g\n原始文字记录：羊肉锅和米饭\n这是牛肉啊\n原始文字记录：羊肉锅和米饭"
	require.Equal(t, "这是牛肉啊", correctionInstructionText(text))
	original := "羊肉锅\n米饭180克"
	text = "上一轮纠错上下文：将米饭改200克\n原始文字记录：" + original + "\n这是牛肉啊\n原始文字记录：" + original
	require.Equal(t, "这是牛肉啊", correctionInstructionText(text, original), "完整剥离多行旧原文，不能把其中数字作为当前纠错")
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅", "weight_grams": 2200.0}}}
	_, err := applyCorrectionInstructionPlan(plan, items, "这是牛肉啊")
	require.Error(t, err, "模型不能为单纯改名擅改克数")
	plan["edits"] = []any{map[string]any{"index": 0.0, "name": "牛肉锅", "weight_grams": 1500.0}}
	resolved, err := applyCorrectionInstructionPlan(plan, items, "这是牛肉啊")
	require.NoError(t, err, "旧客户端仅有weight字段仍可保留原克数")
	require.Equal(t, 1500.0, resolved[0]["weight"])
	plan["edits"] = []any{map[string]any{"index": 0.0, "weight_grams": 60.0, "calories": 127.15}}
	resolved, err = applyCorrectionInstructionPlan(plan, items, "八喜60克，532千焦")
	require.NoError(t, err, "已有克数与千焦纠错继续支持")
	require.Equal(t, 60.0, resolved[0]["weight"])
	require.Equal(t, 127.15, resolved[0]["correctionCalories"])
	plan["edits"] = []any{map[string]any{"index": 0.0, "name": "牛肉锅", "weight_grams": 200.0}}
	_, err = applyCorrectionInstructionPlan(plan, []map[string]any{items[0], {"name": "米饭", "weight": 180.0}}, "羊肉锅是牛肉，米饭改200克")
	require.Error(t, err, "不能把米饭的明确200克套到牛肉锅")
}

func TestResolveCorrectionInstructionsDoesNotRetryAmbiguity(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": true, "edits": []any{}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	_, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "这个是牛肉", CorrectionItems: []map[string]any{{"name": "羊肉锅"}, {"name": "羊肉串"}}})
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear)
	require.Equal(t, 1, client.calls)
}

func TestCorrectionInstructionsRejectsPartiallyAppliedNumericRequests(t *testing.T) {
	items := []map[string]any{
		{"name": "羊肉锅", "weight": 1500.0},
		{"name": "米饭", "weight": 180.0, "nutrients": map[string]any{"calories": 234.0}},
	}
	plan := func(edits ...map[string]any) map[string]any {
		return map[string]any{"needs_clarification": false, "edits": edits}
	}
	_, err := applyCorrectionInstructionPlan(plan(map[string]any{"index": 0.0, "name": "牛肉锅"}), items, "羊肉锅改牛肉锅，米饭改200克")
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "不能用一次改名掩盖漏掉的明确重量")
	_, err = applyCorrectionInstructionPlan(plan(map[string]any{"index": 1.0, "weight_grams": 200.0}), items, "米饭200克，300千卡")
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "不能只改重量却漏掉用户明确热量")
	resolved, err := applyCorrectionInstructionPlan(plan(
		map[string]any{"index": 0.0, "name": "牛肉锅"},
		map[string]any{"index": 1.0, "weight_grams": 200.0, "calories": 300.0},
	), items, "羊肉锅改牛肉锅，米饭200克，300千卡")
	require.NoError(t, err)
	require.Equal(t, "牛肉锅", resolved[0]["name"])
	require.Equal(t, 200.0, resolved[1]["weight"])
	require.Equal(t, 300.0, resolved[1]["correctionCalories"])
	require.Equal(t, 180.0, items[1]["weight"], "失败或成功均不改写输入")

	// A satisfied energy request must remain explicit even when a later rename
	// invokes nutrition resolution and would otherwise replace old calories.
	resolved, err = applyCorrectionInstructionPlan(plan(map[string]any{"index": 1.0, "name": "杂粮饭"}), items, "米饭改为杂粮饭，保持234千卡")
	require.NoError(t, err)
	require.Equal(t, 234.0, resolved[1]["correctionCalories"])
}

func TestCorrectionInstructionsPreservesExplicitNutritionLockOnSpokenRename(t *testing.T) {
	items := []map[string]any{{
		"name": "羊肉锅", "weight": 1500.0, "nutritionEdited": true,
		"nutrients": map[string]any{"calories": 300.0, "protein": 20.0, "carbs": 25.0, "fat": 13.3},
	}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅"}}}
	resolved, err := applyCorrectionInstructionPlan(plan, items, "这是牛肉啊")
	require.NoError(t, err)
	require.True(t, resolved[0]["nutritionEdited"].(bool), "口语改名不得取消用户完整营养快照的编辑锁")
	require.Equal(t, items[0]["nutrients"], resolved[0]["nutrients"])
	_, err = applyCorrectionInstructionPlan(plan, items, "这是牛肉，改为150千卡")
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "即使模型漏掉冲突热量，也不能绕过用户编辑锁")
	plan["edits"] = []any{map[string]any{"index": 0.0, "name": "牛肉锅", "calories": 150.0}}
	_, err = applyCorrectionInstructionPlan(plan, items, "牛肉锅150千卡")
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear)
}

func TestCorrectionInstructionsRejectsInventedQuantitiesInsideName(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}}
	for _, name := range []string{"牛肉锅2200克", "牛肉锅（1500g）", "牛肉锅950kcal", "牛肉锅532千焦"} {
		t.Run(name, func(t *testing.T) {
			_, err := applyCorrectionInstructionPlan(map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": name}}}, items, "这是牛肉啊")
			require.Error(t, err, "不能绕过克数/热量字段把模型编造数字拼到名称里")
		})
	}
}

func TestCorrectionInstructionsNumericCoverageSkipsExplicitlyRejectedOldValues(t *testing.T) {
	items := []map[string]any{{"name": "米饭", "weight": 180.0}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "weight_grams": 100.0}}}
	for _, text := range []string{"米饭不是200克，是100克", "米饭200克不对，应该100克", "米饭原来200克，改成100克"} {
		resolved, err := applyCorrectionInstructionPlan(plan, items, text)
		require.NoError(t, err, text)
		require.Equal(t, 100.0, resolved[0]["weight"])
	}
}
