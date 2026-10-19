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
	return plainBottledWater(name)
}

// 模型常给出带品牌或包装的名称（如“农夫山泉饮用天然水”“怡宝纯净水”），
// 这类无添加的饮用水本就是零热量；带口味、糖、果汁或功能成分的“水”不算。
var (
	plainWaterKinds    = []string{"天然水", "矿泉水", "纯净水", "饮用水", "蒸馏水", "矿物质水"}
	flavouredWaterHint = []string{"味", "果", "汁", "糖", "蜜", "柠檬", "柚", "椰", "维生素", "电解质", "运动", "能量", "茶", "奶", "乳", "豆", "饮料", "甜", "酸"}
)

func plainBottledWater(name string) bool {
	name = strings.TrimSpace(name)
	matched := false
	for _, kind := range plainWaterKinds {
		if strings.Contains(name, kind) {
			matched = true
			break
		}
	}
	if !matched {
		return false
	}
	unsweetened := strings.ReplaceAll(name, "无糖", "")
	for _, hint := range flavouredWaterHint {
		if strings.Contains(unsweetened, hint) {
			return false
		}
	}
	return true
}

const maxFoodEnergyDensityKcalPerGram = 9.0

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
	// The three macronutrients are part of the edible mass. Allow ordinary
	// label/portion rounding, but never accept more solid mass than the food.
	macroMassTolerance := math.Max(0.1, weight*0.02)
	if protein+carbs+fat > weight+macroMassTolerance {
		return fmt.Errorf("食物「%s」三大营养素总量超过可食重量，请重新分析", name)
	}
	// 纯油脂约 9 kcal/g，是食物能量密度的物理上限；只填热量的条目也不能超过它。
	if calories > weight*maxFoodEnergyDensityKcalPerGram+math.Max(1, calories*0.02) {
		return fmt.Errorf("食物「%s」热量超过同等重量纯油脂，请检查份量或重量", name)
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
		if hasModelNutritionSource(item) && n.Protein+n.Carbs+n.Fat == 0 && !ZeroEnergyFood(item.Name) {
			return fmt.Errorf("食物「%s」缺少有效三大营养素，请重新分析", item.Name)
		}
	}
	return nil
}

func hasModelNutritionSource(item FoodItem) bool {
	for _, value := range []*string{item.NutritionSource, item.NutritionSourceCategory} {
		if value != nil && strings.EqualFold(strings.TrimSpace(*value), "user_correction_context") {
			return false
		}
	}
	for _, value := range []*string{item.NutritionSource, item.NutritionSourceCategory} {
		if value == nil {
			continue
		}
		source := strings.ToLower(strings.TrimSpace(*value))
		if IsAIGeneratedNutritionSource(source) {
			return true
		}
		switch source {
		case "ai_direct", "legacy_direct", "ai_then_db_exact", "db_candidates_ai":
			return true
		}
	}
	return false
}
