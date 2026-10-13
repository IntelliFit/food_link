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

// Composition is a data-backed serving calculation, not a medical satiety claim.
// Never invent a rice price or silently interpret a per-weight price as a meal.
func mealKnownServing(c DietRecommendationCandidate) bool {
	if c.PriceType == "by_weight" || c.PriceType == "range" || c.PriceType == "market" {
		return false
	}
	// Absence of a unit is not evidence of a portion price. Catalog nutrition
	// (often estimated per reference serving) must not supply the missing unit.
	unit := strings.TrimSpace(c.PriceUnit)
	return c.Price > 0 && regexp.MustCompile(`^(?:元\s*/\s*|每)?(?:份|碗|盘|套|套餐|餐)(?:元)?$`).MatchString(unit)
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
	staple := regexp.MustCompile(`米饭|拌饭|盖饭|盖浇饭|鸡饭|牛肉饭|滑蛋饭|炒饭|煲仔饭|石锅饭|鳗鱼饭|面条|面包|意面|荞麦面|牛肉面|臊子面|打卤面|阳春面|清汤面|拉面|拌面|炒面|生煎|烧麦|烧卖|汉堡|鸡肉卷|肉夹馍|煎饼|馅饼|米粉|米线|土豆粉|馒头|包子|饺|馄饨|杂粮|红薯|玉米|燕麦|粥|饭`).MatchString(text)
	protein := regexp.MustCompile(`肉|鸡|牛|猪|鱼|虾|蛋|豆腐|豆皮|豆干|奶|排骨|鸭|羊`).MatchString(text)
	// A cooked noodle bowl is a main dish even when its name does not contain
	// 肉/蛋/豆. Known nutrition and explicit user minimums are checked separately;
	// bare rice, dough, a pot base or hotpot dumplings do not get this exemption.
	staple = staple || strings.Contains(c.Title, "肉饼") || strings.Contains(c.Title, "鸡蛋堡") || strings.Contains(c.Title, "香菇油菜包")
	return staple && (protein || mealPreparedMainPattern.MatchString(c.Title) || strings.Contains(c.Title, "香菇油菜包"))
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

func registerMealPlan(state *campusDietAgentRunState, components []DietRecommendationCandidate) (DietRecommendationCandidate, error) {
	if len(components) < 2 || len(components) > 4 {
		return DietRecommendationCandidate{}, fmt.Errorf("一餐需要2至4个真实条目")
	}
	ids, titles := []string{}, []string{}
	combined := components[0]
	combined.Calories, combined.Protein, combined.Carbs, combined.Fat, combined.Price = 0, 0, 0, 0, 0
	combined.Items = nil
	vectors := []nutritionagg.Vector{}
	componentState := *state
	componentState.Constraints.MinProtein = nil    // the user's minimum applies to the whole meal, not each side
	componentState.Constraints.RequiredStaple = "" // staple requirement applies to the composed meal, not each side
	fullMeals := 0
	for _, c := range components {
		if risk := mealOrderingRisk(c); risk != "" {
			return DietRecommendationCandidate{}, fmt.Errorf("%s：%s。请检索能直接点单的主餐或有完整必选费用证据的套餐，不要只加配菜标价", c.Title, risk)
		}
		if mealHasStructure(c) {
			fullMeals++
			if fullMeals > 1 {
				return DietRecommendationCandidate{}, fmt.Errorf("不要把两份完整主餐叠加为一餐；请选择一份主餐搭配配菜")
			}
		}
		if c.Source == "meal_plan" || !mealKnownServing(c) {
			return DietRecommendationCandidate{}, fmt.Errorf("组合只接受份价已知的原始条目，不能将按两单价当作整份")
		}
		if !mealSamePlace(components[0], c) {
			return DietRecommendationCandidate{}, fmt.Errorf("组合须在同一食堂且有同层依据，或同一具明确地址的商家购买；不跨食堂或楼层拼餐")
		}
		if len(mealHarnessRank(&componentState, []DietRecommendationCandidate{c})) == 0 {
			return DietRecommendationCandidate{}, fmt.Errorf("组合中的菜品不符合本餐条件")
		}
		for _, id := range ids {
			if id == c.SourceID {
				return DietRecommendationCandidate{}, fmt.Errorf("不要重复叠加同一条目")
			}
		}
		ids, titles = append(ids, c.SourceID), append(titles, c.Title)
		combined.Calories += c.Calories
		combined.Protein += c.Protein
		combined.Carbs += c.Carbs
		combined.Fat += c.Fat
		combined.Price += c.Price
		vectors = append(vectors, c.Nutrients)
		combined.Items = append(combined.Items, DietRecommendationFoodItem{Name: c.Title, Amount: "1个库内记录份量", Source: c.Source, SourceID: c.SourceID})
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
	if len(mealHarnessRank(state, []DietRecommendationCandidate{combined})) == 0 {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计不满足本餐营养或其它硬约束")
	}
	if state.MealPlans == nil {
		state.MealPlans = map[string][]DietRecommendationCandidate{}
	}
	if state.Candidates == nil {
		state.Candidates = map[string]DietRecommendationCandidate{}
	}
	state.MealPlans[combined.SourceID] = components
	state.Candidates[combined.SourceID] = combined
	return combined, nil
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

// Build bounded, purchasable combinations before ranking whole meals. Ranking
// sides as if each were lunch otherwise rewards a low-calorie mushroom dish.
// Only real portion-priced rows participate; no invented rice, price or menu.
func mealBuildCombinations(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	componentState := *state
	componentState.Constraints.MinProtein = nil
	componentState.Constraints.RequiredStaple = ""
	groups := map[string][]DietRecommendationCandidate{}
	for _, c := range mealHarnessRank(&componentState, candidates) {
		if c.Source == "food_record" || c.Source == "meal_plan" || !mealKnownServing(c) || mealOrderingRisk(c) != "" || mealHasEvidenceStructure(c) {
			continue
		}
		venue := domain.DiningVenueKey(defaultIfEmpty(c.CanteenName, c.MerchantName))
		if venue == "" {
			continue
		}
		area := defaultIfEmpty(c.SchoolID, defaultIfEmpty(c.SchoolName, c.Address))
		floor := mealFloorKey(c.Floor)
		if floor == "" {
			floor = defaultIfEmpty(c.WindowID, c.WindowName)
		}
		key := strings.Join([]string{area, c.CampusID, venue, floor}, "|")
		groups[key] = append(groups[key], c)
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := []DietRecommendationCandidate{}
	staplePattern := regexp.MustCompile(`^(?:白|杂粮|糙米|黑米|紫米|小份|大份)?(?:米饭|饭)|^(?:蒸|煮)?(?:红薯|玉米|馒头)|燕麦粥`)
	proteinPattern := regexp.MustCompile(`肉|鸡|牛|猪|鱼|虾|蛋|豆腐|豆干|奶|排骨|鸭|羊`)
	vegetablePattern := regexp.MustCompile(`青菜|油菜|白菜|包菜|西兰花|芥兰|菠菜|生菜|黄瓜|番茄|西红柿|菌|菇|木耳|豆芽|茄子|冬瓜|海带`)
	for _, key := range keys {
		var staples, proteins, vegetables []DietRecommendationCandidate
		seen := map[string]bool{}
		for _, c := range groups[key] {
			if seen[c.Title] {
				continue
			}
			seen[c.Title] = true
			switch {
			case staplePattern.MatchString(c.Title) && len(staples) < 2:
				staples = append(staples, c)
			case proteinPattern.MatchString(strings.ReplaceAll(c.Title, "鱼香", "")) && len(proteins) < 6:
				proteins = append(proteins, c)
			case vegetablePattern.MatchString(c.Title) && len(vegetables) < 4:
				vegetables = append(vegetables, c)
			}
		}
		scratch := *state
		scratch.Candidates, scratch.MealPlans = nil, nil
		plans := []DietRecommendationCandidate{}
		for _, staple := range staples {
			for _, protein := range proteins {
				parts := []DietRecommendationCandidate{staple, protein}
				if plan, err := registerMealPlan(&scratch, parts); err == nil {
					plans = append(plans, plan)
				}
				for _, vegetable := range vegetables {
					if plan, err := registerMealPlan(&scratch, append(slices.Clone(parts), vegetable)); err == nil {
						plans = append(plans, plan)
					}
				}
			}
		}
		plans = mealHarnessRank(state, plans)
		if len(plans) > 6 {
			plans = plans[:6]
		}
		if state.MealPlans == nil {
			state.MealPlans = map[string][]DietRecommendationCandidate{}
		}
		for _, plan := range plans {
			state.MealPlans[plan.SourceID] = scratch.MealPlans[plan.SourceID]
		}
		result = append(result, plans...)
	}
	return result
}
