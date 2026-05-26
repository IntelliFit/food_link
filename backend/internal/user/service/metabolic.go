package service

import (
	"math"
	"strings"
	"time"
)

var activityMultipliers = map[string]float64{
	"sedentary":   1.2,
	"light":       1.3,
	"moderate":    1.4,
	"active":      1.55,
	"very_active": 1.55,
}

func CalculateBMR(gender string, weightKg float64) float64 {
	var bmr float64
	if gender == "male" {
		bmr = (48.5*weightKg + 2954.7) / 4.184
	} else {
		bmr = (41.9*weightKg + 2869.1) / 4.184
	}
	return math.Max(0, bmr)
}

func CalculateMifflinBMR(gender string, weightKg, heightCm float64, age int) float64 {
	if weightKg <= 0 || heightCm <= 0 || age <= 0 {
		return 0
	}
	bmr := 10*weightKg + 6.25*heightCm - 5*float64(age)
	if gender == "male" {
		bmr += 5
	} else {
		bmr -= 161
	}
	return math.Max(0, bmr)
}

func CalculateHybridBMR(gender string, weightKg, heightCm float64, age int) float64 {
	projectBMR := CalculateBMR(gender, weightKg)
	mifflinBMR := CalculateMifflinBMR(gender, weightKg, heightCm, age)
	if projectBMR <= 0 {
		return mifflinBMR
	}
	if mifflinBMR <= 0 {
		return projectBMR
	}
	return (projectBMR + mifflinBMR) / 2
}

func CalculateTDEE(bmr float64, activityLevel string) float64 {
	mult := DailyLifeActivityMultiplier(activityLevel)
	if mult == 0 {
		mult = 1.2
	}
	return bmr * mult
}

func NormalizeDailyLifeActivityLevel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "sedentary", "office", "desk", "久坐", "久坐办公":
		return "sedentary"
	case "light", "walking", "daily_walk", "日常走动", "轻体力":
		return "light"
	case "moderate", "standing", "often_standing", "经常站立":
		return "moderate"
	case "active", "very_active", "physical", "physical_labor", "体力劳动":
		return "active"
	default:
		return "sedentary"
	}
}

func DailyLifeActivityMultiplier(value string) float64 {
	level := NormalizeDailyLifeActivityLevel(value)
	mult := activityMultipliers[level]
	if mult == 0 {
		return 1.2
	}
	return mult
}

func AgeFromBirthday(birthday string, now time.Time) int {
	birthday = strings.TrimSpace(birthday)
	if birthday == "" {
		return 0
	}
	birthDate, err := time.Parse("2006-01-02", birthday)
	if err != nil {
		return 0
	}
	if now.IsZero() {
		now = time.Now()
	}
	age := now.Year() - birthDate.Year()
	if now.YearDay() < birthDate.YearDay() {
		age--
	}
	if age < 0 {
		return 0
	}
	return age
}

type StableNutritionTargetInput struct {
	Gender        string
	WeightKg      float64
	HeightCm      float64
	Birthday      string
	ActivityLevel string
	DietGoal      string
	Now           time.Time
}

type StableNutritionTargetResult struct {
	BMR     float64
	TDEE    float64
	Targets map[string]float64
}

func CalculateStableNutritionTargets(input StableNutritionTargetInput) StableNutritionTargetResult {
	age := AgeFromBirthday(input.Birthday, input.Now)
	bmr := CalculateHybridBMR(input.Gender, input.WeightKg, input.HeightCm, age)
	if bmr <= 0 {
		bmr = CalculateBMR(input.Gender, input.WeightKg)
	}
	tdee := CalculateTDEE(bmr, input.ActivityLevel)
	calorieTarget := applyDietGoalAdjustmentForStableTarget(tdee, input.DietGoal)
	calorieTarget = roundTo10(clampFloatForStableTarget(calorieTarget, 900, 5000))
	macros := distributeStableMacroTargets(calorieTarget, input.WeightKg, input.DietGoal)
	return StableNutritionTargetResult{
		BMR:  math.Round(bmr*10) / 10,
		TDEE: math.Round(tdee*10) / 10,
		Targets: map[string]float64{
			"calorie_target": calorieTarget,
			"protein_target": math.Round(macros["protein"]*10) / 10,
			"carbs_target":   math.Round(macros["carbs"]*10) / 10,
			"fat_target":     math.Round(macros["fat"]*10) / 10,
		},
	}
}

func applyDietGoalAdjustmentForStableTarget(tdee float64, goal string) float64 {
	switch strings.TrimSpace(goal) {
	case "fat_loss":
		return tdee - clampFloatForStableTarget(tdee*0.16, 300, 500)
	case "muscle_gain":
		return tdee + clampFloatForStableTarget(tdee*0.10, 150, 300)
	default:
		return tdee
	}
}

func distributeStableMacroTargets(calorieTarget, weightKg float64, goal string) map[string]float64 {
	if weightKg <= 0 {
		weightKg = 60
	}
	proteinPerKg := 1.5
	if goal == "fat_loss" || goal == "muscle_gain" {
		proteinPerKg = 1.8
	}
	protein := clampFloatForStableTarget(weightKg*proteinPerKg, 60, 220)
	fat := clampFloatForStableTarget(weightKg*0.8, 40, calorieTarget*0.3/9)
	if goal == "fat_loss" {
		fat = clampFloatForStableTarget(weightKg*0.7, 35, calorieTarget*0.28/9)
	}
	remaining := calorieTarget - protein*4 - fat*9
	if remaining < calorieTarget*0.25 {
		fat = clampFloatForStableTarget((calorieTarget-protein*4-calorieTarget*0.25)/9, 35, fat)
		remaining = calorieTarget - protein*4 - fat*9
	}
	carbs := math.Max(0, remaining/4)
	return map[string]float64{"protein": protein, "carbs": carbs, "fat": fat}
}

func clampFloatForStableTarget(value, min, max float64) float64 {
	if max < min {
		max = min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func roundTo10(value float64) float64 {
	return math.Round(value/10) * 10
}

var dashboardDefaultMacroTargets = map[string]float64{
	"protein": 120.0,
	"carbs":   250.0,
	"fat":     65.0,
}

func GetDashboardDefaultMacroTargets() map[string]float64 {
	return dashboardDefaultMacroTargets
}
