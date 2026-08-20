package service

import (
	"fmt"
	"math"
	"strings"
)

const healthIndexMinRecordedDays = 2

// HealthIndex 健康指数计算结果
type HealthIndex struct {
	HasEnoughData     bool             `json:"has_enough_data"`
	OverallScore      int              `json:"overall_score"`
	ProjectedScore    int              `json:"projected_score"`
	OverallTrendLabel string           `json:"overall_trend_label"`
	OverviewCopy      string           `json:"overview_copy"`
	SignalChips       []SignalChip     `json:"signal_chips"`
	RiskCards         []RiskCard       `json:"risk_cards"`
	CustomRiskCards   []RiskCard       `json:"custom_risk_cards"`
	AllRiskOptions    []RiskOption     `json:"all_risk_options"`
	CustomFocusMeta   *CustomFocusMeta `json:"custom_focus_meta,omitempty"`
	TopIssues         []TopIssue       `json:"top_issues"`
	ActionList        []string         `json:"action_list"`
	ShowDisclaimer    bool             `json:"show_disclaimer"`
}

// CustomFocusMeta 自定义关注元信息
type CustomFocusMeta struct {
	MaxFocuses     int `json:"max_focuses"`
	GenerateCost   int `json:"generate_cost"`
	DailyLimit     int `json:"daily_limit"`
	UsedToday      int `json:"used_today"`
	RemainingToday int `json:"remaining_today"`
}

// SignalChip 信号芯片
type SignalChip struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// RiskCard 风险卡片
type RiskCard struct {
	Key          string `json:"key"`
	Title        string `json:"title"`
	Score        int    `json:"score"`
	Tone         string `json:"tone"`
	Brief        string `json:"brief"`
	Summary      string `json:"summary"`
	Basis        string `json:"basis"`
	Action       string `json:"action"`
	Delta        int    `json:"delta"`
	IsCustom     bool   `json:"is_custom,omitempty"`
	NeedsRefresh bool   `json:"needs_refresh,omitempty"`
	FocusLabel   string `json:"focus_label,omitempty"`
}

// RiskOption 风险选项
type RiskOption struct {
	Key      string `json:"key"`
	Title    string `json:"title"`
	Short    string `json:"short"`
	IsCustom bool   `json:"is_custom,omitempty"`
}

// TopIssue 问题项
type TopIssue struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

var statsMicronutrientWeights = map[string]float64{
	"fiber":          0.20,
	"sodiumMg":       0.15,
	"potassiumMg":    0.15,
	"calciumMg":      0.15,
	"ironMg":         0.10,
	"vitaminARaeMcg": 0.05,
	"vitaminCMg":     0.10,
	"vitaminDMcg":    0.10,
}

var statsSupplementSensitiveMicronutrients = map[string]bool{
	"calciumMg":      true,
	"ironMg":         true,
	"vitaminARaeMcg": true,
	"vitaminDMcg":    true,
}

func computeMicronutrientScore(comp *statsComputation) (int, string, string, string, string) {
	if comp == nil || len(comp.MicronutrientDaily) == 0 {
		return 0, "暂无微量营养数据。", "本期保存的记录里没有可用的微量营养字段，无法判断钙、铁、钾、维生素、膳食纤维等是否充足。", "", "继续保持记录，系统会在数据足够后给出微量营养趋势。"
	}

	score := 0.0
	var deficitLabels []string
	var excessLabels []string
	var supplementContextLabels []string
	var basisParts []string

	for _, ref := range statsInsightMicronutrientReferences {
		actual := comp.MicronutrientDaily[ref.Key]
		target := ref.DailyReference
		weight := statsMicronutrientWeights[ref.Key]
		if weight <= 0 {
			continue
		}

		var ratio float64
		if ref.Key == "sodiumMg" {
			if actual <= 0 {
				ratio = 1
			} else if actual <= target {
				ratio = 1
			} else {
				ratio = target / actual
			}
			if actual > target*1.2 {
				excessLabels = append(excessLabels, ref.Label)
			}
		} else {
			if actual >= target {
				ratio = 1
			} else if target > 0 {
				ratio = actual / target
			}
			if statsSupplementSensitiveMicronutrients[ref.Key] && target > 0 && actual < target {
				ratio = math.Max(ratio, 0.75)
			}
			if actual < target*0.5 && !statsSupplementSensitiveMicronutrients[ref.Key] {
				deficitLabels = append(deficitLabels, ref.Label)
			}
			if actual < target*0.5 && statsSupplementSensitiveMicronutrients[ref.Key] {
				supplementContextLabels = append(supplementContextLabels, ref.Label)
			}
		}
		score += ratio * weight * 100
		basisParts = append(basisParts, fmt.Sprintf("%s %.0f%s", ref.Label, actual, ref.Unit))
	}

	score = math.Max(0, math.Min(100, score))

	brief := "微量营养结构较均衡。"
	summary := "膳食纤维、钙、铁、钾、维生素等摄入趋势看起来比较充足。"
	action := "继续保持多样化的饮食结构，每周覆盖全谷物、深色蔬菜、奶制品和豆类。"

	s := int(math.Round(score))
	if s < 78 {
		brief = "微量营养还有提升空间。"
	}
	if s < 60 {
		brief = "部分微量营养偏低。"
		summary = "膳食纤维、维生素或矿物质的日均摄入低于建议水平，长期可能影响整体健康趋势。"
		action = "每天增加一份深色蔬菜、一份水果，并适量补充奶制品、豆类或全谷物。"
	}
	if s < 42 {
		brief = "微量营养缺口较明显。"
		summary = "多种微量元素摄入不足，是本期健康趋势的主要拖累项之一。"
		action = "优先把早餐或午餐的主食部分换成全谷物，并保证每天有蔬菜、水果和优质蛋白。"
	}

	if len(excessLabels) > 0 {
		brief = brief + fmt.Sprintf(" %s摄入偏高。", strings.Join(excessLabels, "、"))
		action = "注意控制盐和加工食品，优先从天然食材中获取营养。"
	} else if len(deficitLabels) > 0 {
		brief = brief + fmt.Sprintf(" %s偏低。", strings.Join(deficitLabels, "、"))
	}

	basis := fmt.Sprintf("近 %d 天日均：%s。", comp.RecordedDays, strings.Join(basisParts, "，"))
	if len(supplementContextLabels) > 0 {
		summary += fmt.Sprintf(" %s在饮食记录里偏低，但这里没有计入补剂摄入。", strings.Join(supplementContextLabels, "、"))
	}
	basis += " 仅基于饮食记录，不含补剂摄入。"
	return s, brief, summary, basis, action
}

func computeHealthIndex(comp *statsComputation, statsRange string) *HealthIndex {
	totalCalories := comp.TotalCalories
	tdee := float64(comp.TDEE)
	avgCaloriesPerDay := comp.AvgCaloriesPerDay
	macroPercent := comp.MacroPercent
	byMeal := comp.ByMeal
	dailyCalories := comp.DailyCalories
	recordedDays := comp.RecordedDays
	streakDays := comp.StreakDays
	dietGoal := healthIndexDietGoal(comp)
	weightReferenceCalories, weightReferenceLabel := healthIndexWeightReferenceCalories(tdee, dietGoal)

	if recordedDays < healthIndexMinRecordedDays {
		return &HealthIndex{
			HasEnoughData:     false,
			OverallScore:      0,
			ProjectedScore:    0,
			OverallTrendLabel: "",
			OverviewCopy:      "",
			SignalChips:       []SignalChip{{Label: "已记录", Value: fmt.Sprintf("%d 天", recordedDays)}},
			RiskCards:         []RiskCard{},
			CustomRiskCards:   []RiskCard{},
			AllRiskOptions:    []RiskOption{},
			TopIssues:         []TopIssue{},
			ActionList:        []string{},
			ShowDisclaimer:    comp.User != nil && comp.User.HealthDisclaimerAcknowledgedAt == nil,
		}
	}

	surplusDays := 0
	weightOverTargetDays := 0
	for _, item := range dailyCalories {
		if item.Calories > 0 && item.Calories > tdee {
			surplusDays++
		}
		if item.Calories > 0 && weightReferenceCalories > 0 && item.Calories > weightReferenceCalories {
			weightOverTargetDays++
		}
	}

	var surplusRate float64
	var weightOverTargetRate float64
	if recordedDays > 0 {
		surplusRate = float64(surplusDays) / float64(recordedDays)
		weightOverTargetRate = float64(weightOverTargetDays) / float64(recordedDays)
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
	var weightEnergyOverRatio float64
	if weightReferenceCalories > 0 {
		weightEnergyOverRatio = math.Max(0, avgCaloriesPerDay-weightReferenceCalories) / weightReferenceCalories
	}

	dinnerOver35 := math.Max(0, dinnerPct-35)
	dinnerOver38 := math.Max(0, dinnerPct-38)
	snackOver15 := math.Max(0, snackPct-15)
	breakfastUnder18 := math.Max(0, 18-breakfastPct)
	carbOver50 := math.Max(0, macroPercent["carbs"]-50)
	fatOver30 := math.Max(0, macroPercent["fat"]-30)
	proteinUnder20 := math.Max(0, 20-macroPercent["protein"])

	hypertensionScore := clampScore(
		100 -
			surplusRate*25 -
			dinnerOver35*2.0 -
			snackOver15*0.5 -
			energyOverRatio*35 -
			breakfastUnder18*0.5,
	)

	diabetesScore := clampScore(
		100 -
			carbOver50*1.5 -
			proteinUnder20*1.8 -
			surplusRate*20 -
			snackOver15*1.9 -
			dinnerOver35*2.2,
	)

	cardioScore := clampScore(
		100 -
			fatOver30*3.5 -
			surplusRate*20 -
			dinnerOver35*1.5 -
			energyOverRatio*30,
	)

	var weightBonus float64
	if statsRange == "week" && recordedDays >= 5 {
		weightBonus = 3
	} else if statsRange == "month" && recordedDays >= 18 {
		weightBonus = 3
	}

	weightTrendAdjustment, weightTrendSupportsGoal, weightTrendAgainstGoal := healthIndexWeightTrendAdjustment(comp, dietGoal)
	weightScore := clampScore(
		100 -
			weightEnergyOverRatio*40 -
			weightOverTargetRate*25 -
			snackOver15*0.5 -
			dinnerOver38*4.0 +
			weightTrendAdjustment +
			weightBonus,
	)

	micronutrientScore, microBrief, microSummary, microBasis, microAction := computeMicronutrientScore(comp)
	hasMicronutrientData := len(comp.MicronutrientDaily) > 0

	baseScoreSum := float64(hypertensionScore + diabetesScore + cardioScore + weightScore)
	scoreDivisor := 4
	if hasMicronutrientData {
		baseScoreSum += float64(micronutrientScore)
		scoreDivisor = 5
	}
	overallRiskScore := clampScore(baseScoreSum / float64(scoreDivisor))

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

	colorectalScore := clampScore(
		100 -
			fatOver30*2.0 -
			carbOver50*0.8 -
			snackOver15*1.2 -
			surplusRate*12,
	)

	longevityScore := clampScore(
		100 -
			energyOverRatio*28 -
			surplusRate*18 -
			dinnerOver35*1.2 -
			fatOver30*1.5 -
			carbOver50*1.0 +
			bonusIf(recordedDays >= thresholdDays(statsRange), 5),
	)
	weightOverTarget := weightTrendAgainstGoal || (weightEnergyOverRatio > 0.08 && !weightTrendSupportsGoal)
	weightBrief, weightSummary, weightAction := healthIndexWeightCopy(dietGoal, weightOverTarget)
	weightBasis := healthIndexWeightBasis(avgCaloriesPerDay, weightReferenceCalories, tdee, streakDays, weightReferenceLabel, comp.BodyMetrics)

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
			Brief:   weightBrief,
			Summary: weightSummary,
			Basis:   weightBasis,
			Action:  weightAction,
			Delta:   clampScore(ifElseFloat(weightOverTarget, 13, 8) + ifElseFloat(dinnerPct > 40, 5, 0)),
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
			Delta:   clampScore(ifElseFloat(snackPct > 18, 9, 6) + ifElseFloat(fatOver30 > 0, 4, 0)),
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

	if hasMicronutrientData {
		riskCards = append(riskCards, RiskCard{
			Key:     "micronutrient",
			Title:   "微量营养充足度",
			Score:   micronutrientScore,
			Tone:    scoreToTone(micronutrientScore),
			Brief:   microBrief,
			Summary: microSummary,
			Basis:   microBasis,
			Action:  microAction,
			Delta:   clampScore(ifElseFloat(float64(micronutrientScore) < 60, 12, 6)),
		})
	}

	allRiskOptions := []RiskOption{
		{Key: "hypertension", Title: "血压管理友好度", Short: "血压"},
		{Key: "diabetes", Title: "血糖稳定友好度", Short: "血糖"},
		{Key: "cardio", Title: "心血管友好度", Short: "心血管"},
		{Key: "weight", Title: "体重管理友好度", Short: "体重"},
		{Key: "colorectal", Title: "肠道状态友好度", Short: "肠道"},
		{Key: "longevity", Title: "长期状态趋势", Short: "长期"},
	}
	if hasMicronutrientData {
		allRiskOptions = append(allRiskOptions, RiskOption{Key: "micronutrient", Title: "微量营养充足度", Short: "微量营养"})
	}

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
	if hasMicronutrientData && micronutrientScore < 60 {
		actionList = append(actionList, microAction)
	}
	if len(actionList) == 0 {
		actionList = []string{"先保持记录连续 1 周，再根据超标天数和睡前餐占比做微调。"}
	} else if len(actionList) > 3 {
		actionList = actionList[:3]
	}

	return &HealthIndex{
		HasEnoughData:     recordedDays >= healthIndexMinRecordedDays,
		OverallScore:      overallRiskScore,
		ProjectedScore:    projectedOverallScore,
		OverallTrendLabel: overallTrendLabel,
		OverviewCopy:      overviewCopy,
		SignalChips:       signalChips,
		RiskCards:         riskCards,
		CustomRiskCards:   []RiskCard{},
		AllRiskOptions:    allRiskOptions,
		TopIssues:         topIssues,
		ActionList:        actionList,
		ShowDisclaimer:    comp.User != nil && comp.User.HealthDisclaimerAcknowledgedAt == nil,
	}
}

func healthIndexDietGoal(comp *statsComputation) string {
	if comp == nil || comp.User == nil || comp.User.DietGoal == nil {
		return ""
	}
	return strings.TrimSpace(*comp.User.DietGoal)
}

func healthIndexWeightReferenceCalories(tdee float64, dietGoal string) (float64, string) {
	switch dietGoal {
	case "fat_loss":
		return tdee - clampHealthIndexFloat(tdee*0.16, 300, 500), "减脂参考目标"
	case "muscle_gain":
		return tdee + clampHealthIndexFloat(tdee*0.10, 150, 300), "增肌参考目标"
	default:
		return tdee, "TDEE"
	}
}

func healthIndexWeightBasis(avgCaloriesPerDay, referenceCalories, tdee float64, streakDays int, referenceLabel string, bodyMetrics *BodyMetricsSummary) string {
	basis := ""
	if referenceLabel == "TDEE" {
		basis = fmt.Sprintf("日均摄入 %.0f kcal，对比 TDEE %.0f kcal；饮食打卡 %d 天。", avgCaloriesPerDay, tdee, streakDays)
	} else {
		basis = fmt.Sprintf("日均摄入 %.0f kcal，对比%s %.0f kcal（TDEE %.0f kcal）；饮食打卡 %d 天。", avgCaloriesPerDay, referenceLabel, referenceCalories, tdee, streakDays)
	}
	return appendWeightTrendToBasis(basis, bodyMetrics)
}

func healthIndexWeightCopy(dietGoal string, overTarget bool) (string, string, string) {
	switch dietGoal {
	case "muscle_gain":
		if overTarget {
			return "盈余略超计划。",
				"日均摄入已经高于增肌参考目标，体重管理压力主要来自盈余过多或重复超出计划。",
				"保留蛋白质和训练日前后主食，优先收紧最常超出的高油加餐或额外主食，再观察 1 周。"
		}
		return "增肌盈余基本可控。",
			"热量总体接近增肌目标，当前更适合稳住蛋白、训练日前后主食和恢复节奏。",
			"保持总量不大改，优先把盈余放在训练日前后，少让高油加餐承担主要热量。"
	case "fat_loss":
		if overTarget {
			return "重复超标在累积。",
				"日均摄入高于减脂参考目标，体重管理压力主要来自重复性超标。",
				"先把最常超标的一餐减少约 1/4 主食或高油部分，再观察 1 周。"
		}
		return "接近减脂目标。",
			"热量总体接近减脂目标，但餐次集中和加餐结构仍有优化空间。",
			"保持总量不大改，优先优化睡前餐和加餐的时段分布。"
	default:
		if overTarget {
			return "重复超标在累积。",
				"平均摄入已经高于当前消耗，体重管理压力主要来自重复性超标。",
				"先把最常超标的一餐减少约 1/4 主食或高油部分，再观察 1 周。"
		}
		return "总量接近目标。",
			"热量总体接近目标，但餐次集中和加餐结构仍有优化空间。",
			"保持总量不大改，优先优化睡前餐和加餐的时段分布。"
	}
}

func healthIndexWeightTrendAdjustment(comp *statsComputation, dietGoal string) (float64, bool, bool) {
	if comp == nil || comp.BodyMetrics == nil || comp.BodyMetrics.WeightChange == nil {
		return 0, false, false
	}
	change := *comp.BodyMetrics.WeightChange
	switch dietGoal {
	case "fat_loss":
		switch {
		case change <= -0.3:
			return 12, true, false
		case change <= -0.1:
			return 6, true, false
		case change >= 0.3:
			return -10, false, true
		}
	case "muscle_gain":
		switch {
		case change >= 0.2:
			return 8, true, false
		case change <= -0.3:
			return -10, false, true
		}
	default:
		switch {
		case change <= -0.3:
			return 5, true, false
		case change >= 0.5:
			return -8, false, true
		}
	}
	return 0, false, false
}

func appendWeightTrendToBasis(basis string, bodyMetrics *BodyMetricsSummary) string {
	if bodyMetrics == nil || bodyMetrics.LatestWeight == nil {
		return basis
	}
	out := basis + fmt.Sprintf(" 最新体重 %.1f kg", bodyMetrics.LatestWeight.Value)
	if bodyMetrics.WeightChange == nil {
		return out + "。"
	}
	change := *bodyMetrics.WeightChange
	switch {
	case change > 0:
		return out + fmt.Sprintf("，较前一次上升 %.1f kg。", math.Abs(change))
	case change < 0:
		return out + fmt.Sprintf("，较前一次下降 %.1f kg。", math.Abs(change))
	default:
		return out + "，较前一次基本持平。"
	}
}

func clampHealthIndexFloat(value, minVal, maxVal float64) float64 {
	return math.Max(minVal, math.Min(maxVal, value))
}

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
