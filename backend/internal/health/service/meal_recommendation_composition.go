package service

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/nutritionagg"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
)

var (
	// 例 is the usual order unit of a Chinese dish ("元/例"); 份/碗/盘/套/餐 likewise.
	mealServingUnitPattern      = regexp.MustCompile(`^(?:元\s*/\s*|每)?(?:份|碗|盘|套|套餐|餐|例|小例|中例|大例)(?:元)?$`)
	mealStapleStructurePattern  = regexp.MustCompile(`米饭|拌饭|盖饭|盖浇饭|鸡饭|牛肉饭|滑蛋饭|炒饭|煲仔饭|石锅饭|鳗鱼饭|面条|面包|意面|荞麦面|牛肉面|臊子面|打卤面|阳春面|清汤面|拉面|拌面|炒面|生煎|烧麦|烧卖|汉堡|鸡肉卷|肉夹馍|煎饼|馅饼|米粉|米线|土豆粉|馒头|包子|饺|馄饨|杂粮|红薯|燕麦|粥|饭|花卷|烧饼|饭团|凉皮|面片`)
	mealCornStaplePattern       = regexp.MustCompile(`(?:^|[ +])(?:蒸|煮|烤|甜)?玉米(?:棒|段)?(?:$|[ +])`)
	mealProteinStructurePattern = regexp.MustCompile(`肉|鸡|牛|猪|鱼|虾|蛋|豆腐|豆皮|豆干|奶|排骨|鸭|羊`)
	// Noodle, dumpling-soup and rice-noodle bowls are named in endless regional ways. Only the
	// dish name and its items are read for these; batter and gluten dishes are not noodles.
	mealNoodleNamePattern = regexp.MustCompile(`面|抄手|烩饼|炒饼|刀削|拉条|疙瘩`)
	mealNotNoodlePattern  = regexp.MustCompile(`面筋|面托|面糊|面皮|面粉`)
	mealNoodleBowlPattern = regexp.MustCompile(`面|粉|抄手|馄饨|饺|米线|河粉|烩饼|炒饼|拉条`)
)

// Composition is a data-backed serving calculation, not a medical satiety claim.
// Never invent a rice price or silently interpret a per-weight price as a meal.
func mealKnownServing(c DietRecommendationCandidate) bool {
	if c.PriceType == "by_weight" || c.PriceType == "range" || c.PriceType == "market" {
		return false
	}
	// Absence of a unit is not evidence of a portion price. Catalog nutrition
	// (often estimated per reference serving) must not supply the missing unit.
	unit := strings.TrimSpace(c.PriceUnit)
	return c.Price > 0 && mealServingUnitPattern.MatchString(unit)
}

func mealHasStructure(c DietRecommendationCandidate) bool {
	return mealHasNamedStructure(c) && c.Carbs >= 15 && c.Protein >= 10
}

func mealHasNamedStructure(c DietRecommendationCandidate) bool {
	// Suggested pairings in a description are not components included in sale.
	text := c.Title
	for _, item := range c.Items {
		text += " " + item.Name
	}
	staple := mealStapleStructurePattern.MatchString(text)
	// Corn inside a stir-fry is not evidence of an included staple serving.
	// A separately recorded cob can still supply the staple in a real combo.
	staple = staple || mealCornStaplePattern.MatchString(text)
	// Noodles, dumpling soups and rice noodles by any regional name, from the dish name only.
	noodleText := mealNotNoodlePattern.ReplaceAllString(text, "")
	staple = staple || mealNoodleNamePattern.MatchString(noodleText)
	protein := mealProteinStructurePattern.MatchString(text)
	// A bowl of noodles or dumplings whose recorded protein shows toppings is a meal even
	// when its name lists none; plain noodles (a few grams of protein) are not.
	toppedBowl := c.Protein >= 15 && mealNoodleBowlPattern.MatchString(noodleText)
	// A cooked noodle bowl is a main dish even when its name does not contain
	// 肉/蛋/豆. Known nutrition and explicit user minimums are checked separately;
	// bare rice, dough, a pot base or hotpot dumplings do not get this exemption.
	staple = staple || strings.Contains(c.Title, "肉饼") || strings.Contains(c.Title, "鸡蛋堡") || strings.Contains(c.Title, "香菇油菜包")
	return staple && (protein || toppedBowl || mealPreparedMainPattern.MatchString(c.Title) || strings.Contains(c.Title, "香菇油菜包"))
}

func mealSamePlace(a, b DietRecommendationCandidate) bool {
	if a.SourceID != "" && a.SourceID == b.SourceID {
		return true
	}
	if a.SchoolID != "" && b.SchoolID != "" && a.SchoolID != b.SchoolID {
		return false
	}
	if a.CampusID != "" && b.CampusID != "" && a.CampusID != b.CampusID {
		return false
	}
	sameVenue := false
	if a.CanteenID != "" && b.CanteenID != "" {
		sameVenue = a.CanteenID == b.CanteenID
	} else {
		an := domain.DiningVenueKey(defaultIfEmpty(a.CanteenName, a.MerchantName))
		bn := domain.DiningVenueKey(defaultIfEmpty(b.CanteenName, b.MerchantName))
		sameArea := a.SchoolID != "" && a.SchoolID == b.SchoolID || a.SchoolName != "" && a.SchoolName == b.SchoolName || a.Address != "" && a.Address == b.Address
		sameVenue = an != "" && an == bn && sameArea
	}
	if !sameVenue {
		return false
	}
	af, bf := mealFloorKey(a.Floor), mealFloorKey(b.Floor)
	if af != "" || bf != "" {
		return af != "" && af == bf
	}
	// Without floor evidence only a verified identical window (or a single
	// ordinary merchant at one address) can be composed, never two windows.
	return a.WindowID != "" && a.WindowID == b.WindowID ||
		a.WindowName != "" && a.WindowName == b.WindowName ||
		!a.IsCampusFood && !b.IsCampusFood && a.CanteenName == "" && b.CanteenName == "" && a.Address != "" && a.Address == b.Address
}

func mealFloorKey(floor string) string {
	floor = strings.ToUpper(strings.Join(strings.Fields(floor), ""))
	if m := regexp.MustCompile(`^B([1-9][0-9]*)`).FindStringSubmatch(floor); len(m) > 1 {
		return "B" + m[1]
	}
	floor = strings.NewReplacer("地下一层", "B1", "负一层", "B1", "地下二层", "B2", "负二层", "B2", "一楼", "1", "一层", "1", "二楼", "2", "二层", "2", "三楼", "3", "三层", "3", "四楼", "4", "四层", "4").Replace(floor)
	return strings.TrimRight(floor, "F层楼")
}

// Each part is checked on its own. The user's whole-meal minimum protein and a
// required staple belong to the assembled meal, not to every side dish.
func validateMealComponents(state *campusDietAgentRunState, components []DietRecommendationCandidate) error {
	if len(components) < 2 || len(components) > 4 {
		return fmt.Errorf("一餐需要2至4个真实条目")
	}
	componentState := *state
	componentState.Constraints.MinProtein = nil    // the user's minimum applies to the whole meal, not each side
	componentState.Constraints.RequiredStaple = "" // staple requirement applies to the composed meal, not each side
	seen := map[string]bool{}
	fullMeals := 0
	for _, c := range components {
		if risk := mealOrderingRisk(c); risk != "" {
			return fmt.Errorf("%s：%s。请检索能直接点单的主餐或有完整必选费用证据的套餐，不要只加配菜标价", c.Title, risk)
		}
		if mealHasStructure(c) {
			fullMeals++
			if fullMeals > 1 {
				return fmt.Errorf("不要把两份完整主餐叠加为一餐；请选择一份主餐搭配配菜")
			}
		}
		if c.Source == "meal_plan" || !mealKnownServing(c) {
			return fmt.Errorf("组合只接受份价已知的原始条目，不能将按两单价当作整份")
		}
		if !mealSamePlace(components[0], c) {
			return fmt.Errorf("组合须在同一食堂且有同层依据，或同一具明确地址的商家购买；不跨食堂或楼层拼餐")
		}
		if len(mealHarnessRank(&componentState, []DietRecommendationCandidate{c})) == 0 {
			return fmt.Errorf("组合中的菜品不符合本餐条件")
		}
		if seen[c.SourceID] {
			return fmt.Errorf("不要重复叠加同一条目")
		}
		seen[c.SourceID] = true
	}
	return nil
}

// composeMealPlan totals already-validated parts and checks the assembled meal.
// It does not register anything in the run state.
func composeMealPlan(state *campusDietAgentRunState, components []DietRecommendationCandidate) (DietRecommendationCandidate, error) {
	if len(components) < 2 || len(components) > 4 {
		return DietRecommendationCandidate{}, fmt.Errorf("一餐需要2至4个真实条目")
	}
	ids, titles := make([]string, 0, len(components)), make([]string, 0, len(components))
	combined := components[0]
	combined.Calories, combined.Protein, combined.Carbs, combined.Fat, combined.Price = 0, 0, 0, 0, 0
	combined.Items = nil
	vectors := make([]nutritionagg.Vector, 0, len(components))
	for _, c := range components {
		ids, titles = append(ids, c.SourceID), append(titles, c.Title)
		combined.Calories += c.Calories
		combined.Protein += c.Protein
		combined.Carbs += c.Carbs
		combined.Fat += c.Fat
		combined.Price += c.Price
		vectors = append(vectors, c.Nutrients)
		combined.Items = append(combined.Items, DietRecommendationFoodItem{Name: c.Title, Amount: mealPartAmount(c), Source: c.Source, SourceID: c.SourceID})
	}
	for _, total := range []*float64{&combined.Calories, &combined.Protein, &combined.Carbs, &combined.Fat, &combined.Price} {
		*total = math.Round(*total*100) / 100
	}
	combined.Nutrients = nutritionagg.Combine(vectors...)
	if state.Constraints.MaxPrice != nil && combined.Price > *state.Constraints.MaxPrice {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计%s元，超过预算", formatCampusDietNumber(combined.Price))
	}
	if state.Constraints.MaxCalories != nil && combined.Calories > *state.Constraints.MaxCalories {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计%s kcal，超过本餐上限", formatCampusDietNumber(combined.Calories))
	}
	combined.Title = strings.Join(titles, " + ")
	windows := []string{}
	for _, c := range components {
		if c.WindowName != "" && !slices.Contains(windows, c.WindowName) {
			windows = append(windows, c.WindowName)
		}
	}
	if len(windows) > 1 {
		combined.WindowID = ""
		combined.WindowName = strings.Join(windows, " + ")
		combined.Address = strings.Join(compactDietStrings(combined.SchoolName, combined.CanteenName, combined.Floor), " · ")
	}
	if !mealHasStructure(combined) {
		return DietRecommendationCandidate{}, fmt.Errorf("组合仍缺少有记录依据的主食与蛋白搭配，不能当成完整一餐")
	}
	sort.Strings(ids)
	digest := sha256.Sum256([]byte(strings.Join(ids, ":")))
	combined.Source, combined.SourceID = "meal_plan", fmt.Sprintf("meal:%x", digest[:12])
	combined.PriceUnit = "元/餐"
	combined.Description = "按各1个库内记录份量合计；实际份量、供应及配料需向窗口确认"
	combined.NutritionBasis = "library_estimate"
	// The first part's portion text and supply periods do not describe the assembled
	// meal. Say only what holds for every part.
	combined.PortionDescription = ""
	combined.MealPeriods = mealCommonPeriods(components)
	for _, c := range components {
		if c.ImagePath != "" && mealComboRoleOf(c) != mealRoleStaple {
			combined.ImagePath = c.ImagePath
			break
		}
	}
	if len(mealHarnessRank(state, []DietRecommendationCandidate{combined})) == 0 {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计不满足本餐营养或其它硬约束")
	}
	return combined, nil
}

// buildMealPlan validates the parts and totals them without touching the state.
func buildMealPlan(state *campusDietAgentRunState, components []DietRecommendationCandidate) (DietRecommendationCandidate, error) {
	if err := validateMealComponents(state, components); err != nil {
		return DietRecommendationCandidate{}, err
	}
	return composeMealPlan(state, components)
}

func registerMealPlan(state *campusDietAgentRunState, components []DietRecommendationCandidate) (DietRecommendationCandidate, error) {
	combined, err := buildMealPlan(state, components)
	if err != nil {
		return DietRecommendationCandidate{}, err
	}
	registerBuiltMealPlan(state, combined, components)
	return combined, nil
}

func registerBuiltMealPlan(state *campusDietAgentRunState, plan DietRecommendationCandidate, components []DietRecommendationCandidate) {
	if state.MealPlans == nil {
		state.MealPlans = map[string][]DietRecommendationCandidate{}
	}
	if state.Candidates == nil {
		state.Candidates = map[string]DietRecommendationCandidate{}
	}
	state.MealPlans[plan.SourceID] = components
	state.Candidates[plan.SourceID] = plan
}

// The distinct windows and floors a meal is bought at, in component order; windows
// counts the counters that must be queued at.
func mealPurchasePoints(components []DietRecommendationCandidate) (labels []string, windows int) {
	seenKeys, seenLabels := map[string]bool{}, map[string]bool{}
	for _, c := range components {
		if key := mealWindowKey(c); key != "" {
			seenKeys[key] = true
		}
		if label := mealWindowLabel(c); label != "" && !seenLabels[label] {
			seenLabels[label] = true
			labels = append(labels, label)
		}
	}
	return labels, len(seenKeys)
}

// What the card shows beside each dish of an assembled meal: one recorded serving, its price
// and the window it is bought at, e.g. 1份 · ¥2 · 主食窗口（1F）.
func mealPartAmount(c DietRecommendationCandidate) string {
	parts := []string{"1份"}
	if c.Price > 0 {
		parts = append(parts, "¥"+formatCampusDietNumber(c.Price))
	}
	if label := mealWindowLabel(c); label != "" {
		parts = append(parts, label)
	}
	return strings.Join(parts, " · ")
}

func mealWindowKey(c DietRecommendationCandidate) string {
	if c.WindowID != "" {
		return "id:" + c.WindowID
	}
	if c.WindowName != "" {
		return "name:" + c.WindowName
	}
	return ""
}

// The label users see for where a part is sold, e.g. 家常菜窗口（1F）.
func mealWindowLabel(c DietRecommendationCandidate) string {
	name := strings.TrimSpace(c.WindowName)
	if name == "" {
		return ""
	}
	if floor := strings.TrimSpace(c.Floor); floor != "" {
		return name + "（" + floor + "）"
	}
	return name
}

func mealCommonPeriods(components []DietRecommendationCandidate) []string {
	var common map[string]bool
	for _, c := range components {
		if len(c.MealPeriods) == 0 {
			return []string{} // one part with unknown supply hours leaves the whole meal unknown
		}
		current := map[string]bool{}
		for _, period := range c.MealPeriods {
			if common == nil || common[period] {
				current[period] = true
			}
		}
		common = current
	}
	out := []string{}
	for _, period := range []string{"breakfast", "lunch", "dinner"} {
		if common[period] {
			out = append(out, period)
		}
	}
	return out
}

func composeMealTool(state *campusDietAgentRunState, raw string) (map[string]any, error) {
	if !state.MealContextLoaded {
		return nil, fmt.Errorf("请先读取个人上下文并检索餐食")
	}
	var args struct {
		SourceIDs []string `json:"source_ids"`
	}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, err
	}
	components := []DietRecommendationCandidate{}
	for _, id := range mealResolveChoiceIDs(state, args.SourceIDs) {
		c, ok := state.Candidates[id]
		if !ok {
			return nil, fmt.Errorf("组合条目尚未检索，请先查询")
		}
		components = append(components, c)
	}
	plan, err := registerMealPlan(state, components)
	if err != nil {
		return nil, err
	}
	return map[string]any{"meal_id": plan.SourceID, "returned": 1, "meal": campusDietAgentToolCandidates([]DietRecommendationCandidate{plan}, true, state), "components": campusDietAgentToolCandidates(components, true, state)}, nil
}

func mealStoredComponents(state *campusDietAgentRunState, id string) []DietRecommendationCandidate {
	if components := state.MealPlans[id]; len(components) > 0 {
		return components
	}
	if state.ActiveResult != nil {
		for _, o := range state.ActiveResult.Recommendations {
			if o.SourceID == id {
				return o.MealComponents
			}
		}
	}
	return nil
}

func mealPhysicalIDs(state *campusDietAgentRunState, ids []string) []string {
	out := []string{}
	for _, id := range ids {
		if components := mealStoredComponents(state, id); len(components) > 0 {
			for _, c := range components {
				out = append(out, c.SourceID)
			}
		} else {
			out = append(out, id)
		}
	}
	return normalizeDietRecommendationSourceIDs(out)
}

// Synthetic plan IDs are not database UUIDs. Keep plan exclusions in the final
// selection validator; excluding all components would also wrongly ban rice
// reused in a genuinely different meal.
func mealOriginalSourceIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !strings.HasPrefix(id, "meal:") {
			out = append(out, id)
		}
	}
	return out
}

// mealComboSearchLimit is how many assembled meals a search hands to the ranking;
// the final selection then picks the few shown.
const mealComboSearchLimit = 12

// Build bounded, purchasable combinations before ranking whole meals. Ranking
// sides as if each were lunch otherwise rewards a low-calorie mushroom dish.
// Only real portion-priced rows participate; no invented rice, price or menu.
// The assembly itself (roles, same canteen and floor, nutrition, variety) lives in
// searchMealOptions; this keeps the signature the search tools call.
func mealBuildCombinations(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	report := searchMealOptions(state, candidates, mealComboSearchLimit, false)
	plans := make([]DietRecommendationCandidate, 0, len(report.Combos))
	for _, combo := range report.Combos {
		registerBuiltMealPlan(state, combo.Plan, combo.Components)
		plans = append(plans, combo.Plan)
	}
	return plans
}
