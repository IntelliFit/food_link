package worker

import (
	"fmt"
	"math"
	"strings"

	analyzeservice "food_link/backend/internal/analyze/service"
)

// precisionInlineNutritionKeys are the whole-portion nutrients requested from
// the precision estimate call, matching the ordinary one-call photo schema.
func precisionInlineNutritionKeys() []string {
	return append([]string{"calories", "protein", "carbs", "fat"}, analyzeservice.PreciseMicronutrientKeys()...)
}

func precisionNutrientsExample() map[string]any {
	example := map[string]any{}
	for _, key := range precisionInlineNutritionKeys() {
		example[key] = 0
	}
	return example
}

// withPrecisionInlineNutrition asks the estimate call to return nutrition for
// the weight it just estimated. Items that come back with plausible values
// skip the separate nutrition model call, which took 10-20s per item and
// failed the whole item when every estimator timed out.
func withPrecisionInlineNutrition(prompt string) string {
	rule := fmt.Sprintf("- 每个食物还必须输出 nutrients：按本项 estimatedWeightGrams 可食净重计算的整份营养总量，不是每100克。字段为 %s；calories 用 kcal，protein/carbs/fat/fiber/sugar/saturatedFat 用 g，后缀 Mg 用 mg，后缀 Mcg 用 µg。依据实际食物、配料、油量和烹饪状态估算，确实不含的才填 0，不要因为不确定而机械填 0。\n", strings.Join(precisionInlineNutritionKeys(), "、"))
	if idx := strings.Index(prompt, "- 仅返回 JSON。"); idx >= 0 {
		prompt = prompt[:idx] + rule + prompt[idx:]
	} else {
		prompt += "\n" + rule
	}
	return strings.Replace(prompt, "\"estimatedWeightGrams\": 180\n  }", "\"estimatedWeightGrams\": 180,\n    \"nutrients\": "+precisionNutrientsExampleJSON()+"\n  }", 1)
}

func precisionNutrientsExampleJSON() string {
	parts := make([]string, 0, len(precisionInlineNutritionKeys()))
	for _, key := range precisionInlineNutritionKeys() {
		parts = append(parts, fmt.Sprintf("%q: 0", key))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

// inlinePrecisionNutrients keeps the numeric nutrients a model returned with an
// estimate. It returns nil unless every macro is present, finite and
// non-negative; the nutrition resolver applies the remaining plausibility gate.
func inlinePrecisionNutrients(raw map[string]any) map[string]any {
	source := mapFromAny(raw["nutrients"])
	if len(source) == 0 {
		return nil
	}
	out := map[string]any{}
	for _, key := range precisionInlineNutritionKeys() {
		value, ok := floatFromAny(source[key])
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			continue
		}
		out[key] = value
	}
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		if _, ok := out[key]; !ok {
			return nil
		}
	}
	return out
}
