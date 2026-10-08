package service

import (
	"fmt"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/nutritionagg"
	"math"
	"strings"
	"time"
)

type DietNutrientRule struct {
	Key           string  `json:"key"`
	Unit          string  `json:"unit"`
	Target        float64 `json:"target,omitempty"`
	Limit         float64 `json:"limit,omitempty"`
	ReferenceType string  `json:"reference_type"`
	SourceID      string  `json:"source_id"`
	SourceURL     string  `json:"source_url,omitempty"`
	Scope         string  `json:"scope"`
	TimeWindow    string  `json:"time_window"`
}

type DietNutrientState struct {
	Rules         []DietNutrientRule  `json:"rules"`
	Current       nutritionagg.Vector `json:"current"`
	RecordedMeals int                 `json:"recorded_meals"`
	AsOf          string              `json:"as_of"`
	Limitations   []string            `json:"limitations"`
}

func buildDietNutrientState(profile *domain.StatsUserProfile, records []domain.FoodRecord, now time.Time, calorieTarget float64) *DietNutrientState {
	state := &DietNutrientState{AsOf: now.Format(time.RFC3339), Rules: []DietNutrientRule{}, Limitations: []string{
		"只使用已记录摄入小计；未记录不等于零，计划参考不用于诊断营养缺乏。",
		"数值仅反映原始份量的记录/估算；未知字段保留未知，不能保证全天达标。",
		"中国规则采用逐项核录的 WS/T 578 系列 2017/2018 版，不冒充完整 DRIs 2023；特殊人群需另定计划。",
		"维生素E只比较明确的α-TE、叶酸只比较DFE；总糖不替代游离糖，不推测缺失的营养形态。",
	}}
	today := now.In(chinaTZ).Format("2006-01-02")
	vectors := []nutritionagg.Vector{}
	for _, record := range records {
		if record.RecordTime == nil || !record.RecordTime.Before(now) || record.RecordTime.In(chinaTZ).Format("2006-01-02") != today {
			continue
		}
		vectors = append(vectors, nutritionagg.Observe(record.Items, true))
		state.RecordedMeals++
	}
	state.Current = nutritionagg.Combine(vectors...)
	age := dietProfileAge(profile, now)
	health := map[string]any{}
	if profile != nil {
		health = profile.HealthCondition
	}
	special := false
	for _, key := range []string{"pregnant", "pregnancy", "lactating", "kidney_disease", "renal_disease"} {
		if value, exists := health[key]; exists && value != nil {
			text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
			if text != "false" && text != "0" && text != "" {
				special = true
			}
		}
	}
	if age >= 18 && !special {
		who := "https://www.who.int/news-room/fact-sheets/detail/healthy-diet"
		state.Rules = append(state.Rules,
			DietNutrientRule{Key: "fiber", Unit: "g", Target: 25, ReferenceType: "guideline_plan", SourceID: "who-healthy-diet", SourceURL: who, Scope: "一般健康成年人；食物来源纤维", TimeWindow: "daily_plan"},
			DietNutrientRule{Key: "sodiumMg", Unit: "mg", Limit: 2000, ReferenceType: "guideline_limit_not_UL", SourceID: "who-healthy-diet", SourceURL: who, Scope: "一般健康成年人；钠而非盐重量", TimeWindow: "daily_plan"},
			DietNutrientRule{Key: "potassiumMg", Unit: "mg", Target: 3510, ReferenceType: "guideline_plan", SourceID: "who-healthy-diet", SourceURL: who, Scope: "一般健康成年人；不用于肾病个体处方", TimeWindow: "daily_plan"},
		)
		if calorieTarget > 0 && !math.IsNaN(calorieTarget) && !math.IsInf(calorieTarget, 0) {
			state.Rules = append(state.Rules,
				DietNutrientRule{Key: "saturatedFat", Unit: "g", Limit: calorieTarget * .10 / 9, ReferenceType: "guideline_energy_share_not_UL", SourceID: "who-healthy-diet", SourceURL: who, Scope: "一般健康成年人；不超过计划能量10%，仅在含量可比较时启用", TimeWindow: "daily_plan"},
				DietNutrientRule{Key: "freeSugar", Unit: "g", Limit: calorieTarget * .10 / 4, ReferenceType: "guideline_energy_share_not_UL", SourceID: "who-healthy-diet", SourceURL: who, Scope: "一般健康成年人；游离糖而非总糖，计划能量10%限制", TimeWindow: "daily_plan"},
			)
		}
		if age < 50 {
			url := "https://www.nhc.gov.cn/fzs/c100048/201805/e821444378d64bafa7283779631096ce/files/1733125378344_55137.pdf"
			state.Rules = append(state.Rules,
				DietNutrientRule{Key: "calciumMg", Unit: "mg", Target: 800, ReferenceType: "RNI_plan_not_deficiency_threshold", SourceID: "wst-578.2-2018", SourceURL: url, Scope: "18–49岁一般健康成年人；2018版参考", TimeWindow: "daily_plan"},
				DietNutrientRule{Key: "magnesiumMg", Unit: "mg", Target: 330, ReferenceType: "RNI_plan_not_deficiency_threshold", SourceID: "wst-578.2-2018", SourceURL: url, Scope: "18–49岁一般健康成年人；2018版参考", TimeWindow: "daily_plan"},
			)
			state.Rules = append(state.Rules, adultDietVitaminRules(profile)...)
		}
	} else {
		state.Limitations = append(state.Limitations, "年龄/特殊生理健康条件不满足已核录规则，未自动套用成人微量目标。")
	}
	// Explicit saved plans override one nutrient once. They are user plans, not
	// medically validated prescriptions or a guessed disease-specific target.
	for _, def := range nutritionagg.Definitions {
		plans := mapFromAny(health["nutrient_targets"])
		plan := mapFromAny(plans[def.Key])
		target, limit := anyFloat(plan["target"]), anyFloat(plan["limit"])
		if target <= 0 && limit <= 0 || strings.TrimSpace(fmt.Sprint(plan["unit"])) != def.Unit {
			continue
		}
		if target < 0 || limit < 0 || math.IsNaN(target) || math.IsNaN(limit) || math.IsInf(target, 0) || math.IsInf(limit, 0) || limit > 0 && target > limit {
			continue
		}
		rule := DietNutrientRule{Key: def.Key, Unit: def.Unit, Target: target, Limit: limit, ReferenceType: "saved_personal_plan", SourceID: "saved-personal-plan", Scope: "已保存的个人计划，不作医疗有效性背书", TimeWindow: "daily_plan"}
		found := false
		for i := range state.Rules {
			if state.Rules[i].Key == def.Key {
				state.Rules[i], found = rule, true
				break
			}
		}
		if !found {
			state.Rules = append(state.Rules, rule)
		}
	}
	return state
}

// These rows are deliberately restricted to the verified 18–49 healthy-adult
// tables. RNI and AI retain distinct provenance; neither estimates deficiency.
func adultDietVitaminRules(profile *domain.StatsUserProfile) []DietNutrientRule {
	vitaminURL := "https://www.nhc.gov.cn/wjw/yingyang/201805/3dcd74635d8e40bcb5d834d3b2f66964/files/1739783549670_23371.pdf"
	waterURL := "https://www.nhc.gov.cn/fzs/c100048/201805/e821444378d64bafa7283779631096ce/files/1733125378304_81397.pdf"
	traceURL := "https://www.nhc.gov.cn/wjw/yingyang/201710/ef2d42ee35894a46b7726457d08d7e2d/files/1739783538029_71556.pdf"
	makeRule := func(key, unit string, target float64, source, url, reference string) DietNutrientRule {
		return DietNutrientRule{Key: key, Unit: unit, Target: target, ReferenceType: reference + "_plan_not_deficiency_threshold", SourceID: source, SourceURL: url, Scope: "18–49岁一般健康成年人；版本见来源，食物营养计划参考", TimeWindow: "daily_plan"}
	}
	rules := []DietNutrientRule{
		makeRule("vitaminCMg", "mg", 100, "wst-578.5-2018", waterURL, "RNI"),
		makeRule("vitaminB12Mcg", "mcg", 2.4, "wst-578.5-2018", waterURL, "RNI"),
		makeRule("folateDfeMcg", "mcg DFE", 400, "wst-578.5-2018", waterURL, "RNI"),
		makeRule("vitaminDMcg", "mcg", 10, "wst-578.4-2018", vitaminURL, "RNI"),
		makeRule("vitaminEMg", "mg alpha-TE", 14, "wst-578.4-2018", vitaminURL, "AI"),
	}
	if profile.Gender != nil {
		gender := strings.ToLower(strings.TrimSpace(*profile.Gender))
		iron, zinc, vitaminA := 0.0, 0.0, 0.0
		switch gender {
		case "male", "男":
			iron, zinc, vitaminA = 12, 12.5, 800
		case "female", "女":
			iron, zinc, vitaminA = 20, 7.5, 700
		}
		if iron > 0 {
			rules = append(rules,
				makeRule("ironMg", "mg", iron, "wst-578.3-2017", traceURL, "RNI"),
				makeRule("zincMg", "mg", zinc, "wst-578.3-2017", traceURL, "RNI"),
				makeRule("vitaminARaeMcg", "mcg RAE", vitaminA, "wst-578.4-2018", vitaminURL, "RNI"),
			)
		}
	}
	return rules
}

func dietProfileAge(profile *domain.StatsUserProfile, now time.Time) int {
	if profile == nil || profile.Birthday == nil {
		return -1
	}
	birthday := strings.TrimSpace(*profile.Birthday)
	birth, err := time.Parse("2006-01-02", birthday)
	if err != nil {
		// PostgreSQL DATE can be projected by GORM into an RFC3339 string.
		// Keep its calendar date rather than converting a birthday across zones.
		birth, err = time.Parse(time.RFC3339Nano, birthday)
		if err != nil {
			return -1
		}
	}
	now = now.In(chinaTZ)
	age := now.Year() - birth.Year()
	if now.Month() < birth.Month() || now.Month() == birth.Month() && now.Day() < birth.Day() {
		age--
	}
	if age < 0 || age > 120 {
		return -1
	}
	return age
}
