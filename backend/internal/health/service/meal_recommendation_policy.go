package service

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"food_link/backend/internal/health/domain"
)

var mealCampusDenied = regexp.MustCompile(`(?:不要|不去|不进|不能|没法|无法|不方便)[^，。；！？,;!?]{0,16}(?:学校|校园|校内|食堂)|不在[^，。；！？,;!?]{0,16}食堂(?:吃|就餐|消费)|(?:只看|只要|只吃|仅看|仅限)[^，。；！？,;!?]{0,8}(?:校外|外卖|商家)`)
var mealCampusConfirmed = regexp.MustCompile(`(?:可以|能够|能|方便)在[^，。；！？,;!?]{0,16}食堂(?:吃|就餐|消费)|(?:就在|已经在|正在)[^，。；！？,;!?]{0,12}食堂(?:吃|就餐|点餐)`)
var mealRelocation = regexp.MustCompile(`外地|出差|离开.{0,10}(?:学校|大学|校园)|换了(?:城市|学校|位置)|换到|现在不在|不在常用学校`)

func mealExplicitPlaceText(question string) string {
	parts := []string{}
	for _, match := range regexp.MustCompile(`(?:现在在|目前在|在|换到|到了)([^，。；！？,;!?]{1,50})`).FindAllStringSubmatch(question, -1) {
		parts = append(parts, match[1])
	}
	return strings.Join(parts, "，")
}

// A location, saved university, or student identity is not an assertion that a
// particular dining facility can be used. Only user-confirmed access is durable
// within the meal conversation; models cannot grant it through tool arguments.
func initializeMealAccess(state *campusDietAgentRunState) {
	c := &state.Constraints
	q := strings.ReplaceAll(state.Question, " ", "")
	if mealRelocation.MatchString(q) {
		c.AllowedSchoolIDs, c.PendingSchool = nil, nil
		c.CampusAccessDenied = false
	}
	if mealCampusDenied.MatchString(q) {
		c.AllowedSchoolIDs, c.PendingSchool = nil, nil
		c.CampusAccessDenied = true
		c.Scene = "takeout"
		return
	}
	target := state.School
	if target.ID == "" && c.PendingSchool != nil {
		target = *c.PendingSchool
	}
	confirmed := mealCampusConfirmed.MatchString(q)
	if c.PendingSchool != nil && regexp.MustCompile(`^(可以|能|方便|可以的|能在食堂吃饭)[。！!，,]*$`).MatchString(q) {
		confirmed = true
		target = *c.PendingSchool
	}
	if confirmed && target.ID != "" {
		c.AllowedSchoolIDs = []string{target.ID}
		c.PendingSchool = nil
		c.CampusAccessDenied = false
		if c.Scene == "takeout" {
			c.Scene = "any"
		}
		if state.Location == nil {
			state.School = target
		}
	}
}

func mealCampusAvailable(state *campusDietAgentRunState, candidate DietRecommendationCandidate) bool {
	if !candidate.IsCampusFood {
		return true
	}
	if !state.Constraints.CampusAccessDenied && candidate.SchoolID != "" && slices.Contains(state.Constraints.AllowedSchoolIDs, candidate.SchoolID) {
		return true
	}
	if !state.Constraints.CampusAccessDenied && state.Constraints.Scene != "takeout" && candidate.SchoolID != "" && state.Constraints.PendingSchool == nil {
		state.Constraints.PendingSchool = &domain.DietRecommendationSchool{ID: candidate.SchoolID, Name: candidate.SchoolName}
	}
	return false
}

func mealExplicitScene(q string) string {
	if mealCampusDenied.MatchString(q) {
		return "takeout"
	}
	if regexp.MustCompile(`(?:不要|不点|不吃)外卖`).MatchString(q) {
		return "any"
	}
	if strings.Contains(q, "外卖") || regexp.MustCompile(`只.{0,4}校外|只.{0,4}商家`).MatchString(q) {
		return "takeout"
	}
	if regexp.MustCompile(`(?:想|要|去|在|只看|只吃).{0,10}食堂|校内吃`).MatchString(q) {
		return "campus"
	}
	if regexp.MustCompile(`食堂.{0,8}(?:商家|外卖).{0,6}都可以|都可以|不限场景`).MatchString(q) {
		return "any"
	}
	return ""
}

func mealFoodTokens(value string) []string {
	out := []string{}
	for _, token := range regexp.MustCompile(`[、,，和及与或/]+`).Split(value, -1) {
		token = strings.TrimSpace(token)
		for _, prefix := range []string{"还是", "仍然", "也", "再", "吃"} {
			token = strings.TrimPrefix(token, prefix)
		}
		for _, suffix := range []string{"了", "的", "一些", "一点"} {
			token = strings.TrimSuffix(token, suffix)
		}
		if token == "" || regexp.MustCompile(`食堂|学校|校内|校外|外卖|商家|方案|推荐|建议|换菜|地点|位置|预算|记录|营养|主食|只|单个|更多|保持|不变|条件|限制|编|胡说|瞎猜`).MatchString(token) {
			continue
		}
		if !slices.Contains(out, token) {
			out = append(out, token)
		}
	}
	return out
}

func applyMealFoodConstraints(c *CampusDietRecommendationConstraints, q string) {
	c.AvoidFoods = mealFoodTokens(strings.Join(c.AvoidFoods, "、"))
	for _, match := range regexp.MustCompile(`(?:不吃|不要|不能吃|忌口)[：:]?([^，。；！？\n]+)`).FindAllStringSubmatch(q, -1) {
		for _, food := range mealFoodTokens(match[1]) {
			if len([]rune(food)) <= 10 && !slices.Contains(c.AvoidFoods, food) {
				c.AvoidFoods = append(c.AvoidFoods, food)
			}
		}
	}
	for _, match := range regexp.MustCompile(`(?:可以吃|能吃|取消忌口)[：:]?([^，。；！？\n]+)`).FindAllStringSubmatch(q, -1) {
		for _, food := range mealFoodTokens(match[1]) {
			c.AvoidFoods = slices.DeleteFunc(c.AvoidFoods, func(old string) bool { return old == food })
		}
	}
	// Chinese commonly places the food before the permission: 虾今天可以吃了.
	for _, clause := range regexp.MustCompile(`[，。；！？,;!?\n]+`).Split(q, -1) {
		for _, food := range append([]string(nil), c.AvoidFoods...) {
			pattern := `(?:^|但|不过|今天|这餐|现在)` + regexp.QuoteMeta(food) + `(?:今天|这餐|现在)?(?:可以|能)吃(?:了)?$`
			if regexp.MustCompile(pattern).MatchString(strings.TrimSpace(clause)) {
				c.AvoidFoods = slices.DeleteFunc(c.AvoidFoods, func(old string) bool { return old == food })
			}
		}
	}
	if strings.Contains(q, "清淡") && !slices.Contains(c.PreferFoods, "清淡") {
		c.PreferFoods = append(c.PreferFoods, "清淡")
	}
	if regexp.MustCompile(`一餐|吃饱|早餐|午餐|晚餐|早饭|午饭|晚饭`).MatchString(q) {
		c.CompleteMeal = true
	}
	for _, meal := range []struct{ pattern, value string }{{`早餐|早饭`, "breakfast"}, {`午餐|午饭`, "lunch"}, {`晚餐|晚饭`, "dinner"}} {
		if regexp.MustCompile(meal.pattern).MatchString(q) {
			c.MealType = meal.value
		}
	}
}

// Keep prose and numbers backed by retrieval without a blanket two-sentence
// truncation. Exact menu facts still come from the server-owned cards.
func mealEvidenceText(state *campusDietAgentRunState, answer string) string {
	answer = strings.ReplaceAll(answer, `\n`, "\n")
	segments := strings.FieldsFunc(answer, func(r rune) bool { return r == '。' || r == '；' || r == '\n' })
	kept := []string{}
	unsafe := regexp.MustCompile(`完美契合|不会给.{0,8}(?:肠胃|胃|消化)|胃炎|胃部|胃黏膜|易消化|促进消化|升糖指数|肌酸|即可满足.{0,8}需求|长期偏低|今天.{0,6}(?:没吃|空着)|不含花生|不含虾|均不含|均避开|(?:验证|核实|确认|过敏).{0,4}安全|一次买齐|一起解决|稳稳控制|实时外卖平台`)
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" || campusDietAgentUnsupportedClaimPattern.MatchString(segment) || unsafe.MatchString(segment) {
			continue
		}
		if regexp.MustCompile(`可以吃|可食用|可以接受|可接受|不再忌口|不过敏`).MatchString(segment) && matchedDietDecisionAllergen(state.MealContext.Allergies, DietRecommendationCandidate{Title: segment}) != "" {
			continue // a model must not announce that a profile allergen is safe after a temporary preference change
		}
		if campusDietAgentDigitPattern.MatchString(segment) || campusDietAgentChineseNumericClaimPattern.MatchString(segment) {
			// Evidence counts are emitted below from server-owned facts. Do not
			// accept arbitrary numeric claims just because a number occurs elsewhere.
			continue
		}
		kept = append(kept, segment)
	}
	return trimStatsRunes(strings.Join(kept, "。"), 1200)
}

func mealHistoryExplanation(state *campusDietAgentRunState) string {
	if len(state.PersonalContext.FoodFrequency) == 0 {
		return ""
	}
	parts := []string{}
	for _, food := range state.PersonalContext.FoodFrequency {
		if len(parts) == 3 {
			break
		}
		parts = append(parts, fmt.Sprintf("%s %d 条", food.Name, food.Count))
	}
	return fmt.Sprintf("近30天你有%d天、%d条饮食记录，其中%s。这反映已记录的饮食，不代表全部实际摄入。", state.PersonalContext.RecordedDays, state.PersonalContext.RecordCount, strings.Join(parts, "、"))
}

func mealCandidateLocation(c DietRecommendationCandidate) string {
	if strings.TrimSpace(c.Address) != "" {
		return c.Address
	}
	return strings.Join(compactDietStrings(c.SchoolName, c.CampusName, c.CanteenName, c.Floor, c.WindowName, c.MerchantName), " · ")
}

func mealConstraintConfirmation(state *campusDietAgentRunState) string {
	if !strings.Contains(state.Question, "确认") || len(state.Constraints.AvoidFoods) == 0 {
		return ""
	}
	text := "仍保留本餐忌口：" + strings.Join(state.Constraints.AvoidFoods, "、") + "。"
	if len(state.MealContext.Allergies) > 0 {
		text += "档案中的过敏限制（" + strings.Join(state.MealContext.Allergies, "、") + "）也继续生效；本餐口味调整不会解除过敏限制。"
	}
	return text
}

func mealFeasibleChoices(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	out := []DietRecommendationCandidate{}
	for _, c := range mealHarnessRank(state, candidates) {
		if state.Constraints.CompleteMeal && !mealHasStructure(c) {
			continue
		}
		if state.Intent == "more" && slices.Contains(state.ExcludedSourceIDs, c.SourceID) {
			continue
		}
		out = append(out, c)
	}
	return out
}

func mealAvoidFoodMatches(avoid, text string) bool {
	avoid = normalizeDietDecisionToken(avoid)
	if avoid == "" {
		return false
	}
	if strings.Contains(text, avoid) {
		return true
	}
	if avoid == "鸡肉" {
		return regexp.MustCompile(`鸡胸|鸡腿|鸡翅|鸡排|鸡块|鸡柳|鸡饭|鸡丝|烤鸡|炸鸡|盐焗鸡|鸡丁`).MatchString(text)
	}
	for _, alias := range dietDecisionAllergenAliases(avoid) {
		if strings.Contains(text, alias) {
			return true
		}
	}
	return false
}
