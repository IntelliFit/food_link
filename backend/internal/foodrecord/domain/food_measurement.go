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
	// Without a measured mass there is no valid kcal/g or macro-mass bound.
	// Still enforce the same identity, finite-value and missing-energy boundary.
	if strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.Name) == "未知食物" {
		return fmt.Errorf("食物名称无效，请补充食物名称")
	}
	for _, value := range []float64{n.Calories, n.Protein, n.Carbs, n.Fat} {
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("食物营养数据无效，请重新分析")
		}
	}
	if n.Calories == 0 && !ZeroEnergyFood(item.Name) {
		return fmt.Errorf("食物「%s」缺少有效热量，请重新分析", item.Name)
	}
	return nil
}
