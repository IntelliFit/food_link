package service

import (
	"fmt"
	"food_link/backend/internal/health/domain"
	userservice "food_link/backend/internal/user/service"
	"strings"
	"time"
)

const dietPolicyVersion = "foodlink-diet-policy-v3"

type DietEvidenceSource struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Scope string `json:"scope"`
}

type DietDecisionBasis struct {
	FatMin              float64                 `json:"fat_min,omitempty"`
	FatMax              float64                 `json:"fat_max,omitempty"`
	NutrientState       *DietNutrientState      `json:"nutrient_state,omitempty"`
	Version             string                  `json:"version"`
	Date                string                  `json:"date"`
	TargetSource        string                  `json:"target_source"`
	Targets             DietRecommendationMacro `json:"targets"`
	Current             DietRecommendationMacro `json:"current"`
	Goals               []string                `json:"goals"`
	PrimaryGoal         string                  `json:"primary_goal,omitempty"`
	RecordedDays        int                     `json:"recorded_days"`
	FoodGroupPriorities []string                `json:"food_group_priorities"`
	Actions             []string                `json:"actions"`
	Limitations         []string                `json:"limitations"`
	Sources             []DietEvidenceSource    `json:"sources"`
}

var dietPatternGroups = []struct {
	key, label string
	words      []string
}{
	{"vegetables", "蔬菜", []string{"青菜", "菠菜", "白菜", "西兰花", "生菜", "油麦菜", "芹菜", "胡萝卜", "番茄", "西红柿", "茄子", "西葫芦", "菜花", "空心菜"}},
	{"soy", "豆制品", []string{"豆腐", "豆干", "豆皮", "腐竹", "豆浆", "毛豆", "黄豆"}},
	{"fish", "鱼虾", []string{"鱼", "虾"}},
	{"whole_grains", "全谷物", []string{"糙米", "燕麦", "全麦", "荞麦", "藜麦", "黑米"}},
}

func dietFoodGroups(text string) map[string]bool {
	groups := map[string]bool{}
	// A flavour name is not evidence of fish (for example 鱼香肉丝).
	text = strings.ReplaceAll(strings.ToLower(text), "鱼香", "")
	for _, group := range dietPatternGroups {
		if containsAnyText(text, group.words...) {
			groups[group.key] = true
		}
	}
	return groups
}

func buildDietDecisionBasis(profile *domain.StatsUserProfile, records []domain.FoodRecord, now time.Time) *DietDecisionBasis {
	var tdee *float64
	var health map[string]any
	if profile != nil {
		tdee = profile.TDEE
		health = profile.HealthCondition
	}
	targets := userservice.ResolveDashboardNutritionTargets(tdee, health)
	b := &DietDecisionBasis{Version: dietPolicyVersion, Date: now.In(chinaTZ).Format("2006-01-02"), TargetSource: "应用默认目标（未保存个人目标）", Goals: []string{}, FoodGroupPriorities: []string{}, Actions: []string{},
		Targets:     DietRecommendationMacro{Calories: targets["calorie_target"], Protein: targets["protein_target"], Carbs: targets["carbs_target"], Fat: targets["fat_target"]},
		Limitations: []string{"仅使用已记录摄入；未记录不等于没吃。", "食物组来自菜名/食材线索，未核实重量；不是完整 CHEI 或身体健康评分。", "营养目标和排序权重是个人计划/应用规则，不是疾病诊断或疗效预测。"},
		Sources:     []DietEvidenceSource{{ID: "cns-dg-2022", Title: "中国居民膳食指南（2022）", URL: "https://www.cnsoc.org/activitykit2/6522002010.html", Scope: "食物多样与合理搭配；用于有界的食物组优先级，不计算完整指南达标分。"}},
	}
	if len(mapFromAny(health["dashboard_targets"])) > 0 {
		b.TargetSource = "已保存的个人营养目标"
	} else if tdee != nil && *tdee > 0 {
		b.TargetSource = "个人消耗估算＋应用默认宏量目标"
	}
	if name, ok := health["nutrition_plan_name"].(string); ok && name != "" {
		b.TargetSource = "当日饮食方案 · " + name
	}
	b.FatMin = anyFloat(health["nutrition_plan_fat_min"])
	b.FatMax = anyFloat(health["nutrition_plan_fat_max"])
	if profile != nil && profile.DietGoal != nil {
		b.PrimaryGoal = *profile.DietGoal
		b.Goals = append(b.Goals, *profile.DietGoal)
	}
	for _, focus := range parseCustomHealthFocusesFromProfile(profile) {
		b.Goals = append(b.Goals, focus.Label)
	}
	start := time.Date(now.In(chinaTZ).Year(), now.In(chinaTZ).Month(), now.In(chinaTZ).Day(), 0, 0, 0, 0, chinaTZ)
	days := map[string]bool{}
	namedDays := map[string]bool{}
	groups := map[string]bool{}
	for _, record := range records {
		if record.RecordTime == nil || record.RecordTime.After(now) || record.RecordTime.Before(start.AddDate(0, 0, -6)) {
			continue
		}
		date := record.RecordTime.In(chinaTZ).Format("2006-01-02")
		days[date] = true
		if date == b.Date {
			b.Current.Calories += record.TotalCalories
			b.Current.Protein += record.TotalProtein
			b.Current.Carbs += record.TotalCarbs
			b.Current.Fat += record.TotalFat
		}
		// Only named items are evidence; free-form descriptions can contain negation.
		for _, item := range record.Items {
			name, _ := item["name"].(string)
			if strings.TrimSpace(name) != "" {
				namedDays[date] = true
			}
			for key := range dietFoodGroups(name) {
				groups[key] = true
			}
		}
	}
	b.RecordedDays = len(days)
	b.NutrientState = buildDietNutrientState(profile, records, now, b.Targets.Calories)
	seenSources := map[string]bool{}
	for _, rule := range b.NutrientState.Rules {
		if rule.SourceURL == "" || seenSources[rule.SourceID] {
			continue
		}
		seenSources[rule.SourceID] = true
		title := "WHO 健康饮食"
		if rule.SourceID == "wst-578.2-2018" {
			title = "中国居民膳食营养素参考摄入量 WS/T 578.2—2018"
		} else if strings.HasPrefix(rule.SourceID, "wst-") {
			title = "中国居民膳食营养素参考摄入量 " + strings.ToUpper(rule.SourceID)
		}
		b.Sources = append(b.Sources, DietEvidenceSource{ID: rule.SourceID, Title: title, URL: rule.SourceURL, Scope: rule.Scope})
	}
	if len(namedDays) >= 3 {
		for _, group := range dietPatternGroups {
			if !groups[group.key] {
				b.FoodGroupPriorities = append(b.FoodGroupPriorities, group.key)
				if len(b.Actions) < 2 {
					b.Actions = append(b.Actions, fmt.Sprintf("近7天已记录餐食未见%s线索，下一餐可比较含%s的选择。", group.label, group.label))
				}
			}
		}
	}
	if len(b.Actions) == 0 {
		b.Actions = append(b.Actions, "结合今天已记录摄入，在附近比较份量合适、搭配多样的餐食。")
	}
	return b
}

func dietPatternBonus(basis *DietDecisionBasis, c DietRecommendationCandidate) (float64, string) {
	if basis == nil {
		return 0, ""
	}
	names := []string{}
	for _, item := range c.Items {
		names = append(names, item.Name)
	}
	if len(names) == 0 {
		names = append(names, c.Title)
	}
	groups := dietFoodGroups(strings.Join(names, " "))
	for _, key := range basis.FoodGroupPriorities {
		if !groups[key] {
			continue
		}
		for _, group := range dietPatternGroups {
			if group.key == key {
				return 5, "这份餐食有" + group.label + "线索，可增加近期已记录饮食的搭配种类；具体份量待核实。"
			}
		}
	}
	return 0, ""
}
