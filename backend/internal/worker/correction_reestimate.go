package worker

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
)

const correctionReestimateTimeout = 50 * time.Second

type correctionReestimateTarget struct {
	index     int
	weight    bool
	nutrition bool
}

// reestimateCorrectionItems looks at the meal photo again, only for the dishes
// the correction plan flagged: a portion the user says is wrong without giving
// a number, or nutrition the user disputes. Text-only meals keep the plan's
// common-sense weight; disputed nutrition is then estimated from name and note.
// It returns the cleaned items and the nutrition disputes for the review queue.
func (r *Runner) reestimateCorrectionItems(ctx context.Context, input analyzeservice.AnalyzeInput, modelName string) ([]map[string]any, []map[string]any, error) {
	items := make([]map[string]any, len(input.CorrectionItems))
	for index, item := range input.CorrectionItems {
		items[index] = copyAnyMap(item)
	}
	previous := extractItems(input.PreviousResult["items"])
	targets := correctionReestimateTargets(items)
	imageURLs := correctionImageURLs(input)
	needsCall := false
	for _, target := range targets {
		if target.nutrition || (target.weight && len(imageURLs) > 0) {
			needsCall = true
		}
	}
	var parsed map[string]any
	if needsCall {
		sourceType := "image"
		if len(imageURLs) == 0 {
			sourceType = "text"
		}
		prompt := buildCorrectionReestimatePrompt(items, targets, len(imageURLs) > 0)
		callCtx, cancel := context.WithTimeout(ctx, correctionReestimateTimeout)
		var err error
		parsed, err = r.analyze.RunPrecisionJSONWithImagesTemperatureNoFallback(callCtx, sourceType, prompt, imageURLs, modelName, 0.1)
		cancel()
		if err != nil {
			metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_reestimate", "failed")
			logger.Warn(ctx, "纠错看图重估失败，重量沿用纠错计划的估计", slog.Int("target_count", len(targets)), logger.Err(err))
			parsed = nil
		}
	}
	disputes, missing := applyCorrectionReestimate(items, previous, targets, parsed, len(imageURLs) > 0)
	for _, item := range items {
		if calories, ok := floatFromAny(item["correctionCalories"]); ok && calories > 0 {
			disputes = append(disputes, correctionDisputeRecord(item, previous, "user_value", map[string]any{"calories": calories}))
		}
		delete(item, analyzeservice.CorrectionReestimateWeightKey)
		delete(item, analyzeservice.CorrectionDisputeNutritionKey)
		delete(item, analyzeservice.CorrectionHintKey)
	}
	if len(missing) > 0 {
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_reestimate", "rejected")
		return nil, nil, fmt.Errorf("没能重新估算「%s」的营养，请稍后重试，或直接在纠错清单里填写营养数值", strings.Join(missing, "、"))
	}
	if needsCall {
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_reestimate", "passed")
	}
	return items, disputes, nil
}

func correctionImageURLs(input analyzeservice.AnalyzeInput) []string {
	var urls []string
	for _, url := range input.ImageURLs {
		if url = strings.TrimSpace(url); url != "" {
			urls = append(urls, url)
		}
	}
	if len(urls) == 0 && strings.TrimSpace(input.ImageURL) != "" {
		urls = append(urls, strings.TrimSpace(input.ImageURL))
	}
	return urls
}

func correctionReestimateTargets(items []map[string]any) []correctionReestimateTarget {
	var targets []correctionReestimateTarget
	for index, item := range items {
		target := correctionReestimateTarget{
			index:     index,
			weight:    boolFromAny(item[analyzeservice.CorrectionReestimateWeightKey]),
			nutrition: boolFromAny(item[analyzeservice.CorrectionDisputeNutritionKey]),
		}
		if target.weight || target.nutrition {
			targets = append(targets, target)
		}
	}
	return targets
}

func buildCorrectionReestimatePrompt(items []map[string]any, targets []correctionReestimateTarget, hasImage bool) string {
	var meal, tasks []string
	for index, item := range items {
		weight, _ := firstPositiveFloat(item, "weight", "estimatedWeightGrams")
		meal = append(meal, fmt.Sprintf("- index %d：%s，当前 %.0fg", index, firstNonEmptyString(item, "name"), weight))
	}
	for _, target := range targets {
		item := items[target.index]
		var asks []string
		if target.weight && hasImage {
			asks = append(asks, "重新估算可食部分重量 weight_grams")
		}
		if target.nutrition {
			asks = append(asks, "重新估算这一份的营养总量")
		}
		hint := firstNonEmptyString(item, analyzeservice.CorrectionHintKey)
		if hint == "" {
			hint = "无"
		}
		tasks = append(tasks, fmt.Sprintf("- index %d %s：%s。用户说明：%s", target.index, firstNonEmptyString(item, "name"), strings.Join(asks, "；"), hint))
	}
	basis := "对照照片"
	weightRule := "- 重量是实际吃下的可食部分净重：按照片里容器大小、填充高度、堆叠厚度和与餐具的比例估算；用户说汤没喝、只吃一半、可食部分没这么多等，要扣掉对应部分。"
	if !hasImage {
		basis = "根据菜名和用户说明"
		weightRule = "- 没有照片，不要估重量，只估营养。"
	}
	return fmt.Sprintf(`你在复核一餐的纠错。用户指出下面标出的菜分量或营养不对，请%s只重新估算这些菜，未标出的菜不要输出。
整餐清单（供你对应照片中的位置）：
%s
需要重估：
%s
规则：
%s
- 营养按这道菜最终重量的整份给出：calories 千卡，protein、carbs、fat、fiber 为克。要结合用户理由调整（例如油比一般多，脂肪和热量就要高于常规做法；说是无糖的就不要按含糖估），不要照搬常见数据库的值。蛋白质、碳水、脂肪之和不能超过重量。
- 只需重估重量的菜不要给营养字段。
只返回 JSON：{"items":[{"index":1,"weight_grams":260,"reason":"碗里约一半是汤"},{"index":3,"calories":520,"protein":18,"carbs":40,"fat":32,"fiber":3,"reason":"表面油多"}]}`,
		basis, strings.Join(meal, "\n"), strings.Join(tasks, "\n"), weightRule)
}

// applyCorrectionReestimate writes valid estimates onto items in place and
// returns the nutrition disputes plus the names whose nutrition could not be
// estimated. A missing weight keeps the plan's common-sense estimate.
func applyCorrectionReestimate(items, previous []map[string]any, targets []correctionReestimateTarget, parsed map[string]any, hasImage bool) ([]map[string]any, []string) {
	rows := map[int]map[string]any{}
	for _, row := range extractItems(parsed["items"]) {
		if index, ok := floatFromAny(row["index"]); ok && index == math.Trunc(index) {
			rows[int(index)] = row
		}
	}
	var disputes []map[string]any
	var missing []string
	for _, target := range targets {
		item := items[target.index]
		row := rows[target.index]
		if target.weight && hasImage {
			if weight, ok := floatFromAny(row["weight_grams"]); ok && weight > 0 && weight <= 100000 {
				item["weight"], item["estimatedWeightGrams"], item["weightEdited"] = round2(weight), round2(weight), true
			}
		}
		if !target.nutrition {
			continue
		}
		nutrients, ok := correctionEstimatedNutrients(row, item)
		if !ok {
			missing = append(missing, firstNonEmptyString(item, "name"))
			continue
		}
		applyCorrectionEstimatedNutrients(item, previous, nutrients)
		disputes = append(disputes, correctionDisputeRecord(item, previous, "image_reestimate", nutrients))
	}
	return disputes, missing
}

func correctionEstimatedNutrients(row, item map[string]any) (map[string]any, bool) {
	weight, _ := firstPositiveFloat(item, "weight", "estimatedWeightGrams")
	values := map[string]float64{}
	for _, key := range []string{"protein", "carbs", "fat"} {
		value, ok := floatFromAny(row[key])
		if !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, false
		}
		values[key] = value
	}
	if weight > 0 && values["protein"]+values["carbs"]+values["fat"] > weight*1.02 {
		return nil, false
	}
	calories := foodrecorddomain.MacroCalories(values["protein"], values["carbs"], values["fat"])
	if calories <= 0 {
		return nil, false
	}
	nutrients := map[string]any{"calories": round2(calories), "protein": round2(values["protein"]), "carbs": round2(values["carbs"]), "fat": round2(values["fat"])}
	if fiber, ok := floatFromAny(row["fiber"]); ok && fiber >= 0 && fiber <= weight {
		nutrients["fiber"] = round2(fiber)
	}
	return nutrients, true
}

// 质疑营养的菜：微量营养沿用原记录并按新重量缩放，热量和三大营养素换成重估值，
// 交给下游“用户填写营养”的同一路径处理。改了名的菜不沿用原菜的微量营养。
func applyCorrectionEstimatedNutrients(item map[string]any, previous []map[string]any, estimated map[string]any) {
	weight, _ := firstPositiveFloat(item, "weight", "estimatedWeightGrams")
	nutrients := map[string]any{}
	if original := correctionOriginalItem(item, previous); original != nil &&
		normalizeScopedName(firstNonEmptyString(original, "name")) == normalizeScopedName(firstNonEmptyString(item, "name")) {
		oldWeight, _ := firstPositiveFloat(original, "estimatedWeightGrams", "weight")
		for key, value := range mapFromAny(original["nutrients"]) {
			if number, ok := floatFromAny(value); ok && oldWeight > 0 && weight > 0 {
				nutrients[key] = round2(number * weight / oldWeight)
			}
		}
	}
	for key, value := range estimated {
		nutrients[key] = value
	}
	item["nutrients"] = nutrients
	item["calorie"], item["protein"], item["carbs"], item["fat"] = estimated["calories"], estimated["protein"], estimated["carbs"], estimated["fat"]
	item["nutritionEdited"] = true
}

func correctionOriginalItem(item map[string]any, previous []map[string]any) map[string]any {
	if index := scopedPreviousIndex(item, previous); index >= 0 {
		return previous[index]
	}
	return nil
}

// correctionDisputeRecord keeps what a reviewer needs to judge whether the
// library value was wrong: which entry it came from, the old values, the
// user's reason or number, and what this meal now uses.
func correctionDisputeRecord(item map[string]any, previous []map[string]any, kind string, values map[string]any) map[string]any {
	record := map[string]any{
		"kind":   kind,
		"name":   firstNonEmptyString(item, "name"),
		"hint":   firstNonEmptyString(item, analyzeservice.CorrectionHintKey),
		"values": values,
	}
	if weight, ok := firstPositiveFloat(item, "weight", "estimatedWeightGrams"); ok {
		record["weight_grams"] = weight
	}
	if original := correctionOriginalItem(item, previous); original != nil {
		record["original_name"] = firstNonEmptyString(original, "name")
		record["original_weight_grams"] = original["estimatedWeightGrams"]
		record["original_nutrients"] = original["nutrients"]
		for _, key := range []string{"nutrition_source", "nutrition_source_category", "matched_food_id", "packaged_food_id", "manual_source_id"} {
			if value, ok := original[key]; ok && value != nil {
				record[key] = value
			}
		}
	}
	return record
}

// captureCorrectionNutritionDisputes queues a nutrition_mismatch sample for
// review. Only this meal changes; the shared library is updated only after a
// reviewer confirms the dispute.
func (r *Runner) captureCorrectionNutritionDisputes(ctx context.Context, task *analyzedomain.AnalysisTask, disputes []map[string]any, result map[string]any) {
	if r == nil || r.tasks == nil || task == nil || len(disputes) == 0 {
		return
	}
	sourceTaskID := strings.TrimSpace(stringFromMap(task.Payload, "correction_source_task_id"))
	if sourceTaskID == "" {
		sourceTaskID = task.ID
	}
	rootTaskID := strings.TrimSpace(stringFromMap(task.Payload, "correction_root_task_id"))
	if rootTaskID == "" {
		rootTaskID = sourceTaskID
	}
	// correction_task_id 是旧纠错样本的唯一键，本样本不占用，任务编号放在快照里。
	sample := &analyzedomain.AnalysisFeedbackSample{
		UserID:              task.UserID,
		FeedbackType:        analyzedomain.FeedbackTypeNutritionMismatch,
		ResolutionState:     analyzedomain.ResolutionStateUserCorrected,
		SourceTaskID:        stringPtr(sourceTaskID),
		RootTaskID:          stringPtr(rootTaskID),
		TaskType:            task.TaskType,
		BeforeResult:        mapFromAny(task.Payload["previousResult"]),
		UserCorrectionItems: disputes,
		AfterResult:         result,
		PayloadSnapshot: map[string]any{
			"review_status":      "pending",
			"correction_task_id": task.ID,
			"additionalContext":  stringFromMap(task.Payload, "additionalContext"),
		},
	}
	if err := r.tasks.UpsertFeedbackSample(ctx, sample); err != nil {
		r.warn(ctx, "营养质疑写入审核队列失败", slog.String("task_id", task.ID), logger.Err(err))
		return
	}
	r.info(ctx, "营养质疑已写入审核队列", slog.String("task_id", task.ID), slog.Int("dispute_count", len(disputes)))
}
