package service

import (
	"context"
	"fmt"
	"log/slog"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
)

// ApplyPrecisionNutrition shares the ordinary nutrition engines. Precision
// weight estimation must not silently force a different nutrition policy.
func (s *AnalyzeService) ApplyPrecisionNutrition(ctx context.Context, items []map[string]any, input AnalyzeInput) ([]map[string]any, error) {
	engine := normalizeAnalysisEngine(input.AnalysisEngine, precisionExecutionMode, input.Text != "")
	input.AnalysisEngine = engine
	contextText := fullNutritionContext(input)
	prepared := make([]map[string]any, len(items))
	candidates := []UnresolvedNutritionCandidate{}
	for index, item := range items {
		prepared[index] = copyAnyMap(item)
		if nutritionWeightFromItem(item) <= 0 {
			return nil, fmt.Errorf("精准模式食物重量无效，请重新分析")
		}
		// Weight-only precision models have no independent nutrition yet. Build
		// it from the full portion context before considering any library rows.
		if analysisEngineProducesNutrition(engine) && len(mapFromAny(item["nutrients"])) == 0 {
			candidates = append(candidates, nutritionFallbackForItem(index, item, stringFromAny(item["name"])))
		}
	}
	if len(candidates) > 0 {
		rows, err := s.estimateNutritionWithFallback(ctx, candidates, contextText)
		if err != nil {
			logger.Error(ctx, "精准模式独立营养估算失败", err, slog.Int("item_count", len(candidates)))
			return nil, fmt.Errorf("精准模式营养估算未完成，请重试: %w", err)
		}
		for _, candidate := range candidates {
			unit := copyAnyMap(rows[candidate.Index])
			if len(unit) == 0 {
				return nil, fmt.Errorf("精准模式营养估算缺少有效结果，请重试")
			}
			popFallbackSource(unit, "deepseek_generated")
			for _, key := range []string{"calories", "protein", "carbs", "fat"} {
				if _, ok := finiteNutritionNumber(unit[key]); !ok {
					return nil, fmt.Errorf("精准模式营养估算字段无效，请重试")
				}
			}
			unit["calories"] = foodrecorddomain.MacroCalories(numberFromAny(unit["protein"]), numberFromAny(unit["carbs"]), numberFromAny(unit["fat"]))
			prepared[candidate.Index]["unit_nutrition_per_100g"] = unit
			prepared[candidate.Index]["nutrients"] = scaleGeneratedNutrition(unit, candidate.EstimatedWeightGrams)
		}
	}
	if analysisEngineProducesNutrition(engine) {
		if err := ValidateResolvedNutritionItems(prepared); err != nil {
			return nil, err
		}
	}
	resp := map[string]any{"items": prepared}
	switch engine {
	case analysisEngineLegacyDirect, analysisEngineAIDirect:
		resp = finalizeAIDirectNutrition(resp, engine)
	case analysisEngineAIThenDBExact:
		resp = s.applyAIThenExactDBNutrition(ctx, resp, input)
	case analysisEngineDBCandidates:
		resp = s.applyCandidateGuidedNutrition(ctx, resp, input)
	default:
		resp = s.applyDBFirstNutrition(ctx, resp, contextText)
	}
	resolved := toItems(resp["items"])
	if input.PreciseMicronutrients {
		var err error
		resolved, err = s.ApplyUserRequestedMicronutrientsToResolvedItems(ctx, resolved, contextText)
		if err != nil {
			return nil, err
		}
	}
	if err := ValidateResolvedNutritionItems(resolved); err != nil {
		return nil, err
	}
	logger.Info(ctx, "精准模式营养口径核验完成", slog.String("analysis_engine", engine), slog.Int("item_count", len(resolved)))
	return resolved, nil
}
