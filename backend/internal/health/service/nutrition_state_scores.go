package service

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
)

// A focus score is a weighted mean of the components that have data; a component
// without data is left out rather than scored as zero. Each component also says in
// one sentence what it saw, and the weakest one becomes the card's reason.
type nutritionComponent struct {
	Score float64
	Text  string
	OK    bool
}

type nutritionFocusSpec struct {
	Key, Title string
	Parts      map[string]float64
}

var nutritionFocusSpecs = []nutritionFocusSpec{
	{Key: "hypertension", Title: "血压管理友好度", Parts: map[string]float64{"sodium": .5, "potassium": .25, "vegetables": .25}},
	{Key: "diabetes", Title: "血糖稳定友好度", Parts: map[string]float64{"sugar": .3, "fiber": .3, "whole_grains": .2, "late": .2}},
	{Key: "cardio", Title: "心血管友好度", Parts: map[string]float64{"sat_fat": .35, "sodium": .25, "fish_soy": .2, "fiber": .2}},
	{Key: "weight", Title: "体重管理友好度", Parts: map[string]float64{"energy": .5, "weight_trend": .3, "protein": .2}},
	{Key: "colorectal", Title: "肠道状态友好度", Parts: map[string]float64{"fiber": .5, "vegetables": .3, "whole_grains": .2}},
	{Key: "longevity", Title: "近期饮食习惯", Parts: map[string]float64{"regularity": .4, "vegetables": .2, "fish_soy": .2, "late": .2}},
	{Key: "micronutrient", Title: "微量营养充足度", Parts: map[string]float64{"micro": 1}},
}

var nutritionMicroKeys = []string{"calciumMg", "potassiumMg", "magnesiumMg", "ironMg", "zincMg", "vitaminARaeMcg", "vitaminCMg", "vitaminDMcg", "vitaminEMg", "vitaminB12Mcg", "folateDfeMcg"}

// nutritionScores scores a window of days (a week). Fewer than two recorded days
// give no scores at all.
func nutritionScores(days []nutritionDay, facts nutritionWeekFacts, goal string, trend *domain.NutritionWeightTrend) (*int, []domain.NutritionFocusScore) {
	recorded := nutritionDaysRecorded(days)
	if len(recorded) < 2 {
		return nil, []domain.NutritionFocusScore{}
	}
	parts := nutritionComponents(recorded, facts, goal, trend)
	focus := []domain.NutritionFocusScore{}
	total, count := 0.0, 0
	for _, spec := range nutritionFocusSpecs {
		card := domain.NutritionFocusScore{Key: spec.Key, Title: spec.Title, Evidence: []string{}}
		sum, weight := 0.0, 0.0
		// The reason is the component that costs the card the most points, so a
		// heavily weighted problem (salt for blood pressure) wins over a light one.
		var costliest nutritionComponent
		cost, lowest := -1.0, 101.0
		keys := make([]string, 0, len(spec.Parts))
		for key := range spec.Parts {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			return spec.Parts[keys[i]] > spec.Parts[keys[j]] || spec.Parts[keys[i]] == spec.Parts[keys[j]] && keys[i] < keys[j]
		})
		for _, key := range keys {
			part, ok := parts[key]
			if !ok || !part.OK {
				continue
			}
			sum += part.Score * spec.Parts[key]
			weight += spec.Parts[key]
			card.Evidence = append(card.Evidence, part.Text)
			if c := spec.Parts[key] * (100 - part.Score); c > cost {
				costliest, cost = part, c
			}
			lowest = math.Min(lowest, part.Score)
		}
		if weight > 0 {
			score := clampScore(sum / weight)
			card.Score = &score
			card.Reason = costliest.Text
			if lowest >= 85 && len(card.Evidence) > 1 {
				card.Reason = "这几项都在范围里：" + strings.Join(card.Evidence, "；")
			}
			total += float64(score)
			count++
		} else {
			card.Reason = "这一项还缺数据，多记几餐再看"
		}
		focus = append(focus, card)
	}
	if count == 0 {
		return nil, focus
	}
	overall := clampScore(total / float64(count))
	return &overall, focus
}

func nutritionComponents(days []nutritionDay, f nutritionWeekFacts, goal string, trend *domain.NutritionWeightTrend) map[string]nutritionComponent {
	parts := map[string]nutritionComponent{}
	n := len(days)
	if f.SodiumJudged > 0 {
		text := fmt.Sprintf("钠 %d 天里 %d 天超过 2000 毫克", f.SodiumJudged, f.SodiumOverDays)
		if f.SodiumOverDays == 0 {
			text = fmt.Sprintf("钠 %d 天都没超上限", f.SodiumJudged)
		}
		parts["sodium"] = nutritionComponent{Score: 100 * (1 - float64(f.SodiumOverDays)/float64(f.SodiumJudged)), Text: text, OK: true}
	}
	if ratio, ok := nutritionMeanRatio(days, "potassiumMg", true); ok {
		text := "钾基本够"
		if ratio < .8 {
			text = fmt.Sprintf("钾平均只到目标的 %d%%", int(math.Round(ratio*100)))
		}
		parts["potassium"] = nutritionComponent{Score: 100 * ratio, Text: text, OK: true}
	}
	parts["vegetables"] = nutritionComponent{Score: 100 * float64(f.VegHitDays) / float64(n), Text: fmt.Sprintf("蔬菜够量 %d/%d 天", f.VegHitDays, n), OK: true}
	if ratio, avg, target, ok := nutritionFiber(days); ok {
		parts["fiber"] = nutritionComponent{Score: 100 * ratio, Text: fmt.Sprintf("纤维平均每天约 %d 克（建议 %d 克）", int(math.Round(avg)), int(math.Round(target))), OK: true}
	}
	if judged, over := nutritionCeilingDays(days, "freeSugar"); judged > 0 {
		text := fmt.Sprintf("添加糖 %d 天里 %d 天超量", judged, over)
		if over == 0 {
			text = "添加糖不多"
		}
		parts["sugar"] = nutritionComponent{Score: 100 * (1 - float64(over)/float64(judged)), Text: text, OK: true}
	}
	parts["whole_grains"] = nutritionComponent{Score: 100 * math.Min(1, float64(f.WholeGrainMeals)/3), Text: fmt.Sprintf("这周全谷物 %d 次", f.WholeGrainMeals), OK: true}
	parts["fish_soy"] = nutritionComponent{Score: 100 * math.Min(1, float64(f.FishSoyMeals)/3), Text: fmt.Sprintf("鱼或豆制品这周 %d 次", f.FishSoyMeals), OK: true}
	if f.Meals > 0 {
		text := "没有很晚吃饭"
		if f.LateMeals > 0 {
			text = fmt.Sprintf("%d 餐在晚上 9 点以后", f.LateMeals)
		}
		parts["late"] = nutritionComponent{Score: 100 * (1 - math.Min(1, 3*float64(f.LateMeals)/float64(f.Meals))), Text: text, OK: true}
	}
	if share, ok := nutritionSatFatShare(days); ok {
		parts["sat_fat"] = nutritionComponent{Score: 100 * math.Min(1, 10/math.Max(share, .1)), Text: fmt.Sprintf("饱和脂肪平均约占 %d%% 能量（建议不超过 10%%）", int(math.Round(share))), OK: true}
	}
	if part, ok := nutritionEnergyComponent(days, goal); ok {
		parts["energy"] = part
	}
	if part, ok := nutritionWeightComponent(trend, goal); ok {
		parts["weight_trend"] = part
	}
	if ratio, ok := nutritionProteinRatio(days); ok {
		parts["protein"] = nutritionComponent{Score: 100 * ratio, Text: fmt.Sprintf("蛋白质平均到目标的 %d%%", int(math.Round(ratio*100))), OK: true}
	}
	breakfast := float64(f.BreakfastDays) / float64(n)
	parts["regularity"] = nutritionComponent{Score: 60*math.Min(1, float64(n)/7) + 40*breakfast, Text: fmt.Sprintf("这周记了 %d 天，%d 天吃了早餐", n, f.BreakfastDays), OK: true}
	if part, ok := nutritionMicroComponent(days); ok {
		parts["micro"] = part
	}
	return parts
}

// nutritionMeanRatio averages value/target (capped at 1) over the days with data.
func nutritionMeanRatio(days []nutritionDay, key string, completeOnly bool) (float64, bool) {
	sum, count := 0.0, 0
	for _, day := range days {
		rule, ok := day.rule(key)
		value, complete, known := day.known(key)
		if !ok || rule.Target <= 0 || !known || completeOnly && !complete {
			continue
		}
		sum += math.Min(1, value/rule.Target)
		count++
	}
	if count == 0 {
		return 0, false
	}
	return sum / float64(count), true
}

func nutritionFiber(days []nutritionDay) (ratio, avg, target float64, ok bool) {
	count := 0
	for _, day := range days {
		rule, has := day.rule("fiber")
		value, _, known := day.known("fiber")
		if !has || rule.Target <= 0 || !known {
			continue
		}
		ratio += math.Min(1, value/rule.Target)
		avg += value
		target = rule.Target
		count++
	}
	if count == 0 {
		return 0, 0, 0, false
	}
	return ratio / float64(count), avg / float64(count), target, true
}

// nutritionCeilingDays counts days judged against a ceiling: complete days, and
// partial days whose known part is already over it.
func nutritionCeilingDays(days []nutritionDay, key string) (judged, over int) {
	for _, day := range days {
		rule, ok := day.rule(key)
		value, complete, known := day.known(key)
		if !ok || rule.Limit <= 0 || !known {
			continue
		}
		if value > rule.Limit {
			judged++
			over++
		} else if complete {
			judged++
		}
	}
	return judged, over
}

func nutritionSatFatShare(days []nutritionDay) (float64, bool) {
	sum, count := 0.0, 0
	for _, day := range days {
		value, complete, known := day.known("saturatedFat")
		if !known || !complete || day.Calories <= 0 {
			continue
		}
		sum += value * 9 / day.Calories * 100
		count++
	}
	if count == 0 {
		return 0, false
	}
	return sum / float64(count), true
}

// Only days with at least two meals say anything about a whole day's energy.
func nutritionEnergyComponent(days []nutritionDay, goal string) (nutritionComponent, bool) {
	sum, avg, target, count := 0.0, 0.0, 0.0, 0
	for _, day := range days {
		if day.Meals < 2 || day.CalorieGoal <= 0 {
			continue
		}
		over := math.Max(0, day.Calories-day.CalorieGoal) / day.CalorieGoal
		under := math.Max(0, day.CalorieGoal*.75-day.Calories) / day.CalorieGoal
		if goal != "fat_loss" {
			under = math.Max(0, day.CalorieGoal*.85-day.Calories) / day.CalorieGoal
		}
		sum += math.Max(0, 1-(over+under)/.35)
		avg += day.Calories
		target += day.CalorieGoal
		count++
	}
	if count == 0 {
		return nutritionComponent{}, false
	}
	text := fmt.Sprintf("热量平均每天 %d 千卡，目标 %d", int(math.Round(avg/float64(count))), int(math.Round(target/float64(count))))
	return nutritionComponent{Score: 100 * sum / float64(count), Text: text, OK: true}, true
}

func nutritionWeightComponent(trend *domain.NutritionWeightTrend, goal string) (nutritionComponent, bool) {
	if trend == nil || trend.Days < 5 {
		return nutritionComponent{}, false
	}
	perWeek := trend.KgChange / float64(trend.Days) * 7
	score := 80.0
	switch goal {
	case "fat_loss":
		switch {
		case perWeek <= -.1 && perWeek >= -1:
			score = 100
		case perWeek < -1:
			score = 60
		case perWeek > .1:
			score = 40
		default:
			score = 70
		}
	case "muscle_gain":
		switch {
		case perWeek >= .1 && perWeek <= .5:
			score = 100
		case perWeek > .5:
			score = 60
		case perWeek < -.1:
			score = 40
		default:
			score = 70
		}
	default:
		if math.Abs(perWeek) <= .3 {
			score = 100
		} else {
			score = 60
		}
	}
	sign := "+"
	if trend.KgChange < 0 {
		sign = "−"
	}
	text := fmt.Sprintf("近 %d 天体重 %s%.1f kg", trend.Days, sign, math.Abs(trend.KgChange))
	return nutritionComponent{Score: score, Text: text, OK: true}, true
}

func nutritionProteinRatio(days []nutritionDay) (float64, bool) {
	sum, count := 0.0, 0
	for _, day := range days {
		if day.Meals < 2 || day.ProteinGoal <= 0 {
			continue
		}
		sum += math.Min(1, day.Protein/day.ProteinGoal)
		count++
	}
	if count == 0 {
		return 0, false
	}
	return sum / float64(count), true
}

func nutritionMicroComponent(days []nutritionDay) (nutritionComponent, bool) {
	type low struct {
		label string
		ratio float64
	}
	labels := map[string]string{}
	for _, def := range nutritionMicroLabels() {
		labels[def[0]] = def[1]
	}
	ratios := []low{}
	for _, key := range nutritionMicroKeys {
		if ratio, ok := nutritionMeanRatio(days, key, false); ok {
			ratios = append(ratios, low{labels[key], ratio})
		}
	}
	if len(ratios) < 2 {
		return nutritionComponent{}, false
	}
	sum := 0.0
	for _, r := range ratios {
		sum += r.ratio
	}
	sort.SliceStable(ratios, func(i, j int) bool { return ratios[i].ratio < ratios[j].ratio })
	names := []string{}
	for _, r := range ratios {
		if r.ratio < .6 && len(names) < 3 {
			names = append(names, r.label)
		}
	}
	text := "已记录的微量营养基本够"
	if len(names) > 0 {
		text = strings.Join(names, "、") + "偏低"
	}
	return nutritionComponent{Score: 100 * sum / float64(len(ratios)), Text: text, OK: true}, true
}

func nutritionMicroLabels() [][2]string {
	return [][2]string{
		{"calciumMg", "钙"}, {"potassiumMg", "钾"}, {"magnesiumMg", "镁"}, {"ironMg", "铁"}, {"zincMg", "锌"},
		{"vitaminARaeMcg", "维生素A"}, {"vitaminCMg", "维生素C"}, {"vitaminDMcg", "维生素D"}, {"vitaminEMg", "维生素E"},
		{"vitaminB12Mcg", "维生素B12"}, {"folateDfeMcg", "叶酸"},
	}
}
