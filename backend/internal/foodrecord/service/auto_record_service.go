package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
)

// AutoRecordCompletedTask turns an explicitly opted-in, completed food analysis
// into a normal food record. Save remains the single write path, so the
// user/source_task_id uniqueness guard also protects worker/HTTP races.
func (s *FoodRecordService) AutoRecordCompletedTask(ctx context.Context, task *analyzedomain.AnalysisTask) (string, bool, error) {
	if task == nil || task.Status != "done" || !autoRecordRequested(task.Payload) {
		return "", false, nil
	}
	if task.TaskType != "food" && task.TaskType != "food_text" {
		return "", false, nil
	}
	if autoRecordNeedsUserAction(task) {
		logger.Warn(ctx, "识别结果仍需用户确认，跳过自动记录",
			slog.String("user_id", task.UserID),
			slog.String("task_id", task.ID),
		)
		return "", false, nil
	}
	items, err := autoRecordFoodItems(task.Result)
	if err != nil {
		return "", false, err
	}
	if len(items) == 0 {
		return "", false, fmt.Errorf("识别结果没有可记录的食物")
	}

	mealType := normalizeAutoRecordMealTypeValue(stringFromAny(task.Payload["auto_record_meal_type"], task.Payload["meal_type"]))
	if mealType == "" {
		return "", false, fmt.Errorf("自动记录餐次无效")
	}
	imagePaths := append([]string(nil), task.ImagePaths...)
	if len(imagePaths) == 0 && task.ImageURL != nil && strings.TrimSpace(*task.ImageURL) != "" {
		imagePaths = []string{strings.TrimSpace(*task.ImageURL)}
	}
	var imagePath *string
	if len(imagePaths) > 0 {
		value := imagePaths[0]
		imagePath = &value
	}
	description := nonEmptyAutoRecordStringPtr(stringFromAny(task.Result["description"]))
	insight := nonEmptyAutoRecordStringPtr(stringFromAny(task.Result["insight"]))
	dietGoal := nonEmptyAutoRecordStringPtr(stringFromAny(task.Payload["diet_goal"], task.Payload["dietGoal"]))
	activityTiming := nonEmptyAutoRecordStringPtr(stringFromAny(task.Payload["activity_timing"], task.Payload["activityTiming"]))
	pfcComment := nonEmptyAutoRecordStringPtr(stringFromAny(task.Result["pfc_ratio_comment"], task.Result["pfcRatioComment"]))
	absorptionNotes := nonEmptyAutoRecordStringPtr(stringFromAny(task.Result["absorption_notes"], task.Result["absorptionNotes"]))
	contextAdvice := nonEmptyAutoRecordStringPtr(stringFromAny(task.Result["context_advice"], task.Result["contextAdvice"]))
	recordedOn := nonEmptyAutoRecordStringPtr(stringFromAny(task.Payload["date"], task.Payload["recorded_on"], task.Payload["recordedOn"]))
	entryTypeValue := "food_image"
	if task.TaskType == "food_text" {
		entryTypeValue = "food_text"
	}
	sourceTaskID := task.ID
	totalCalories, totalProtein, totalCarbs, totalFat, totalWeight := autoRecordTotals(items)

	record, err := s.Save(ctx, task.UserID, SaveFoodRecordInput{
		MealType:         mealType,
		ImagePath:        imagePath,
		ImagePaths:       imagePaths,
		Description:      description,
		Insight:          insight,
		Items:            items,
		TotalCalories:    totalCalories,
		TotalProtein:     totalProtein,
		TotalCarbs:       totalCarbs,
		TotalFat:         totalFat,
		TotalWeightGrams: int(math.Round(totalWeight)),
		DietGoal:         dietGoal,
		ActivityTiming:   activityTiming,
		PFCRatioComment:  pfcComment,
		AbsorptionNotes:  absorptionNotes,
		ContextAdvice:    contextAdvice,
		SourceTaskID:     &sourceTaskID,
		EntryType:        &entryTypeValue,
		Date:             recordedOn,
	})
	if err != nil {
		logger.Error(ctx, "识别完成后自动记录失败", err,
			slog.String("user_id", task.UserID),
			slog.String("task_id", task.ID),
			slog.String("meal_type", mealType),
		)
		return "", false, err
	}
	logger.Info(ctx, "识别完成后已自动记录",
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("record_id", record.ID),
		slog.String("meal_type", record.MealType),
		slog.Bool("already_saved", record.AlreadySaved),
	)
	return record.ID, true, nil
}

func autoRecordRequested(payload map[string]any) bool {
	value, ok := payload["auto_record_requested"]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	default:
		return false
	}
}

func autoRecordNeedsUserAction(task *analyzedomain.AnalysisTask) bool {
	if task == nil || task.Result == nil {
		return true
	}
	if stringFromAny(task.Payload["correction_source_task_id"], task.Payload["correction_root_task_id"]) != "" {
		return true
	}
	if truthyAutoRecordValue(task.Result["userActionRequired"]) || truthyAutoRecordValue(task.Result["user_action_required"]) {
		return true
	}
	precisionStatus := strings.ToLower(stringFromAny(task.Result["precisionStatus"], task.Result["precision_status"]))
	if precisionStatus == "needs_user_input" || precisionStatus == "needs_retake" {
		return true
	}
	for _, item := range autoRecordResultItemMaps(task.Result["items"]) {
		if truthyAutoRecordValue(item["needs_user_confirmation"]) || truthyAutoRecordValue(item["needsUserConfirmation"]) || truthyAutoRecordValue(item["is_unresolved"]) {
			return true
		}
		status := strings.ToLower(stringFromAny(item["package_match_status"], item["packageMatchStatus"]))
		candidates := autoRecordAnySlice(item["packaged_candidates"])
		if len(candidates) == 0 {
			candidates = autoRecordAnySlice(item["packagedCandidates"])
		}
		weightApplied := truthyAutoRecordValue(item["package_weight_applied"]) || truthyAutoRecordValue(item["packageWeightApplied"])
		if len(candidates) > 0 && !weightApplied && (status == "packaged_needs_confirmation" || status == "multiple_candidates") {
			return true
		}
	}
	return false
}

func autoRecordFoodItems(result map[string]any) ([]domain.FoodItem, error) {
	rows := autoRecordResultItemMaps(result["items"])
	items := make([]domain.FoodItem, 0, len(rows))
	for _, row := range rows {
		copyRow := make(map[string]any, len(row)+4)
		for key, value := range row {
			copyRow[key] = value
		}
		weight := numberFromAny(row["weight"], row["estimatedWeightGrams"], row["estimated_weight_grams"], row["originalWeightGrams"])
		if weight <= 0 {
			continue
		}
		copyRow["weight"] = weight
		copyRow["ratio"] = 100.0
		copyRow["intake"] = weight
		for snakeKey, camelKey := range map[string]string{
			"edible_portion_ratio":      "ediblePortionRatio",
			"edible_portion_reason":     "ediblePortionReason",
			"edible_portion_source":     "ediblePortionSource",
			"suggested_ratio":           "suggestedRatio",
			"suggested_ratio_reason":    "suggestedRatioReason",
			"suggested_ratio_source":    "suggestedRatioSource",
			"water_ml":                  "waterMl",
			"nutrition_source":          "nutritionSource",
			"nutrition_source_category": "nutritionSourceCategory",
			"matched_food_id":           "matchedFoodId",
			"packaged_food_id":          "packagedFoodId",
			"package_match_status":      "packageMatchStatus",
			"package_match_confidence":  "packageMatchConfidence",
			"package_weight_source":     "packageWeightSource",
			"package_weight_applied":    "packageWeightApplied",
			"package_weight_reason":     "packageWeightReason",
			"packaged_candidates":       "packagedCandidates",
		} {
			if _, exists := copyRow[snakeKey]; !exists {
				if value, ok := row[camelKey]; ok {
					copyRow[snakeKey] = value
				}
			}
		}
		if _, ok := copyRow["gross_weight_grams"]; !ok {
			copyRow["gross_weight_grams"] = numberFromAny(row["grossWeightGrams"], row["originalWeightGrams"], weight)
		}
		encoded, err := json.Marshal(copyRow)
		if err != nil {
			return nil, err
		}
		var item domain.FoodItem
		if err := json.Unmarshal(encoded, &item); err != nil {
			return nil, err
		}
		if strings.TrimSpace(item.Name) == "" {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

func autoRecordResultItemMaps(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		rows := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if row, ok := item.(map[string]any); ok {
				rows = append(rows, row)
			}
		}
		return rows
	default:
		return nil
	}
}

func autoRecordAnySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, len(typed))
		for index := range typed {
			out[index] = typed[index]
		}
		return out
	default:
		return nil
	}
}

func truthyAutoRecordValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	case float64:
		return typed == 1
	default:
		return false
	}
}

func normalizeAutoRecordMealTypeValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack":
		return strings.ToLower(strings.TrimSpace(value))
	case "snack":
		return "afternoon_snack"
	default:
		return ""
	}
}

func nonEmptyAutoRecordStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" || value == "none" {
		return nil
	}
	return &value
}

func autoRecordTotals(items []domain.FoodItem) (calories, protein, carbs, fat, weight float64) {
	for _, item := range items {
		calories += item.Nutrients.Calories
		protein += item.Nutrients.Protein
		carbs += item.Nutrients.Carbs
		fat += item.Nutrients.Fat
		weight += item.Intake
	}
	return
}
