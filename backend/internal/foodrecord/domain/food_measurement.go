package domain

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// ApplyFoodItemMeasurement derives nutrition from the saved label basis. The
// legacy mass fields contain real grams only; a count or volume is never mass.
func ApplyFoodItemMeasurement(item *FoodItem) error {
	if item == nil || item.Measurement == nil {
		return nil
	}
	totals, err := item.Measurement.Totals()
	if err != nil {
		return fmt.Errorf("食物「%s」的数量或营养单位无效：%w", item.Name, err)
	}
	encoded, err := json.Marshal(totals)
	if err != nil {
		return err
	}
	var nutrients FoodItemNutrients
	if err := json.Unmarshal(encoded, &nutrients); err != nil {
		return err
	}
	item.Nutrients = nutrients
	if water, exists := totals["water_ml"]; exists {
		item.WaterMl = water
	} else if water, exists := totals["waterMl"]; exists {
		item.WaterMl = water
	}
	item.Weight = 0
	if grams, known := item.Measurement.Grams(); known {
		item.Weight = grams
	}
	ratio := math.Max(0, math.Min(100, item.Ratio)) / 100
	item.Intake = item.Weight * ratio
	return nil
}

func validateMeasuredFoodItem(item FoodItem) error {
	if err := ApplyFoodItemMeasurement(&item); err != nil {
		return err
	}
	n := item.Nutrients
	if item.Weight > 0 {
		return ValidateFoodNutritionValues(item.Name, item.Weight, n.Calories, n.Protein, n.Carbs, n.Fat)
	}
	return ValidateUnweighedFoodNutritionValues(item.Name, n.Calories, n.Protein, n.Carbs, n.Fat)
}

// ValidateUnweighedFoodNutritionValues checks a food counted by volume, pieces
// or servings whose mass is unknown. Without a measured mass there is no valid
// kcal/g or macro-mass bound; identity, finite values and missing energy are
// still enforced, as in ValidateFoodNutritionValues.
func ValidateUnweighedFoodNutritionValues(name string, calories, protein, carbs, fat float64) error {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(name) == "未知食物" {
		return fmt.Errorf("食物名称无效，请补充食物名称")
	}
	for _, value := range []float64{calories, protein, carbs, fat} {
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("食物营养数据无效，请重新分析")
		}
	}
	if calories == 0 && !ZeroEnergyFood(name) {
		return fmt.Errorf("食物「%s」缺少有效热量，请重新分析", name)
	}
	return nil
}
