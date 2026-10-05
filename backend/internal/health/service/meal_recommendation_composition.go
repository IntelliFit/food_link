package service

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// Composition is a data-backed serving calculation, not a medical satiety claim.
// Never invent a rice price or silently interpret a per-weight price as a meal.
func mealKnownServing(c DietRecommendationCandidate) bool {
	return c.Price > 0 && !regexp.MustCompile(`两|克|千克|公斤|斤|kg|/g|每|只|个|串|枚|片|粒`).MatchString(c.PriceUnit)
}

func mealHasStructure(c DietRecommendationCandidate) bool {
	return mealHasNamedStructure(c) && c.Carbs >= 15 && c.Protein >= 10
}

func mealHasNamedStructure(c DietRecommendationCandidate) bool {
	text := c.Title + " " + c.Description
	for _, item := range c.Items {
		text += " " + item.Name
	}
	staple := regexp.MustCompile(`米饭|拌饭|盖饭|盖浇饭|鸡饭|牛肉饭|滑蛋饭|炒饭|煲仔饭|石锅饭|鳗鱼饭|面条|面包|意面|荞麦面|牛肉面|臊子面|打卤面|阳春面|清汤面|拉面|拌面|炒面|生煎|烧麦|烧卖|汉堡|鸡肉卷|肉夹馍|煎饼|馅饼|米粉|米线|土豆粉|馒头|包子|饺|馄饨|杂粮|红薯|玉米|燕麦|粥|饭`).MatchString(text)
	protein := regexp.MustCompile(`肉|鸡|牛|猪|鱼|虾|蛋|豆腐|豆皮|豆干|奶|排骨|鸭|羊`).MatchString(text)
	// A cooked noodle bowl is a main dish even when its name does not contain
	// 肉/蛋/豆. Known nutrition and explicit user minimums are checked separately;
	// bare rice, dough, a pot base or hotpot dumplings do not get this exemption.
	return staple && (protein || mealPreparedMainPattern.MatchString(c.Title))
}

func mealSamePlace(a, b DietRecommendationCandidate) bool {
	if a.IsCampusFood != b.IsCampusFood {
		return false
	}
	if a.IsCampusFood {
		if a.WindowID != "" && b.WindowID != "" && a.WindowID != b.WindowID || a.WindowName != "" && b.WindowName != "" && a.WindowName != b.WindowName || a.Floor != "" && b.Floor != "" && a.Floor != b.Floor {
			return false
		}
	}
	if a.CanteenID != "" && b.CanteenID != "" {
		return a.CanteenID == b.CanteenID
	}
	if a.IsCampusFood {
		return a.SchoolID != "" && a.SchoolID == b.SchoolID && a.CanteenName != "" && a.CanteenName == b.CanteenName
	}
	return a.MerchantName != "" && a.MerchantName == b.MerchantName && a.Address != "" && a.Address == b.Address
}

func registerMealPlan(state *campusDietAgentRunState, components []DietRecommendationCandidate) (DietRecommendationCandidate, error) {
	if len(components) < 2 || len(components) > 4 {
		return DietRecommendationCandidate{}, fmt.Errorf("一餐需要2至4个真实条目")
	}
	ids, titles := []string{}, []string{}
	combined := components[0]
	combined.Calories, combined.Protein, combined.Carbs, combined.Fat, combined.Price = 0, 0, 0, 0, 0
	combined.Items = nil
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
			return DietRecommendationCandidate{}, fmt.Errorf("组合须在同一食堂窗口或同一具明确地址的商家购买，不跨窗口或楼层拼总价")
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
		combined.Items = append(combined.Items, DietRecommendationFoodItem{Name: c.Title, Amount: "1个库内记录份量", Source: c.Source, SourceID: c.SourceID})
	}
	for _, total := range []*float64{&combined.Calories, &combined.Protein, &combined.Carbs, &combined.Fat, &combined.Price} {
		*total = math.Round(*total*100) / 100
	}
	if state.Constraints.MaxPrice != nil && combined.Price > *state.Constraints.MaxPrice {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计%s元，超过预算", formatCampusDietNumber(combined.Price))
	}
	if state.Constraints.MaxCalories != nil && combined.Calories > *state.Constraints.MaxCalories {
		return DietRecommendationCandidate{}, fmt.Errorf("整餐合计%s kcal，超过本餐上限", formatCampusDietNumber(combined.Calories))
	}
	combined.Title = strings.Join(titles, " + ")
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
