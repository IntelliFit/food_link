package worker

import (
	"context"
	"testing"

	analyzeservice "food_link/backend/internal/analyze/service"

	"github.com/stretchr/testify/require"
)

type instructionTestClient struct{}

func (*instructionTestClient) Analyze(context.Context, string, string) (map[string]any, error) {
	return map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "name": "翘脚牛肉"}}}, nil
}

type instructionNutritionRunner struct {
	fakeWorkerAnalyzeRunner
	names []string
}

func (a *instructionNutritionRunner) ApplyDBFirstToItemsWithPreciseMicronutrients(ctx context.Context, items []map[string]any, _ string) ([]map[string]any, error) {
	for _, item := range items {
		a.names = append(a.names, firstNonEmptyString(item, "name"))
		// Fixed nutrition fixture; this is not a nutritional estimate of the meal.
		item["nutrients"] = map[string]any{"calories": 700.0, "protein": 80.0, "carbs": 5.0, "fat": 40.0}
	}
	return a.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, "")
}

func TestResolveScopedCorrectionSpokenRenameOnlyRecalculatesTarget(t *testing.T) {
	svc := analyzeservice.NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(&instructionTestClient{})
	for _, text := range []string{"这个是翘脚牛肉", "这是牛肉啊"} {
		t.Run(text, func(t *testing.T) {
			previous := []map[string]any{
				{"itemId": 1, "name": "羊肉锅", "estimatedWeightGrams": 1500.0, "nutrients": map[string]any{"calories": 950.0, "protein": 82.0, "carbs": 12.0, "fat": 65.0}},
				{"itemId": 2, "name": "辣子鸡", "estimatedWeightGrams": 350.0, "nutrients": map[string]any{"calories": 880.0, "protein": 65.0, "carbs": 15.0, "fat": 62.0}},
				{"itemId": 3, "name": "米饭", "estimatedWeightGrams": 180.0, "nutrients": map[string]any{"calories": 234.0, "protein": 4.5, "carbs": 51.0, "fat": 0.5}},
			}
			correction := make([]map[string]any, len(previous))
			for index, old := range previous {
				correction[index] = copyAnyMap(old)
				correction[index]["sourceItemId"], correction[index]["sourceName"] = old["itemId"], old["name"]
				correction[index]["weight"] = old["estimatedWeightGrams"]
				correction[index]["nameEdited"], correction[index]["weightEdited"], correction[index]["nutritionEdited"] = false, false, false
			}
			input := analyzeservice.AnalyzeInput{AdditionalContext: text, PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}
			var err error
			input.CorrectionItems, err = svc.ResolveCorrectionInstructions(context.Background(), "", input)
			require.NoError(t, err)
			analyze := &instructionNutritionRunner{}
			runner := &Runner{analyze: analyze}
			result, err := runner.resolveScopedCorrection(context.Background(), "", input, nil)
			require.NoError(t, err)
			items := extractItems(result["items"])
			require.Equal(t, []string{"翘脚牛肉"}, analyze.names)
			require.Equal(t, "翘脚牛肉", items[0]["name"])
			require.Equal(t, 1500.0, items[0]["estimatedWeightGrams"])
			require.Equal(t, 700.0, mapFromAny(items[0]["nutrients"])["calories"])
			require.Equal(t, previous[1:], items[1:], "辣子鸡和米饭包括重量、营养在内保持原值")
			require.Equal(t, "羊肉锅", previous[0]["name"], "历史输入不可被改写")
		})
	}
}

func TestResolveScopedCorrectionRejectsUnchangedResult(t *testing.T) {
	previous := map[string]any{"itemId": 1, "name": "羊肉锅", "estimatedWeightGrams": 1500.0, "nutrients": map[string]any{"calories": 950.0, "protein": 82.0, "carbs": 12.0, "fat": 65.0}}
	runner := &Runner{analyze: &fakeWorkerAnalyzeRunner{}}
	_, err := runner.resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		AdditionalContext: "这是牛肉啊", PreviousResult: map[string]any{"items": []any{previous}},
		CorrectionItems: []map[string]any{{"sourceItemId": 1, "name": "羊肉锅", "weight": 1500.0}},
	}, nil)
	require.ErrorContains(t, err, "未应用任何更正")
}
