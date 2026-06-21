package service

import (
	"testing"

	"food_link/backend/internal/nutrition"
)

func TestComputeMicronutrientScore_PerfectMeal(t *testing.T) {
	// 一餐 666 kcal，约占 2000 的 1/3，微量元素也按 1/3 提供。
	dailyTargets := nutrition.MicroNutrientDefaultTargets()
	items := []map[string]any{
		{
			"nutrients": map[string]any{
				"calories":       666,
				"protein":        20,
				"carbs":          80,
				"fat":            22,
				"fiber":          dailyTargets["fiber"] / 3,
				"sugar":          dailyTargets["sugar"] / 3,
				"saturatedFat":   dailyTargets["saturatedFat"] / 3,
				"cholesterolMg":  dailyTargets["cholesterolMg"] / 3,
				"sodiumMg":       dailyTargets["sodiumMg"] / 3,
				"potassiumMg":    dailyTargets["potassiumMg"] / 3,
				"calciumMg":      dailyTargets["calciumMg"] / 3,
				"ironMg":         dailyTargets["ironMg"] / 3,
				"magnesiumMg":    dailyTargets["magnesiumMg"] / 3,
				"zincMg":         dailyTargets["zincMg"] / 3,
				"vitaminARaeMcg": dailyTargets["vitaminARaeMcg"] / 3,
				"vitaminCMg":     dailyTargets["vitaminCMg"] / 3,
				"vitaminDMcg":    dailyTargets["vitaminDMcg"] / 3,
				"vitaminEMg":     dailyTargets["vitaminEMg"] / 3,
				"vitaminKMcg":    dailyTargets["vitaminKMcg"] / 3,
				"thiaminMg":      dailyTargets["thiaminMg"] / 3,
				"riboflavinMg":   dailyTargets["riboflavinMg"] / 3,
				"niacinMg":       dailyTargets["niacinMg"] / 3,
				"vitaminB6Mg":    dailyTargets["vitaminB6Mg"] / 3,
				"folateMcg":      dailyTargets["folateMcg"] / 3,
				"vitaminB12Mcg":  dailyTargets["vitaminB12Mcg"] / 3,
			},
		},
	}

	score := ComputeMicronutrientScore(items, dailyTargets, 2000)
	if score != 100 {
		t.Fatalf("expected perfect score 100, got %d", score)
	}
}

func TestComputeMicronutrientScore_SodiumExcess(t *testing.T) {
	dailyTargets := nutrition.MicroNutrientDefaultTargets()
	// 一餐热量正常，但钠达到全日目标（即超标 3 倍）
	items := []map[string]any{
		{
			"nutrients": map[string]any{
				"calories": 666,
				"protein":  20,
				"carbs":    80,
				"fat":      22,
				"sodiumMg": 2000.0,
			},
		},
	}

	score := ComputeMicronutrientScore(items, dailyTargets, 2000)
	if score >= 100 {
		t.Fatalf("expected score below 100 due to sodium excess, got %d", score)
	}
	if score < 0 {
		t.Fatalf("expected score >= 0, got %d", score)
	}
}

func TestComputeMicronutrientScore_VitaminDeficiency(t *testing.T) {
	dailyTargets := nutrition.MicroNutrientDefaultTargets()
	// 一餐几乎不含维生素 C
	items := []map[string]any{
		{
			"nutrients": map[string]any{
				"calories":   666,
				"protein":    20,
				"carbs":      80,
				"fat":        22,
				"vitaminCMg": 0.0,
			},
		},
	}

	score := ComputeMicronutrientScore(items, dailyTargets, 2000)
	if score >= 100 {
		t.Fatalf("expected score below 100 due to vitamin C deficiency, got %d", score)
	}
}

func TestComputeMicronutrientScore_CustomTarget(t *testing.T) {
	dailyTargets := nutrition.MicroNutrientDefaultTargets()
	dailyTargets["sodiumMg"] = 1000 // 用户自定义更严格的目标
	items := []map[string]any{
		{
			"nutrients": map[string]any{
				"calories": 666,
				"protein":  20,
				"carbs":    80,
				"fat":      22,
				"sodiumMg": 400.0, // 占每日 1000 的 40%，一餐目标 333，略超
			},
		},
	}

	score := ComputeMicronutrientScore(items, dailyTargets, 2000)
	if score >= 100 {
		t.Fatalf("expected score below 100 with strict sodium target, got %d", score)
	}
}

func TestComputeMacroBalanceScore(t *testing.T) {
	// 完美 PFC 30/40/30：protein 75g=300kcal, carbs 100g=400kcal, fat 33.3g=300kcal, total 1000
	items := []map[string]any{
		{
			"nutrients": map[string]any{
				"calories": 1000,
				"protein":  75,
				"carbs":    100,
				"fat":      33.3,
			},
		},
	}
	score := ComputeMacroBalanceScore(items, nil)
	if score != 100 {
		t.Fatalf("expected macro balance 100, got %d", score)
	}

	// 纯碳水
	items = []map[string]any{
		{
			"nutrients": map[string]any{
				"calories": 400,
				"protein":  0,
				"carbs":    100,
				"fat":      0,
			},
		},
	}
	score = ComputeMacroBalanceScore(items, nil)
	if score >= 100 {
		t.Fatalf("expected low macro balance for pure carbs, got %d", score)
	}

	// 用户自定义目标：蛋白质 40% / 碳水 40% / 脂肪 20%
	// 100g 蛋白质=400kcal, 100g 碳水=400kcal, 22.2g 脂肪=200kcal, 总 1000，比例 40/40/20
	customTargets := map[string]any{
		"protein_target": 100.0,
		"carbs_target":   100.0,
		"fat_target":     22.2,
	}
	items = []map[string]any{
		{
			"nutrients": map[string]any{
				"calories": 1000,
				"protein":  100,
				"carbs":    100,
				"fat":      22.2,
			},
		},
	}
	score = ComputeMacroBalanceScore(items, customTargets)
	if score != 100 {
		t.Fatalf("expected macro balance 100 with custom targets, got %d", score)
	}
}

func TestComputeCalorieScore(t *testing.T) {
	// 午餐 800 kcal，每日目标 2000，午餐期望 800，应得 100
	items := []map[string]any{
		{"nutrients": map[string]any{"calories": 800}},
	}
	score := ComputeCalorieScore(items, 2000, "lunch")
	if score != 100 {
		t.Fatalf("expected calorie score 100, got %d", score)
	}

	// 早餐 200 kcal，偏差较大
	items = []map[string]any{
		{"nutrients": map[string]any{"calories": 200}},
	}
	score = ComputeCalorieScore(items, 2000, "breakfast")
	if score >= 100 {
		t.Fatalf("expected lower calorie score for small breakfast, got %d", score)
	}

	// 未知餐次回退到 1/3：666 kcal vs 2000 每日目标
	items = []map[string]any{
		{"nutrients": map[string]any{"calories": 666}},
	}
	score = ComputeCalorieScore(items, 2000, "")
	if score != 100 {
		t.Fatalf("expected calorie score 100 for fallback ratio, got %d", score)
	}
}

func TestComputeFinalScore(t *testing.T) {
	final := ComputeFinalScore(100, 100, 100)
	if final != 100 {
		t.Fatalf("expected final 100, got %d", final)
	}

	final = ComputeFinalScore(80, 60, 70)
	// 0.4*80 + 0.35*60 + 0.25*70 = 32 + 21 + 17.5 = 70.5 -> 71
	if final != 71 {
		t.Fatalf("expected final 71, got %d", final)
	}
}

func TestComputeAnalysisScores_Disabled(t *testing.T) {
	items := []map[string]any{
		{"nutrients": map[string]any{"calories": 666}},
	}
	scores := ComputeAnalysisScores(items, nil, 2000, "lunch", false)
	if scores.ScoreEnabled {
		t.Fatal("expected score to be disabled")
	}
	if scores.FinalScore != 0 {
		t.Fatalf("expected final score 0 when disabled, got %d", scores.FinalScore)
	}
}
