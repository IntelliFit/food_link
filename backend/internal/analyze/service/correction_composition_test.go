package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// 线上实例（2026-11-26）：“驴肉清汤里面没有肉，纯是汤”说的是成分，模型却标成看图重估重量，
// 重量不变、营养不变，这次纠错什么都没改成。
func TestCorrectionInstructionsTreatCompositionAsNutritionDispute(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{
		map[string]any{"index": 1.0, "dispute_nutrition": true, "hint": "里面没有肉，纯是汤"},
	}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	items := []map[string]any{
		{"itemId": 1.0, "name": "卤肉夹饼", "weight": 210.0, "nutritionEdited": false},
		{"itemId": 2.0, "name": "驴肉清汤", "weight": 420.0, "nutritionEdited": false},
	}

	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "驴肉清汤里面没有肉，纯是汤", CorrectionItems: items})
	require.NoError(t, err)
	require.Contains(t, client.prompt, "区分成分和分量", "提示词要求把“有什么、没有什么”与“吃了多少”分开")
	require.Contains(t, client.prompt, "“里面没有肉，纯是汤”")
	require.Equal(t, items[0], resolved[0])
	require.Equal(t, true, resolved[1][CorrectionDisputeNutritionKey])
	require.Equal(t, "里面没有肉，纯是汤", resolved[1][CorrectionHintKey])
	require.NotContains(t, resolved[1], CorrectionReestimateWeightKey)
	require.Equal(t, 420.0, resolved[1]["weight"])
	require.NotContains(t, resolved[1], "weightEdited")
}
