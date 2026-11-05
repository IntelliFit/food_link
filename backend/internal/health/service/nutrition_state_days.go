package service

import (
	"math"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/nutritionagg"
)

// nutritionDay is one calendar day (China time) of recorded eating, the unit every
// part of the daily nutrition state is built from. Unknown nutrients stay unknown in
// Nutrients (see nutritionagg); vegetables are estimated from dish names and weights.
type nutritionDay struct {
	Date      string
	Meals     int
	Calories  float64
	Protein   float64
	Nutrients nutritionagg.Vector
	Rules     []DietNutrientRule
	// Meals whose items lack the nutrient, per nutrient key.
	UnknownMeals map[string]int
	VegGrams     float64
	GroupMeals   map[string]int
	LateMeals    int
	Breakfast    bool
	MealTypes    map[string]bool
	CalorieGoal  float64
	ProteinGoal  float64
}

const (
	nutritionVegetableTarget = 300.0 // 中国居民膳食指南（2022）每天蔬菜 300–500g 的下限
	nutritionMixedDishVeg    = 0.4   // a dish with vegetables and meat or egg counts this share of its weight
	nutritionLateMealHour    = 21
)

var nutritionVegetableWords = []string{
	"青菜", "菠菜", "白菜", "西兰花", "西蓝花", "生菜", "油麦菜", "芹菜", "胡萝卜", "番茄", "西红柿", "茄子", "西葫芦", "菜花", "空心菜",
	"黄瓜", "青椒", "彩椒", "豆角", "四季豆", "菜心", "芥兰", "芥蓝", "蘑菇", "香菇", "金针菇", "菌菇", "木耳", "莴笋", "包菜", "卷心菜",
	"甘蓝", "秋葵", "苦瓜", "冬瓜", "丝瓜", "洋葱", "韭菜", "蒜苔", "蒜薹", "茼蒿", "娃娃菜", "荷兰豆", "竹笋", "莲藕", "藕片", "沙拉", "蔬菜", "时蔬", "小炒菜",
	"油菜", "绿叶菜", "萝卜", "海带", "紫菜", "辣椒", "南瓜", "豆芽", "茭白", "蒜苗", "芦笋", "苋菜", "豌豆苗", "花菜", "西芹", "青笋", "莴苣",
}

// Fruit salads and fruit-and-vegetable powders are not vegetables.
var nutritionNotVegetableWords = []string{"水果", "果蔬粉", "冲调", "果汁"}

var nutritionProteinWords = []string{"肉", "鸡", "鸭", "鱼", "虾", "牛", "羊", "猪", "蛋", "排骨", "培根", "火腿", "肠"}

// buildNutritionDays groups records by China date for every day in [from, to] and
// evaluates each against that day's targets. now caps the last day, so a meal logged
// in the future is not counted yet.
func buildNutritionDays(profile *domain.StatsUserProfile, records []domain.FoodRecord, from, to, now time.Time, goals map[string]nutritionGoal) []nutritionDay {
	byDate := map[string][]domain.FoodRecord{}
	for _, record := range records {
		if record.RecordTime == nil || record.RecordTime.After(now) {
			continue
		}
		date := record.RecordTime.In(chinaTZ).Format("2006-01-02")
		byDate[date] = append(byDate[date], record)
	}
	days := []nutritionDay{}
	for cursor := from; !cursor.After(to); cursor = cursor.AddDate(0, 0, 1) {
		date := cursor.Format("2006-01-02")
		goal := goals[date]
		dayEnd := cursor.Add(24*time.Hour - time.Second)
		if dayEnd.After(now) {
			dayEnd = now
		}
		days = append(days, buildNutritionDay(profile, date, byDate[date], dayEnd, goal))
	}
	return days
}

type nutritionGoal struct {
	Calories float64
	Protein  float64
	FromPlan bool
}

func buildNutritionDay(profile *domain.StatsUserProfile, date string, records []domain.FoodRecord, dayEnd time.Time, goal nutritionGoal) nutritionDay {
	day := nutritionDay{Date: date, UnknownMeals: map[string]int{}, GroupMeals: map[string]int{}, MealTypes: map[string]bool{}, CalorieGoal: goal.Calories, ProteinGoal: goal.Protein}
	// buildDietNutrientState keeps only records before its clock on the clock's date,
	// so the clock is the day's last second (or now, for today).
	state := buildDietNutrientState(profile, records, dayEnd, goal.Calories)
	day.Rules = state.Rules
	day.Nutrients = state.Current
	for _, record := range records {
		day.Meals++
		day.Calories += record.TotalCalories
		day.Protein += record.TotalProtein
		vector := nutritionagg.Observe(record.Items, true)
		for key, amount := range vector {
			if amount.KnownItems < amount.TotalItems || amount.TotalItems == 0 {
				day.UnknownMeals[key]++
			}
		}
		groups := map[string]bool{}
		for _, item := range record.Items {
			name, _ := item["name"].(string)
			for key := range dietFoodGroups(name) {
				groups[key] = true
			}
			day.VegGrams += nutritionVegetableGrams(item)
		}
		for key := range groups {
			day.GroupMeals[key]++
		}
		if groups["fish"] || groups["soy"] {
			day.GroupMeals["fish_soy"]++
		}
		local := record.RecordTime.In(chinaTZ)
		if local.Hour() >= nutritionLateMealHour || local.Hour() < 4 {
			day.LateMeals++
		}
		day.MealTypes[record.MealType] = true
		if record.MealType == "breakfast" {
			day.Breakfast = true
		}
	}
	day.VegGrams = math.Round(day.VegGrams)
	return day
}

// nutritionVegetableGrams estimates the eaten vegetable weight of one item from its
// name and recorded weight. Items without a weight add nothing (a lower bound).
func nutritionVegetableGrams(item map[string]any) float64 {
	name, _ := item["name"].(string)
	name = strings.ReplaceAll(name, "鱼香", "")
	if !containsAnyText(name, nutritionVegetableWords...) || containsAnyText(name, nutritionNotVegetableWords...) {
		return 0
	}
	weight := anyFloat(item["weight"])
	if weight <= 0 || math.IsNaN(weight) || math.IsInf(weight, 0) {
		return 0
	}
	weight *= nutritionagg.IntakeFactor(item)
	if containsAnyText(name, nutritionProteinWords...) {
		weight *= nutritionMixedDishVeg
	}
	return math.Min(weight, 600)
}

func (d nutritionDay) recorded() bool { return d.Meals > 0 }

// rule returns the day's floor (target) or ceiling (limit) for a nutrient key.
func (d nutritionDay) rule(key string) (DietNutrientRule, bool) {
	for _, rule := range d.Rules {
		if rule.Key == key {
			return rule, true
		}
	}
	return DietNutrientRule{}, false
}

// known returns the recorded amount of a nutrient and whether every meal had it.
func (d nutritionDay) known(key string) (value float64, complete, any bool) {
	amount, ok := d.Nutrients[key]
	if !ok || amount.KnownItems == 0 {
		return 0, false, false
	}
	return amount.Value, amount.Complete(), true
}

func nutritionDaysRecorded(days []nutritionDay) []nutritionDay {
	out := []nutritionDay{}
	for _, day := range days {
		if day.recorded() {
			out = append(out, day)
		}
	}
	return out
}
