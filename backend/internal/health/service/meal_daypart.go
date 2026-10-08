package service

import (
	"food_link/backend/internal/health/domain"
	"regexp"
	"strings"
	"time"
)

var breakfastMenuNamePattern = regexp.MustCompile(domain.BreakfastMenuNamePattern)

func mealWeekdayAllowed(now time.Time, c DietRecommendationCandidate) bool {
	known, matches := false, false
	today := strings.ToLower(now.In(chinaTZ).Weekday().String())
	for _, d := range c.AvailableWeekdays {
		switch d {
		case "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday":
			known = true
			matches = matches || d == today
		}
	}
	return !known || matches
}

func historyMealSourceLabel(c DietRecommendationCandidate) string {
	if c.RecordEntryType == "favorite_recipe" {
		return "食谱录入"
	}
	return "饮食记录"
}

// Meal-type matching is contextual suitability, not proof of today's opening
// hours. Breakfast names below are a transparent fallback for unlabelled menus.
func mealDaypartAllowed(mealType string, c DietRecommendationCandidate) bool {
	if mealType == "" {
		return true
	}
	knownPeriod, matches := false, false
	for _, period := range c.MealPeriods {
		if period == "breakfast" || period == "lunch" || period == "dinner" {
			knownPeriod = true
			matches = matches || period == mealType
		}
	}
	if knownPeriod {
		return matches
	}
	if c.Source == "food_record" && c.RecordedMealType != "" {
		if mealType == "breakfast" {
			return c.RecordedMealType == "breakfast"
		}
		if mealType == "lunch" || mealType == "dinner" {
			return c.RecordedMealType == "lunch" || c.RecordedMealType == "dinner"
		}
		return c.RecordedMealType == mealType
	}
	if mealType != "breakfast" {
		return true
	}
	if strings.Contains(c.Title, "午餐") || strings.Contains(c.Title, "晚餐") {
		return false
	}
	if !strings.Contains(c.Title, "早餐") && containsAnyText(c.Title, "饭", "沙拉", "披萨", "火锅") {
		return false
	}
	return breakfastMenuNamePattern.MatchString(c.Title)
}
