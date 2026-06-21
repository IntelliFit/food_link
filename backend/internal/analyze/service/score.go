package service

import (
	"math"

	"food_link/backend/internal/nutrition"
)

const (
	// defaultMealRatio 当无法从热量推导餐次占比时使用的默认值（一餐约占全天 1/3）。
	defaultMealRatio = 1.0 / 3.0
	// minMealRatio 避免极低热量饮品导致微量元素目标过低的保护下限。
	minMealRatio = 0.15
	// maxMealRatio 避免单餐热量占比过高导致目标失真的保护上限。
	maxMealRatio = 0.50
	// calorieTolerance 热量评分在预期 ±20% 内不扣分。
	calorieTolerance = 0.20
)

// AnalysisScores 保存一次分析的多维度评分。
type AnalysisScores struct {
	ScoreEnabled       bool `json:"score_enabled"`
	MicronutrientScore int  `json:"micronutrient_score"`
	MacroBalanceScore  int  `json:"macro_balance_score"`
	CalorieScore       int  `json:"calorie_score"`
	FinalScore         int  `json:"final_score"`
}

// ComputeAnalysisScores 汇总一次分析的各项评分。
// enabled=false 时返回 AnalysisScores{ScoreEnabled:false}，便于调用方统一处理。
func clampScore(value float64) int {
	return int(math.Max(0, math.Min(100, math.Round(value))))
}

func ComputeAnalysisScores(items []map[string]any, dashboardTargets map[string]any, dailyCalorieTarget float64, enabled bool) AnalysisScores {
	if !enabled {
		return AnalysisScores{ScoreEnabled: false}
	}
	targets := nutrition.ResolveMicroNutrientTargets(dashboardTargets)
	if dailyCalorieTarget <= 0 {
		dailyCalorieTarget = nutrition.ResolveDailyCalorieTarget(dashboardTargets, nil)
	}

	micro := ComputeMicronutrientScore(items, targets, dailyCalorieTarget)
	macro := ComputeMacroBalanceScore(items)
	calorie := ComputeCalorieScore(items, dailyCalorieTarget)
	final := ComputeFinalScore(micro, macro, calorie)

	return AnalysisScores{
		ScoreEnabled:       true,
		MicronutrientScore: micro,
		MacroBalanceScore:  macro,
		CalorieScore:       calorie,
		FinalScore:         final,
	}
}

// ComputeMicronutrientScore 计算微量元素评分（0–100）。
// 算法：按餐次热量占每日热量比例折算每日目标，上限型营养素超标扣分，下限型营养素不足扣分。
func ComputeMicronutrientScore(items []map[string]any, targets map[string]float64, dailyCalorieTarget float64) int {
	totals := sumItemNutrients(items)
	mealCalories := totals["calories"]
	ratio := mealRatio(mealCalories, dailyCalorieTarget)

	var sum, count float64
	for _, cfg := range nutrition.MicroNutrientConfigs {
		dailyTarget := targets[cfg.Key]
		if dailyTarget <= 0 {
			continue
		}
		target := dailyTarget * ratio
		if target <= 0 {
			continue
		}
		current := totals[cfg.Key]

		var penalty float64
		switch cfg.Kind {
		case nutrition.MicroUpper:
			if current > target {
				penalty = (current - target) / target * 100.0 * cfg.Weight
			}
		default:
			if current < target {
				penalty = (target - current) / target * 100.0 * cfg.Weight
			}
		}
		if penalty > 100 {
			penalty = 100
		}
		score := 100.0 - penalty
		if score < 0 {
			score = 0
		}
		sum += score
		count++
	}

	if count == 0 {
		return 0
	}
	return clampScore(sum / count)
}

// ComputeMacroBalanceScore 计算宏量营养素平衡评分（0–100），复用社区 feed 的 PFC 理想比例 30/40/30。
func ComputeMacroBalanceScore(items []map[string]any) int {
	totals := sumItemNutrients(items)
	protein := totals["protein"]
	carbs := totals["carbs"]
	fat := totals["fat"]

	proteinKcal := protein * 4.0
	carbsKcal := carbs * 4.0
	fatKcal := fat * 9.0
	totalKcal := proteinKcal + carbsKcal + fatKcal
	if totalKcal <= 0 {
		return 0
	}

	proteinRatio := proteinKcal / totalKcal
	carbsRatio := carbsKcal / totalKcal
	fatRatio := fatKcal / totalKcal

	penalty := math.Abs(proteinRatio-0.30) + math.Abs(carbsRatio-0.40) + math.Abs(fatRatio-0.30)
	score := math.Max(0.0, 1.0-penalty/0.9) * 100.0
	return clampScore(score)
}

// ComputeCalorieScore 计算热量评分（0–100）。
// 按一餐占全天 1/3 的期望热量计算，偏差在 ±20% 内满分，超出后线性扣分。
func ComputeCalorieScore(items []map[string]any, dailyCalorieTarget float64) int {
	if dailyCalorieTarget <= 0 {
		return 0
	}
	totals := sumItemNutrients(items)
	mealCalories := totals["calories"]
	expected := dailyCalorieTarget * defaultMealRatio
	if expected <= 0 {
		return 0
	}

	deviation := math.Abs(mealCalories-expected) / expected
	if deviation <= calorieTolerance {
		return 100
	}
	penalty := (deviation - calorieTolerance) / (1.0 - calorieTolerance) * 100.0
	score := math.Max(0.0, 100.0-penalty)
	return clampScore(score)
}

// ComputeFinalScore 按权重聚合各维度评分。
func ComputeFinalScore(micro, macro, calorie int) int {
	final := 0.40*float64(micro) + 0.35*float64(macro) + 0.25*float64(calorie)
	return clampScore(final)
}

// sumItemNutrients 汇总分析结果中所有 items 的 nutrients，返回 key -> 总量。
func sumItemNutrients(items []map[string]any) map[string]float64 {
	totals := map[string]float64{
		"calories": 0,
		"protein":  0,
		"carbs":    0,
		"fat":      0,
	}
	for _, cfg := range nutrition.MicroNutrientConfigs {
		totals[cfg.Key] = 0
	}

	for _, item := range items {
		nutrients := mapFromAny(item["nutrients"])
		if len(nutrients) == 0 {
			continue
		}
		for key := range totals {
			totals[key] += numberFromAny(nutrients[key])
		}
	}
	return totals
}

// mealRatio 计算一餐占全天热量的比例，并做边界保护。
func mealRatio(mealCalories, dailyCalorieTarget float64) float64 {
	if dailyCalorieTarget <= 0 {
		return defaultMealRatio
	}
	if mealCalories <= 0 {
		return defaultMealRatio
	}
	ratio := mealCalories / dailyCalorieTarget
	if ratio < minMealRatio {
		return minMealRatio
	}
	if ratio > maxMealRatio {
		return maxMealRatio
	}
	return ratio
}

