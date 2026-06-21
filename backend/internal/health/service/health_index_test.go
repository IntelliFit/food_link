package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func buildScreenshotLikeComputation() *statsComputation {
	totalCal := 7600.0
	dinnerCombined := totalCal * 0.44
	breakfastCombined := totalCal * 0.15
	lunch := totalCal * 0.30
	snack := totalCal * 0.11

	proteinPct := 22.0
	carbsPct := 44.0
	fatPct := 34.0
	totalProtein := totalCal * proteinPct / 100 / 4
	totalCarbs := totalCal * carbsPct / 100 / 4
	totalFat := totalCal * fatPct / 100 / 9

	return &statsComputation{
		StatsRange:        "week",
		TDEE:              2000,
		StreakDays:        1,
		TotalCalories:     totalCal,
		AvgCaloriesPerDay: totalCal / 4,
		ByMeal: map[string]float64{
			"breakfast":       breakfastCombined * 0.85,
			"morning_snack":   breakfastCombined * 0.15,
			"lunch":           lunch,
			"afternoon_snack": snack * 0.4,
			"dinner":          dinnerCombined * 0.82,
			"evening_snack":   dinnerCombined * 0.18,
		},
		DailyCalories: []DailyCalories{
			{Date: "2026-05-20", Calories: 1900},
			{Date: "2026-05-21", Calories: 1850},
			{Date: "2026-05-22", Calories: 1950},
			{Date: "2026-05-23", Calories: 1900},
		},
		MacroPercent: map[string]float64{
			"protein": proteinPct,
			"carbs":   carbsPct,
			"fat":     fatPct,
		},
		TotalProtein: totalProtein,
		TotalCarbs:   totalCarbs,
		TotalFat:     totalFat,
		RecordedDays: 4,
	}
}

func buildIdealComputation() *statsComputation {
	totalCal := 10000.0
	return &statsComputation{
		StatsRange:        "week",
		TDEE:              2000,
		StreakDays:        7,
		TotalCalories:     totalCal,
		AvgCaloriesPerDay: 2000,
		ByMeal: map[string]float64{
			"breakfast":       totalCal * 0.20,
			"morning_snack":   totalCal * 0.02,
			"lunch":           totalCal * 0.35,
			"afternoon_snack": totalCal * 0.05,
			"dinner":          totalCal * 0.27,
			"evening_snack":   totalCal * 0.06,
		},
		DailyCalories: []DailyCalories{
			{Date: "2026-05-19", Calories: 2000},
			{Date: "2026-05-20", Calories: 1980},
			{Date: "2026-05-21", Calories: 1990},
			{Date: "2026-05-22", Calories: 2000},
			{Date: "2026-05-23", Calories: 2000},
		},
		MacroPercent: map[string]float64{
			"protein": 25,
			"carbs":   45,
			"fat":     28,
		},
		MicronutrientDaily: map[string]float64{
			"fiber":          30,
			"sodiumMg":       1800,
			"potassiumMg":    3600,
			"calciumMg":      900,
			"ironMg":         15,
			"vitaminARaeMcg": 800,
			"vitaminCMg":     120,
			"vitaminDMcg":    12,
		},
		RecordedDays: 5,
	}
}

func TestHealthIndex_ScreenshotLikeScenario(t *testing.T) {
	idx := computeHealthIndex(buildScreenshotLikeComputation(), "week")
	require.True(t, idx.HasEnoughData)
	assert.GreaterOrEqual(t, idx.OverallScore, 72)
	assert.LessOrEqual(t, idx.OverallScore, 82)
	assert.Equal(t, scoreToLabel(idx.OverallScore), idx.OverallTrendLabel)

	scores := map[string]int{}
	for _, card := range idx.RiskCards {
		scores[card.Key] = card.Score
	}
	assert.InDelta(t, 77, float64(scores["hypertension"]), 4)
	assert.InDelta(t, 79, float64(scores["diabetes"]), 4)
	assert.InDelta(t, 71, float64(scores["cardio"]), 4)
	assert.InDelta(t, 76, float64(scores["weight"]), 4)
}

func TestHealthIndex_IdealDietCanReachHighScore(t *testing.T) {
	idx := computeHealthIndex(buildIdealComputation(), "week")
	require.True(t, idx.HasEnoughData)
	assert.GreaterOrEqual(t, idx.OverallScore, 95)

	for _, card := range idx.RiskCards {
		if card.Key == "hypertension" || card.Key == "diabetes" || card.Key == "cardio" || card.Key == "weight" || card.Key == "micronutrient" {
			assert.GreaterOrEqual(t, card.Score, 95, card.Key)
		}
	}
	assert.True(t, len(idx.AllRiskOptions) > 0 && containsRiskOption(idx.AllRiskOptions, "micronutrient"), "micronutrient option should exist")
}

func containsRiskOption(options []RiskOption, key string) bool {
	for _, o := range options {
		if o.Key == key {
			return true
		}
	}
	return false
}

func TestHealthIndex_InsufficientDataGate(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	comp.RecordedDays = 1
	idx := computeHealthIndex(comp, "week")
	assert.False(t, idx.HasEnoughData)
	assert.Empty(t, idx.RiskCards)
}
