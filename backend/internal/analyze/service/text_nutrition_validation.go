package service

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
)

const fastTextModel = "qwen-flash"

var textWeightQuantity = `([0-9]+(?:\.[0-9]+)?)\s*(kg|KG|公斤|千克|斤|两|g|G|克)`

// Match only a quantity directly attached to this food. Do not distribute a
// recipe's total, an ingredient's weight, or a separate dish across all items.
func explicitTextItemWeight(text, name string) (float64, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, false
	}
	nameRE := regexp.QuoteMeta(name)
	patterns := []string{textWeightQuantity + `\s*(?:的|生|熟)?` + nameRE, nameRE + `\s*[:：]?\s*` + textWeightQuantity}
	var weights []float64
	for _, pattern := range patterns {
		for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatch(text, -1) {
			weight, err := strconv.ParseFloat(match[1], 64)
			if err != nil || weight <= 0 {
				continue
			}
			switch strings.ToLower(match[2]) {
			case "kg", "公斤", "千克":
				weight *= 1000
			case "斤":
				weight *= 500
			case "两":
				weight *= 50
			}
			weights = append(weights, weight)
		}
	}
	if len(weights) != 1 {
		return 0, false
	}
	return weights[0], true
}

func normalizeAndValidateTextResult(parsed map[string]any, input AnalyzeInput) (map[string]any, error) {
	parsed = copyAnyMap(normalizePayload(parsed))
	items := toItems(parsed["items"])
	if len(items) == 0 {
		return nil, &LLMJSONParseError{Err: ErrEmptyFoodAnalysisResult}
	}
	for _, item := range items {
		name := stringFromAny(item["name"])
		weight := nutritionWeightFromItem(item)
		if explicit, ok := explicitTextItemWeight(input.Text, name); ok {
			// Explicit gross weights of shelled/bony foods still require edible
			// conversion. A boneless food such as pork belly keeps the stated grams.
			ratio := numberFromAny(firstNonNil(item["ediblePortionRatio"], item["edible_portion_ratio"]))
			if ratio <= 0 || ratio >= 100 {
				if weight > 0 && math.Abs(explicit-weight) > 0.001 {
					nutrients := mapFromAny(item["nutrients"])
					for key, value := range nutrients {
						if amount, valid := finiteNutritionNumber(value); valid {
							nutrients[key] = round4(amount * explicit / weight)
						}
					}
				}
				weight = explicit
				item["estimatedWeightGrams"] = explicit
				item["originalWeightGrams"] = explicit
				item["grossWeightGrams"] = explicit
				item["weight_method"] = "user_explicit_weight"
				item["weight_confidence"] = 1.0
				item["needs_user_confirmation"] = false
			}
		}
		nutrients := mapFromAny(item["nutrients"])
		values := make([]float64, 0, 4)
		for _, key := range []string{"calories", "protein", "carbs", "fat"} {
			value, valid := finiteNutritionNumber(nutrients[key])
			if !valid {
				return nil, &LLMJSONParseError{Err: fmt.Errorf("文字食物分析缺少有效%s", key)}
			}
			nutrients[key] = value
			values = append(values, value)
		}
		if err := foodrecorddomain.ValidateFoodNutritionValues(name, weight, values[0], values[1], values[2], values[3]); err != nil {
			return nil, &LLMJSONParseError{Err: err}
		}
	}
	parsed["items"] = items
	if analysisEngineProducesNutrition(input.AnalysisEngine) && !textMicronutrientsComplete(items) {
		return nil, &LLMJSONParseError{Err: fmt.Errorf("文字食物分析未返回完整微量营养，请重试")}
	}
	return parsed, nil
}

func textMicronutrientsComplete(items []map[string]any) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		n := mapFromAny(item["nutrients"])
		positive := 0
		for _, key := range preciseMicronutrientKeys {
			value, valid := finiteNutritionNumber(n[key])
			if !valid {
				return false
			}
			if value > 0 {
				positive++
			}
		}
		if positive < 4 && !foodrecorddomain.ZeroEnergyFood(stringFromAny(item["name"])) {
			return false
		}
	}
	return true
}
