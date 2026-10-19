package repo

import (
	"regexp"
	"strconv"
	"strings"
)

// publicFoodFallbackWeightGrams 仅在公共库菜品完全没有可用重量时兜底。
// 过去兜底为 1g，导致「1份」被当成 1 克：营养密度被放大百倍且被写进用户记录。
const publicFoodFallbackWeightGrams = 100.0

// 公共库条目既有用户记录形态（intake/weight），也有识别结果形态
// （estimatedWeightGrams/final_weight_g）。识别结果的 nutrients 与 estimatedWeightGrams 对应。
var publicFoodItemWeightKeys = []string{"intake", "weight", "estimatedWeightGrams", "final_weight_g", "originalWeightGrams"}

var portionDescriptionWeightPattern = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(ml|mL|ML|g|G|克|毫升)`)

// publicFoodItemWeightGrams 返回单个公共库菜品的整份重量；无法确定时返回 0。
func publicFoodItemWeightGrams(item map[string]any) float64 {
	if item == nil {
		return 0
	}
	for _, key := range publicFoodItemWeightKeys {
		if weight := numberFromAny(item[key]); weight > 0 {
			return weight
		}
	}
	description, _ := item["portion_description"].(string)
	return weightFromPortionDescription(description)
}

func weightFromPortionDescription(description string) float64 {
	match := portionDescriptionWeightPattern.FindStringSubmatch(strings.TrimSpace(description))
	if len(match) < 2 {
		return 0
	}
	weight, err := strconv.ParseFloat(match[1], 64)
	if err != nil || weight <= 0 {
		return 0
	}
	return weight
}

// publicFoodPortionWeightGrams 返回「1份」的总重量。只有每个菜品都能确定重量时才求和，
// 否则部分菜品的营养会被摊到过小的重量上。
func publicFoodPortionWeightGrams(items []map[string]any) float64 {
	total := 0.0
	for _, item := range items {
		if item == nil {
			continue
		}
		weight := publicFoodItemWeightGrams(item)
		if weight <= 0 {
			return publicFoodFallbackWeightGrams
		}
		total += weight
	}
	if total <= 0 {
		return publicFoodFallbackWeightGrams
	}
	return total
}
