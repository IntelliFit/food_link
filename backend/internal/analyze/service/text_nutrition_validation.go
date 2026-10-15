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

func textNutritionJSONSchema(withNutrition bool) map[string]any {
	nutrientKeys := append([]string{"calories", "protein", "carbs", "fat"}, preciseMicronutrientKeys...)
	nutrientProperties := map[string]any{}
	for _, key := range nutrientKeys {
		nutrientProperties[key] = map[string]any{"type": "number", "minimum": 0}
	}
	text := func() map[string]any { return map[string]any{"type": "string"} }
	textList := map[string]any{"type": "array", "items": text()}
	itemProperties := map[string]any{
		"name":                 map[string]any{"type": "string", "minLength": 1},
		"type":                 map[string]any{"type": "string", "enum": []string{"normal", "snack", "packaged"}},
		"estimatedWeightGrams": map[string]any{"type": "number", "exclusiveMinimum": 0},
		"nutrients":            map[string]any{"type": "object", "properties": nutrientProperties, "required": nutrientKeys, "additionalProperties": false},
		"foodState":            text(), "weightBasis": text(), "basisEvidence": text(), "isComposite": map[string]any{"type": "boolean"},
		"addedIngredients": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": true}},
		"assumptions":      textList, "suggestedRatio": map[string]any{"type": "number", "minimum": 0, "maximum": 100},
		"grossWeightGrams":    map[string]any{"type": "number", "minimum": 0},
		"ediblePortionRatio":  map[string]any{"type": "number", "exclusiveMinimum": 0, "maximum": 100},
		"ediblePortionReason": text(), "waterMl": map[string]any{"type": "number", "minimum": 0},
	}
	itemRequired := []string{"name", "type", "estimatedWeightGrams"}
	if withNutrition {
		itemRequired = append(itemRequired, "nutrients", "foodState", "weightBasis", "basisEvidence", "isComposite", "addedIngredients", "assumptions", "suggestedRatio")
	} else {
		delete(itemProperties, "nutrients")
	}
	properties := map[string]any{"items": map[string]any{"type": "array", "minItems": 1, "items": map[string]any{"type": "object", "properties": itemProperties, "required": itemRequired, "additionalProperties": false}}, "uncertaintyNotes": textList}
	required := []string{"items", "uncertaintyNotes"}
	for _, key := range []string{"description", "insight", "pfc_ratio_comment", "eating_order_advice", "absorption_notes", "context_advice"} {
		properties[key] = text()
		required = append(required, key)
	}
	return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}

// Record field presence/type, never the complete prompt or model response.
func textResultShape(parsed map[string]any) string {
	items := toItems(parsed["items"])
	if len(items) == 0 {
		return "no_items"
	}
	item := items[0]
	weight, hasWeight := item["estimatedWeightGrams"]
	nutrients := mapFromAny(item["nutrients"])
	calories, hasCalories := nutrients["calories"]
	weightNumber, weightNumeric := finiteNutritionNumber(weight)
	caloriesNumber, caloriesNumeric := finiteNutritionNumber(calories)
	return fmt.Sprintf("weight_present=%t weight_type=%T weight_numeric=%t weight_positive=%t calories_present=%t calories_type=%T calories_numeric=%t calories_positive=%t nutrient_fields=%d", hasWeight, weight, weightNumeric, weightNumber > 0, hasCalories, calories, caloriesNumeric, caloriesNumber > 0, len(nutrients))
}

var textWeightQuantity = `([0-9]+(?:\.[0-9]+)?)\s*(kg|KG|公斤|千克|斤|两|g|G|克)`
var textFoodNameQualifier = regexp.MustCompile(`[（(][^）)]*[）)]`)

// Match only a quantity directly attached to this food. Do not distribute a
// recipe's total, an ingredient's weight, or a separate dish across all items.
func explicitTextItemWeight(text, name string) (float64, bool) {
	name = strings.TrimSpace(textFoodNameQualifier.ReplaceAllString(name, ""))
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
	rawItems := toItems(parsed["items"])
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item := copyAnyMap(raw)
		item["nutrients"] = copyAnyMap(mapFromAny(raw["nutrients"]))
		items = append(items, item)
	}
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
			plainName := strings.TrimSpace(textFoodNameQualifier.ReplaceAllString(name, ""))
			bonelessPork := (plainName == "五花肉" || plainName == "猪肉" || plainName == "猪五花肉") && !strings.Contains(input.Text, "骨") && !strings.Contains(input.Text, "去皮") && !strings.Contains(input.Text, "皮不吃")
			if ratio <= 0 || ratio >= 100 || bonelessPork {
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
				item["ediblePortionRatio"] = 100.0
				item["weight_method"] = "user_explicit_weight"
				item["weight_confidence"] = 1.0
				item["needs_user_confirmation"] = false
			}
		}
		if strings.TrimSpace(name) == "" || weight <= 0 || math.IsNaN(weight) || math.IsInf(weight, 0) {
			return nil, &LLMJSONParseError{Err: fmt.Errorf("文字食物分析缺少有效名称或份量")}
		}
		// Database-first parses the food/weight before the resolver supplies
		// nutrition. Do not require model nutrition that its prompt forbids.
		if !analysisEngineProducesNutrition(input.AnalysisEngine) {
			continue
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
		if values[1]+values[2]+values[3] == 0 && !foodrecorddomain.ZeroEnergyFood(name) {
			return nil, &LLMJSONParseError{Err: fmt.Errorf("文字食物分析缺少有效三大营养素")}
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
