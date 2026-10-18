package worker

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrecisionEstimateContractRejectsWrongMissingAndDuplicateFoods(t *testing.T) {
	planned := []map[string]any{
		{"item_key": "beef", "item_name": "牛肉锅", "foodState": "cooked", "weightBasis": "as_served"},
		{"item_key": "rice", "item_name": "白米饭"},
	}
	beef := map[string]any{"name": "牛肉锅", "estimatedWeightGrams": 800.0}
	rice := map[string]any{"name": "米饭", "estimatedWeightGrams": 180.0}
	for name, output := range map[string][]map[string]any{
		"missing":      {beef},
		"duplicate":    {beef, beef},
		"different":    {{"name": "羊肉锅", "estimatedWeightGrams": 800.0}, rice},
		"forged_key":   {{"item_key": "beef", "name": "羊肉锅", "estimatedWeightGrams": 800.0}, rice},
		"wrong_key":    {{"item_key": "rice", "name": "牛肉锅", "estimatedWeightGrams": 800.0}, rice},
		"state_change": {{"name": "牛肉锅", "foodState": "dry", "weightBasis": "dry", "estimatedWeightGrams": 800.0}, rice},
		"extra_food":   {beef, rice, {"name": "鸡肉", "estimatedWeightGrams": 100.0}},
		"no_weight":    {{"name": "牛肉锅"}, rice},
		"nan_weight":   {{"name": "牛肉锅", "estimatedWeightGrams": math.NaN()}, rice},
	} {
		t.Run(name, func(t *testing.T) {
			items, err := parsePrecisionEstimateItems(map[string]any{"items": output}, planned, nil)
			require.Error(t, err)
			require.Empty(t, items)
		})
	}

	items, err := parsePrecisionEstimateItems(map[string]any{"items": []map[string]any{rice, beef}}, planned, nil)
	require.NoError(t, err)
	require.Equal(t, "牛肉锅", items[0]["name"])
	require.Equal(t, "米饭", items[1]["name"])
}

func TestPrecisionEstimateContractKeepsKeysForRepeatedNamedFoods(t *testing.T) {
	planned := []map[string]any{{"item_key": "left", "item_name": "米饭"}, {"item_key": "right", "item_name": "米饭"}}
	items, err := parsePrecisionEstimateItems(map[string]any{"items": []map[string]any{
		{"item_key": "right", "name": "米饭", "estimatedWeightGrams": 200.0},
		{"item_key": "left", "name": "米饭", "estimatedWeightGrams": 100.0},
	}}, planned, nil)
	require.NoError(t, err)
	require.Equal(t, "left", items[0]["item_key"])
	require.Equal(t, 100.0, items[0]["estimatedWeightGrams"])

	_, err = parsePrecisionEstimateItems(map[string]any{"items": []map[string]any{
		{"name": "米饭", "estimatedWeightGrams": 100.0}, {"name": "米饭", "estimatedWeightGrams": 200.0},
	}}, planned, nil)
	require.Error(t, err, "identical names need stable keys to avoid ambiguous identity")
}

func TestPrecisionEstimateContractDoesNotTreatCandidatesAsConfirmedAliases(t *testing.T) {
	planned := []map[string]any{{"item_name": "牛肉", "candidate_names": []string{"牛肉", "羊肉"}}}
	_, err := parsePrecisionEstimateItems(map[string]any{"item": map[string]any{"name": "羊肉", "estimatedWeightGrams": 100.0}}, planned, nil)
	require.Error(t, err)
}

func TestPrecisionMetadataNeverBorrowsUnmatchedIdentity(t *testing.T) {
	items := attachPrecisionItemMetadata([]map[string]any{{"name": "羊肉锅", "estimatedWeightGrams": 800.0}}, []map[string]any{
		{"item_key": "beef", "item_name": "牛肉锅", "item_hint": "去骨牛肉", "foodState": "cooked"},
	})
	require.NotContains(t, items[0], "item_key")
	require.NotContains(t, items[0], "item_hint")
}

func TestPrecisionRefinementContractPreservesCompleteOriginalOnInvalidOutput(t *testing.T) {
	fallback := []map[string]any{
		{"name": "牛肉", "estimatedWeightGrams": 100.0}, {"name": "米饭", "estimatedWeightGrams": 180.0},
	}
	items, _, err := parsePrecisionRefinedItems(map[string]any{"items": []map[string]any{
		{"name": "羊肉", "estimatedWeightGrams": 120.0}, {"name": "米饭", "estimatedWeightGrams": 180.0},
	}}, fallback)
	require.Error(t, err)
	require.Equal(t, fallback, items)
}

func TestPrecisionEstimatePromptsKeepPlannedIdentityAndKeys(t *testing.T) {
	planned := []map[string]any{
		{"item_key": "beef", "item_name": "牛肉", "foodState": "cooked", "weightBasis": "as_served"},
		{"item_key": "rice", "item_name": "米饭", "foodState": "cooked", "weightBasis": "as_served"},
	}
	single, err := buildPrecisionItemEstimatePromptFromPayload("image", map[string]any{"items_to_estimate": planned[:1]}, "", "用户已确认牛肉", nil)
	require.NoError(t, err)
	multi := buildPrecisionItemEstimatePromptMulti("image", planned, "", "用户已确认牛肉", nil)
	refine := buildPrecisionWeightRefinePrompt(planned, "", "用户已确认牛肉", nil)
	for _, prompt := range []string{single, multi, refine} {
		require.Contains(t, prompt, "item_key")
		require.Contains(t, prompt, "beef")
		require.Contains(t, prompt, "恰好返回一次")
		require.Contains(t, prompt, "不得遗漏")
		require.NotContains(t, prompt, "可以把 name 修正")
		require.NotContains(t, prompt, "name 填更可能的主名称")
	}
	require.Contains(t, multi, `"item_key":"beef"`)
	require.Contains(t, multi, `"item_key":"rice"`)
	require.Contains(t, refine, `"name":"牛肉"`)
}
