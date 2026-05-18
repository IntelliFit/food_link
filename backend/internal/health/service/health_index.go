package service

import (
	"fmt"
	"math"
)

// HealthIndex 健康指数计算结果
type HealthIndex struct {
	HasEnoughData     bool         `json:"has_enough_data"`
	OverallScore      int          `json:"overall_score"`
	ProjectedScore    int          `json:"projected_score"`
	OverallTrendLabel string       `json:"overall_trend_label"`
	OverviewCopy      string       `json:"overview_copy"`
	SignalChips       []SignalChip `json:"signal_chips"`
	RiskCards         []RiskCard   `json:"risk_cards"`
	AllRiskOptions    []RiskOption `json:"all_risk_options"`
	TopIssues         []TopIssue   `json:"top_issues"`
	ActionList        []string     `json:"action_list"`
	ShowDisclaimer    bool         `json:"show_disclaimer"`
}

// SignalChip 信号芯片
type SignalChip struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// RiskCard 风险卡片
type RiskCard struct {
	Key     string `json:"key"`
	Title   string `json:"title"`
	Score   int    `json:"score"`
	Tone    string `json:"tone"`
	Brief   string `json:"brief"`
	Summary string `json:"summary"`
	Basis   string `json:"basis"`
	Action  string `json:"action"`
	Delta   int    `json:"delta"`
}

// RiskOption 风险选项
type RiskOption struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Short string `json:"short"`
}

// TopIssue 问题项
type TopIssue struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

func computeHealthIndex(comp *statsComputation, statsRange string) *HealthIndex {
	// 基础指标
	totalCalories := comp.TotalCalories
	tdee := float64(comp.TDEE)
	avgCaloriesPerDay := comp.AvgCaloriesPerDay
	macroPercent := comp.MacroPercent
	byMeal := comp.ByMeal
	dailyCalories := comp.DailyCalories
	recordedDays := comp.RecordedDays
	streakDays := comp.StreakDays

	// 超标天数
	surplusDays := 0
	for _, item := range dailyCalories {
		if item.Calories > 0 && item.Calories > tdee {
			surplusDays++
		}
	}

	var surplusRate float64
	if recordedDays > 0 {
		surplusRate = float64(surplusDays) / float64(recordedDays)
	}

	breakfastCombined := byMeal["breakfast"] + byMeal["morning_snack"]
	dinnerCombined := byMeal["dinner"] + byMeal["evening_snack"]
	snackCombined := byMeal["morning_snack"] + byMeal["afternoon_snack"] + byMeal["evening_snack"]

	var breakfastPct, dinnerPct, snackPct float64
	if totalCalories > 0 {
		breakfastPct = (breakfastCombined / totalCalories) * 100
		dinnerPct = (dinnerCombined / totalCalories) * 100
		snackPct = (snackCombined / totalCalories) * 100
	}

	var energyOverRatio float64
	if tdee > 0 {
		energyOverRatio = math.Max(0, avgCaloriesPerDay-tdee) / tdee
	}

	carbGap := math.Max(0, macroPercent["carbs"]-50)
	fatGap := math.Max(0, macroPercent["fat"]-32)
	proteinGap := math.Max(0, 20-macroPercent["protein"])
	dinnerPenalty := math.Max(0, dinnerPct-38)
	snackPenalty := math.Max(0, snackPct-18)

	// 四个核心维度得分
	hypertensionScore := clampScore(
		82 -
			surplusRate*18 -
			dinnerPenalty*0.8 -
			snackPenalty*0.45 -
			energyOverRatio*26 +
			bonusIf(breakfastPct >= 18, 3),
	)

	diabetesScore := clampScore(
		80 -
			carbGap*1.25 -
			proteinGap*1.4 -
			surplusRate*16 -
			snackPenalty*0.65 +
			bonusIf(macroPercent["protein"] >= 20 && macroPercent["protein"] <= 30, 4),
	)

	cardioScore := clampScore(
		79 -
			fatGap*1.15 -
			surplusRate*14 -
			dinnerPenalty*0.7 -
			energyOverRatio*20 +
			bonusIf(macroPercent["protein"] >= 18 && macroPercent["protein"] <= 28, 3),
	)

	var weightBonus float64
	if statsRange == "week" && recordedDays >= 5 {
		weightBonus = 4
	} else if statsRange == "month" && recordedDays >= 18 {
		weightBonus = 4
	}

	weightScore := clampScore(
		78 -
			energyOverRatio*38 -
			surplusRate*22 -
			snackPenalty*0.45 -
			math.Max(0, dinnerPct-40)*0.55 +
			weightBonus,
	)

	overallRiskScore := clampScore(float64(hypertensionScore+diabetesScore+cardioScore+weightScore) / 4)

	projectedOverallScore := clampScore(
		float64(overallRiskScore) +
			bonusIf(surplusRate > 0.45, 8) +
			bonusIf(dinnerPct > 40, 7) +
			bonusIf(macroPercent["protein"] < 20, 6) +
			bonusIf(macroPercent["carbs"] > 50, 5),
	)

	overallTrendLabel := scoreToLabel(overallRiskScore)
	overviewCopy := scoreToTrendCopy(overallRiskScore)

	signalChips := []SignalChip{
		{Label: "已记录", Value: fmt.Sprintf("%d 天", recordedDays)},
		{Label: "超出消耗", Value: fmt.Sprintf("%d 天", surplusDays)},
		{Label: "睡前餐占比", Value: formatPercent(dinnerPct)},
		{Label: "连续记录", Value: fmt.Sprintf("%d 天", streakDays)},
	}

	// 肠道状态友好度
	colorectalScore := clampScore(
		76 -
			fatGap*0.9 -
			carbGap*0.45 -
			snackPenalty*0.6 -
			surplusRate*10 +
			bonusIf(macroPercent["protein"] >= 18 && macroPercent["protein"] <= 28, 4),
	)

	// 长期状态趋势
	longevityScore := clampScore(
		78 -
			energyOverRatio*24 -
			surplusRate*15 -
			dinnerPenalty*0.55 -
			fatGap*0.75 -
			carbGap*0.55 +
			bonusIf(recordedDays >= thresholdDays(statsRange), 5),
	)

	// 风险卡片
	riskCards := []RiskCard{
		{
			Key:     "hypertension",
			Title:   "血压管理友好度",
			Score:   hypertensionScore,
			Tone:    scoreToTone(hypertensionScore),
			Brief:   ifElseStr(dinnerPct > 40, "晚间负担偏重。", "分布基本可控。"),
			Summary: ifElseStr(dinnerPct > 40, "晚餐与夜间热量偏集中，长期更容易把饮食结构推向不友好区。", "热量分布还算可控，但仍需避免把超标集中压在晚餐。"),
			Basis:   fmt.Sprintf("最近 %d 天里有 %d 天摄入高于消耗，晚餐/夜间占比 %s。", recordedDays, surplusDays, formatPercent(dinnerPct)),
			Action:  ifElseStr(dinnerPct > 40, "把晚餐主食或高油部分前移一部分到早餐/午餐。", "继续维持白天优先，避免晚间补偿性进食。"),
			Delta:   clampScore(ifElseFloat(dinnerPct > 40, 12, 7) + ifElseFloat(surplusRate > 0.45, 6, 0)),
		},
		{
			Key:     "diabetes",
			Title:   "血糖稳定友好度",
			Score:   diabetesScore,
			Tone:    scoreToTone(diabetesScore),
			Brief:   ifElseStr(macroPercent["carbs"] > 50, "主食偏重，支撑偏弱。", "代谢压力暂时可控。"),
			Summary: ifElseStr(macroPercent["carbs"] > 50, "当前主要拖累是碳水占比偏高，同时蛋白质支撑不足。", "代谢结构不算差，但还可以把蛋白质和饱腹感做得更稳。"),
			Basis:   fmt.Sprintf("碳水 %s，蛋白质 %s，加餐热量占比 %s。", formatPercent(macroPercent["carbs"]), formatPercent(macroPercent["protein"]), formatPercent(snackPct)),
			Action:  ifElseStr(macroPercent["carbs"] > 50, "把一部分主食换成蛋白质或蔬菜，先从最常超标的一餐改起。", "保留当前主食量的同时，每餐补一个更稳定的蛋白来源。"),
			Delta:   clampScore(ifElseFloat(macroPercent["carbs"] > 50, 12, 8) + ifElseFloat(macroPercent["protein"] < 20, 6, 0)),
		},
		{
			Key:     "cardio",
			Title:   "心血管友好度",
			Score:   cardioScore,
			Tone:    scoreToTone(cardioScore),
			Brief:   ifElseStr(macroPercent["fat"] > 32, "高油频率偏多。", "整体还在中性区。"),
			Summary: ifElseStr(macroPercent["fat"] > 32, "脂肪占比和连续超标频率一起拖累了心血管保护趋势。", "总体还在可接受区，但连续超标天数已经开始拉低长期保护感。"),
			Basis:   fmt.Sprintf("脂肪 %s，超出消耗天数 %d/%d，睡前餐占比 %s。", formatPercent(macroPercent["fat"]), surplusDays, recordedDays, formatPercent(dinnerPct)),
			Action:  ifElseStr(macroPercent["fat"] > 32, "优先减少最常出现的高油菜和夜间加餐，不必一次性大幅节食。", "先把每周最容易超标的 2-3 餐压下来，保护分会更明显回升。"),
			Delta:   clampScore(ifElseFloat(macroPercent["fat"] > 32, 10, 7) + ifElseFloat(surplusRate > 0.45, 5, 0)),
		},
		{
			Key:     "weight",
			Title:   "体重管理友好度",
			Score:   weightScore,
			Tone:    scoreToTone(weightScore),
			Brief:   ifElseStr(energyOverRatio > 0.08, "重复超标在累积。", "总量接近目标。"),
			Summary: ifElseStr(energyOverRatio > 0.08, "平均摄入已经高于当前消耗，体重管理压力主要来自重复性超标。", "热量总体接近目标，但餐次集中和加餐结构仍有优化空间。"),
			Basis:   fmt.Sprintf("日均摄入 %.0f kcal，对比 TDEE %.0f kcal；饮食打卡 %d 天。", avgCaloriesPerDay, tdee, streakDays),
			Action:  ifElseStr(energyOverRatio > 0.08, "先把最常超标的一餐减少约 1/4 主食或高油部分，再观察 1 周。", "保持总量不大改，优先优化睡前餐和加餐的时段分布。"),
			Delta:   clampScore(ifElseFloat(energyOverRatio > 0.08, 13, 8) + ifElseFloat(dinnerPct > 40, 5, 0)),
		},
		{
			Key:     "colorectal",
			Title:   "肠道状态友好度",
			Score:   colorectalScore,
			Tone:    scoreToTone(colorectalScore),
			Brief:   ifElseStr(snackPct > 18, "结构偏散，重复性偏高。", "整体还算整齐。"),
			Summary: ifElseStr(snackPct > 18, "加餐偏多、结构偏散时，长期饮食质量通常会被一点点拖低。", "这段时间的饮食结构还算整齐，但仍要警惕高油高精制主食的重复出现。"),
			Basis:   fmt.Sprintf("加餐占比 %s，脂肪 %s，连续超标 %d/%d 天。", formatPercent(snackPct), formatPercent(macroPercent["fat"]), surplusDays, recordedDays),
			Action:  "优先减少最容易重复出现的重油重加工那一类餐食，让整体结构更干净。",
			Delta:   clampScore(ifElseFloat(snackPct > 18, 9, 6) + ifElseFloat(fatGap > 0, 4, 0)),
		},
		{
			Key:     "longevity",
			Title:   "长期状态趋势",
			Score:   longevityScore,
			Tone:    scoreToTone(longevityScore),
			Brief:   ifElseStr(surplusRate > 0.45, "重复性问题在拖分。", "长期趋势还能再修。"),
			Summary: ifElseStr(surplusRate > 0.45, "拖累长期趋势的，不是某一顿，而是反复出现的超标和晚间集中。", "只要继续把主要问题控制住，这段时间的长期趋势还有往上修的空间。"),
			Basis:   fmt.Sprintf("已记录 %d 天，超出消耗 %d 天，睡前餐/夜间占比 %s。", recordedDays, surplusDays, formatPercent(dinnerPct)),
			Action:  "先把重复出现的问题降频，比偶尔一次\"吃得特别完美\"更有用。",
			Delta:   clampScore(ifElseFloat(surplusRate > 0.45, 10, 7) + ifElseFloat(recordedDays >= thresholdDays(statsRange), 3, 0)),
		},
	}

	allRiskOptions := []RiskOption{
		{Key: "hypertension", Title: "血压管理友好度", Short: "血压"},
		{Key: "diabetes", Title: "血糖稳定友好度", Short: "血糖"},
		{Key: "cardio", Title: "心血管友好度", Short: "心血管"},
		{Key: "weight", Title: "体重管理友好度", Short: "体重"},
		{Key: "colorectal", Title: "肠道状态友好度", Short: "肠道"},
		{Key: "longevity", Title: "长期状态趋势", Short: "长期"},
	}

	// 问题列表
	var topIssues []TopIssue
	if surplusRate > 0.45 {
		topIssues = append(topIssues, TopIssue{Title: "连续超出消耗", Detail: fmt.Sprintf("%d/%d 天摄入高于 TDEE", surplusDays, recordedDays)})
	}
	if dinnerPct > 40 {
		topIssues = append(topIssues, TopIssue{Title: "睡前餐过于集中", Detail: fmt.Sprintf("睡前餐与夜间占全天 %s", formatPercent(dinnerPct))})
	}
	if macroPercent["carbs"] > 50 {
		topIssues = append(topIssues, TopIssue{Title: "碳水占比偏高", Detail: fmt.Sprintf("当前碳水占比 %s", formatPercent(macroPercent["carbs"]))})
	}
	if macroPercent["protein"] < 20 {
		topIssues = append(topIssues, TopIssue{Title: "蛋白质支撑偏弱", Detail: fmt.Sprintf("当前蛋白质占比 %s", formatPercent(macroPercent["protein"]))})
	}
	if snackPct > 18 {
		topIssues = append(topIssues, TopIssue{Title: "加餐热量偏多", Detail: fmt.Sprintf("加餐已占全天 %s", formatPercent(snackPct))})
	}
	if len(topIssues) > 3 {
		topIssues = topIssues[:3]
	}

	// 行动建议
	var actionList []string
	if surplusRate > 0.45 {
		actionList = append(actionList, "先把每周最容易超标的 2-3 餐压下来，不求每餐都完美。")
	}
	if dinnerPct > 40 {
		actionList = append(actionList, "把睡前餐的一部分主食或高油菜前移到起床后第一餐/中间餐。")
	}
	if macroPercent["carbs"] > 50 {
		actionList = append(actionList, "主食先减 1/4，补一份更稳定的蛋白质或蔬菜。")
	}
	if macroPercent["protein"] < 20 {
		actionList = append(actionList, "每餐固定补一个蛋白来源，先从早餐或午餐开始。")
	}
	if len(actionList) == 0 {
		actionList = []string{"先保持记录连续 1 周，再根据超标天数和睡前餐占比做微调。"}
	} else if len(actionList) > 3 {
		actionList = actionList[:3]
	}

	return &HealthIndex{
		HasEnoughData:     recordedDays >= 2,
		OverallScore:      overallRiskScore,
		ProjectedScore:    projectedOverallScore,
		OverallTrendLabel: overallTrendLabel,
		OverviewCopy:      overviewCopy,
		SignalChips:       signalChips,
		RiskCards:         riskCards,
		AllRiskOptions:    allRiskOptions,
		TopIssues:         topIssues,
		ActionList:        actionList,
		ShowDisclaimer:    comp.User != nil && comp.User.HealthDisclaimerAcknowledgedAt == nil,
	}
}

// ---- 辅助函数 ----

func clampScore(value float64) int {
	return int(math.Max(0, math.Min(100, math.Round(value))))
}

func scoreToTone(score int) string {
	if score >= 78 {
		return "positive"
	}
	if score >= 60 {
		return "neutral"
	}
	if score >= 42 {
		return "warning"
	}
	return "danger"
}

func scoreToLabel(score int) string {
	if score >= 78 {
		return "偏保护"
	}
	if score >= 60 {
		return "基本中性"
	}
	if score >= 42 {
		return "需要关注"
	}
	return "重点关注"
}

func scoreToTrendCopy(score int) string {
	if score >= 78 {
		return "这段时间的饮食模式整体更偏向保护。"
	}
	if score >= 60 {
		return "总体还算稳，但已经出现一些可逆转的拖累项。"
	}
	if score >= 42 {
		return "最近的吃法已经在把你推向更高风险区。"
	}
	return "如果继续这样吃，长期风险趋势会比较不友好。"
}

func formatPercent(value float64) string {
	return fmt.Sprintf("%d%%", int(math.Round(value)))
}

func bonusIf(condition bool, value float64) float64 {
	if condition {
		return value
	}
	return 0
}

func ifElseStr(condition bool, trueVal, falseVal string) string {
	if condition {
		return trueVal
	}
	return falseVal
}

func ifElseFloat(condition bool, trueVal, falseVal float64) float64 {
	if condition {
		return trueVal
	}
	return falseVal
}

func thresholdDays(statsRange string) int {
	if statsRange == "week" {
		return 5
	}
	return 18
}
