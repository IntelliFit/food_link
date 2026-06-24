package service

import (
	"testing"

	"food_link/backend/internal/health/domain"
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

func TestHealthIndex_MuscleGainUsesGoalAdjustedWeightTarget(t *testing.T) {
	goal := "muscle_gain"
	comp := buildScreenshotLikeComputation()
	comp.TDEE = 1693
	comp.StreakDays = 90
	comp.RecordedDays = 7
	comp.TotalCalories = 13496
	comp.AvgCaloriesPerDay = 1928
	comp.DailyCalories = []DailyCalories{
		{Date: "2026-06-17", Calories: 1810},
		{Date: "2026-06-18", Calories: 1880},
		{Date: "2026-06-19", Calories: 1910},
		{Date: "2026-06-20", Calories: 1940},
		{Date: "2026-06-21", Calories: 1960},
		{Date: "2026-06-22", Calories: 1970},
		{Date: "2026-06-23", Calories: 2026},
	}
	comp.User = &domain.StatsUserProfile{DietGoal: &goal}

	idx := computeHealthIndex(comp, "week")
	require.True(t, idx.HasEnoughData)

	var weightCard RiskCard
	for _, card := range idx.RiskCards {
		if card.Key == "weight" {
			weightCard = card
			break
		}
	}
	require.Equal(t, "weight", weightCard.Key)
	assert.Contains(t, weightCard.Brief, "增肌盈余")
	assert.Contains(t, weightCard.Summary, "增肌目标")
	assert.Contains(t, weightCard.Basis, "增肌参考目标")
	assert.Contains(t, weightCard.Basis, "TDEE")
	assert.NotContains(t, weightCard.Action, "减少约 1/4")
	assert.Contains(t, weightCard.Action, "训练日前后")
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
