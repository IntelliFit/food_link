package service

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
)

// nutritionReadingSpec is one line of "今天还差什么": which nutrient, where its value
// comes from and how much it weighs when the gaps are ranked.
type nutritionReadingSpec struct {
	Key, Label, Unit, RuleKey string
	Weight                    float64
	Always                    bool
}

var nutritionReadingSpecs = []nutritionReadingSpec{
	{Key: "energy", Label: "热量", Unit: "kcal", Weight: 0, Always: true},
	{Key: "protein", Label: "蛋白质", Unit: "g", Weight: 1, Always: true},
	{Key: "fiber", Label: "膳食纤维", Unit: "g", RuleKey: "fiber", Weight: .8, Always: true},
	{Key: "vegetables", Label: "蔬菜", Unit: "g", Weight: .8, Always: true},
	{Key: "sodium", Label: "钠", Unit: "mg", RuleKey: "sodiumMg", Always: true},
	{Key: "added_sugar", Label: "添加糖", Unit: "g", RuleKey: "freeSugar"},
	{Key: "sat_fat", Label: "饱和脂肪", Unit: "g", RuleKey: "saturatedFat"},
	{Key: "potassium", Label: "钾", Unit: "mg", RuleKey: "potassiumMg", Weight: .4},
	{Key: "calcium", Label: "钙", Unit: "mg", RuleKey: "calciumMg", Weight: .4},
	{Key: "water", Label: "喝水", Unit: "ml", Weight: .5},
}

const nutritionNearLimitShare = .85

// nutritionTodayReadings evaluates one day against its targets. A ceiling nutrient
// whose meals are partly unknown is "unknown" while the known part stays under the
// ceiling: a lower bound cannot show it is fine. waterML < 0 means water is not tracked.
func nutritionTodayReadings(day nutritionDay, waterML, waterGoal float64) []domain.NutrientReading {
	readings := []domain.NutrientReading{}
	for _, spec := range nutritionReadingSpecs {
		switch spec.Key {
		case "energy":
			if day.CalorieGoal > 0 {
				readings = append(readings, nutritionRangeReading(spec, day.Calories, day.CalorieGoal))
			}
		case "protein":
			if day.ProteinGoal > 0 {
				readings = append(readings, nutritionMinReading(spec, day.Protein, day.ProteinGoal, 0))
			}
		case "vegetables":
			readings = append(readings, nutritionMinReading(spec, day.VegGrams, nutritionVegetableTarget, 0))
		case "water":
			if waterML >= 0 && waterGoal > 0 {
				readings = append(readings, nutritionMinReading(spec, waterML, waterGoal, 0))
			}
		default:
			rule, ok := day.rule(spec.RuleKey)
			if !ok {
				continue
			}
			value, _, known := day.known(spec.RuleKey)
			if !known && !spec.Always {
				continue
			}
			unknown := day.UnknownMeals[spec.RuleKey]
			if rule.Limit > 0 {
				readings = append(readings, nutritionMaxReading(spec, value, known, rule.Limit, unknown))
			} else if rule.Target > 0 {
				reading := nutritionMinReading(spec, value, rule.Target, unknown)
				if !known {
					reading.Value, reading.Status, reading.Gap = nil, domain.NutrientStatusUnknown, 0
				}
				readings = append(readings, reading)
			}
		}
	}
	return readings
}

func nutritionValue(v float64) *float64 {
	v = math.Round(v)
	return &v
}

func nutritionMinReading(spec nutritionReadingSpec, value, target float64, unknown int) domain.NutrientReading {
	r := domain.NutrientReading{Key: spec.Key, Label: spec.Label, Unit: spec.Unit, Value: nutritionValue(value), Target: math.Round(target), Kind: "min", UnknownMeals: unknown}
	if value >= target {
		r.Status = domain.NutrientStatusOK
	} else {
		r.Status, r.Gap = domain.NutrientStatusShort, math.Round(target-value)
	}
	return r
}

func nutritionMaxReading(spec nutritionReadingSpec, value float64, known bool, limit float64, unknown int) domain.NutrientReading {
	r := domain.NutrientReading{Key: spec.Key, Label: spec.Label, Unit: spec.Unit, Target: math.Round(limit), Kind: "max", UnknownMeals: unknown}
	if !known {
		r.Status = domain.NutrientStatusUnknown
		return r
	}
	r.Value = nutritionValue(value)
	switch {
	case value > limit:
		r.Status, r.Gap = domain.NutrientStatusOver, math.Round(value-limit)
	case value >= limit*nutritionNearLimitShare:
		r.Status, r.Gap = domain.NutrientStatusNearLimit, math.Round(limit-value)
	case unknown > 0:
		r.Status, r.Gap = domain.NutrientStatusUnknown, math.Round(limit-value)
	default:
		r.Status, r.Gap = domain.NutrientStatusOK, math.Round(limit-value)
	}
	return r
}

func nutritionRangeReading(spec nutritionReadingSpec, value, target float64) domain.NutrientReading {
	r := domain.NutrientReading{Key: spec.Key, Label: spec.Label, Unit: spec.Unit, Value: nutritionValue(value), Target: math.Round(target), Kind: "range"}
	switch {
	case value > target*1.1:
		r.Status, r.Gap = domain.NutrientStatusOver, math.Round(value-target)
	case value >= target*.9:
		r.Status = domain.NutrientStatusOK
	default:
		r.Status, r.Gap = domain.NutrientStatusShort, math.Round(target-value)
	}
	return r
}

// nutritionTodayGaps ranks what matters most today: anything over its ceiling first,
// then what is close to one, then the biggest shortfalls weighted by importance.
func nutritionTodayGaps(readings []domain.NutrientReading) []domain.NutritionGap {
	weights := map[string]float64{}
	for _, spec := range nutritionReadingSpecs {
		weights[spec.Key] = spec.Weight
	}
	gaps := []domain.NutritionGap{}
	for _, r := range readings {
		var gap domain.NutritionGap
		switch {
		case r.Status == domain.NutrientStatusOver && (r.Kind == "max" || r.Kind == "range"):
			gap = domain.NutritionGap{Key: r.Key, Label: r.Label, Severity: math.Min(1, .9+(r.Gap/math.Max(r.Target, 1))*.1)}
			gap.Text = fmt.Sprintf("%s已经超过%s %s%s", r.Label, nutritionLimitWord(r), formatCampusDietNumber(r.Gap), nutritionUnitWord(r.Unit))
		case r.Status == domain.NutrientStatusNearLimit:
			gap = domain.NutritionGap{Key: r.Key, Label: r.Label, Severity: .6}
			gap.Text = fmt.Sprintf("%s快到上限，还剩 %s%s", r.Label, formatCampusDietNumber(r.Gap), nutritionUnitWord(r.Unit))
		case r.Status == domain.NutrientStatusShort && r.Kind == "min" && weights[r.Key] > 0:
			gap = domain.NutritionGap{Key: r.Key, Label: r.Label, Severity: math.Round(weights[r.Key]*r.Gap/math.Max(r.Target, 1)*100) / 100}
			gap.Text = fmt.Sprintf("%s还差 %s%s", r.Label, formatCampusDietNumber(r.Gap), nutritionUnitWord(r.Unit))
		default:
			continue
		}
		gaps = append(gaps, gap)
	}
	sort.SliceStable(gaps, func(i, j int) bool { return gaps[i].Severity > gaps[j].Severity })
	return gaps
}

func nutritionLimitWord(r domain.NutrientReading) string {
	if r.Kind == "range" {
		return "目标"
	}
	return "上限"
}

func nutritionUnitWord(unit string) string {
	switch unit {
	case "kcal":
		return " 千卡"
	case "mg":
		return " 毫克"
	case "ml":
		return " 毫升"
	case "g":
		return " 克"
	}
	return unit
}

var nutritionMealLabels = map[string]string{"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "evening_snack": "加餐", "snack": "加餐"}

// nutritionNextMeal turns the gaps into one concrete plate for the next meal. The
// week counts too: a week with sodium over its ceiling on most days keeps sodium on
// the list even when today is still under it, and so does a condition the user
// ticked in the health profile (hypertension: sodium; diabetes: sugar and whole grains).
func nutritionNextMeal(mealType string, readings []domain.NutrientReading, week nutritionWeekFacts, medical map[string]bool) *domain.NutritionNextMeal {
	label := nutritionMealLabels[mealType]
	if label == "" {
		return nil
	}
	status := map[string]string{}
	for _, r := range readings {
		status[r.Key] = r.Status
	}
	meal := &domain.NutritionNextMeal{MealType: mealType, Label: label, Fills: []string{}, Limits: []string{}}
	parts, limits := []string{}, []string{}
	if status["vegetables"] == domain.NutrientStatusShort || status["fiber"] == domain.NutrientStatusShort {
		meal.Fills = append(meal.Fills, "vegetables")
		parts = append(parts, "一份深色蔬菜")
	}
	if status["protein"] == domain.NutrientStatusShort {
		meal.Fills = append(meal.Fills, "protein")
		if week.FishSoyMeals < 3 {
			parts = append(parts, "鱼或豆腐")
		} else {
			parts = append(parts, "一份瘦肉、鱼或豆腐")
		}
	}
	if (week.WholeGrainMeals < 3 || medical["diabetes"]) && mealType != "evening_snack" {
		meal.Fills = append(meal.Fills, "whole_grains")
		parts = append(parts, "主食换一半粗粮")
	}
	sodium := status["sodium"]
	if sodium == domain.NutrientStatusOver || sodium == domain.NutrientStatusNearLimit || week.SodiumOverDays >= 3 || medical["hypertension"] {
		meal.Limits = append(meal.Limits, "sodium")
		limits = append(limits, "汤和酱汁少一点")
	}
	if sugar := status["added_sugar"]; sugar == domain.NutrientStatusOver || sugar == domain.NutrientStatusNearLimit || medical["diabetes"] {
		meal.Limits = append(meal.Limits, "added_sugar")
		limits = append(limits, "饮料选无糖的")
	}
	if energy := status["energy"]; energy == domain.NutrientStatusOver || energy == domain.NutrientStatusOK {
		meal.Limits = append(meal.Limits, "energy")
		limits = append(limits, "份量小一点")
	}
	switch {
	case len(parts) == 0 && len(limits) == 0:
		meal.Advice = "照平常的量吃就好，配一份蔬菜"
	case len(parts) == 0:
		meal.Advice = strings.Join(limits, "，")
	default:
		meal.Advice = strings.Join(parts, " + ")
		if len(limits) > 0 {
			meal.Advice += "，" + strings.Join(limits, "，")
		}
	}
	return meal
}
