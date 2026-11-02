package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type photoPlanCall struct {
	prompt string
	images []string
}

func stubCorrectionPhotoPlan(t *testing.T, results []map[string]any, err error) *[]photoPlanCall {
	t.Helper()
	calls := &[]photoPlanCall{}
	original := runCorrectionPhotoPlan
	runCorrectionPhotoPlan = func(_ *AnalyzeService, _ context.Context, prompt string, imageURLs []string, _ string) (map[string]any, error) {
		*calls = append(*calls, photoPlanCall{prompt: prompt, images: imageURLs})
		if err != nil {
			return nil, err
		}
		return results[min(len(*calls)-1, len(results)-1)], nil
	}
	t.Cleanup(func() { runCorrectionPhotoPlan = original })
	return calls
}

func photoPlanMeal() []map[string]any {
	return []map[string]any{
		{"itemId": 1.0, "name": "米饭", "weight": 180.0},
		{"itemId": 2.0, "name": "番茄炒蛋", "weight": 200.0},
		{"itemId": 3.0, "name": "青菜", "weight": 150.0},
	}
}

// “漏了一样”没说是什么：只看文字无法确定，带上原照片后从照片里补上。
func TestResolveCorrectionInstructionsUsesPhotoWhenTextIsNotEnough(t *testing.T) {
	text := &mockLLMClient{result: map[string]any{"needs_clarification": true, "edits": []any{}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(text)
	calls := stubCorrectionPhotoPlan(t, []map[string]any{{
		"needs_clarification": false, "edits": []any{},
		"add": []any{map[string]any{"name": "红烧鸡腿", "weight_grams": 120.0}},
	}}, nil)
	note := "漏了一样食物"
	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "u1", AnalyzeInput{
		AdditionalContext: note, CorrectionItems: photoPlanMeal(), ImageURLs: []string{"https://img.example/meal.jpg"},
	})
	require.NoError(t, err)
	require.Len(t, resolved, 4)
	require.Equal(t, "红烧鸡腿", resolved[3]["name"])
	require.Equal(t, 120.0, resolved[3]["weight"])
	require.Len(t, *calls, 1)
	require.Equal(t, []string{"https://img.example/meal.jpg"}, (*calls)[0].images)
	require.Contains(t, (*calls)[0].prompt, "从照片里找出清单里还没有的食物")
	require.Contains(t, (*calls)[0].prompt, note)
	require.Contains(t, text.prompt, "系统会再结合原照片处理")
}

func TestResolveCorrectionInstructionsPhotoRetriesInvalidPlanOnce(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(&mockLLMClient{result: map[string]any{"needs_clarification": true, "edits": []any{}}})
	calls := stubCorrectionPhotoPlan(t, []map[string]any{
		{"needs_clarification": false, "edits": []any{map[string]any{"index": 9.0, "name": "鸡腿"}}},
		{"needs_clarification": false, "edits": []any{}, "remove": []any{2.0}},
	}, nil)
	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "u1", AnalyzeInput{
		AdditionalContext: "多识别了一样", CorrectionItems: photoPlanMeal(), ImageURL: "https://img.example/meal.jpg",
	})
	require.NoError(t, err)
	require.Len(t, *calls, 2)
	require.Len(t, resolved, 2)
	require.Equal(t, "番茄炒蛋", resolved[1]["name"])
}

func TestResolveCorrectionInstructionsPhotoFallbackFailures(t *testing.T) {
	newSvc := func() *AnalyzeService {
		svc := NewAnalyzeService(nil, nil, nil)
		svc.ConfigureDashScopeLLMClient(&mockLLMClient{result: map[string]any{"needs_clarification": true, "edits": []any{}}})
		return svc
	}
	input := AnalyzeInput{AdditionalContext: "漏了一样", CorrectionItems: photoPlanMeal(), ImageURLs: []string{"https://img.example/meal.jpg"}}

	stubCorrectionPhotoPlan(t, nil, errors.New("upstream timeout"))
	_, err := newSvc().ResolveCorrectionInstructions(context.Background(), "u1", input)
	require.ErrorIs(t, err, ErrCorrectionPhotoPlanUnavailable)

	stubCorrectionPhotoPlan(t, []map[string]any{{"needs_clarification": true, "edits": []any{}}}, nil)
	_, err = newSvc().ResolveCorrectionInstructions(context.Background(), "u1", input)
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "照片里也找不到时才请用户补充")

	calls := stubCorrectionPhotoPlan(t, []map[string]any{{"needs_clarification": false, "edits": []any{}}}, nil)
	input.ImageURLs = nil
	_, err = newSvc().ResolveCorrectionInstructions(context.Background(), "u1", input)
	require.ErrorIs(t, err, ErrCorrectionInstructionsUnclear, "文字记录没有照片，仍请用户写明")
	require.Empty(t, *calls)
}

func TestResolveCorrectionInstructionsDoesNotCallPhotoWhenTextSucceeds(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(&mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{},
		"add": []any{map[string]any{"name": "冰粉", "weight_grams": 200.0}}}})
	calls := stubCorrectionPhotoPlan(t, nil, errors.New("should not be called"))
	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "u1", AnalyzeInput{
		AdditionalContext: "还有一碗冰粉", CorrectionItems: photoPlanMeal(), ImageURLs: []string{"https://img.example/meal.jpg"},
	})
	require.NoError(t, err)
	require.Len(t, resolved, 4)
	require.Empty(t, *calls)
}
