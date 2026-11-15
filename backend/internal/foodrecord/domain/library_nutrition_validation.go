package domain

import (
	"fmt"
	"math"
	"strings"
)

// ValidateLibraryNutrition validates an incoming label, never a saved meal.
// The numeric fields are normalized to the stated basis, not necessarily mass.
func ValidateLibraryNutrition(basis string, values map[string]float64) error {
	if err := ValidateNutrientComponents(values); err != nil {
		return err
	}
	normalized := strings.ToLower(strings.TrimSpace(basis))
	normalized = strings.NewReplacer("每", "", "毫升", "ml", "克", "g", " ", "", "_", "", "-", "", "/", "").Replace(normalized)
	switch normalized {
	case "g", "100g", "per_100g", "per100g":
		if values["protein"]+values["carbs"]+values["fat"] > 102 {
			return fmt.Errorf("每100克三大营养素合计超过102克，请核对营养表及计量基准")
		}
		if values["calories"] > 918 {
			return fmt.Errorf("每100克热量超过质量上限，请核对能量单位")
		}
	case "ml", "100ml", "per_100ml", "per100ml":
		// Dense liquids may weigh more than 100g per 100ml. Do not apply g bounds.
	default:
		return fmt.Errorf("营养计量基准不明确，请先换算为每100克或每100毫升；不能直接把个或份当成克")
	}
	return nil
}

// ValidateNutrientComponents also applies to a count/serving whose mass is unknown.
func ValidateNutrientComponents(values map[string]float64) error {
	for key, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return fmt.Errorf("营养字段%s必须是有限非负数", key)
		}
	}
	if values["sugar"] > values["carbs"]+0.2 {
		return fmt.Errorf("糖含量超过碳水化合物，请核对数值、单位和同一列的计量基准")
	}
	if values["saturatedFat"] > values["fat"]+0.2 {
		return fmt.Errorf("饱和脂肪含量超过总脂肪，请核对是否误填百分比或营养素参考值")
	}
	return nil
}
