package service

import (
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func nsAt(day, clock string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", day+" "+clock, chinaTZ)
	if err != nil {
		panic(err)
	}
	return t
}

func nsRecord(id, day, clock, meal string, kcal, protein float64, items ...map[string]any) domain.FoodRecord {
	t := nsAt(day, clock)
	return domain.FoodRecord{ID: id, RecordTime: &t, MealType: meal, TotalCalories: kcal, TotalProtein: protein, Items: items}
}

func nsItem(name string, weight float64, nutrients map[string]float64) map[string]any {
	item := map[string]any{"name": name, "weight": weight}
	for key, value := range nutrients {
		item[key] = value
	}
	return item
}

func nsProfile() *domain.StatsUserProfile {
	birthday, gender, goal := "1995-01-01", "male", "fat_loss"
	tdee := 2000.0
	return &domain.StatsUserProfile{ID: "user-1", Birthday: &birthday, Gender: &gender, DietGoal: &goal, TDEE: &tdee, HealthCondition: map[string]any{}}
}

// Two weeks of a user who eats salty, picked up vegetables this week and has had a
// breakfast and a lunch today, the lunch partly without sodium data.
func nsWeekInput() nutritionStateInput {
	records := []domain.FoodRecord{
		nsRecord("lw-1", "2026-10-23", "12:00", "lunch", 800, 30, nsItem("红烧牛肉面", 500, map[string]float64{"sodiumMg": 2600, "fiber": 4})),
		nsRecord("lw-2", "2026-10-24", "12:00", "lunch", 800, 30, nsItem("酸辣粉", 450, map[string]float64{"sodiumMg": 2600, "fiber": 3})),
		nsRecord("w-1", "2026-10-30", "12:00", "lunch", 700, 35, nsItem("清炒西兰花", 350, map[string]float64{"sodiumMg": 2500, "fiber": 9})),
		nsRecord("w-2", "2026-10-31", "12:00", "lunch", 750, 30, nsItem("牛肉汤面", 500, map[string]float64{"sodiumMg": 2400, "fiber": 3})),
		nsRecord("w-3", "2026-11-01", "12:00", "lunch", 650, 30, nsItem("鸡胸肉饭", 400, map[string]float64{"sodiumMg": 1500, "fiber": 4})),
		nsRecord("w-4", "2026-11-02", "12:00", "lunch", 600, 28, nsItem("凉拌黄瓜", 320, map[string]float64{"sodiumMg": 1200, "fiber": 5})),
		nsRecord("w-5", "2026-11-03", "19:00", "dinner", 900, 30, nsItem("麻辣香锅", 500, map[string]float64{"sodiumMg": 2200, "fiber": 6})),
		nsRecord("breakfast", "2026-11-04", "08:00", "breakfast", 250, 10, nsItem("豆浆", 300, map[string]float64{"sodiumMg": 100, "fiber": 2})),
		nsRecord("lunch", "2026-11-04", "12:20", "lunch", 600, 15,
			nsItem("番茄炒蛋", 250, map[string]float64{"sodiumMg": 900, "fiber": 3}),
			nsItem("米饭", 200, nil)),
	}
	day := nsAt("2026-11-04", "00:00")
	return nutritionStateInput{
		Now: nsAt("2026-11-04", "13:10"), Date: day, Profile: nsProfile(), Records: records,
		Goals: nutritionGoals(nsProfile(), nil, day.AddDate(0, 0, -13), day), Water: map[string]WaterDaily{},
	}
}

func nsReading(t *testing.T, state *domain.DailyNutritionState, key string) domain.NutrientReading {
	t.Helper()
	for _, r := range state.Today {
		if r.Key == key {
			return r
		}
	}
	t.Fatalf("no reading %s in %+v", key, state.Today)
	return domain.NutrientReading{}
}

func TestNutritionStateTodayKeepsUnknownApartFromZero(t *testing.T) {
	state := buildDailyNutritionState(nsWeekInput())

	fiber := nsReading(t, state, "fiber")
	require.NotNil(t, fiber.Value)
	assert.Equal(t, 5.0, *fiber.Value)
	assert.Equal(t, 1, fiber.UnknownMeals, "the rice has no fibre data")
	assert.Equal(t, domain.NutrientStatusShort, fiber.Status)

	// 1000 mg known with one item unknown is a lower bound under the ceiling: not "ok".
	sodium := nsReading(t, state, "sodium")
	require.NotNil(t, sodium.Value)
	assert.Equal(t, 1000.0, *sodium.Value)
	assert.Equal(t, "max", sodium.Kind)
	assert.Equal(t, domain.NutrientStatusUnknown, sodium.Status)

	// Sugar is almost never in the data: without any, the row is left out, not shown as 0.
	for _, r := range state.Today {
		assert.NotEqual(t, "added_sugar", r.Key)
	}

	// 番茄炒蛋 is a mixed dish: 40% of 250 g counts as vegetables.
	veg := nsReading(t, state, "vegetables")
	require.NotNil(t, veg.Value)
	assert.Equal(t, 100.0, *veg.Value)
	assert.Equal(t, 200.0, veg.Gap)
}

func TestNutritionStateWeekCountsSaltAndVegetables(t *testing.T) {
	state := buildDailyNutritionState(nsWeekInput())

	require.Len(t, state.Week.Days, 7)
	assert.Equal(t, "2026-10-29", state.Week.Days[0])
	assert.Equal(t, "2026-11-04", state.Week.Days[6])
	var sodium, veg *domain.NutritionHabit
	for i := range state.Week.Habits {
		switch state.Week.Habits[i].Key {
		case "sodium":
			sodium = &state.Week.Habits[i]
		case "vegetables":
			veg = &state.Week.Habits[i]
		}
	}
	require.NotNil(t, sodium)
	assert.Equal(t, []string{"none", "miss", "miss", "hit", "hit", "miss", "today"}, sodium.Marks)
	assert.Equal(t, 2, sodium.Hit)
	assert.Equal(t, 5, sodium.Of)
	require.NotNil(t, veg)
	assert.Equal(t, 2, veg.Hit)
	assert.Equal(t, "today", veg.Marks[6])

	deltas := map[string]domain.NutritionWeekDelta{}
	for _, d := range state.Week.VsLastWeek {
		deltas[d.Key] = d
	}
	assert.Equal(t, 0.0, deltas["vegetables"].Last)
	assert.Equal(t, 2.0, deltas["vegetables"].This)
	assert.True(t, deltas["vegetables"].Better)
	assert.Equal(t, 3.0, deltas["sodium"].This)
	assert.False(t, deltas["sodium"].Better)

	assert.Equal(t, "这周蔬菜跟上了，盐还偏多：5 天里有 3 天钠超过 2000 毫克。", state.Headline)
}

// A salty week keeps sodium on the next plate even while today is still under the
// ceiling, and the lunch already recorded makes the next meal dinner.
func TestNutritionStateNextMealUsesTheWeek(t *testing.T) {
	state := buildDailyNutritionState(nsWeekInput())

	require.NotNil(t, state.NextMeal)
	assert.Equal(t, "dinner", state.NextMeal.MealType)
	assert.Contains(t, state.NextMeal.Limits, "sodium")
	assert.Contains(t, state.NextMeal.Fills, "vegetables")
	assert.Contains(t, state.NextMeal.Advice, "一份深色蔬菜")
	assert.Contains(t, state.NextMeal.Advice, "汤和酱汁少一点")
}

func TestNutritionStateScoresComeFromNutrients(t *testing.T) {
	state := buildDailyNutritionState(nsWeekInput())

	require.NotNil(t, state.Scores.Overall)
	focus := map[string]domain.NutritionFocusScore{}
	for _, f := range state.Scores.Focus {
		focus[f.Key] = f
	}
	bp := focus["hypertension"]
	require.NotNil(t, bp.Score)
	assert.Less(t, *bp.Score, 60)
	assert.Contains(t, bp.Evidence, "钠 5 天里 3 天超过 2000 毫克")
	assert.NotEmpty(t, bp.Reason)
	assert.Equal(t, "血压管理友好度", bp.Title)

	assert.True(t, state.Coverage.EnoughData)
	assert.Equal(t, 6, state.Coverage.RecordedDays)
	assert.Equal(t, 2, state.Coverage.TodayMeals)
}

func TestNutritionStateNeedsTwoDaysForScores(t *testing.T) {
	in := nsWeekInput()
	in.Records = in.Records[len(in.Records)-2:]
	state := buildDailyNutritionState(in)

	assert.Nil(t, state.Scores.Overall)
	assert.Empty(t, state.Scores.Focus)
	assert.False(t, state.Coverage.EnoughData)
	assert.NotEmpty(t, state.Today, "today's readings do not wait for two days")
	assert.Equal(t, "再记几餐，就能看出这周吃得怎么样。", state.Headline)
}

func TestNutritionStateAsksForTheDataItLacks(t *testing.T) {
	in := nsWeekInput()
	in.Body = &BodyMetricsSummary{WaterGoalMl: 2000}
	in.SleepTracked = true
	state := buildDailyNutritionState(in)

	actions := map[string]string{}
	for _, gap := range state.EvidenceGaps {
		actions[gap.Key] = gap.Action
	}
	assert.Equal(t, "record", actions["sodium_unknown"])
	assert.Equal(t, "weight", actions["weight_missing"])
	assert.Equal(t, "water", actions["water_sparse"])
	assert.Equal(t, "sleep", actions["sleep_missing"])
	assert.Contains(t, state.Context.Notes, "减脂中")
}

func TestNutritionStateWeightTrendFromWeighIns(t *testing.T) {
	in := nsWeekInput()
	in.Body = &BodyMetricsSummary{WeightTrendDaily: []WeightEntry{{Date: "2026-10-21", Value: 70.4}, {Date: "2026-10-28", Value: 70.1}, {Date: "2026-11-04", Value: 69.8}}}
	state := buildDailyNutritionState(in)

	require.NotNil(t, state.Context.WeightTrend)
	assert.Equal(t, -0.6, state.Context.WeightTrend.KgChange)
	assert.Equal(t, 14, state.Context.WeightTrend.Days)
	for _, f := range state.Scores.Focus {
		if f.Key == "weight" {
			assert.Contains(t, strings.Join(f.Evidence, "|"), "近 14 天体重 −0.6 kg")
		}
	}
}

// The recommendation ranking remembers the week: three salty days before today tighten
// today's sodium ceiling, a lighter week leaves it at 2000 mg.
func TestDecisionBasisTightensSodiumAfterASaltyWeek(t *testing.T) {
	in := nsWeekInput()
	basis := buildDietDecisionBasis(in.Profile, in.Records, in.Now)
	limit := 0.0
	for _, rule := range basis.NutrientState.Rules {
		if rule.Key == "sodiumMg" {
			limit = rule.Limit
		}
	}
	assert.Equal(t, 1500.0, limit)
	assert.Contains(t, basis.Actions, "这周已有 3 天钠超过上限，今天选汤少、酱汁少的。")

	light := []domain.FoodRecord{}
	for _, r := range in.Records {
		if r.ID != "w-5" {
			light = append(light, r)
		}
	}
	basis = buildDietDecisionBasis(in.Profile, light, in.Now)
	for _, rule := range basis.NutrientState.Rules {
		if rule.Key == "sodiumMg" {
			assert.Equal(t, 2000.0, rule.Limit)
		}
	}
}

func TestMealImpactComparesTheDayWithAndWithoutTheMeal(t *testing.T) {
	in := nsWeekInput()
	var lunch domain.FoodRecord
	for _, r := range in.Records {
		if r.ID == "lunch" {
			lunch = r
		}
	}
	impact := buildMealImpact(in.Profile, in.Records, lunch, in.Date, in.Now, in.Goals["2026-11-04"])

	changes := map[string]domain.MealImpactChange{}
	for _, c := range impact.Changes {
		changes[c.Key] = c
	}
	fiber := changes["fiber"]
	require.NotNil(t, fiber.Before)
	require.NotNil(t, fiber.Delta)
	assert.Equal(t, 2.0, *fiber.Before)
	assert.Equal(t, 3.0, *fiber.Delta)
	sodium := changes["sodium"]
	require.NotNil(t, sodium.Delta)
	assert.Equal(t, 900.0, *sodium.Delta)
	assert.Equal(t, "这一餐让蔬菜 +100 克，今天还差 200 克", impact.Headline)
	assert.Equal(t, "lunch", impact.MealType)
}

func TestMealImpactWarnsWhenTheMealCrossesACeiling(t *testing.T) {
	in := nsWeekInput()
	salty := nsRecord("salty", "2026-11-04", "12:50", "lunch", 500, 20, nsItem("酸菜鱼", 500, map[string]float64{"sodiumMg": 1500, "fiber": 2}))
	in.Records = append(in.Records, salty)
	impact := buildMealImpact(in.Profile, in.Records, salty, in.Date, in.Now, in.Goals["2026-11-04"])

	assert.Equal(t, "这一餐钠 +1500 毫克，今天已经超过上限了", impact.Headline)
}

// Real data showed these: praise and the issue about the same nutrient, profile option
// codes ("none", "spicy") shown as words, and a water gap for someone who never logs water.
func TestNutritionStateReadsLikeTheProfileAndTheWeek(t *testing.T) {
	in := nsWeekInput()
	// Last week saltier than this one: sodium got better but is still the main issue.
	extra := nsRecord("lw-3", "2026-10-25", "12:00", "lunch", 800, 30, nsItem("麻辣烫", 500, map[string]float64{"sodiumMg": 2600, "fiber": 3}))
	extra2 := nsRecord("lw-4", "2026-10-26", "12:00", "lunch", 800, 30, nsItem("螺蛳粉", 500, map[string]float64{"sodiumMg": 2700, "fiber": 3}))
	extra3 := nsRecord("lw-5", "2026-10-27", "12:00", "lunch", 800, 30, nsItem("火锅", 500, map[string]float64{"sodiumMg": 2900, "fiber": 3}))
	in.Records = append(in.Records, extra, extra2, extra3)
	in.Profile.HealthCondition = map[string]any{"medical_history": []any{"hypertension"}, "allergies": []any{"spicy", "none"}, "diet_preference": []any{"none"}}
	in.Body = &BodyMetricsSummary{WaterGoalMl: 2000}
	state := buildDailyNutritionState(in)

	assert.NotContains(t, state.Headline, "盐比上周少了，盐还偏多")
	assert.Contains(t, state.Headline, "蔬菜跟上了")
	assert.Contains(t, state.Context.Notes, "有高血压")
	assert.Contains(t, state.Context.Notes, "不吃辣")
	for _, note := range state.Context.Notes {
		assert.NotContains(t, note, "none")
	}
	for _, r := range state.Today {
		assert.NotEqual(t, "water", r.Key, "water is not logged at all")
	}
}

func TestVegetableEstimateSkipsFruitAndPowders(t *testing.T) {
	assert.Equal(t, 0.0, nutritionVegetableGrams(nsItem("什锦水果沙拉", 150, nil)))
	assert.Equal(t, 0.0, nutritionVegetableGrams(nsItem("每日果蔬粉冲调粉", 15, nil)))
	assert.Equal(t, 100.0, nutritionVegetableGrams(nsItem("清炒油菜", 100, nil)))
	assert.Equal(t, 48.0, nutritionVegetableGrams(nsItem("芹菜炒肉丝", 120, nil)))
}

// The user's focus steers the state: someone who cares about blood glucose sees fibre
// first, their card first, sugar on the next plate, and a headline about fibre.
func TestNutritionStateFollowsTheUsersFocus(t *testing.T) {
	in := nsWeekInput()
	in.Profile.HealthCondition = map[string]any{
		"focus_keys":            []any{"diabetes", "custom:f1", "custom:gone"},
		"custom_health_focuses": []any{map[string]any{"id": "f1", "label": "控尿酸", "created_at": "2026-11-01T00:00:00Z"}},
	}
	state := buildDailyNutritionState(in)

	require.Len(t, state.Focus, 2, "a custom focus that no longer exists is dropped")
	assert.Equal(t, domain.NutritionFocusChoice{Key: "diabetes", Title: "血糖稳定友好度"}, state.Focus[0])
	assert.Equal(t, domain.NutritionFocusChoice{Key: "custom:f1", Title: "控尿酸", Custom: true}, state.Focus[1])
	require.NotEmpty(t, state.Gaps)
	assert.Equal(t, "fiber", state.Gaps[0].Key)
	require.NotEmpty(t, state.Scores.Focus)
	assert.Equal(t, "diabetes", state.Scores.Focus[0].Key)
	require.NotNil(t, state.NextMeal)
	assert.Contains(t, state.NextMeal.Limits, "added_sugar")
	assert.Contains(t, state.NextMeal.Fills, "whole_grains")
	assert.Contains(t, state.Headline, "纤维不够")

	plain := buildDailyNutritionState(nsWeekInput())
	assert.Empty(t, plain.Focus)
	assert.Contains(t, plain.Headline, "盐还偏多")
}
