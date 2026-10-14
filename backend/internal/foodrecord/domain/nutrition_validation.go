package domain

import (
	"fmt"
	"math"
	"strings"
)

// ZeroEnergyFood permits genuine zero-energy drinks, not missing food estimates.
func ZeroEnergyFood(name string) bool {
	switch strings.TrimSpace(name) {
	case "水", "白水", "白开水", "饮用水", "纯净水", "矿泉水", "苏打水", "无糖苏打水", "无糖气泡水", "茶", "清茶", "绿茶", "红茶", "乌龙茶", "无糖茶", "无糖茶水", "黑咖啡", "美式咖啡", "无糖黑咖啡":
		return true
	}
	return false
}

// ValidateFoodNutritionValues is shared by analysis and the recording boundary.
func ValidateFoodNutritionValues(name string, weight, calories, protein, carbs, fat float64) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "未知食物" || weight <= 0 || math.IsNaN(weight) || math.IsInf(weight, 0) {
		return fmt.Errorf("食物名称或重量无效，请重新分析或补充份量")
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

func ValidateFoodItemsForRecording(items []FoodItem) error {
	if len(items) == 0 {
		return fmt.Errorf("没有可记录的食物，请重新分析")
	}
	for _, item := range items {
		n := item.Nutrients
		if err := ValidateFoodNutritionValues(item.Name, item.Weight, n.Calories, n.Protein, n.Carbs, n.Fat); err != nil {
			return err
		}
	}
	return nil
}
