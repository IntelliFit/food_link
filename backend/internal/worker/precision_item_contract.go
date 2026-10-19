package worker

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

func precisionEstimatePromptExample(items []map[string]any) string {
	examples := make([]map[string]any, 0, len(items))
	for _, item := range items {
		examples = append(examples, map[string]any{
			"item_key":             firstNonEmptyString(item, "item_key"),
			"name":                 firstNonEmptyString(item, "item_name", "name"),
			"foodState":            firstNonEmptyString(item, "foodState", "food_state"),
			"weightBasis":          firstNonEmptyString(item, "weightBasis", "weight_basis"),
			"basisEvidence":        firstNonEmptyString(item, "basisEvidence", "basis_evidence"),
			"estimatedWeightGrams": 180,
			"nutrients":            precisionNutrientsExample(),
		})
	}
	data, _ := json.Marshal(examples)
	return string(data)
}

// A model may estimate a planned food, but must not silently replace, omit or
// duplicate it. Candidate names are hypotheses, not user-confirmed aliases.
func matchPrecisionEstimateItems(items, planned []map[string]any) ([]map[string]any, error) {
	if len(planned) == 0 {
		return items, nil
	}
	if len(items) != len(planned) {
		return nil, fmt.Errorf("精准分项结果不完整：计划 %d 项，返回 %d 项", len(planned), len(items))
	}
	matched := make([]map[string]any, len(planned))
	for _, item := range items {
		weight, valid := floatFromAny(firstNonNil(item["estimatedWeightGrams"], item["weight"]))
		if !valid || math.IsNaN(weight) || math.IsInf(weight, 0) || weight <= 0 || weight > 20000 {
			return nil, fmt.Errorf("精准分项结果缺少有效重量")
		}
		match := -1
		for index, plan := range planned {
			if !precisionItemIdentityMatches(item, plan) {
				continue
			}
			if match >= 0 {
				return nil, fmt.Errorf("精准分项身份对应不明确，请重新分析")
			}
			match = index
		}
		if match < 0 {
			return nil, fmt.Errorf("精准分项结果与计划食物身份或重量口径不一致")
		}
		if matched[match] != nil {
			return nil, fmt.Errorf("精准分项结果包含重复食物，另有计划项缺失")
		}
		matched[match] = item
	}
	for _, item := range matched {
		if item == nil {
			return nil, fmt.Errorf("精准分项结果缺少计划食物")
		}
	}
	return matched, nil
}

func precisionItemIdentityMatches(item, plan map[string]any) bool {
	itemKey := firstNonEmptyString(item, "item_key")
	planKey := firstNonEmptyString(plan, "item_key")
	if itemKey != "" && itemKey != planKey {
		return false
	}
	for _, keys := range [][2]string{{"foodState", "food_state"}, {"weightBasis", "weight_basis"}} {
		actual := firstNonEmptyString(item, keys[0], keys[1])
		expected := firstNonEmptyString(plan, keys[0], keys[1])
		if actual != "" && expected != "" && actual != expected {
			return false
		}
	}
	actual := precisionIdentityName(firstNonEmptyString(item, "name", "item_name"))
	expected := precisionIdentityName(firstNonEmptyString(plan, "item_name", "name"))
	return actual != "" && actual == expected
}

func precisionIdentityName(name string) string {
	name = normalizeFoodName(name)
	// These express the same ingredient, not a guess based on shared characters.
	name = strings.NewReplacer("白米饭", "米饭", "白饭", "米饭", "莴笋", "莴苣").Replace(name)
	// State/basis are checked separately before allowing an omitted preparation
	// prefix. Do not strip dry/hydrated qualifiers or ingredient-bearing dish names.
	for _, prefix := range []string{"熟制", "熟", "水煮", "清蒸", "卤"} {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			break
		}
	}
	return name
}
