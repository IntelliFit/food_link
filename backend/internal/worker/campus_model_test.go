package worker

import (
	"context"
	"testing"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"

	"github.com/stretchr/testify/require"
)

type campusBudgetRunner struct {
	fakeWorkerAnalyzeRunner
	campusImages    int
	campusTexts     int
	campusNutrition int
}

func (f *campusBudgetRunner) AnalyzeCampus(context.Context, string, analyzeservice.AnalyzeInput) (map[string]any, error) {
	f.campusImages++
	return map[string]any{}, nil
}

func (f *campusBudgetRunner) AnalyzeCampusText(context.Context, string, analyzeservice.AnalyzeInput) (map[string]any, error) {
	f.campusTexts++
	return map[string]any{}, nil
}

func (f *campusBudgetRunner) ApplyCampusPreciseMicronutrientsToResolvedItems(ctx context.Context, items []map[string]any, note string) ([]map[string]any, error) {
	f.campusNutrition++
	return f.fakeWorkerAnalyzeRunner.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, note)
}

func TestCampusBudgetWorkerRoutesOnlyCampusTasks(t *testing.T) {
	f := &campusBudgetRunner{}
	r := &Runner{analyze: f}
	task := &domain.AnalysisTask{UserID: "system-user", Payload: map[string]any{"public_food_source_type": "campus_public_food"}}
	input := analyzeservice.AnalyzeInput{ModelName: "original-model"}
	_, err := r.analyzeWithCampusBudget(context.Background(), task, input, false)
	require.NoError(t, err)
	_, err = r.analyzeWithCampusBudget(context.Background(), task, input, true)
	require.NoError(t, err)
	require.Equal(t, 1, f.campusImages)
	require.Equal(t, 1, f.campusTexts)
	task.Payload = map[string]any{}
	_, err = r.analyzeWithCampusBudget(context.Background(), task, input, true)
	require.NoError(t, err)
	require.Equal(t, "original-model", f.input.ModelName)
	require.Equal(t, 1, f.campusTexts)
}

func TestCampusBudgetWorkerUsesDedicatedNutritionMethod(t *testing.T) {
	f := &campusBudgetRunner{}
	r := &Runner{analyze: f}
	task := &domain.AnalysisTask{ID: "campus-test", Payload: map[string]any{"public_food_source_type": "campus_public_food", "micronutrient_analysis_required": true}}
	result := map[string]any{"items": []any{map[string]any{"name": "熟米饭", "nutrients": map[string]any{"calories": 194.0, "protein": 4.0, "carbs": 40.0, "fat": 2.0}}}}
	require.NoError(t, r.enrichCampusPreciseMicronutrients(context.Background(), task, result))
	require.Equal(t, 1, f.campusNutrition)
	task.Payload = map[string]any{}
	require.NoError(t, r.enrichCampusPreciseMicronutrients(context.Background(), task, result))
	require.Equal(t, 1, f.campusNutrition)
}
