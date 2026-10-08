package service

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
)

var mealCampusDenied = regexp.MustCompile(`(?:不要|不去|不进|不能|没法|无法|不方便)[^，。；！？,;!?]{0,16}(?:学校|校园|校内|食堂)|不在[^，。；！？,;!?]{0,16}食堂(?:吃|就餐|消费)|(?:只看|只要|只吃|仅看|仅限)[^，。；！？,;!?]{0,8}(?:校外|外卖|商家)`)
var mealCampusConfirmed = regexp.MustCompile(`(?:可以|能够|能|方便)在[^，。；！？,;!?]{0,16}食堂(?:吃|就餐|消费)|(?:就在|已经在|正在)[^，。；！？,;!?]{0,12}食堂(?:吃|就餐|点餐)`)
var mealRelocation = regexp.MustCompile(`外地|出差|离开.{0,10}(?:学校|大学|校园)|换了(?:城市|学校|位置)|换到|现在不在|不在常用学校`)

// A polite question such as 能不能推荐北大食堂 is not a denial of access.
// This is a conversation preference, not a real university permission check.
func mealDeniesCampusAccess(question string) bool {
	question = strings.NewReplacer("能不能", "能否", "可不可以", "是否可以", "方不方便", "是否方便").Replace(question)
	return mealCampusDenied.MatchString(question)
}

func mealRequestsCampusDining(question string) bool {
	return !mealDeniesCampusAccess(question) && !mealRequestsMixedDining(question) && strings.Contains(question, "食堂") &&
		regexp.MustCompile(`推荐|想吃|吃什么|饭菜|菜品|点餐|去吃|就餐|吃饭`).MatchString(question)
}

func mealRequestsMixedDining(q string) bool {
	return regexp.MustCompile(`(?:食堂|学校|校内).{0,20}(?:商家|外卖|校外).{0,12}(?:都|一起|同时)|(?:外卖|商家|校外).{0,20}(?:食堂|学校|校内).{0,12}(?:都|一起|同时)|(?:都|一起|同时).{0,12}(?:考虑|看看|比较).{0,20}(?:食堂|外卖)|不限场景|不限(?:学校|食堂|商家)|不只.{0,6}食堂`).MatchString(q)
}

func mealExplicitPlaceText(question string) string {
	parts := []string{}
	for _, match := range regexp.MustCompile(`(?:现在在|目前在|今天在|今天来(?:了|到)?|今天回(?:到)?|来了|来到|在|换到|到了)([^，。；！？,;!?]{1,50})`).FindAllStringSubmatch(question, -1) {
		if strings.HasPrefix(match[1], "校") || strings.HasPrefix(match[1], "读") || strings.HasPrefix(match[1], "线") {
			continue
		}
		parts = append(parts, match[1])
	}
	if len(parts) == 0 {
		return ""
	}
	// The latest explicitly stated place wins over a usual/earlier campus.
	return parts[len(parts)-1]
}

// Published university dining data is available to every user. A school is a
// search scope, never an authorization allowlist. Forget old access metadata.
func initializeMealAccess(state *campusDietAgentRunState) {
	c := &state.Constraints
	q := strings.ReplaceAll(state.Question, " ", "")
	c.AllowedSchoolIDs, c.PendingSchool, c.CampusAccessDenied = nil, nil, false
	if mealDeniesCampusAccess(q) {
		c.Scene = "takeout"
		return
	}
	if school := state.ConfirmedStudentSchool; school != nil && school.ID != "" {
		state.School = *school
	}
	if school := state.RequestedDiningSchool; school != nil && school.ID != "" {
		c.Scene = "campus"
		state.School = *school
	}
}

func mealExplicitScene(q string) string {
	if mealDeniesCampusAccess(q) {
		return "takeout"
	}
	// Mixed requests must be recognised BEFORE either category's keyword.
	if mealRequestsMixedDining(q) {
		return "any"
	}
	if regexp.MustCompile(`(?:不要|不点|不吃)外卖`).MatchString(q) {
		return "any"
	}
	if strings.Contains(q, "外卖") || regexp.MustCompile(`只.{0,4}校外|只.{0,4}商家`).MatchString(q) {
		return "takeout"
	}
	if regexp.MustCompile(`(?:想|要|去|在|只看|只吃).{0,10}食堂|校内吃|(?:清华|大学|学校|本校)食堂`).MatchString(q) {
		return "campus"
	}
	return ""
}

func applyMealFoodConstraints(c *CampusDietRecommendationConstraints, q string) {
	mealApplyExplicitFoodChanges(c, q)
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
	answer = strings.NewReplacer("近期未摄入", "近期记录中未见", "最近未摄入", "最近记录中未见").Replace(answer)
	segments := strings.FieldsFunc(answer, func(r rune) bool { return r == '。' || r == '；' || r == '\n' })
	kept := []string{}
	unsafe := regexp.MustCompile(`完美契合|不会给.{0,8}(?:肠胃|胃|消化)|胃炎|胃部|胃黏膜|易消化|促进消化|升糖指数|肌酸|即可满足.{0,8}需求|长期偏低|今天.{0,6}(?:没吃|空着)|不含花生|不含虾|均不含|均避开|(?:验证|核实|确认|过敏).{0,4}安全|一次买齐|一起解决|稳稳控制|实时外卖平台|一碗管饱|保证.{0,4}吃饱|能吃饱|份量扎实|皮薄馅大|饱腹感强`)
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if regexp.MustCompile(`不含.{0,8}(?:上述|这些|忌口|过敏)|高饱腹感|避开了.{0,16}忌口`).MatchString(segment) {
			continue // Matching recorded ingredients is not a guarantee about a kitchen's allergens or serving size.
		}
		if segment == "" || campusDietAgentUnsupportedClaimPattern.MatchString(segment) || unsafe.MatchString(segment) || regexp.MustCompile(`(?i:低GI|高GI)|campus_access_denied|allowed_school_ids|pending_school|系统.{0,12}(?:权限受限|无权限)|就餐权限受限`).MatchString(segment) {
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
		if state.Constraints.CompleteMeal && !mealHasEvidenceStructure(c) {
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
	switch mealCanonicalFood(avoid) {
	case "米饭":
		return regexp.MustCompile(`米饭|拌饭|盖饭|盖浇|炒饭|煲仔|石锅|饭团|饭卷|[鸡鸭鹅牛猪鱼虾蛋肉排骨腿]饭`).MatchString(text)
	case "面":
		return regexp.MustCompile(`面条|面食|拉面|拌面|炒面|汤面|意面|荞麦面|[牛肉鸡排鱼汤热干凉刀削]面|米线|米粉|土豆粉|河粉|肠粉`).MatchString(text)
	case "鸡蛋":
		return regexp.MustCompile(`鸡蛋|煎蛋|炒蛋|滑蛋|卤蛋|荷包蛋|蒸蛋|茶叶蛋|蛋饭|蛋花|蛋黄|蛋清|全蛋`).MatchString(text)
	}
	for _, alias := range dietDecisionAllergenAliases(avoid) {
		if strings.Contains(text, alias) {
			return true
		}
	}
	return false
}
