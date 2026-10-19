package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A canteen dish the way the catalog stores it: one priced serving at a window.
func comboDish(id, title string, kcal, protein, carbs, fat, price float64, window string) DietRecommendationCandidate {
	c := campusDietAgentTestCandidate(id, title, kcal, protein)
	c.Carbs, c.Fat, c.Price = carbs, fat, price
	c.PriceUnit = "元/份"
	c.CanteenID, c.CanteenName = "canteen-zijing", "紫荆园"
	c.WindowID, c.WindowName, c.Floor = "win-"+window, window, "1F"
	return c
}

func comboInCanteen(c DietRecommendationCandidate, id, name string) DietRecommendationCandidate {
	c.CanteenID, c.CanteenName = id, name
	c.SourceID = name + ":" + c.SourceID
	c.Items = []DietRecommendationFoodItem{{Name: c.Title, Amount: "1份", Source: c.Source, SourceID: c.SourceID}}
	return c
}

func comboZijingPool() []DietRecommendationCandidate {
	return []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"),
		comboDish("mantou", "馒头", 220, 7, 45, 1, 1.5, "主食窗口"),
		comboDish("pork", "红烧肉", 320, 14, 6, 26, 9, "家常菜"),
		comboDish("chicken", "宫保鸡丁", 240, 22, 10, 12, 8, "家常菜"),
		comboDish("egg", "番茄炒蛋", 180, 11, 8, 12, 6, "家常菜"),
		comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"),
		comboDish("tofu", "麻婆豆腐", 190, 12, 8, 13, 6, "家常菜"),
		comboDish("beef", "黑椒牛柳", 260, 24, 8, 15, 11, "家常菜"),
		comboDish("greens", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"),
		comboDish("broccoli", "蒜蓉西兰花", 80, 5, 8, 4, 4, "素菜"),
		comboDish("cabbage", "手撕包菜", 90, 3, 9, 5, 3, "素菜"),
		comboDish("soup", "紫菜蛋花汤", 50, 4, 3, 2, 2, "汤"),
		comboDish("noodle", "牛肉面", 520, 28, 70, 14, 12, "面食"),
	}
}

func newComboTestState() *campusDietAgentRunState {
	state := newCampusDietAgentTestState("initial", nil)
	state.EngineVersion = dietDecisionEngineVersion
	state.MealContextLoaded = true
	state.Constraints = CampusDietRecommendationConstraints{Scene: "campus", CompleteMeal: true, MealType: "lunch"}
	targets := DietRecommendationMacro{Calories: 2000, Protein: 100, Carbs: 250, Fat: 65}
	state.MealContext = campusDietAgentMealContext{EngineVersion: dietDecisionEngineVersion, MealType: "lunch", Date: time.Now().In(chinaTZ).Format("2006-01-02"), Targets: targets, Remaining: targets, CalorieTarget: targets.Calories}
	return state
}

func comboTitles(report mealComboReport) []string {
	out := []string{}
	for _, combo := range report.Combos {
		out = append(out, combo.Plan.Title)
	}
	return out
}

func comboHasRole(combo mealCombo, role mealComboRole) bool {
	for _, c := range combo.Components {
		if mealComboRoleOf(c) == role {
			return true
		}
	}
	return false
}

func comboDishIDs(combo mealCombo) map[string]bool {
	ids := map[string]bool{}
	for _, c := range combo.Components {
		if role := mealComboRoleOf(c); role != mealRoleStaple {
			ids[c.SourceID] = true
		}
	}
	return ids
}

func comboShown(state *campusDietAgentRunState, daysAgo int, dishes ...DietRecommendationCandidate) {
	shown := time.Now().AddDate(0, 0, -daysAgo)
	for _, d := range dishes {
		state.PreviewMemory = append(state.PreviewMemory, domain.MealRecommendationMemory{
			UserID: state.UserID, ContextKey: "earlier-conversation", SourceID: d.SourceID, OptionKey: mealDecisionHash(d.Source, d.SourceID),
			Fingerprint: mealDecisionHash(mealFingerprint(d)), MealDate: shown.In(chinaTZ).Format("2006-01-02"),
			MealType: "lunch", ShownAt: &shown,
		})
	}
}

func TestMealComboRoleOf(t *testing.T) {
	cases := []struct {
		title                   string
		kcal, protein, carbs, f float64
		want                    mealComboRole
	}{
		{"米饭", 230, 4.5, 50, 0.5, mealRoleStaple},
		{"馒头", 220, 7, 45, 1, mealRoleStaple},
		{"红烧肉", 320, 14, 6, 26, mealRoleProtein},
		{"番茄炒蛋", 180, 11, 8, 12, mealRoleProtein},
		{"麻婆豆腐", 190, 12, 8, 13, mealRoleProtein},
		{"青椒肉丝", 210, 15, 9, 14, mealRoleProtein},
		{"清炒时蔬", 60, 3, 6, 3, mealRoleVegetable},
		{"蒜蓉西兰花", 80, 5, 8, 4, mealRoleVegetable},
		{"手撕包菜", 90, 3, 9, 5, mealRoleVegetable},
		{"紫菜蛋花汤", 50, 4, 3, 2, mealRoleSoup},
		{"玉米排骨汤", 120, 9, 8, 6, mealRoleSoup},
		{"牛肉面", 520, 28, 70, 14, mealRoleFull},
		{"黄焖鸡米饭", 650, 32, 85, 20, mealRoleFull},
		{"豆浆", 80, 7, 4, 4, mealRoleDrink},
		{"纯牛奶", 130, 6.5, 9, 7, mealRoleDrink},
		{"可乐", 140, 0, 35, 0, mealRoleOther},
		{"奶茶", 280, 2, 45, 9, mealRoleOther},
	}
	for _, tc := range cases {
		c := comboDish("x", tc.title, tc.kcal, tc.protein, tc.carbs, tc.f, 5, "窗口")
		assert.Equal(t, tc.want, mealComboRoleOf(c), tc.title)
	}
}

func TestSearchMealCombosBuildsMealsFromOneCanteenMenu(t *testing.T) {
	state := newComboTestState()
	report := searchMealCombos(state, comboZijingPool(), 3)
	require.Len(t, report.Combos, 3, "titles=%v reason=%s", comboTitles(report), report.Reason)
	for _, combo := range report.Combos {
		require.GreaterOrEqual(t, len(combo.Components), 2)
		assert.LessOrEqual(t, len(combo.Components), 4)
		assert.True(t, strings.HasPrefix(combo.Plan.SourceID, "meal:"))
		assert.Equal(t, "meal_plan", combo.Plan.Source)
		assert.True(t, mealHasStructure(combo.Plan), combo.Plan.Title)
		price := 0.0
		for _, c := range combo.Components {
			price += c.Price
			assert.Equal(t, "canteen-zijing", c.CanteenID)
		}
		assert.InDelta(t, price, combo.Plan.Price, 0.001)
		assert.Len(t, combo.Plan.Items, len(combo.Components))
		assert.Positive(t, combo.HealthFit)
		assert.True(t, comboHasRole(combo, mealRoleVegetable), "lunch combos carry a vegetable: %s", combo.Plan.Title)
	}
}

func TestSearchMealCombosNeverMixCanteens(t *testing.T) {
	pool := comboZijingPool()
	pool = append(pool,
		comboInCanteen(comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 1, "主食"), "canteen-taoli", "桃李园"),
		comboInCanteen(comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 6, "家常菜"), "canteen-taoli", "桃李园"),
		comboInCanteen(comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 2, "素菜"), "canteen-taoli", "桃李园"),
	)
	report := searchMealCombos(newComboTestState(), pool, 12)
	require.NotEmpty(t, report.Combos)
	seen := map[string]bool{}
	for _, combo := range report.Combos {
		canteens := map[string]bool{}
		for _, c := range combo.Components {
			canteens[c.CanteenID] = true
		}
		assert.Len(t, canteens, 1, combo.Plan.Title)
		for id := range canteens {
			seen[id] = true
		}
	}
	assert.True(t, seen["canteen-zijing"] && seen["canteen-taoli"], "both canteens should be represented: %v", seen)
	assert.Equal(t, 2, report.Places)
}

func TestSearchMealCombosSpanWindowsOfTheSameCanteenAndSayWhereToBuy(t *testing.T) {
	report := searchMealCombos(newComboTestState(), comboZijingPool(), 3)
	require.NotEmpty(t, report.Combos)
	crossed := false
	for _, combo := range report.Combos {
		windows := map[string]bool{}
		for _, c := range combo.Components {
			windows[c.WindowName] = true
		}
		if len(windows) > 1 {
			crossed = true
			assert.True(t, combo.CrossWindow)
			assert.Empty(t, combo.Plan.WindowID, "a combo spanning windows has no single window")
			for name := range windows {
				assert.Contains(t, combo.Plan.WindowName, name, "the card must say where each part is bought")
			}
			assert.Greater(t, len(combo.Windows), 1)
		}
	}
	assert.True(t, crossed, "rice, dishes and vegetables are sold at different windows: %v", comboTitles(report))
}

func TestSearchMealCombosHonourBudgetCaloriesAndAvoidedFoods(t *testing.T) {
	state := newComboTestState()
	budget, calories := 14.0, 560.0
	state.Constraints.MaxPrice, state.Constraints.MaxCalories = &budget, &calories
	state.Constraints.AvoidFoods = []string{"鱼"}
	report := searchMealCombos(state, comboZijingPool(), 6)
	require.NotEmpty(t, report.Combos)
	for _, combo := range report.Combos {
		assert.LessOrEqual(t, combo.Plan.Price, budget, combo.Plan.Title)
		assert.LessOrEqual(t, combo.Plan.Calories, calories, combo.Plan.Title)
		assert.NotContains(t, combo.Plan.Title, "鱼")
	}
}

func TestSearchMealCombosOnlyUsePricedServings(t *testing.T) {
	pool := comboZijingPool()
	byWeight := comboDish("duck", "烤鸭", 250, 26, 4, 15, 9, "家常菜")
	byWeight.PriceUnit = "元/两"
	unpriced := comboDish("ribs", "糖醋排骨", 300, 20, 18, 16, 0, "家常菜")
	pool = append(pool, byWeight, unpriced)
	report := searchMealCombos(newComboTestState(), pool, 12)
	require.NotEmpty(t, report.Combos)
	for _, combo := range report.Combos {
		for _, c := range combo.Components {
			assert.NotContains(t, []string{"duck", "ribs"}, c.SourceID)
		}
	}
}

func TestSearchMealCombosDoNotRepeatTheSameDishAcrossOptions(t *testing.T) {
	report := searchMealCombos(newComboTestState(), comboRotationPool(), 3)
	require.Len(t, report.Combos, 3)
	used := map[string]bool{}
	for _, combo := range report.Combos {
		for id := range comboDishIDs(combo) {
			assert.False(t, used[id], "dish %s appears in two options: %v", id, comboTitles(report))
			used[id] = true
		}
	}
}

func TestSearchMealCombosIsDeterministic(t *testing.T) {
	a := comboTitles(searchMealCombos(newComboTestState(), comboZijingPool(), 4))
	b := comboTitles(searchMealCombos(newComboTestState(), comboZijingPool(), 4))
	assert.Equal(t, a, b)
}

// Near-identical nutrition, so only exposure may decide which dishes are offered.
func comboRotationPool() []DietRecommendationCandidate {
	protein := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 250, 25, 8, 12, 10, "家常菜")
	}
	veg := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 70, 3, 7, 3, 3, "素菜")
	}
	return []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"),
		protein("p1", "宫保鸡丁"), protein("p2", "黑椒牛柳"), protein("p3", "清蒸鱼"), protein("p4", "香煎鸡排"), protein("p5", "红烧排骨"),
		veg("v1", "清炒时蔬"), veg("v2", "蒜蓉西兰花"), veg("v3", "手撕包菜"), veg("v4", "炒油麦菜"), veg("v5", "凉拌黄瓜"),
	}
}

func TestSearchMealCombosRotateDishesRecommendedRecently(t *testing.T) {
	pool := comboRotationPool()
	byID := map[string]DietRecommendationCandidate{}
	for _, c := range pool {
		byID[c.SourceID] = c
	}
	first := searchMealCombos(newComboTestState(), pool, 3)
	require.Len(t, first.Combos, 3)
	assert.Zero(t, first.Combos[0].ShownDays)

	state := newComboTestState()
	var shown []DietRecommendationCandidate
	for id := range comboDishIDs(first.Combos[0]) {
		shown = append(shown, byID[id])
	}
	comboShown(state, 1, shown...)
	second := searchMealCombos(state, pool, 3)
	require.Len(t, second.Combos, 3)
	for _, combo := range second.Combos {
		for id := range comboDishIDs(combo) {
			assert.False(t, comboDishIDs(first.Combos[0])[id], "dish %s was offered yesterday although equally good alternatives exist: %v", id, comboTitles(second))
		}
	}
}

func TestSearchMealCombosExposureNeverBeatsAClearNutritionGap(t *testing.T) {
	pool := []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"),
		comboDish("good", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"),
		comboDish("greasy", "红烧五花肉", 450, 12, 5, 38, 9, "家常菜"),
		comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"),
	}
	fit := func(report mealComboReport, title string) float64 {
		for _, combo := range report.Combos {
			if combo.Plan.Title == title {
				return combo.HealthFit
			}
		}
		t.Fatalf("combo %q not offered: %v", title, comboTitles(report))
		return 0
	}
	baseline := searchMealCombos(newComboTestState(), pool, 10)
	gap := fit(baseline, "米饭 + 清蒸鱼 + 清炒时蔬") - fit(baseline, "米饭 + 红烧五花肉 + 清炒时蔬")
	require.Greater(t, gap, mealHealthShortlistTolerance, "precondition: the greasy meal is clearly worse")
	require.Less(t, gap, mealComboExposureCap, "precondition: exposure alone could otherwise outweigh the gap")

	state := newComboTestState()
	for day := 0; day < 3; day++ {
		comboShown(state, day, pool[1], pool[3])
	}
	report := searchMealCombos(state, pool, 1)
	require.Len(t, report.Combos, 1)
	assert.Contains(t, report.Combos[0].Plan.Title, "清蒸鱼", "a clearly better meal is not demoted below the health band for variety")
}

func TestSelectMealCombosOnlyVariesInsideTheHealthBand(t *testing.T) {
	row := func(id string, fit, score float64) mealComboRow {
		plan := DietRecommendationCandidate{SourceID: id}
		return mealComboRow{combo: mealCombo{Plan: plan, HealthFit: fit, Score: score}, place: "canteen:a", dishes: map[string]bool{id: true}}
	}
	rows := []mealComboRow{row("better", 100, 70), row("fresh", 90, 95), row("nearly", 97, 80)}
	chosen := selectMealCombos(rows, 3)
	require.Len(t, chosen, 3)
	assert.Equal(t, "nearly", chosen[0].combo.Plan.SourceID, "inside the band the higher variety score wins")
	assert.Equal(t, "better", chosen[1].combo.Plan.SourceID)
	assert.Equal(t, "fresh", chosen[2].combo.Plan.SourceID, "a meal outside the band only comes after the healthier ones")
}

func TestSearchMealCombosPreferAVegetableWhenNutritionIsEqual(t *testing.T) {
	same := func(id, title string) DietRecommendationCandidate {
		return comboDish(id, title, 250, 25, 8, 12, 10, "家常菜")
	}
	pool := []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"),
		same("p1", "宫保鸡丁"), same("p2", "黑椒牛柳"), same("veg", "清炒时蔬"),
	}
	report := searchMealCombos(newComboTestState(), pool, 1)
	require.Len(t, report.Combos, 1)
	assert.True(t, comboHasRole(report.Combos[0], mealRoleVegetable), report.Combos[0].Plan.Title)
}

func TestSearchMealCombosBreakfastNeedsNoVegetableAndMayAddASoyOrMilkDrink(t *testing.T) {
	breakfast := func(c DietRecommendationCandidate) DietRecommendationCandidate {
		c.MealPeriods = []string{"breakfast"}
		return c
	}
	pool := []DietRecommendationCandidate{
		breakfast(comboDish("mantou", "馒头", 110, 3.5, 23, 0.5, 1, "早点")),
		breakfast(comboDish("congee", "白粥", 90, 2.5, 19, 0.4, 1.5, "早点")),
		breakfast(comboDish("egg", "茶叶蛋", 75, 6.5, 0.5, 5, 2, "早点")),
		breakfast(comboDish("soy", "豆浆", 80, 7, 4, 4, 2.5, "早点")),
	}
	state := newComboTestState()
	state.Constraints.MealType = "breakfast"
	state.MealContext.MealType = "breakfast"
	report := searchMealCombos(state, pool, 3)
	require.NotEmpty(t, report.Combos, report.Reason)
	drink := false
	for _, combo := range report.Combos {
		assert.False(t, comboHasRole(combo, mealRoleVegetable))
		drink = drink || comboHasRole(combo, mealRoleDrink)
	}
	assert.True(t, drink, "a soy or milk drink can complete a breakfast: %v", comboTitles(report))
}

func TestSearchMealCombosPairAWholeMealWithASideButNeverTwoWholeMeals(t *testing.T) {
	pool := []DietRecommendationCandidate{
		comboDish("noodle", "牛肉面", 520, 28, 70, 14, 12, "面食"),
		comboDish("rice-meal", "黄焖鸡米饭", 650, 32, 85, 20, 14, "盖饭"),
		comboDish("greens", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"),
	}
	report := searchMealCombos(newComboTestState(), pool, 6)
	require.NotEmpty(t, report.Combos)
	for _, combo := range report.Combos {
		full := 0
		for _, c := range combo.Components {
			if mealComboRoleOf(c) == mealRoleFull {
				full++
			}
		}
		assert.Equal(t, 1, full, combo.Plan.Title)
		assert.GreaterOrEqual(t, len(combo.Components), 2)
	}
}

func TestSearchMealCombosExplainWhyNothingCouldBeComposed(t *testing.T) {
	onlyDishes := []DietRecommendationCandidate{
		comboDish("chicken", "宫保鸡丁", 240, 22, 10, 12, 8, "家常菜"),
		comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"),
	}
	report := searchMealCombos(newComboTestState(), onlyDishes, 3)
	assert.Empty(t, report.Combos)
	assert.Contains(t, report.Reason, "主食")

	unpriced := comboZijingPool()
	for i := range unpriced {
		unpriced[i].Price = 0
	}
	report = searchMealCombos(newComboTestState(), unpriced, 3)
	assert.Empty(t, report.Combos)
	assert.Contains(t, report.Reason, "价格")
}

func TestBuildMealPlanAllowsOneCanteenAcrossWindowsButNotAcrossCanteens(t *testing.T) {
	state := newComboTestState()
	rice := comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口")
	fish := comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜")
	plan, err := buildMealPlan(state, []DietRecommendationCandidate{rice, fish})
	require.NoError(t, err)
	assert.Empty(t, plan.WindowID)
	assert.Contains(t, plan.WindowName, "主食窗口")
	assert.Contains(t, plan.WindowName, "家常菜")
	assert.Empty(t, state.MealPlans, "building a plan must not register it")

	other := fish
	other.CanteenID, other.CanteenName = "canteen-taoli", "桃李园"
	_, err = buildMealPlan(state, []DietRecommendationCandidate{rice, other})
	require.ErrorContains(t, err, "同一食堂")
}

func TestBuildMealPlanKeepsTheWindowWhenEveryPartComesFromIt(t *testing.T) {
	state := newComboTestState()
	rice := comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "自选窗口")
	fish := comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "自选窗口")
	plan, err := buildMealPlan(state, []DietRecommendationCandidate{rice, fish})
	require.NoError(t, err)
	assert.Equal(t, "自选窗口", plan.WindowName)
	assert.Empty(t, plan.PortionDescription, "the first part's portion text must not describe the whole meal")
}

func comboCards(t *testing.T, output map[string]any) []map[string]any {
	t.Helper()
	cards, ok := output["candidates"].([]map[string]any)
	require.True(t, ok, "%T", output["candidates"])
	return cards
}

func TestSearchToolAddsAssembledMealsTheModelCanSelect(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{candidates: comboZijingPool()}, nil)
	state := newComboTestState()
	output, err := svc.executeCampusDietSearchTool(context.Background(), state, `{}`, "search_campus_foods")
	require.NoError(t, err)
	var plan map[string]any
	for _, card := range comboCards(t, output) {
		if card["source"] == "meal_plan" {
			plan = card
			break
		}
	}
	require.NotNil(t, plan, "a whole-meal search offers assembled meals beside the single dishes")
	id, _ := plan["source_id"].(string)
	require.True(t, strings.HasPrefix(id, "meal:"))
	require.Contains(t, state.MealPlans, id)
	require.Contains(t, state.Candidates, id)

	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: []campusDietAgentFinalSelection{{SourceID: id, Reason: "主食、荤菜和蔬菜都有"}}}, true, "")
	require.NoError(t, err)
	require.NotEmpty(t, result.Recommendation.Recommendations)
	assert.GreaterOrEqual(t, len(result.Recommendation.Recommendations[0].MealComponents), 2)
}

func TestSearchToolStaysInTheCanteenTheUserIsIn(t *testing.T) {
	pool := comboZijingPool()
	pool = append(pool,
		comboInCanteen(comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食"), "canteen-taoli", "桃李园"),
		comboInCanteen(comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"), "canteen-taoli", "桃李园"),
		comboInCanteen(comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"), "canteen-taoli", "桃李园"),
	)
	svc := NewStatsService(&mockStatsRepo{candidates: pool}, nil)
	state := newComboTestState()
	state.Constraints.CanteenName = "桃李园"
	output, err := svc.executeCampusDietSearchTool(context.Background(), state, `{}`, "search_campus_foods")
	require.NoError(t, err)
	plans := 0
	for _, card := range comboCards(t, output) {
		assert.Equal(t, "桃李园", card["canteen"])
		if card["source"] == "meal_plan" {
			plans++
		}
	}
	assert.Positive(t, plans)
}

func TestSearchToolOffersNoAssembledMealWhenTheMenuCannotMakeOne(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{candidates: []DietRecommendationCandidate{comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜")}}, nil)
	state := newComboTestState()
	output, err := svc.executeCampusDietSearchTool(context.Background(), state, `{}`, "search_campus_foods")
	require.NoError(t, err)
	for _, card := range comboCards(t, output) {
		assert.NotEqual(t, "meal_plan", card["source"], "nothing is invented from one side dish")
	}
	assert.Empty(t, state.MealPlans)
}

func TestSearchMealCombosNeedAFloorOrOneWindowToBuyEverythingAt(t *testing.T) {
	noFloor := func(c DietRecommendationCandidate) DietRecommendationCandidate {
		c.Floor = ""
		return c
	}
	rice := noFloor(comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"))
	fish := noFloor(comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"))
	veg := noFloor(comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"))
	report := searchMealCombos(newComboTestState(), []DietRecommendationCandidate{rice, fish, veg}, 3)
	assert.Empty(t, report.Combos, "without floor evidence two windows are never combined: %v", comboTitles(report))

	rice.WindowName, rice.WindowID = "家常菜", "win-家常菜"
	veg.WindowName, veg.WindowID = "家常菜", "win-家常菜"
	report = searchMealCombos(newComboTestState(), []DietRecommendationCandidate{rice, fish, veg}, 3)
	assert.NotEmpty(t, report.Combos, "one verified window is enough")
}

func TestAssembledMealItemsSayWhatEachPartCostsAndWhereItIsSold(t *testing.T) {
	state := newComboTestState()
	rice := comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口")
	fish := comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12.5, "家常菜")
	plan, err := buildMealPlan(state, []DietRecommendationCandidate{rice, fish})
	require.NoError(t, err)
	require.Len(t, plan.Items, 2)
	assert.Equal(t, "米饭", plan.Items[0].Name)
	assert.Equal(t, "1份 · ¥2 · 主食窗口（1F）", plan.Items[0].Amount)
	assert.Equal(t, "1份 · ¥12.5 · 家常菜（1F）", plan.Items[1].Amount)
}
func comboOnFloor(c DietRecommendationCandidate, floor string) DietRecommendationCandidate {
	c.Floor = floor
	return c
}

func TestSearchMealCombosDoNotOfferAnAbsurdAmountOfFoodAsAMeal(t *testing.T) {
	pool := []DietRecommendationCandidate{
		comboDish("bun", "金银馒头", 220, 7, 45, 1, 8, "中餐厅"),
		comboDish("duck", "北京烤鸭", 2700, 136, 40, 180, 176, "中餐厅"),
		comboDish("pancake", "单加烤鸭配料", 730, 24, 80, 33, 20, "中餐厅"),
	}
	report := searchMealCombos(newComboTestState(), pool, 6)
	for _, combo := range report.Combos {
		assert.GreaterOrEqual(t, combo.HealthFit, mealComboMinHealthFit, combo.Plan.Title)
		assert.NotContains(t, combo.Plan.Title, "北京烤鸭")
	}
}

func TestSearchMealCombosDoNotSendTheUserUpAndDownStairs(t *testing.T) {
	staple := comboOnFloor(comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"), "B1")
	fish := comboOnFloor(comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜"), "2F")
	veg := comboOnFloor(comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 3, "素菜"), "2F")
	report := searchMealCombos(newComboTestState(), []DietRecommendationCandidate{staple, fish, veg}, 3)
	assert.Empty(t, report.Combos, "rice on B1 and dishes on 2F are not one convenient meal: %v", comboTitles(report))

	staple.Floor = "2F"
	report = searchMealCombos(newComboTestState(), []DietRecommendationCandidate{staple, fish, veg}, 3)
	require.NotEmpty(t, report.Combos)
	assert.True(t, report.Combos[0].CrossWindow, "different counters on the same floor are fine")
}

func TestSearchMealCombosDoNotBorrowASideFromAPizzaOrHotPotStall(t *testing.T) {
	rice := comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "涮羊肉")
	fish := comboDish("fish", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜")
	veg := comboDish("veg", "清炒时蔬", 60, 3, 6, 3, 3, "素菜")
	report := searchMealCombos(newComboTestState(), []DietRecommendationCandidate{rice, fish, veg}, 3)
	assert.Empty(t, report.Combos, "rice listed under a hot pot stall is not a side for another stall's dish: %v", comboTitles(report))

	rice.WindowName, rice.WindowID = "主食窗口", "win-主食窗口"
	report = searchMealCombos(newComboTestState(), []DietRecommendationCandidate{rice, fish, veg}, 3)
	assert.NotEmpty(t, report.Combos)
}

func TestSearchMealOptionsIncludeDishesThatAreAlreadyACompleteMeal(t *testing.T) {
	pool := comboZijingPool()
	assembledOnly := searchMealCombos(newComboTestState(), pool, 12)
	for _, combo := range assembledOnly.Combos {
		assert.False(t, combo.Single)
	}
	report := searchMealOptions(newComboTestState(), pool, 12, true)
	var single *mealCombo
	for i := range report.Combos {
		if report.Combos[i].Single {
			single = &report.Combos[i]
		}
	}
	require.NotNil(t, single, "the canteen's beef noodles are a complete meal on their own: %v", comboTitles(report))
	assert.Equal(t, "noodle", single.Plan.SourceID)
	require.Len(t, single.Components, 1)
	assert.False(t, single.CrossWindow)
}

func TestSearchMealCombosBreakAnEqualNutritionTieInFavourOfTheCheaperMeal(t *testing.T) {
	cheap := comboDish("cheap", "宫保鸡丁", 250, 25, 8, 12, 8, "家常菜")
	dear := comboDish("dear", "黑椒牛柳", 250, 25, 8, 12, 100, "家常菜")
	pool := []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"), dear, cheap,
		comboDish("veg", "清炒时蔬", 70, 3, 7, 3, 3, "素菜"),
	}
	report := searchMealCombos(newComboTestState(), pool, 1)
	require.Len(t, report.Combos, 1)
	assert.Contains(t, report.Combos[0].Plan.Title, "宫保鸡丁")
}

// Names, windows and macros as they appear in the published campus menus.
func TestMealComboRoleOfRealMenuNames(t *testing.T) {
	cases := []struct {
		title, window           string
		kcal, protein, carbs, f float64
		want                    mealComboRole
	}{
		{"西红柿鸡蛋面", "砂锅/麻辣香锅", 385, 13, 62, 8, mealRoleFull},
		{"香煎鸡块面", "砂锅/麻辣香锅", 646, 33, 70, 22, mealRoleFull},
		{"鸡汤抄手", "川渝小吃", 242, 13, 30, 6, mealRoleFull},
		{"骨汤番茄拉面", "豚骨拉面", 444, 20, 70, 10, mealRoleFull},
		{"辛拉面", "韩式风味", 574, 20, 80, 18, mealRoleFull},
		{"宜宾素燃面", "川味面食", 578, 17, 80, 22, mealRoleFull},
		{"重庆小面", "川渝小吃", 480, 17, 75, 15, mealRoleFull},
		{"荞麦面", "川香麻辣烫", 202, 7, 40, 1, mealRoleStaple},
		{"苏式烫饭", "米粉", 351, 10, 60, 6, mealRoleStaple},
		{"芽菜炒饭（早餐）", "湘菜", 400, 10, 70, 10, mealRoleFull},
		{"燕麦粥", "砂锅", 172, 6, 30, 3, mealRoleStaple},
		{"12寸夏威夷土豆披萨", "清青披萨", 1058, 42, 120, 40, mealRoleOther},
		{"9寸芝心芥香凤尾虾披萨", "清青披萨", 913, 40, 90, 38, mealRoleOther},
		{"瀑布芝士猪肉酱薯条", "清青披萨", 523, 13, 50, 30, mealRoleOther},
		{"美式洋葱圈", "清青披萨", 320, 5, 35, 18, mealRoleOther},
		{"巧克力圣代", "清青披萨", 383, 7, 55, 14, mealRoleOther},
		{"椰奶木瓜西米露", "基本伙食", 227, 2, 40, 6, mealRoleOther},
		{"南瓜汁", "韩式风味", 113, 3, 25, 1, mealRoleOther},
		{"红枣银耳雪梨汤", "烤烙", 127, 2, 30, 0, mealRoleOther},
		{"炝炒凤尾叶", "素菜/养生汤粥", 58, 3, 5, 3, mealRoleVegetable},
		{"炝炒葫芦丝", "素菜/养生汤粥", 63, 2, 7, 3, mealRoleVegetable},
		{"清炒土豆丝", "素菜/养生汤粥", 147, 3, 20, 6, mealRoleVegetable},
		{"白灼菜心", "", 80, 5, 8, 4, mealRoleVegetable},
		{"娃娃菜炒肉", "湘菜", 200, 9, 8, 14, mealRoleProtein},
		{"低脂营养鸡胸", "烤盘饭", 199, 34, 2, 4, mealRoleProtein},
		{"山药排骨汤", "赣味招牌", 250, 20, 10, 12, mealRoleSoup},
		{"红豆杂粮饭", "烤盘饭", 198, 6, 40, 1, mealRoleStaple},
	}
	for _, tc := range cases {
		c := comboDish("x", tc.title, tc.kcal, tc.protein, tc.carbs, tc.f, 9, tc.window)
		c.WindowID = ""
		assert.Equal(t, tc.want, mealComboRoleOf(c), tc.title)
	}
}

func TestMealHasStructureRecognisesAToppedNoodleBowlOnlyWhenProteinIsRecorded(t *testing.T) {
	bowl := func(title string, protein, carbs float64) DietRecommendationCandidate {
		return DietRecommendationCandidate{Title: title, Calories: 520, Protein: protein, Carbs: carbs, Fat: 14}
	}
	assert.True(t, mealHasStructure(bowl("山城担担面", 23, 75)), "a bowl whose recorded protein shows toppings is a meal")
	assert.True(t, mealHasStructure(bowl("老陕炸酱刀削面", 30, 80)))
	assert.False(t, mealHasStructure(bowl("荞麦面", 7, 40)), "plain noodles are a staple, not a meal")
	assert.False(t, mealHasStructure(bowl("面包", 6, 50)))
	assert.False(t, mealHasStructure(DietRecommendationCandidate{Title: "香酥鸡腿", Description: "表面酥脆", Calories: 300, Protein: 25, Carbs: 20}), "free text such as 表面 never makes a dish a noodle meal")
}

func TestMealKnownServingAcceptsTheLiOrderUnit(t *testing.T) {
	for unit, want := range map[string]bool{"元/份": true, "元/例": true, "元/小例": true, "元/碗": true, "元/两": false, "元/个": false, "": false, "元/50克": false} {
		c := DietRecommendationCandidate{Price: 12, PriceUnit: unit}
		assert.Equal(t, want, mealKnownServing(c), unit)
	}
}

func TestMealOrderingRiskFlagsShabuAndSpicySoupIngredients(t *testing.T) {
	for _, window := range []string{"涮羊肉", "川香麻辣烫", "冒菜", "串串香", "川南荤豆花"} {
		c := comboDish("x", "冻豆腐", 129, 11, 4, 8, 1, window)
		assert.NotEmpty(t, mealOrderingRisk(c), window)
	}
	assert.Empty(t, mealOrderingRisk(comboDish("x", "清蒸鱼", 200, 28, 2, 8, 12, "家常菜")))
}

// Role caps keep the enumeration bounded however large a canteen's menu is; this
// guards against an accidental explosion, not a performance target.
func TestSearchMealCombosStaysBoundedOnAHugeMenu(t *testing.T) {
	if testing.Short() {
		t.Skip("timing guard")
	}
	var pool []DietRecommendationCandidate
	for i := 0; i < 12; i++ {
		pool = append(pool, comboDish(fmt.Sprintf("staple-%d", i), fmt.Sprintf("杂粮饭%d", i), 200+float64(i), 5, 45, 1, 2, "主食窗口"))
	}
	for i := 0; i < 90; i++ {
		pool = append(pool, comboDish(fmt.Sprintf("meat-%d", i), fmt.Sprintf("红烧肉%d", i), 180+float64(i%40), 14+float64(i%12), 6, 10+float64(i%9), 6+float64(i%7), "家常菜"))
	}
	for i := 0; i < 40; i++ {
		pool = append(pool, comboDish(fmt.Sprintf("veg-%d", i), fmt.Sprintf("清炒时蔬%d", i), 50+float64(i%30), 3, 6, 3, 2+float64(i%3), "素菜"))
	}
	for i := 0; i < 10; i++ {
		pool = append(pool, comboDish(fmt.Sprintf("soup-%d", i), fmt.Sprintf("紫菜蛋花汤%d", i), 50, 4, 3, 2, 2, "汤"))
	}
	for i := 0; i < 30; i++ {
		pool = append(pool, comboDish(fmt.Sprintf("bowl-%d", i), fmt.Sprintf("牛肉面%d", i), 480+float64(i), 26, 68, 14, 12, "面食"))
	}
	started := time.Now()
	report := searchMealOptions(newComboTestState(), pool, 6, true)
	elapsed := time.Since(started)
	require.Len(t, report.Combos, 6)
	assert.Less(t, elapsed, 5*time.Second, "scored %d assemblies", report.Considered)
	t.Logf("scored %d assemblies in %s", report.Considered, elapsed)
}

// The same dish sold at two windows of one canteen is one dish to the person eating:
// a meal never serves it twice, and two options never offer it as "different" dishes.
func TestSearchMealCombosTreatTheSameDishAtTwoWindowsAsOneDish(t *testing.T) {
	pool := append(comboZijingPool(),
		comboDish("rice2", "米饭", 230, 4.5, 50, 0.5, 2, "第二窗口"),
		comboDish("chicken2", "宫保鸡丁", 240, 22, 10, 12, 8, "第二窗口"),
	) // one floor: the windows can be combined, so the duplicate is a real candidate partner
	state := newComboTestState()
	report := searchMealCombos(state, pool, 40)
	require.NotEmpty(t, report.Combos)
	sawTheDish := false
	titleCount := func(combo mealCombo) map[string]int {
		counts := map[string]int{}
		for _, c := range combo.Components {
			counts[c.Title]++
		}
		return counts
	}
	for _, combo := range report.Combos {
		for title, n := range titleCount(combo) {
			assert.LessOrEqual(t, n, 1, "%s appears %d times in %q", title, n, combo.Plan.Title)
		}
		sawTheDish = sawTheDish || titleCount(combo)["宫保鸡丁"] == 1
	}
	assert.True(t, sawTheDish, "the dish itself is still offered, once")

	// Across options: after 宫保鸡丁 at one window was shown, the other window's is not "new".
	rows := []mealComboRow{
		{combo: mealCombo{HealthFit: 90, Score: 90, Plan: DietRecommendationCandidate{SourceID: "meal:a"}}, place: "p1", dishes: mealComboDishSet([]DietRecommendationCandidate{pool[3]})},
		{combo: mealCombo{HealthFit: 90, Score: 89, Plan: DietRecommendationCandidate{SourceID: "meal:b"}}, place: "p2", dishes: mealComboDishSet([]DietRecommendationCandidate{pool[len(pool)-1]})},
		{combo: mealCombo{HealthFit: 90, Score: 80, Plan: DietRecommendationCandidate{SourceID: "meal:c"}}, place: "p3", dishes: mealComboDishSet([]DietRecommendationCandidate{pool[4]})},
	}
	require.Equal(t, "宫保鸡丁", pool[3].Title)
	require.Equal(t, "宫保鸡丁", pool[len(pool)-1].Title)
	chosen := selectMealCombos(rows, 2)
	require.Len(t, chosen, 2)
	assert.Equal(t, []string{"meal:a", "meal:c"}, []string{chosen[0].combo.Plan.SourceID, chosen[1].combo.Plan.SourceID},
		"the second 宫保鸡丁 is the same dish, so the different one is preferred")
}

// A dish recommended earlier in the conversation counts as seen whichever window sells it.
func TestConversationDishesAreRecognisedByNameAcrossWindows(t *testing.T) {
	shown := comboDish("chicken", "宫保鸡丁", 240, 22, 10, 12, 8, "家常菜")
	other := comboDish("chicken2", "宫保鸡丁", 240, 22, 10, 12, 8, "第二窗口")
	state := newComboTestState()
	state.Intent = "refine"
	state.ActiveSourceIDs = []string{"meal:earlier"}
	state.MealPlans = map[string][]DietRecommendationCandidate{"meal:earlier": {shown}}

	dishes, plans := mealComboConversationDishes(state)
	assert.True(t, plans["meal:earlier"])
	assert.True(t, dishes[shown.SourceID], "the stored component itself")
	assert.True(t, dishes[mealComboDishKey(other)], "and the same dish at another window")
	assert.False(t, dishes[mealComboDishKey(comboDish("beef", "黑椒牛柳", 260, 24, 8, 15, 11, "家常菜"))])
}

// A small canteen where serving the same dish twice would look like the best way to
// reach the protein target: it must not be offered as a meal.
func TestSearchMealCombosNeverServeTheSameDishTwice(t *testing.T) {
	pool := []DietRecommendationCandidate{
		comboDish("rice", "米饭", 230, 4.5, 50, 0.5, 2, "主食窗口"),
		comboDish("chicken-a", "宫保鸡丁", 240, 22, 10, 12, 8, "家常菜"),
		comboDish("chicken-b", "宫保鸡丁", 240, 22, 10, 12, 8, "第二窗口"),
	}
	state := newComboTestState()
	places, _ := mealComboPlaces(state, pool)
	require.Len(t, places, 1)
	drafts, considered := places[0].enumerate(dietDecisionContextFromCampusState(state), mealComboLimits{}, false)
	require.NotZero(t, considered)
	for _, list := range drafts {
		for _, d := range list {
			seen := map[string]bool{}
			for i := 0; i < d.n; i++ {
				assert.False(t, seen[d.parts[i].dish], "%s is served twice", d.parts[i].c.Title)
				seen[d.parts[i].dish] = true
			}
		}
	}
	report := searchMealCombos(state, pool, 6)
	for _, combo := range report.Combos {
		assert.Len(t, combo.Components, 2, "米饭 + 宫保鸡丁 is the whole menu: %q", combo.Plan.Title)
	}
}
