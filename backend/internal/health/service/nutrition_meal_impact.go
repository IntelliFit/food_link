package service

import (
	"fmt"
	"math"
	"time"

	"food_link/backend/internal/health/domain"
)

// buildMealImpact compares the record's day with and without the record. The other
// records of the day count as "before" whatever their time, so editing an earlier
// meal still shows what that meal contributes.
func buildMealImpact(profile *domain.StatsUserProfile, records []domain.FoodRecord, target domain.FoodRecord, day, now time.Time, goal nutritionGoal) *domain.MealImpact {
	date := day.Format("2006-01-02")
	dayEnd := day.Add(24*time.Hour - time.Second)
	if dayEnd.After(now) {
		dayEnd = now
	}
	// The record itself may be stamped a moment after the clock; keep it in its day.
	if target.RecordTime.After(dayEnd) {
		dayEnd = target.RecordTime.Add(time.Second)
	}
	others, with := []domain.FoodRecord{}, []domain.FoodRecord{}
	for _, record := range records {
		if record.RecordTime == nil || record.RecordTime.In(chinaTZ).Format("2006-01-02") != date || record.RecordTime.After(dayEnd) {
			continue
		}
		with = append(with, record)
		if record.ID != target.ID {
			others = append(others, record)
		}
	}
	before := nutritionTodayReadings(buildNutritionDay(profile, date, others, dayEnd, goal), -1, 0)
	after := nutritionTodayReadings(buildNutritionDay(profile, date, with, dayEnd, goal), -1, 0)
	beforeByKey := map[string]domain.NutrientReading{}
	for _, r := range before {
		beforeByKey[r.Key] = r
	}
	impact := &domain.MealImpact{RecordID: target.ID, Date: date, MealType: target.MealType, Changes: []domain.MealImpactChange{}}
	for _, r := range after {
		b := beforeByKey[r.Key]
		change := domain.MealImpactChange{Key: r.Key, Label: r.Label, Unit: r.Unit, Before: b.Value, After: r.Value, Target: r.Target, Kind: r.Kind, Status: r.Status}
		if len(others) == 0 && change.Before == nil && change.After != nil {
			zero := 0.0
			change.Before = &zero
		}
		if change.Before != nil && change.After != nil {
			delta := math.Round(*change.After - *change.Before)
			change.Delta = &delta
		}
		impact.Changes = append(impact.Changes, change)
	}
	impact.Headline = mealImpactHeadline(impact.Changes)
	return impact
}

// mealImpactHeadline names the change that matters most: a ceiling this meal pushed
// over or close, else the floor it moved furthest, else the day's energy.
func mealImpactHeadline(changes []domain.MealImpactChange) string {
	for _, c := range changes {
		if c.Kind != "max" || c.Delta == nil || *c.Delta <= 0 {
			continue
		}
		switch c.Status {
		case domain.NutrientStatusOver:
			return fmt.Sprintf("这一餐%s +%s%s，今天已经超过上限了", c.Label, formatCampusDietNumber(*c.Delta), nutritionUnitWord(c.Unit))
		case domain.NutrientStatusNearLimit:
			return fmt.Sprintf("这一餐%s +%s%s，今天快到上限了", c.Label, formatCampusDietNumber(*c.Delta), nutritionUnitWord(c.Unit))
		}
	}
	var best *domain.MealImpactChange
	bestShare := 0.0
	for i, c := range changes {
		if c.Kind != "min" || c.Delta == nil || *c.Delta <= 0 || c.Target <= 0 || c.Key == "water" {
			continue
		}
		if share := *c.Delta / c.Target; share > bestShare {
			best, bestShare = &changes[i], share
		}
	}
	if best != nil {
		if best.Status == domain.NutrientStatusOK {
			return fmt.Sprintf("这一餐让%s +%s%s，今天的%s够了", best.Label, formatCampusDietNumber(*best.Delta), nutritionUnitWord(best.Unit), best.Label)
		}
		return fmt.Sprintf("这一餐让%s +%s%s，今天还差 %s%s", best.Label, formatCampusDietNumber(*best.Delta), nutritionUnitWord(best.Unit), formatCampusDietNumber(best.Target-*best.After), nutritionUnitWord(best.Unit))
	}
	for _, c := range changes {
		if c.Key == "energy" && c.After != nil {
			return fmt.Sprintf("这一餐记上了：今天热量 %s / %s 千卡", formatCampusDietNumber(*c.After), formatCampusDietNumber(c.Target))
		}
	}
	return "这一餐记上了"
}
