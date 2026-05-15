package service

import "math"

var activityMultipliers = map[string]float64{
	"sedentary":   1.2,
	"light":       1.375,
	"moderate":    1.55,
	"active":      1.725,
	"very_active": 1.9,
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
	mult := activityMultipliers[activityLevel]
	if mult == 0 {
		mult = 1.2
	}
	return bmr * mult
}

var dashboardDefaultMacroTargets = map[string]float64{
	"protein": 120.0,
	"carbs":   250.0,
	"fat":     65.0,
}

func GetDashboardDefaultMacroTargets() map[string]float64 {
	return dashboardDefaultMacroTargets
}
