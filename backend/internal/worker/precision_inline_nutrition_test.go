package worker

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrecisionEstimatePromptsRequestInlineNutrition(t *testing.T) {
	single, err := buildPrecisionItemEstimatePromptFromPayload("image", map[string]any{"item_name": "熟米饭", "items_to_estimate": []any{map[string]any{"item_key": "rice", "item_name": "熟米饭"}}}, "", "", nil)
	require.NoError(t, err)
	multi, err := buildPrecisionItemEstimatePromptFromPayload("image", map[string]any{"items_to_estimate": []any{map[string]any{"item_key": "rice", "item_name": "熟米饭"}, map[string]any{"item_key": "egg", "item_name": "鸡蛋"}}}, "", "", nil)
	require.NoError(t, err)
	for label, prompt := range map[string]string{"single": single, "multi": multi} {
		require.Contains(t, prompt, "每个食物还必须输出 nutrients", label)
		require.Contains(t, prompt, `"vitaminB12Mcg"`, label)
		require.Less(t, strings.Index(prompt, "每个食物还必须输出 nutrients"), strings.Index(prompt, "- 仅返回 JSON。"), label)
	}
	require.Contains(t, single, `"nutrients": {"calories": 0`)
}

func TestParsePrecisionEstimateItemsKeepsCompleteInlineNutrition(t *testing.T) {
	planned := []map[string]any{{"item_key": "rice", "item_name": "熟米饭"}}
	parsed := map[string]any{"item": map[string]any{"item_key": "rice", "name": "熟米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 200.0,
		"nutrients": map[string]any{"calories": 232.0, "protein": 5.0, "carbs": 52.0, "fat": 0.6, "sodiumMg": 2.0}}}
	items, err := parsePrecisionEstimateItems(parsed, planned, nil)
	require.NoError(t, err)
	require.Equal(t, 232.0, mapFromAny(items[0]["nutrients"])["calories"])

	parsed["item"].(map[string]any)["nutrients"] = map[string]any{"calories": 232.0}
	items, err = parsePrecisionEstimateItems(parsed, planned, nil)
	require.NoError(t, err)
	require.Nil(t, items[0]["nutrients"], "missing macros fall back to the separate estimate")
}

func TestPrecisionEstimatePromptAddsRoutingFieldsOnlyForSmartEngine(t *testing.T) {
	payload := map[string]any{"item_name": "番茄炒蛋", "items_to_estimate": []any{map[string]any{"item_key": "dish", "item_name": "番茄炒蛋"}}}
	plain, err := buildPrecisionItemEstimatePromptFromPayload("image", payload, "", "", nil)
	require.NoError(t, err)
	require.NotContains(t, plain, "components")

	payload["analysis_engine"] = "smart"
	smart, err := buildPrecisionItemEstimatePromptFromPayload("image", payload, "", "", nil)
	require.NoError(t, err)
	require.Contains(t, smart, "components")
}

func TestParsePrecisionEstimateItemsKeepsSmartRoutingFields(t *testing.T) {
	planned := []map[string]any{{"item_key": "dish", "item_name": "番茄炒蛋"}}
	components := []any{map[string]any{"name": "番茄", "grams": 150.0}, map[string]any{"name": "鸡蛋", "grams": 90.0}, map[string]any{"name": "植物油", "grams": 10.0}}
	parsed := map[string]any{"item": map[string]any{"item_key": "dish", "name": "番茄炒蛋", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 250.0,
		"isComposite": true, "components": components, "brand": ""}}
	items, err := parsePrecisionEstimateItems(parsed, planned, nil)
	require.NoError(t, err)
	require.Equal(t, components, items[0]["components"])
	require.Equal(t, true, items[0]["isComposite"])
}
