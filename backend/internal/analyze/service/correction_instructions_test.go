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

func TestCorrectionInstructionTextKeepsOnlyCurrentNote(t *testing.T) {
	text := "上一轮纠错上下文：米饭改为200g\n用户在列表中做了以下修改：将米饭改为200g\n原始文字记录：羊肉锅和米饭\n这是牛肉啊\n原始文字记录：羊肉锅和米饭"
	require.Equal(t, "这是牛肉啊", correctionInstructionText(text))
	original := "羊肉锅\n米饭180克"
	text = "上一轮纠错上下文：将米饭改200克\n原始文字记录：" + original + "\n这是牛肉啊\n原始文字记录：" + original
	require.Equal(t, "这是牛肉啊", correctionInstructionText(text, original), "完整剥离多行旧原文")
}

// 用户没给新克数、只说分量不对时，按模型估算的重量修改，不再要求数字出现在原话里。
func TestResolveCorrectionInstructionsAcceptsEstimatedWeightWithoutNumber(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 1.0, "weight_grams": 260.0}}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	items := []map[string]any{
		{"itemId": 1, "name": "驴肉火烧", "weight": 240.0},
		{"itemId": 2, "name": "驴肉馄饨", "weight": 400.0},
	}
	note := "这个驴肉馄饨应该没有400克，可食用的部分没有这么多"
	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: note, CorrectionItems: items})
	require.NoError(t, err)
	require.Equal(t, 260.0, resolved[1]["weight"])
	require.Equal(t, true, resolved[1]["weightEdited"])
	require.Equal(t, items[0], resolved[0])
	require.Equal(t, 400.0, items[1]["weight"], "不能修改任务原始输入")
	require.Contains(t, client.prompt, note)
	require.Contains(t, client.prompt, "填 reestimate_weight=true")
}

func TestCorrectionInstructionPlanAppliesNamesWeightsAndCalories(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}, {"name": "米饭", "weight": 180.0}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{
		map[string]any{"index": 0.0, "name": "牛肉锅"},
		map[string]any{"index": 1.0, "weight_grams": 100.0, "calories": 127.15},
	}}
	resolved, err := applyCorrectionInstructionPlan(plan, items)
	require.NoError(t, err)
	require.Equal(t, "牛肉锅", resolved[0]["name"])
	require.Equal(t, true, resolved[0]["nameEdited"])
	require.Equal(t, 1500.0, resolved[0]["weight"])
	require.Equal(t, 100.0, resolved[1]["weight"])
	require.Equal(t, 127.15, resolved[1]["correctionCalories"])
	require.Equal(t, 180.0, items[1]["weight"], "不改写输入")
}

func TestCorrectionInstructionPlanRemovesAndAddsFoods(t *testing.T) {
	items := []map[string]any{
		{"itemId": 1.0, "name": "羊肉锅", "weight": 1500.0},
		{"itemId": 2.0, "name": "辣子鸡", "weight": 350.0},
		{"itemId": 3.0, "name": "米饭", "weight": 180.0},
	}
	plan := map[string]any{
		"needs_clarification": false,
		"edits":               []any{map[string]any{"index": 0.0, "name": "牛肉锅"}},
		"remove":              []any{2.0},
		"add":                 []any{map[string]any{"name": "冰粉", "weight_grams": 200.0}, map[string]any{"name": "米饭", "weight_grams": 150.0}},
	}
	resolved, err := applyCorrectionInstructionPlan(plan, items)
	require.NoError(t, err)
	require.Len(t, resolved, 4)
	require.Equal(t, "牛肉锅", resolved[0]["name"])
	require.Equal(t, "辣子鸡", resolved[1]["name"])
	require.Equal(t, map[string]any{"itemId": 4, "name": "冰粉", "weight": 200.0, "estimatedWeightGrams": 200.0, "nameEdited": true, "weightEdited": true, "nutritionEdited": false}, resolved[2])
	require.Equal(t, 5, resolved[3]["itemId"], "新增项用新编号，不能按同名配对到被删的原米饭")

	_, err = applyCorrectionInstructionPlan(map[string]any{"needs_clarification": false, "edits": []any{}, "remove": []any{0.0, 1.0, 2.0}}, items)
	require.ErrorIs(t, err, ErrCorrectionLeavesNoFood)
}

func TestCorrectionInstructionPlanFlagsPhotoReestimateAndNutritionDispute(t *testing.T) {
	items := []map[string]any{
		{"itemId": 1.0, "name": "驴肉馄饨", "weight": 400.0},
		{"itemId": 2.0, "name": "红烧肉", "weight": 200.0},
		{"itemId": 3.0, "name": "米饭", "weight": 150.0, "weightEdited": true},
		{"itemId": 4.0, "name": "鸡腿", "weight": 120.0, "nutritionEdited": true, "nutrients": map[string]any{"calories": 250.0, "protein": 25.0, "carbs": 0.0, "fat": 16.0}},
	}
	plan := map[string]any{
		"needs_clarification": false,
		"edits": []any{
			map[string]any{"index": 0.0, "weight_grams": 250.0, "reestimate_weight": true, "hint": "可食用的部分没有这么多"},
			map[string]any{"index": 1.0, "dispute_nutrition": true, "hint": "油比一般多"},
			map[string]any{"index": 2.0, "reestimate_weight": true},
			map[string]any{"index": 3.0, "dispute_nutrition": true},
		},
		"add": []any{map[string]any{"name": "冰粉", "weight_grams": 200.0, "reestimate_weight": true}},
	}
	resolved, err := applyCorrectionInstructionPlan(plan, items)
	require.NoError(t, err)
	require.Equal(t, true, resolved[0][CorrectionReestimateWeightKey])
	require.Equal(t, 250.0, resolved[0]["weight"], "常识估计先作为没有照片时的结果")
	require.Equal(t, "可食用的部分没有这么多", resolved[0][CorrectionHintKey])
	require.Equal(t, true, resolved[1][CorrectionDisputeNutritionKey])
	require.Equal(t, "油比一般多", resolved[1][CorrectionHintKey])
	require.NotContains(t, resolved[2], CorrectionReestimateWeightKey, "用户在清单里改过的重量不再看图改回")
	require.NotContains(t, resolved[3], CorrectionDisputeNutritionKey, "用户手填的营养不再看图重估")
	require.Equal(t, true, resolved[4][CorrectionReestimateWeightKey], "新增且没给重量的菜对照照片估重")
	require.Equal(t, true, resolved[4]["weightEdited"])

	for _, bad := range []map[string]any{
		{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "reestimate_weight": "true"}}},
		{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "hint": 3.0}}},
		{"needs_clarification": false, "edits": []any{}, "add": []any{map[string]any{"name": "冰粉", "weight_grams": 200.0, "dispute_nutrition": true}}},
	} {
		_, err := applyCorrectionInstructionPlan(bad, items)
		var parseErr *LLMJSONParseError
		require.ErrorAs(t, err, &parseErr)
	}
}

func TestCorrectionInstructionPlanRejectsMalformedPlans(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "estimatedWeightGrams": 1500.0}, {"name": "辣子鸡", "estimatedWeightGrams": 350.0}}
	for _, test := range []struct {
		name string
		plan map[string]any
	}{
		{"缺少明确判断", map[string]any{"edits": []any{}}},
		{"缺少修改列表", map[string]any{"needs_clarification": false}},
		{"无效目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 2.0, "name": "牛肉锅"}}}},
		{"小数目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.5, "name": "牛肉锅"}}}},
		{"重复目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅"}, map[string]any{"index": 0.0, "name": "鸡肉锅"}}}},
		{"只有目标", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0}}}},
		{"未知字段", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "protein": 10.0}}}},
		{"零重量", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "weight_grams": 0.0}}}},
		{"空名称", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": ""}}}},
		{"零热量", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "calories": 0.0}}}},
		{"删除越界", map[string]any{"needs_clarification": false, "edits": []any{}, "remove": []any{5.0}}},
		{"删除又修改", map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅"}}, "remove": []any{0.0}}},
		{"新增缺重量", map[string]any{"needs_clarification": false, "edits": []any{}, "add": []any{map[string]any{"name": "冰粉"}}}},
		{"新增缺名称", map[string]any{"needs_clarification": false, "edits": []any{}, "add": []any{map[string]any{"weight_grams": 200.0}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := applyCorrectionInstructionPlan(test.plan, items)
			var parseErr *LLMJSONParseError
			require.ErrorAs(t, err, &parseErr)
			require.Equal(t, "羊肉锅", items[0]["name"])
		})
	}
	_, err := applyCorrectionInstructionPlan(map[string]any{"needs_clarification": true, "edits": []any{}}, items)
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear)
}

func TestResolveCorrectionInstructionsDoesNotRetryAmbiguity(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": true, "edits": []any{}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	_, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "这个是牛肉", CorrectionItems: []map[string]any{{"name": "羊肉锅"}, {"name": "羊肉串"}}})
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear)
	require.Equal(t, 1, client.calls)
}

func TestResolveCorrectionInstructionsGivesUserFacingMessageAfterInvalidPlans(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 2.0, "weight_grams": 0.0}}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}, {"name": "辣子鸡", "weight": 350.0}, {"name": "米饭", "weight": 180.0}}
	_, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "不是羊肉，是牛肉，米饭没吃", CorrectionItems: items})
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear)
	require.NotContains(t, err.Error(), "parse llm json")
	require.Greater(t, client.calls, 1, "格式无效仍先按原策略重试")
}

func TestCorrectionInstructionsPreservesExplicitNutritionLockOnSpokenRename(t *testing.T) {
	items := []map[string]any{{
		"name": "羊肉锅", "weight": 1500.0, "nutritionEdited": true,
		"nutrients": map[string]any{"calories": 300.0, "protein": 20.0, "carbs": 25.0, "fat": 13.3},
	}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "牛肉锅"}}}
	resolved, err := applyCorrectionInstructionPlan(plan, items)
	require.NoError(t, err)
	require.True(t, resolved[0]["nutritionEdited"].(bool), "口语改名不得取消用户完整营养快照的编辑锁")
	require.Equal(t, items[0]["nutrients"], resolved[0]["nutrients"])
}
