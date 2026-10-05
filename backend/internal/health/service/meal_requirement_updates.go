package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const mealRequirementVersion = 2

// Updates change only this meal's conversation state. Profile allergies remain
// in MealContext and are enforced independently, including after a release.
type mealRequirementUpdate struct {
	Field    string `json:"field"`
	Action   string `json:"action"`
	Value    string `json:"value"`
	Evidence string `json:"evidence"`
}

var mealFoodNegative = regexp.MustCompile(`不想再吃|不想吃|不喜欢|别再推荐|不能有|不能吃|不(?:能)?含|不吃|不要|忌口|避开`)
var mealFoodRelease = regexp.MustCompile(`取消|解除|不再忌口|可以(?:吃)?|能吃|可接受|想吃|换成|改成`)
var mealFoodPreference = regexp.MustCompile(`想吃|要吃|喜欢|偏好|换成|改成`)
var mealCanteenRelease = regexp.MustCompile(`不限(?:定)?(?:食堂|桃李|紫荆|清芬|清青)|不(?:再)?(?:限制|限定|锁定)|所有食堂|全校食堂|其他食堂`)

func mealCanonicalFood(value string) string {
	value = strings.Trim(strings.TrimSpace(value), "：:。！!?？")
	for _, prefix := range []string{"算了", "算啦", "但", "不过", "之前", "刚才", "今天", "现在", "这餐", "还是", "仍然", "也", "再", "吃"} {
		value = strings.TrimPrefix(value, prefix)
	}
	// A clause tail is not part of a food name (e.g. 鸡肉这些要求仍保留).
	if i := regexp.MustCompile(`这些要求|要求仍|仍然保留|仍保留|仍然保持|还是保留|那条|这条|这项|取消|保持|保留|不变|都可以|可以吃|可以了|能吃|不能吃|不吃`).FindStringIndex(value); i != nil {
		value = value[:i[0]]
	}
	for _, suffix := range []string{"今天", "现在", "这餐", "一些", "一点", "的", "了"} {
		value = strings.TrimSuffix(value, suffix)
	}
	switch value {
	case "面条", "面食":
		return "面"
	case "蛋", "鸡蛋制品":
		return "鸡蛋"
	case "鸡", "鸡肉类":
		return "鸡肉"
	case "白米饭", "米饭类":
		return "米饭"
	}
	return value
}

func mealRequirementFoods(value string) []string {
	foods := []string{}
	for _, item := range regexp.MustCompile(`[、,，和及与或/]+`).Split(value, -1) {
		food := mealCanonicalFood(item)
		if food == "" || len([]rune(food)) > 16 || regexp.MustCompile(`食堂|学校|校内|校外|外卖|商家|方案|推荐|建议|搭配|没吃过|说成|食谱|历史|来源|查不到|换菜|地点|位置|预算|记录|营养|主食|只|单个|更多|条件|限制|编|胡说|猜|推测|判断|假设|刚才|之前|现在|这份|这餐|那份|上面|前面|刚练|训练|健身|午餐|晚餐|早餐|要求|先不|[0-9]+.*(?:元|卡|kcal|克|公里)`).MatchString(food) {
			continue
		}
		if !slices.Contains(foods, food) {
			foods = append(foods, food)
		}
	}
	return foods
}

func mealApplyFoodUpdate(c *CampusDietRecommendationConstraints, field, action, value string) {
	food := mealCanonicalFood(value)
	if len(mealRequirementFoods(food)) != 1 {
		return
	}
	if field == "avoid_food" {
		if action == "remove" {
			c.AvoidFoods = slices.DeleteFunc(c.AvoidFoods, func(old string) bool { return mealCanonicalFood(old) == food })
		} else if action == "add" {
			if !slices.Contains(c.AvoidFoods, food) {
				c.AvoidFoods = append(c.AvoidFoods, food)
			}
			c.PreferFoods = slices.DeleteFunc(c.PreferFoods, func(old string) bool { return mealCanonicalFood(old) == food })
			if food == "米饭" && c.RequiredStaple == "rice" || food == "面" && c.RequiredStaple == "noodles" {
				c.RequiredStaple = ""
			}
		}
	} else if field == "prefer_food" {
		if action == "remove" {
			c.PreferFoods = slices.DeleteFunc(c.PreferFoods, func(old string) bool { return mealCanonicalFood(old) == food })
		} else if action == "add" {
			mealApplyFoodUpdate(c, "avoid_food", "remove", food)
			if food == "米饭" || food == "面" {
				c.PreferFoods = slices.DeleteFunc(c.PreferFoods, func(old string) bool { return old == "米饭" || old == "面" })
				c.RequiredStaple = map[string]string{"米饭": "rice", "面": "noodles"}[food]
			}
			if !slices.Contains(c.PreferFoods, food) {
				c.PreferFoods = append(c.PreferFoods, food)
			}
		}
	}
}

func mealApplyExplicitFoodChanges(c *CampusDietRecommendationConstraints, question string) {
	c.AvoidFoods = mealRequirementFoods(strings.Join(c.AvoidFoods, "、"))
	c.PreferFoods = mealRequirementFoods(strings.Join(c.PreferFoods, "、"))
	// Process in utterance order so later corrections win. Release clauses must
	// never first add the negated historical text as a new exclusion.
	for _, clause := range regexp.MustCompile(`[，。；！？,;!?\n]+`).Split(question, -1) {
		clause = strings.TrimSpace(clause)
		if clause == "" {
			continue
		}
		negative := mealFoodNegative.FindStringIndex(clause)
		release := regexp.MustCompile(`取消|解除|不再忌口`).MatchString(clause)
		suffixRelease := regexp.MustCompile(`(?:都|也)?(?:可以(?:吃)?|能吃|可接受)(?:了)?$`).FindStringIndex(clause)
		if release || suffixRelease != nil {
			value := clause
			if negative != nil {
				value = clause[negative[1]:]
			} else if suffixRelease != nil {
				value = clause[:suffixRelease[0]]
			} else if m := regexp.MustCompile(`(?:取消|解除)(?:对)?(.+?)(?:的忌口|忌口|限制)?$`).FindStringSubmatch(clause); len(m) > 1 {
				value = m[1]
			}
			for _, food := range mealRequirementFoods(value) {
				mealApplyFoodUpdate(c, "avoid_food", "remove", food)
			}
			continue
		}
		if m := regexp.MustCompile(`(?:可以吃|能吃)[：:]?(.+)$`).FindStringSubmatch(clause); len(m) > 1 && negative == nil {
			for _, food := range mealRequirementFoods(m[1]) {
				mealApplyFoodUpdate(c, "avoid_food", "remove", food)
			}
			continue
		}
		if negative != nil {
			value := clause[negative[1]:]
			if strings.TrimSpace(value) == "" {
				value = strings.TrimSuffix(clause[:negative[0]], "还是")
			}
			for _, food := range mealRequirementFoods(value) {
				mealApplyFoodUpdate(c, "avoid_food", "add", food)
			}
			continue
		}
		if m := mealFoodPreference.FindStringIndex(clause); m != nil {
			for _, food := range mealRequirementFoods(clause[m[1]:]) {
				mealApplyFoodUpdate(c, "prefer_food", "add", food)
			}
		}
	}
}

// Model interpretation is an evidence-backed delta, never an untrusted full
// replacement. It handles natural wording while the explicit path is also
// available when the model supplies no updates. Unmentioned fields are kept.
func applyMealRequirementUpdates(state *campusDietAgentRunState, raw string) (int, error) {
	var args struct {
		Updates []mealRequirementUpdate `json:"updates"`
	}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return 0, fmt.Errorf("条件更新参数需要是JSON对象")
	}
	if len(args.Updates) > 16 {
		return 0, fmt.Errorf("单轮条件更新不能超过16项")
	}
	question := normalizeMealChineseNumbers(strings.ReplaceAll(state.Question, " ", ""))
	accepted := 0
	for _, update := range args.Updates {
		evidence := normalizeMealChineseNumbers(strings.ReplaceAll(strings.TrimSpace(update.Evidence), " ", ""))
		value := mealCanonicalFood(update.Value)
		if evidence == "" || !strings.Contains(question, evidence) || regexp.MustCompile(`[，。；！？,;!?\n]`).MatchString(evidence) {
			continue
		}
		switch update.Field {
		case "avoid_food", "prefer_food":
			grounded := strings.Contains(evidence, value)
			for _, token := range mealRequirementFoods(evidence) {
				grounded = grounded || token == value
			}
			if !grounded || len(mealRequirementFoods(value)) != 1 {
				continue
			}
			if update.Field == "avoid_food" && update.Action == "add" && (!mealFoodNegative.MatchString(evidence) || regexp.MustCompile(`取消|解除|不再忌口`).MatchString(evidence)) {
				continue
			}
			if update.Field == "avoid_food" && update.Action == "add" && regexp.MustCompile(`(?:不想吃|不要|不吃)(?:刚才|这份|那份|前面|上一份)`).MatchString(evidence) {
				continue // rejecting one referenced meal is not banning its entire food category
			}
			if update.Field == "avoid_food" && update.Action == "remove" && !mealFoodRelease.MatchString(evidence) {
				continue
			}
			if update.Field == "avoid_food" && update.Action == "remove" && mealFoodNegative.MatchString(evidence) && !regexp.MustCompile(`取消|解除|不再忌口`).MatchString(evidence) {
				continue
			}
			if update.Field == "prefer_food" && update.Action == "add" && (!mealFoodPreference.MatchString(evidence) || mealFoodNegative.MatchString(evidence)) {
				continue
			}
			if update.Field == "prefer_food" && update.Action == "remove" && !regexp.MustCompile(`不想|不喜欢|不要|不吃|取消|改成|换成`).MatchString(evidence) {
				continue
			}
			if update.Action != "add" && update.Action != "remove" {
				continue
			}
			mealApplyFoodUpdate(&state.Constraints, update.Field, update.Action, value)
		case "canteen_name":
			if update.Action == "clear" && mealCanteenRelease.MatchString(evidence) {
				state.Constraints.CanteenName = ""
			} else if update.Action == "set" && strings.Contains(evidence, update.Value) && regexp.MustCompile(`只|仅|就去|就在|锁定|指定`).MatchString(evidence) && regexp.MustCompile(`园|食堂|餐厅`).MatchString(update.Value) && len([]rune(update.Value)) <= 24 {
				state.Constraints.CanteenName = update.Value
			} else {
				continue
			}
		case "option_count":
			n, err := strconv.Atoi(update.Value)
			if err != nil || n < 1 || n > 3 || mealExplicitOptionCount(evidence) != n || update.Action != "set" {
				continue
			}
			state.Constraints.OptionCount = n
		default:
			continue
		}
		accepted++
	}
	state.Constraints.Version = mealRequirementVersion
	return accepted, nil
}

func mealRequirementUpdateSchema() map[string]any {
	return map[string]any{"type": "array", "maxItems": 16, "items": map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"field":    map[string]any{"type": "string", "enum": []string{"avoid_food", "prefer_food", "canteen_name", "option_count"}},
			"action":   map[string]any{"type": "string", "enum": []string{"add", "remove", "set", "clear"}},
			"value":    map[string]any{"type": "string"},
			"evidence": map[string]any{"type": "string", "description": "必须逐字引用本轮用户原话中支持这项变更的片段，不能引用历史或推测"},
		}, "required": []string{"field", "action", "value", "evidence"},
	}}
}

func mealStateOptionLimit(state *campusDietAgentRunState) int {
	if state.Constraints.OptionCount > 0 && state.Constraints.OptionCount <= campusDietAgentDefaultResultSize {
		return state.Constraints.OptionCount
	}
	return mealRequestedOptionLimit(state.Question)
}
