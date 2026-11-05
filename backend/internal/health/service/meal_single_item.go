package service

import (
	"regexp"
)

// A meal recommendation means a whole meal unless the user asks for one item: a single dish
// ("单点一个菜"), a side ("来个小菜"), a drink ("想喝点什么") or a snack ("来点零食"). Then
// one item is recommended, sized as a small share of the day, and nothing has to be a meal.

const (
	mealItemDish  = "dish"
	mealItemSide  = "side"
	mealItemDrink = "drink"
	mealItemSnack = "snack"
)

var (
	mealItemKindPatterns = []struct {
		kind    string
		pattern *regexp.Regexp
	}{
		{mealItemDrink, regexp.MustCompile(`喝(?:点|些)?什么|想喝|喝的|来(?:一)?杯|(?:饮料|饮品|奶茶|咖啡|果汁|豆浆|酸奶|茶饮)`)},
		{mealItemSnack, regexp.MustCompile(`零食|小吃|加餐|甜点|甜品|点心|水果|下午茶|垫(?:一下|点|吧)`)},
		{mealItemSide, regexp.MustCompile(`配菜|小菜|凉菜|加(?:个|一个|一份|道)?菜|再来(?:个|一个|一份|道)菜`)},
		{mealItemDish, regexp.MustCompile(`单盘|单点|单品|一个菜|一道菜|一份菜|炒个菜|只要(?:一个|一份|一道)`)},
	}
	mealItemKindRefused = regexp.MustCompile(`(?:不要|不用|不想|别|不需要|不喝|不吃)(?:再)?(?:点|来|喝|吃|加)?(?:个|杯|份|点)?(?:饮料|饮品|奶茶|咖啡|果汁|零食|小吃|甜点|配菜|小菜|凉菜|菜)`)
	// 喝粥 / 喝汤 is eating, not a drink.
	mealDrinkingFood = regexp.MustCompile(`喝(?:点|碗|口|个|些)?(?:粥|汤|羹|稀饭)`)
	// Asking for a whole meal again ends a single-item request.
	mealWholeMealWords = regexp.MustCompile(`一餐|一顿|吃饱|正餐|早餐|午餐|晚餐|早饭|午饭|晚饭|套餐|主食`)

	mealDrinkNamePattern = regexp.MustCompile(`奶茶|可乐|雪碧|汽水|果汁|饮料|咖啡|拿铁|美式|茶饮|柠檬茶|气泡|奶昔|冰沙|豆浆|豆奶|牛奶|纯奶|酸奶|鲜奶|燕麦奶|椰汁|椰奶|乌龙|绿茶|红茶|花茶|养乐多|酸梅汤|凉茶`)
)

// mealRequestedItemKind reads a single-item request. ok is true when the message decides it:
// an item kind, or "" when it asks for a whole meal again.
func mealRequestedItemKind(question string) (kind string, ok bool) {
	if mealItemKindRefused.MatchString(question) {
		return "", false
	}
	for _, k := range mealItemKindPatterns {
		if k.kind == mealItemDrink && mealDrinkingFood.MatchString(question) {
			continue
		}
		if k.pattern.MatchString(question) {
			// "午饭配个饮料" asks for a meal; the drink is part of it.
			if mealWholeMealWords.MatchString(question) && k.kind != mealItemDish {
				return "", true
			}
			return k.kind, true
		}
	}
	if mealWholeMealWords.MatchString(question) {
		return "", true
	}
	return "", false
}

// mealItemKindRatio is the share of the day's targets one item is sized against.
func mealItemKindRatio(kind string) float64 {
	switch kind {
	case mealItemDrink:
		return 0.08
	case mealItemSide, mealItemSnack:
		return 0.10
	case mealItemDish:
		return 0.15
	}
	return 0
}

// dietDecisionPortionRatio is the share of the day this recommendation is sized against: one
// item when the user asked for one, otherwise the meal's share.
func dietDecisionPortionRatio(ctx dietDecisionContext) float64 {
	if ratio := mealItemKindRatio(ctx.Constraints.ItemKind); ratio > 0 {
		return ratio
	}
	return dietDecisionMealRatio(ctx.MealType)
}

// mealItemKindMatches says whether a dish is the kind of item the user asked for. A whole meal
// (rice bowl, set meal) is never a side, a drink or a snack; an assembled meal is never one item.
func mealItemKindMatches(kind string, c DietRecommendationCandidate) bool {
	if kind == "" {
		return true
	}
	if c.Source == "meal_plan" {
		return false
	}
	drink := mealDrinkNamePattern.MatchString(c.Title)
	whole := mealHasStructure(c)
	role := mealComboRoleOf(c)
	switch kind {
	case mealItemDrink:
		return drink
	case mealItemSnack:
		return !whole && role != mealRoleStaple && c.Calories <= 450
	case mealItemSide:
		return !whole && !drink && (role == mealRoleVegetable || role == mealRoleSoup || role == mealRoleProtein && c.Calories <= 350)
	case mealItemDish:
		return !whole && !drink && (role == mealRoleProtein || role == mealRoleVegetable || role == mealRoleSoup)
	}
	return true
}
