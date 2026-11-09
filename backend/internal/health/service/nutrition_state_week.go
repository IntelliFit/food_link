package service

import (
	"food_link/backend/internal/health/domain"
)

// nutritionWeekFacts are the week's counts that other parts (next meal, scores,
// headline) reason with.
type nutritionWeekFacts struct {
	RecordedDays    int
	Meals           int
	FishSoyMeals    int
	WholeGrainMeals int
	SodiumJudged    int
	SodiumOverDays  int
	VegHitDays      int
	FiberHalfDays   int
	FiberJudged     int
	LateMeals       int
	BreakfastDays   int
	WaterJudged     int
	WaterHitDays    int
}

type nutritionHabitSpec struct {
	Key, Label string
	Mark       func(day nutritionDay, water *WaterDaily, waterGoal float64) string
}

// A day the habit cannot be judged on (no record, or the nutrient is unknown) is "none".
var nutritionHabitSpecs = []nutritionHabitSpec{
	{Key: "vegetables", Label: "蔬菜够 300 克", Mark: func(day nutritionDay, _ *WaterDaily, _ float64) string {
		if !day.recorded() {
			return domain.HabitMarkNone
		}
		return nutritionMark(day.VegGrams >= nutritionVegetableTarget)
	}},
	{Key: "fiber_half", Label: "纤维过一半", Mark: func(day nutritionDay, _ *WaterDaily, _ float64) string {
		rule, ok := day.rule("fiber")
		value, _, known := day.known("fiber")
		if !day.recorded() || !ok || !known || rule.Target <= 0 {
			return domain.HabitMarkNone
		}
		return nutritionMark(value >= rule.Target/2)
	}},
	{Key: "sodium", Label: "钠没超上限", Mark: func(day nutritionDay, _ *WaterDaily, _ float64) string {
		rule, ok := day.rule("sodiumMg")
		value, complete, known := day.known("sodiumMg")
		if !day.recorded() || !ok || !known || rule.Limit <= 0 {
			return domain.HabitMarkNone
		}
		if value > rule.Limit {
			return domain.HabitMarkMiss
		}
		if !complete {
			return domain.HabitMarkNone
		}
		return domain.HabitMarkHit
	}},
	{Key: "protein", Label: "蛋白质够量", Mark: func(day nutritionDay, _ *WaterDaily, _ float64) string {
		if !day.recorded() || day.ProteinGoal <= 0 {
			return domain.HabitMarkNone
		}
		return nutritionMark(day.Protein >= day.ProteinGoal*.9)
	}},
	{Key: "water", Label: "喝水够量", Mark: func(_ nutritionDay, water *WaterDaily, goal float64) string {
		if water == nil || water.Total <= 0 || goal <= 0 {
			return domain.HabitMarkNone
		}
		return nutritionMark(float64(water.Total) >= goal)
	}},
}

func nutritionMark(hit bool) string {
	if hit {
		return domain.HabitMarkHit
	}
	return domain.HabitMarkMiss
}

// nutritionWeek builds the 7-day view ending on the state's day. While that day is
// today and a floor habit is not reached yet, its mark is "today", not a miss.
func nutritionWeek(days, lastWeek []nutritionDay, water map[string]WaterDaily, waterGoal float64, isToday bool) (domain.NutritionWeek, nutritionWeekFacts) {
	week := domain.NutritionWeek{Days: []string{}, Habits: []domain.NutritionHabit{}, Counts: []domain.NutritionCount{}, VsLastWeek: []domain.NutritionWeekDelta{}}
	for _, day := range days {
		week.Days = append(week.Days, day.Date)
	}
	for _, spec := range nutritionHabitSpecs {
		habit := domain.NutritionHabit{Key: spec.Key, Label: spec.Label, Marks: []string{}}
		judged := false
		for i, day := range days {
			w := nutritionWaterDay(water, day.Date)
			mark := spec.Mark(day, w, waterGoal)
			// Today is still going: a floor reached counts, a ceiling broken counts,
			// anything else is not decided yet.
			if isToday && i == len(days)-1 {
				ceiling := spec.Key == "sodium"
				if ceiling && mark != domain.HabitMarkMiss || !ceiling && mark != domain.HabitMarkHit {
					mark = domain.HabitMarkToday
				}
			}
			habit.Marks = append(habit.Marks, mark)
			switch mark {
			case domain.HabitMarkHit:
				habit.Hit++
				habit.Of++
				judged = true
			case domain.HabitMarkMiss:
				habit.Of++
				judged = true
			}
		}
		if judged {
			week.Habits = append(week.Habits, habit)
		}
	}
	facts := nutritionFacts(days, water, waterGoal)
	week.Counts = append(week.Counts,
		domain.NutritionCount{Key: "fish_soy", Label: "鱼或豆制品", Value: float64(facts.FishSoyMeals), Target: 3, Unit: "次"},
		domain.NutritionCount{Key: "whole_grains", Label: "全谷物", Value: float64(facts.WholeGrainMeals), Target: 3, Unit: "次"},
	)
	last := nutritionFacts(lastWeek, water, waterGoal)
	if facts.RecordedDays >= 2 && last.RecordedDays >= 2 {
		week.VsLastWeek = append(week.VsLastWeek,
			domain.NutritionWeekDelta{Key: "vegetables", Label: "蔬菜够量", Last: float64(last.VegHitDays), This: float64(facts.VegHitDays), Unit: "天", Better: facts.VegHitDays > last.VegHitDays},
			domain.NutritionWeekDelta{Key: "fish_soy", Label: "鱼或豆制品", Last: float64(last.FishSoyMeals), This: float64(facts.FishSoyMeals), Unit: "次", Better: facts.FishSoyMeals > last.FishSoyMeals},
			domain.NutritionWeekDelta{Key: "whole_grains", Label: "全谷物", Last: float64(last.WholeGrainMeals), This: float64(facts.WholeGrainMeals), Unit: "次", Better: facts.WholeGrainMeals > last.WholeGrainMeals},
		)
		if facts.SodiumJudged > 0 && last.SodiumJudged > 0 {
			week.VsLastWeek = append(week.VsLastWeek, domain.NutritionWeekDelta{Key: "sodium", Label: "钠超标", Last: float64(last.SodiumOverDays), This: float64(facts.SodiumOverDays), Unit: "天", Better: facts.SodiumOverDays < last.SodiumOverDays})
		}
	}
	return week, facts
}

func nutritionWaterDay(water map[string]WaterDaily, date string) *WaterDaily {
	if w, ok := water[date]; ok {
		return &w
	}
	return nil
}

func nutritionFacts(days []nutritionDay, water map[string]WaterDaily, waterGoal float64) nutritionWeekFacts {
	f := nutritionWeekFacts{}
	for _, day := range days {
		if w := nutritionWaterDay(water, day.Date); w != nil && w.Total > 0 && waterGoal > 0 {
			f.WaterJudged++
			if float64(w.Total) >= waterGoal {
				f.WaterHitDays++
			}
		}
		if !day.recorded() {
			continue
		}
		f.RecordedDays++
		f.Meals += day.Meals
		f.FishSoyMeals += day.GroupMeals["fish_soy"]
		f.WholeGrainMeals += day.GroupMeals["whole_grains"]
		f.LateMeals += day.LateMeals
		if day.Breakfast {
			f.BreakfastDays++
		}
		if day.VegGrams >= nutritionVegetableTarget {
			f.VegHitDays++
		}
		if rule, ok := day.rule("sodiumMg"); ok && rule.Limit > 0 {
			value, complete, known := day.known("sodiumMg")
			if known && value > rule.Limit {
				f.SodiumJudged++
				f.SodiumOverDays++
			} else if complete {
				f.SodiumJudged++
			}
		}
		if rule, ok := day.rule("fiber"); ok && rule.Target > 0 {
			if value, _, known := day.known("fiber"); known {
				f.FiberJudged++
				if value >= rule.Target/2 {
					f.FiberHalfDays++
				}
			}
		}
	}
	return f
}
