package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func chineseWeightTestItems() []map[string]any {
	return []map[string]any{
		{"itemId": 1, "name": "羊肉锅", "estimatedWeightGrams": 1500.0},
		{"itemId": 2, "name": "米饭", "estimatedWeightGrams": 180.0},
	}
}

func TestCorrectionInstructionsAcceptChineseSpokenWeights(t *testing.T) {
	for text, grams := range map[string]float64{
		"米饭只有二两": 100, "米饭两两": 100, "米饭半斤": 250, "米饭一斤": 500, "米饭三两半": 175,
	} {
		t.Run(text, func(t *testing.T) {
			parsed := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 1.0, "weight_grams": grams}}}
			resolved, err := applyCorrectionInstructionPlan(parsed, chineseWeightTestItems(), text)
			require.NoError(t, err, "口语中文重量也是用户明确给出的克数")
			require.Equal(t, grams, resolved[1]["weight"])
		})
	}
}

func TestCorrectionInstructionsChineseWeightRequiresActualStatement(t *testing.T) {
	parsed := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 1.0, "weight_grams": 50.0}}}
	_, err := applyCorrectionInstructionPlan(parsed, chineseWeightTestItems(), "米饭里还有一两个鸡蛋")
	require.Error(t, err, "“一两个鸡蛋”是数量，不是一两重量")
}

func TestNormalizeChineseWeightWords(t *testing.T) {
	cases := map[string]string{
		"米饭只有二两":  "米饭只有2两",
		"半斤米饭":    "0.5斤米饭",
		"两斤羊肉":    "2斤羊肉",
		"一两个鸡蛋":   "一两个鸡蛋",
		"米饭200克":  "米饭200克",
		"一公斤":     "1公斤",
		"三两半":     "3.5两",
		"这两个菜都不对": "这两个菜都不对",
	}
	for input, want := range cases {
		require.Equal(t, want, normalizeChineseWeightWords(input), input)
	}
}

func TestCorrectionInstructionsKilojouleRoundingWithinOneKcal(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}, {"name": "辣子鸡", "weight": 350.0}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 1.0, "calories": 502.0}}}
	resolved, err := applyCorrectionInstructionPlan(plan, items, "辣子鸡标签写的是2100千焦")
	require.NoError(t, err, "2100千焦÷4.184=501.9，模型取整为502千卡应接受")
	require.Equal(t, 502.0, resolved[1]["correctionCalories"])
	plan["edits"] = []any{map[string]any{"index": 1.0, "calories": 520.0}}
	_, err = applyCorrectionInstructionPlan(plan, items, "辣子鸡标签写的是2100千焦")
	require.Error(t, err, "偏差超过1千卡仍拒绝")
}

func TestCorrectionInstructionsBindNumberByUniqueDishForm(t *testing.T) {
	items := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}, {"name": "辣子鸡", "weight": 350.0}, {"name": "米饭", "weight": 180.0}}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "calories": 800.0}}}
	resolved, err := applyCorrectionInstructionPlan(plan, items, "这个锅其实只有800大卡")
	require.NoError(t, err, "“锅”只对应羊肉锅，可唯一绑定")
	require.Equal(t, 800.0, resolved[0]["correctionCalories"])

	twoPots := []map[string]any{{"name": "羊肉锅", "weight": 1500.0}, {"name": "鱼头锅", "weight": 900.0}}
	_, err = applyCorrectionInstructionPlan(plan, twoPots, "这个锅其实只有800大卡")
	require.Error(t, err, "两道锅时不能猜")
	_, err = applyCorrectionInstructionPlan(plan, items, "这个其实只有800大卡")
	require.Error(t, err, "没有任何菜名线索时不绑定")
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
