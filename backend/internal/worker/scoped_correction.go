package worker

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"reflect"
	"strings"

	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/foodrecord/domain"
	recordservice "food_link/backend/internal/foodrecord/service"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
)

// 结构化纠错按原食物标识合并，未修改项不进入营养重新估算。
func (r *Runner) resolveScopedCorrection(ctx context.Context, userID string, input analyzeservice.AnalyzeInput, overrides map[int]correctionContextOverride) (map[string]any, error) {
	previous := extractItems(input.PreviousResult["items"])
	if len(previous) == 0 || len(input.CorrectionItems) == 0 || len(input.CorrectionItems) > 100 {
		return nil, fmt.Errorf("纠错需要完整原餐和有效食物清单")
	}
	result := copyAnyMap(input.PreviousResult)
	resolvedTargets, err := r.resolveScopedCorrectionTargets(ctx, input, previous)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(input.CorrectionItems))
	used := map[int]bool{}
	recalculated := 0
	for correctionIndex, correction := range input.CorrectionItems {
		name := strings.TrimSpace(firstNonEmptyString(correction, "name"))
		weight, valid := firstPositiveFloat(correction, "weight", "estimatedWeightGrams")
		if name == "" || !valid || weight > 100000 || math.IsNaN(weight) || math.IsInf(weight, 0) {
			return nil, fmt.Errorf("请填写有效食物名称和重量")
		}
		originalIndex := scopedPreviousIndex(correction, previous)
		var original map[string]any
		if originalIndex >= 0 {
			if used[originalIndex] {
				return nil, fmt.Errorf("纠错清单包含重复食物标识")
			}
			used[originalIndex] = true
			original = previous[originalIndex]
		}
		renamed := original == nil || normalizeScopedName(name) != normalizeScopedName(firstNonEmptyString(original, "name"))
		explicitNutrition, _ := explicitCorrectionNutritionEdited(correction)
		var next map[string]any
		if renamed && !explicitNutrition {
			target, ok := resolvedTargets[correctionIndex]
			if !ok {
				return nil, fmt.Errorf("更正项营养未能完整补全，请重试")
			}
			next = scaleScopedItem(target, weight)
			next["name"] = name
			recalculated++
		} else if original != nil && !renamed {
			oldWeight, _ := firstPositiveFloat(original, "estimatedWeightGrams", "weight")
			if math.Abs(oldWeight-weight) >= 0.01 {
				next = scaleScopedItem(original, weight)
			} else {
				next = copyAnyMap(original)
			}
		} else {
			next = copyAnyMap(correction)
			next["estimatedWeightGrams"], next["originalWeightGrams"] = weight, weight
			next["grossWeightGrams"], next["ediblePortionRatio"] = weight, 100
		}
		if explicitNutrition {
			next["nutrients"] = copyAnyMap(mapFromAny(next["nutrients"]))
			applyNutritionOverridesToCorrectionItem(next, correctionNutrientOverrideValues(correction))
			// 食物库来源与图片随其营养快照保留。
			for _, key := range []string{"manual_source", "manual_source_id", "manual_source_title", "manual_portion_label", "image_path", "image_paths", "nutrition_source", "nutrition_source_category", "matched_food_id"} {
				if value, ok := correction[key]; ok {
					next[key] = value
				}
			}
		}
		if original != nil {
			for _, key := range []string{"itemId", "intakeRatio", "suggestedRatio", "suggestedRatioReason", "suggestedRatioSource"} {
				if value, ok := original[key]; ok {
					next[key] = value
				}
			}
			oldWeight, _ := firstPositiveFloat(original, "estimatedWeightGrams", "weight")
			if !renamed && math.Abs(weight-oldWeight) < 0.01 {
				if value, ok := original["intakeGrams"]; ok {
					next["intakeGrams"] = value
				}
			} else {
				ratio, ok := floatFromAny(original["intakeRatio"])
				if !ok {
					ratio = 100
				}
				next["intakeGrams"] = round2(weight * ratio / 100)
			}
		} else {
			next["itemId"] = firstNonNil(correction["sourceItemId"], correction["itemId"])
			next["intakeRatio"], next["intakeGrams"] = 100, weight
		}
		if renamed {
			next["name"] = name
		}
		if override, ok := overrides[correctionIndex]; ok && override.Calories != nil {
			next["nutrients"] = copyAnyMap(mapFromAny(next["nutrients"]))
			applyCorrectionOverrideToItem(next, correctionContextOverride{Calories: override.Calories})
		}
		items = append(items, next)
	}
	if err := analyzeservice.ValidateResolvedNutritionItems(items); err != nil {
		return nil, err
	}
	if !scopedCorrectionChanged(previous, items) {
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_effect", "rejected")
		logger.Warn(ctx, "纠错结果没有实际变化，拒绝标记成功", slog.Int("item_count", len(items)))
		return nil, fmt.Errorf("未应用任何更正，请在纠错清单中填写需要修改的食物名称或重量")
	}
	metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_effect", "passed")
	result["items"] = items
	result["analysis_engine"] = "db_first"
	result["description"] = "更正后的餐食：" + scopedItemNames(items)
	record := &domain.FoodRecord{}
	for _, item := range items {
		ratio, ok := floatFromAny(item["intakeRatio"])
		if !ok {
			ratio = 100
		}
		nutrients := mapFromAny(item["nutrients"])
		calories, _ := floatFromAny(nutrients["calories"])
		protein, _ := floatFromAny(nutrients["protein"])
		carbs, _ := floatFromAny(nutrients["carbs"])
		fat, _ := floatFromAny(nutrients["fat"])
		record.TotalCalories += calories * ratio / 100
		record.TotalProtein += protein * ratio / 100
		record.TotalCarbs += carbs * ratio / 100
		record.TotalFat += fat * ratio / 100
		weight, _ := firstPositiveFloat(item, "estimatedWeightGrams", "weight")
		record.Items = append(record.Items, domain.FoodItem{Name: firstNonEmptyString(item, "name"), Ratio: ratio, Intake: weight * ratio / 100})
	}
	result["insight"], result["pfc_ratio_comment"], result["eating_order_advice"], result["absorption_notes"] = recordservice.GeneratedRecordAdvice(record)
	result["context_advice"] = "更正后按最终食物与实际摄入量汇总；未修改食物的营养保持原值。"
	logger.Info(ctx, "结构化纠错已合并并保留未修改食物", slog.Int("item_count", len(items)), slog.Int("recalculated_count", recalculated))
	return result, nil
}

func scopedCorrectionChanged(previous, current []map[string]any) bool {
	if len(previous) != len(current) {
		return true
	}
	for index, item := range current {
		old := previous[index]
		if normalizeScopedName(firstNonEmptyString(item, "name")) != normalizeScopedName(firstNonEmptyString(old, "name")) {
			return true
		}
		weight, _ := firstPositiveFloat(item, "estimatedWeightGrams", "weight")
		oldWeight, _ := firstPositiveFloat(old, "estimatedWeightGrams", "weight")
		if math.Abs(weight-oldWeight) > 0.001 || !reflect.DeepEqual(mapFromAny(item["nutrients"]), mapFromAny(old["nutrients"])) {
			return true
		}
	}
	return false
}

// The correction form already supplies authoritative names and edible grams.
// Resolve only new/renamed targets together; do not reparse them through a
// separate text-model request for every dish or re-estimate untouched items.
func (r *Runner) resolveScopedCorrectionTargets(ctx context.Context, input analyzeservice.AnalyzeInput, previous []map[string]any) (map[int]map[string]any, error) {
	indices := []int{}
	targets := []map[string]any{}
	seen := map[int]bool{}
	for index, correction := range input.CorrectionItems {
		name := strings.TrimSpace(firstNonEmptyString(correction, "name"))
		weight, valid := firstPositiveFloat(correction, "weight", "estimatedWeightGrams")
		if name == "" || !valid || weight > 100000 || math.IsNaN(weight) || math.IsInf(weight, 0) {
			return nil, fmt.Errorf("请填写有效食物名称和重量")
		}
		originalIndex := scopedPreviousIndex(correction, previous)
		if originalIndex >= 0 {
			if seen[originalIndex] {
				return nil, fmt.Errorf("纠错清单包含重复食物标识")
			}
			seen[originalIndex] = true
		}
		renamed := originalIndex < 0 || normalizeScopedName(name) != normalizeScopedName(firstNonEmptyString(previous[originalIndex], "name"))
		explicitNutrition, _ := explicitCorrectionNutritionEdited(correction)
		if !renamed || explicitNutrition {
			continue
		}
		target := map[string]any{"name": name, "type": "normal", "estimatedWeightGrams": weight, "grossWeightGrams": weight, "ediblePortionRatio": 100.0, "weight_method": "user_explicit_weight", "needs_user_confirmation": false}
		for _, key := range []string{"type", "foodState", "weightBasis", "basisEvidence"} {
			if value, ok := correction[key]; ok {
				target[key] = value
			}
		}
		indices, targets = append(indices, index), append(targets, target)
	}
	out := map[int]map[string]any{}
	if len(targets) == 0 {
		return out, nil
	}
	const targetContext = "用户已确认本次更正清单的食物名称及当前可食克数，仅补全这些新增或改名项的营养，保留完整微量营养；禁止改变食物或份量。"
	var resolved []map[string]any
	var err error
	if enricher, ok := r.analyze.(interface {
		ApplyUserRequestedMicronutrientsToResolvedItems(context.Context, []map[string]any, string) ([]map[string]any, error)
	}); ok {
		resolved = r.analyze.ApplyDBFirstToItems(ctx, targets, targetContext)
		resolved, err = enricher.ApplyUserRequestedMicronutrientsToResolvedItems(ctx, resolved, targetContext)
	} else {
		resolved, err = r.analyze.ApplyDBFirstToItemsWithPreciseMicronutrients(ctx, targets, targetContext)
	}
	if err != nil {
		return nil, err
	}
	if len(resolved) != len(targets) {
		return nil, fmt.Errorf("更正项营养未能完整补全，请重试")
	}
	if err := analyzeservice.ValidateResolvedNutritionItems(resolved); err != nil {
		return nil, err
	}
	if err := analyzeservice.ValidatePreciseMicronutrientItems(resolved); err != nil {
		return nil, err
	}
	for index, item := range resolved {
		out[indices[index]] = item
	}
	logger.Info(ctx, "纠错新增和改名食物已批量补全营养", slog.Int("item_count", len(resolved)))
	return out, nil
}

func scopedPreviousIndex(item map[string]any, previous []map[string]any) int {
	id := firstNonNil(item["sourceItemId"], item["itemId"])
	if id != nil {
		for i, baseline := range previous {
			if fmt.Sprint(id) == fmt.Sprint(baseline["itemId"]) {
				return i
			}
		}
		return -1
	}
	// 老客户端无标识时仅接受唯一名称，不能按删除后的数组位置配对。
	source := normalizeScopedName(firstNonEmptyString(item, "sourceName", "name"))
	found := -1
	for i, baseline := range previous {
		if normalizeScopedName(firstNonEmptyString(baseline, "name")) == source {
			if found >= 0 {
				return -1
			}
			found = i
		}
	}
	return found
}

func normalizeScopedName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), ""))
}
func scopedItemNames(items []map[string]any) string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, firstNonEmptyString(item, "name"))
	}
	return strings.Join(names, "、")
}

func scaleScopedItem(item map[string]any, weight float64) map[string]any {
	next := copyAnyMap(item)
	oldWeight, _ := firstPositiveFloat(item, "estimatedWeightGrams", "weight")
	nutrients := copyAnyMap(mapFromAny(item["nutrients"]))
	if oldWeight > 0 {
		for key, value := range nutrients {
			if number, ok := floatFromAny(value); ok {
				nutrients[key] = round2(number * weight / oldWeight)
			}
		}
		for _, key := range []string{"waterMl", "water_ml"} {
			if value, ok := floatFromAny(item[key]); ok {
				next[key] = round2(value * weight / oldWeight)
			}
		}
	}
	next["nutrients"] = nutrients
	next["estimatedWeightGrams"], next["originalWeightGrams"], next["final_weight_g"] = weight, weight, weight
	next["grossWeightGrams"], next["ediblePortionRatio"] = weight, 100
	for _, key := range []string{"calorie", "protein", "carbs", "fat"} {
		nutrientKey := key
		if key == "calorie" {
			nutrientKey = "calories"
		}
		if value, ok := nutrients[nutrientKey]; ok {
			next[key] = value
		}
	}
	return next
}
