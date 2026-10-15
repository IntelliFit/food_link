package worker

import (
	"context"

	analyzeservice "food_link/backend/internal/analyze/service"
)

func (r *Runner) resolvePrecisionNutrition(ctx context.Context, items, plannedItems []map[string]any, payload map[string]any) ([]map[string]any, error) {
	// Constraints must reach the resolver before any database lookup.
	items = attachPrecisionItemMetadata(items, plannedItems)
	return r.analyze.ApplyPrecisionNutrition(ctx, items, precisionNutritionInput(payload))
}

func precisionNutritionInput(payload map[string]any) analyzeservice.AnalyzeInput {
	return analyzeservice.AnalyzeInput{
		Text: stringFromMap(payload, "text"), AdditionalContext: stringFromMap(payload, "additionalContext"),
		AnalysisEngine:        stringFromMap(payload, "analysis_engine"),
		PreciseMicronutrients: boolFromAny(payload["precise_micronutrients"]) || requiresPreciseCampusMicronutrients(payload),
	}
}
