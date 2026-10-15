package worker

import (
	"context"
	"testing"

	analyzeservice "food_link/backend/internal/analyze/service"

	"github.com/stretchr/testify/require"
)

type capturePrecisionNutritionRunner struct {
	fakeWorkerAnalyzeRunner
	items []map[string]any
}

func (f *capturePrecisionNutritionRunner) ApplyPrecisionNutrition(_ context.Context, items []map[string]any, input analyzeservice.AnalyzeInput) ([]map[string]any, error) {
	f.items, f.input = items, input
	return items, nil
}

func TestPrecisionNutritionPayloadPreservesPolicyAndMicronutrients(t *testing.T) {
	parent := map[string]any{
		"analysis_engine": "db_candidates_ai", "execution_mode": "strict", "precise_micronutrients": true,
	}
	child := map[string]any{"text": "鸡汤面加鸭腿", "additionalContext": "鸭腿自己去皮"}
	copyPrecisionPlanningPayload(parent, child)
	input := precisionNutritionInput(child)
	require.Equal(t, "db_candidates_ai", input.AnalysisEngine)
	require.True(t, input.PreciseMicronutrients)
	require.Equal(t, "鸡汤面加鸭腿", input.Text)
	require.Equal(t, "鸭腿自己去皮", input.AdditionalContext)
	require.Equal(t, "strict", child["execution_mode"])
}

func TestPrecisionPlannerPortionReachesNutritionBeforeLookup(t *testing.T) {
	planned := []map[string]any{{"item_name": "鸭腿", "foodState": "cooked", "weightBasis": "as_served", "item_hint": "去皮净肉，不含骨"}}
	parsed, err := parsePrecisionEstimateItems(map[string]any{"item": map[string]any{"name": "卤鸭腿", "estimatedWeightGrams": 95.0}}, planned, nil)
	require.NoError(t, err)
	analyze := &capturePrecisionNutritionRunner{}
	runner := &Runner{analyze: analyze}
	items, err := runner.resolvePrecisionNutrition(context.Background(), parsed, planned, map[string]any{"analysis_engine": "db_candidates_ai"})
	require.NoError(t, err)
	require.Equal(t, "db_candidates_ai", analyze.input.AnalysisEngine)
	require.Equal(t, "去皮净肉，不含骨", analyze.items[0]["item_hint"])
	require.Equal(t, "去皮净肉，不含骨", items[0]["item_hint"])
	require.Equal(t, "cooked", items[0]["foodState"])
	require.Equal(t, "as_served", items[0]["weightBasis"])
	require.Equal(t, 95.0, items[0]["estimatedWeightGrams"])
}
