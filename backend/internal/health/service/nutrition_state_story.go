package service

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
)

// nutritionEvidenceGaps lists what the state cannot judge yet, each with the record
// that would fix it, so the page asks for data instead of guessing.
func nutritionEvidenceGaps(in nutritionStateInput, days []nutritionDay, facts nutritionWeekFacts, isToday bool) []domain.NutritionEvidenceGap {
	gaps := []domain.NutritionEvidenceGap{}
	if isToday && len(days) > 0 && !days[len(days)-1].recorded() && in.Now.Hour() >= 11 {
		gaps = append(gaps, domain.NutritionEvidenceGap{Key: "today_unrecorded", Text: "今天还没有记录", Hint: "拍一下这一餐，就能算出今天还差什么", Action: "record"})
	}
	// Sugar is almost never in the data, so only sodium is asked for.
	unknown := 0
	for _, day := range days {
		unknown += day.UnknownMeals["sodiumMg"]
	}
	if unknown > 0 {
		gaps = append(gaps, domain.NutritionEvidenceGap{Key: "sodium_unknown", Text: fmt.Sprintf("%d 餐没有钠的数据", unknown), Hint: "拍照时把汤和酱料也拍进去", Action: "record"})
	}
	if in.Body != nil {
		if nutritionLatestWeightDate(in.Body, in.Date) == "" {
			gaps = append(gaps, domain.NutritionEvidenceGap{Key: "weight_missing", Text: "最近两周没记体重", Hint: "记一次就能看体重变化", Action: "weight"})
		}
		if facts.WaterJudged < 3 {
			gaps = append(gaps, domain.NutritionEvidenceGap{Key: "water_sparse", Text: fmt.Sprintf("这周喝水只记了 %d 天", facts.WaterJudged), Hint: "记几天就能看出喝得够不够", Action: "water"})
		}
	}
	if in.SleepTracked && in.Sleep == nil {
		gaps = append(gaps, domain.NutritionEvidenceGap{Key: "sleep_missing", Text: "昨晚的睡眠没有记录", Hint: "睡得少的第二天更容易吃多，记一下更好判断", Action: "sleep"})
	}
	return gaps
}

// nutritionLatestWeightDate is the newest weigh-in within two weeks of the day, or "".
func nutritionLatestWeightDate(body *BodyMetricsSummary, day time.Time) string {
	from := day.AddDate(0, 0, -13).Format("2006-01-02")
	to := day.Format("2006-01-02")
	latest := ""
	for _, entry := range nutritionWeightEntries(body) {
		if entry.Date >= from && entry.Date <= to && entry.Date > latest {
			latest = entry.Date
		}
	}
	return latest
}

func nutritionWeightEntries(body *BodyMetricsSummary) []WeightEntry {
	if body == nil {
		return nil
	}
	if len(body.WeightTrendDaily) > 0 {
		return body.WeightTrendDaily
	}
	return body.WeightEntries
}

// nutritionWeightTrend compares the first and last weigh-ins of the three weeks up to the day.
func nutritionWeightTrend(body *BodyMetricsSummary, day time.Time) *domain.NutritionWeightTrend {
	from := day.AddDate(0, 0, -20).Format("2006-01-02")
	to := day.Format("2006-01-02")
	var first, last *WeightEntry
	for _, entry := range nutritionWeightEntries(body) {
		if entry.Date < from || entry.Date > to || entry.Value <= 0 {
			continue
		}
		e := entry
		if first == nil || e.Date < first.Date {
			first = &e
		}
		if last == nil || e.Date > last.Date {
			last = &e
		}
	}
	if first == nil || last == nil || first.Date == last.Date {
		return nil
	}
	a, errA := time.Parse("2006-01-02", first.Date)
	b, errB := time.Parse("2006-01-02", last.Date)
	if errA != nil || errB != nil {
		return nil
	}
	days := int(math.Round(b.Sub(a).Hours() / 24))
	if days < 3 {
		return nil
	}
	return &domain.NutritionWeightTrend{KgChange: math.Round((last.Value-first.Value)*10) / 10, Days: days}
}

var nutritionGoalLabels = map[string]string{"fat_loss": "减脂", "muscle_gain": "增肌", "maintain": "保持体重"}

func nutritionContext(in nutritionStateInput, facts nutritionWeekFacts, isToday bool) domain.NutritionContext {
	c := domain.NutritionContext{Notes: []string{}, WeightTrend: nutritionWeightTrend(in.Body, in.Date)}
	if label := nutritionGoalLabels[in.goal()]; label != "" {
		c.Notes = append(c.Notes, label+"中")
	}
	for _, focus := range parseCustomHealthFocusesFromProfile(in.Profile) {
		if strings.TrimSpace(focus.Label) != "" {
			c.Notes = append(c.Notes, "在意"+focus.Label)
		}
	}
	if in.Profile != nil {
		if medical := nutritionProfileLabels(in.Profile.HealthCondition["medical_history"]); len(medical) > 0 {
			c.Notes = append(c.Notes, "有"+strings.Join(medical, "、"))
		}
		if allergies := nutritionProfileLabels(in.Profile.HealthCondition["allergies"]); len(allergies) > 0 {
			c.Notes = append(c.Notes, "不吃"+strings.Join(allergies, "、"))
		}
		if preferences := nutritionProfileLabels(in.Profile.HealthCondition["diet_preference"]); len(preferences) > 0 {
			c.Notes = append(c.Notes, strings.Join(preferences, "、")+"饮食")
		}
	}
	date := in.Date.Format("2006-01-02")
	for _, log := range in.Exercise {
		if log.RecordedOn != nil && log.RecordedOn.In(chinaTZ).Format("2006-01-02") == date || log.RecordedAt != nil && log.RecordedAt.In(chinaTZ).Format("2006-01-02") == date {
			c.TrainingToday = true
			if desc := strings.TrimSpace(log.ExerciseDesc); desc != "" && len(c.Notes) < 6 {
				c.Notes = append(c.Notes, nutritionDayWord(isToday)+"运动："+desc)
			}
			break
		}
	}
	if in.Body != nil {
		if w := in.Water[date]; w.Total > 0 {
			v := float64(w.Total)
			c.WaterMLToday = &v
		}
	}
	if in.Sleep != nil && in.Sleep.DurationMinutes > 0 {
		hours := math.Round(float64(in.Sleep.DurationMinutes)/6) / 10
		c.SleepHours = &hours
	}
	if facts.LateMeals >= 3 {
		c.Notes = append(c.Notes, "常在晚上 9 点后吃东西")
	}
	return c
}

// The health profile stores option codes (apps/wechat health-profile); custom entries
// are free text and kept as typed. "none" means nothing was ticked.
var nutritionProfileCodeLabels = map[string]string{
	"diabetes": "糖尿病", "hypertension": "高血压", "gout": "痛风", "hyperlipidemia": "高血脂", "thyroid": "甲状腺疾病",
	"seafood": "海鲜", "peanut": "花生", "milk": "牛奶", "egg": "鸡蛋", "mango": "芒果", "alcohol": "酒精", "spicy": "辣",
	"keto": "生酮", "vegetarian": "素食", "vegan": "纯素", "low_salt": "低盐", "gluten_free": "无麸质",
}

func nutritionProfileLabels(value any) []string {
	out := []string{}
	for _, raw := range stringSliceFromCampusDietAny(value) {
		code := strings.TrimSpace(raw)
		if code == "" || strings.EqualFold(code, "none") || code == "无" {
			continue
		}
		if label, ok := nutritionProfileCodeLabels[strings.ToLower(code)]; ok {
			code = label
		}
		out = append(out, code)
	}
	return out
}

func nutritionDayWord(isToday bool) string {
	if isToday {
		return "今天"
	}
	return "当天"
}

type nutritionStoryFinding struct {
	finding domain.NutritionFinding
	short   string
	topic   string
}

// nutritionStory picks the grounded facts behind the day and one headline: something
// that went well and the main thing to change. Numbers come only from the facts.
func nutritionStory(days []nutritionDay, facts, last nutritionWeekFacts, readings []domain.NutrientReading, trend *domain.NutritionWeightTrend, goal string, focusTopics map[string]bool) (string, []domain.NutritionFinding) {
	good, issues := []nutritionStoryFinding{}, []nutritionStoryFinding{}
	add := func(list *[]nutritionStoryFinding, key, kind, short, text, value string) {
		topic, _, _ := strings.Cut(key, "_")
		*list = append(*list, nutritionStoryFinding{finding: domain.NutritionFinding{Key: key, Kind: kind, Text: text, Value: value}, short: short, topic: topic})
	}
	// Salt is the main issue on three or more days, or on more than half of the judged ones.
	if facts.SodiumOverDays >= 3 || facts.SodiumOverDays >= 2 && facts.SodiumOverDays*2 > facts.SodiumJudged {
		add(&issues, "sodium_over_days", "over", "盐还偏多", fmt.Sprintf("%d 天里有 %d 天钠超过 2000 毫克", facts.SodiumJudged, facts.SodiumOverDays), fmt.Sprintf("%d/%d", facts.SodiumOverDays, facts.SodiumJudged))
	}
	if ratio, avg, target, ok := nutritionFiber(nutritionDaysRecorded(days)); ok && ratio < .5 {
		add(&issues, "fiber_low", "short", "纤维不够", fmt.Sprintf("纤维平均每天约 %d 克，建议 %d 克", int(math.Round(avg)), int(math.Round(target))), fmt.Sprintf("%d", int(math.Round(avg))))
	}
	if ratio, ok := nutritionProteinRatio(nutritionDaysRecorded(days)); ok && ratio < .7 {
		add(&issues, "protein_low", "short", "蛋白质偏少", fmt.Sprintf("蛋白质平均只到目标的 %d%%", int(math.Round(ratio*100))), fmt.Sprintf("%d%%", int(math.Round(ratio*100))))
	}
	if facts.LateMeals >= 3 {
		add(&issues, "late_meals", "habit", "吃得偏晚", fmt.Sprintf("这周有 %d 餐在晚上 9 点以后", facts.LateMeals), fmt.Sprintf("%d", facts.LateMeals))
	}
	if facts.RecordedDays >= 4 && facts.FishSoyMeals == 0 {
		add(&issues, "no_fish_soy", "short", "鱼和豆制品没吃到", "这周还没吃到鱼或豆制品", "0")
	}
	if facts.RecordedDays >= 2 && last.RecordedDays >= 2 && facts.VegHitDays > last.VegHitDays {
		add(&good, "vegetables_up", "better", "这周蔬菜跟上了", fmt.Sprintf("蔬菜够量 %d 天，比上周多 %d 天", facts.VegHitDays, facts.VegHitDays-last.VegHitDays), fmt.Sprintf("%d", facts.VegHitDays))
	} else if facts.VegHitDays >= 4 {
		add(&good, "vegetables_ok", "good", "蔬菜吃得不错", fmt.Sprintf("这周蔬菜够量 %d 天", facts.VegHitDays), fmt.Sprintf("%d", facts.VegHitDays))
	}
	if last.SodiumJudged > 0 && facts.SodiumJudged > 0 && facts.SodiumOverDays < last.SodiumOverDays {
		add(&good, "sodium_down", "better", "盐比上周少了", fmt.Sprintf("钠超标从 %d 天降到 %d 天", last.SodiumOverDays, facts.SodiumOverDays), fmt.Sprintf("%d", facts.SodiumOverDays))
	}
	if part, ok := nutritionWeightComponent(trend, goal); ok && part.Score >= 100 {
		add(&good, "weight_on_track", "good", "体重变化在节奏上", part.Text, fmt.Sprintf("%.1f", trend.KgChange))
	}
	if facts.FishSoyMeals >= 3 {
		add(&good, "fish_soy_ok", "good", "鱼和豆制品吃够了", fmt.Sprintf("鱼或豆制品这周 %d 次", facts.FishSoyMeals), fmt.Sprintf("%d", facts.FishSoyMeals))
	}
	// What the user said they care about comes first.
	sort.SliceStable(issues, func(i, j int) bool { return focusTopics[issues[i].topic] && !focusTopics[issues[j].topic] })
	findings := []domain.NutritionFinding{}
	for _, f := range append(issues, good...) {
		findings = append(findings, f.finding)
	}
	for _, r := range readings {
		if r.Status == domain.NutrientStatusOver && r.Kind == "max" {
			findings = append(findings, domain.NutritionFinding{Key: r.Key + "_over_today", Kind: "over", Text: fmt.Sprintf("今天%s已经超过上限 %s%s", r.Label, formatCampusDietNumber(r.Gap), nutritionUnitWord(r.Unit)), Value: formatCampusDietNumber(r.Gap)})
		}
	}
	switch {
	case facts.RecordedDays < 2:
		return "再记几餐，就能看出这周吃得怎么样。", findings
	case len(good) > 0 && len(issues) > 0:
		// Praise and the main issue are about different things; the same thing
		// getting better but still off reads as one sentence.
		for _, g := range good {
			if g.topic != issues[0].topic {
				return fmt.Sprintf("%s，%s：%s。", g.short, issues[0].short, issues[0].finding.Text), findings
			}
		}
		return fmt.Sprintf("%s，但还是偏多：%s。", good[0].short, issues[0].finding.Text), findings
	case len(issues) > 0:
		return fmt.Sprintf("%s：%s。", issues[0].short, issues[0].finding.Text), findings
	case len(good) > 0:
		return fmt.Sprintf("%s：%s。", good[0].short, good[0].finding.Text), findings
	}
	return "这周吃得挺均衡，照这样继续。", findings
}
