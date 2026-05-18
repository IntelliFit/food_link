package service

import (
	"math"
	"strings"
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

var dashboardDefaultMacroTargets = map[string]float64{
	"protein": 120.0,
	"carbs":   250.0,
	"fat":     65.0,
}

func GetDashboardDefaultMacroTargets() map[string]float64 {
	return dashboardDefaultMacroTargets
}
