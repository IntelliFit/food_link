package worker

import (
	"context"
	"fmt"
	"log/slog"
	"math"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/pkg/logger"
)

func (r *Runner) completeSingleItemCorrection(ctx context.Context, task *domain.AnalysisTask) error {
	indexValue, ok := floatFromAny(task.Payload["correction_target_index"])
	if !ok || indexValue != math.Trunc(indexValue) || indexValue < 0 || indexValue >= 100 {
		return fmt.Errorf("单项重算目标无效")
	}
	index := int(indexValue)
	previous := mapFromAny(task.Payload["previousResult"])
	items, name, weight, err := analyzeservice.ParseSingleItemCorrection(previous, extractItems(task.Payload["correctionItems"]), index)
	if err != nil {
		return err
	}
	logger.Info(ctx, "开始单项营养重算", slog.String("task_id", task.ID), slog.String("user_id", task.UserID), slog.Int("item_index", index))
	input := analyzeInputFromTask(task)
	// Do not send the old dish's nutrients or the remaining meal to the model.
	input.Text = fmt.Sprintf("%s，当前可食重量 %.2f 克。只分析这一个食物，返回一个食物项。", name, weight)
	input.PreviousResult = nil
	input.CorrectionItems = nil
	input.AdditionalContext = ""
	input.ImageURL = ""
	input.ImageURLs = nil
	input.SuggestRatioEnabled = false
	input.AnalysisEngine = "db_first"
	input.ModelName = selectPrecisionModel(r.analyze, "")
	mode := "standard"
	input.ExecutionMode = &mode
	result, err := r.analyze.AnalyzeText(ctx, task.UserID, input)
	if err != nil {
		logger.Error(ctx, "单项营养重算失败", err, slog.String("task_id", task.ID), slog.Int("item_index", index))
		return err
	}
	resolved := extractItems(result["items"])
	if len(resolved) != 1 {
		return fmt.Errorf("单项重算未返回唯一食物，请使用一个具体菜名")
	}
	if err := analyzeservice.ValidateResolvedNutritionItems(resolved); err != nil {
		return err
	}
	target := copyAnyMap(resolved[0])
	estimated, ok := firstPositiveFloat(target, "estimatedWeightGrams")
	if !ok {
		return fmt.Errorf("单项重算缺少有效重量")
	}
	nutrients := copyAnyMap(mapFromAny(target["nutrients"]))
	for key, value := range nutrients {
		if number, numeric := floatFromAny(value); numeric {
			nutrients[key] = round2(number * weight / estimated)
		}
	}
	target["nutrients"] = nutrients
	if calories, exists := nutrients["calories"]; exists {
		target["calorie"] = calories
	}
	for _, key := range []string{"protein", "carbs", "fat"} {
		if value, exists := nutrients[key]; exists {
			target[key] = value
		}
	}
	target["name"] = name
	target["estimatedWeightGrams"] = weight
	target["final_weight_g"] = weight
	target["originalWeightGrams"] = weight
	target["grossWeightGrams"] = weight
	target["ediblePortionRatio"] = 100
	if id, exists := items[index]["itemId"]; exists {
		target["itemId"] = id
	}
	for _, key := range []string{"waterMl", "water_ml"} {
		water, exists := floatFromAny(nutrients[key])
		if !exists {
			if original, found := floatFromAny(target[key]); found {
				water, exists = original*weight/estimated, true
			}
		}
		if exists {
			water = math.Max(0, math.Min(weight, water))
			target[key] = round2(water)
			nutrients[key] = round2(water)
		}
	}
	items[index] = target
	merged := copyAnyMap(previous)
	merged["items"] = items
	merged["correctionApplied"] = true
	merged["correctionTargetIndex"] = index
	logger.Info(ctx, "单项营养重算完成，保留其余食物", slog.String("task_id", task.ID), slog.Int("item_index", index), slog.Int("item_count", len(items)))
	return r.completeTask(ctx, task, merged)
}
