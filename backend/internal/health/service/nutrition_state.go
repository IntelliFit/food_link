package service

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	userdomain "food_link/backend/internal/user/domain"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/logger"
)

// The daily nutrition state (domain.DailyNutritionState) is the one reading of a
// user's diet that the meal Agent, the analysis page, the pet and the record result
// page share. It is built from two weeks of records (this week and the one before,
// for "比上周"), the day's plan targets, weigh-ins, water, exercise and last night's
// sleep. docs/algorithms/daily-nutrition-state.md describes the fields.

var ErrNutritionRecordNotFound = errors.New("nutrition state: record not found")

type nutritionStateInput struct {
	Now          time.Time // the clock, China time
	Date         time.Time // 00:00 China time of the day the state is for
	Profile      *domain.StatsUserProfile
	Records      []domain.FoodRecord // from Date-13 to the end of Date
	Goals        map[string]nutritionGoal
	Body         *BodyMetricsSummary
	Water        map[string]WaterDaily
	Exercise     []domain.ExerciseLog
	Sleep        *domain.SleepRecord
	SleepTracked bool
}

func (in nutritionStateInput) goal() string {
	if in.Profile == nil || in.Profile.DietGoal == nil {
		return ""
	}
	return strings.TrimSpace(*in.Profile.DietGoal)
}

// medical is the conditions the user ticked in the health profile (diabetes, hypertension, ...).
func (in nutritionStateInput) medical() map[string]bool {
	out := map[string]bool{}
	if in.Profile == nil {
		return out
	}
	for _, code := range stringSliceFromCampusDietAny(in.Profile.HealthCondition["medical_history"]) {
		out[strings.TrimSpace(code)] = true
	}
	return out
}

func (in nutritionStateInput) isToday() bool {
	return in.Date.Format("2006-01-02") == in.Now.In(chinaTZ).Format("2006-01-02")
}

func buildDailyNutritionState(in nutritionStateInput) *domain.DailyNutritionState {
	isToday := in.isToday()
	focus := in.focus()
	all := buildNutritionDays(in.Profile, in.Records, in.Date.AddDate(0, 0, -13), in.Date, in.Now, in.Goals)
	lastWeek, week := all[:7], all[7:]
	today := week[len(week)-1]
	waterGoal := 0.0
	waterML := -1.0
	if in.Body != nil {
		waterGoal = float64(in.Body.WaterGoalMl)
		// Someone who never logs water is not told every day that water is short.
		for _, w := range in.Water {
			if w.Total > 0 {
				waterML = float64(in.Water[today.Date].Total)
				break
			}
		}
	}
	readings := nutritionTodayReadings(today, waterML, waterGoal)
	weekView, facts := nutritionWeek(week, lastWeek, in.Water, waterGoal, isToday)
	lastFacts := nutritionFacts(lastWeek, in.Water, waterGoal)
	trend := nutritionWeightTrend(in.Body, in.Date)
	overall, cards := nutritionScores(week, facts, in.goal(), trend)
	lastOverall, _ := nutritionScores(lastWeek, lastFacts, in.goal(), nil)
	headline, findings := nutritionStory(week, facts, lastFacts, readings, trend, in.goal(), focus.Topics)

	state := &domain.DailyNutritionState{
		Date:        today.Date,
		GeneratedAt: in.Now.UTC().Format(time.RFC3339),
		Coverage:    nutritionCoverage(week, today, facts),
		Plan:        nutritionPlanSummary(in, today),
		Today:       readings,
		Gaps:        nutritionFocusGaps(nutritionTodayGaps(readings), focus),
		Week:        weekView,
		Scores:      domain.NutritionScores{Overall: overall, OverallLastWeek: lastOverall, Focus: nutritionFocusCards(cards, focus)},
		Context:     nutritionContext(in, facts, isToday),
		Headline:    headline,
		Findings:    findings,
		Focus:       focus.Choices,
	}
	state.EvidenceGaps = nutritionEvidenceGaps(in, week, facts, isToday)
	if isToday && in.Now.Hour() < 21 {
		state.NextMeal = nutritionNextMeal(nutritionUpcomingMeal(in.Now, today), readings, facts, nutritionPriorities(in.medical(), focus))
	}
	return state
}

// nutritionUpcomingMeal is the meal the clock points at, or the one after it when that
// meal is already recorded (lunch logged at 12:20 makes 13:10 about dinner).
func nutritionUpcomingMeal(now time.Time, today nutritionDay) string {
	order := []string{"breakfast", "lunch", "dinner"}
	meal := inferCampusDietMealType("", now)
	for i, m := range order {
		if m != meal || !today.MealTypes[m] {
			continue
		}
		if i+1 < len(order) {
			return order[i+1]
		}
		return ""
	}
	return meal
}

func nutritionCoverage(week []nutritionDay, today nutritionDay, facts nutritionWeekFacts) domain.NutritionCoverage {
	known, total := 0, 0
	for _, day := range week {
		for _, key := range []string{"fiber", "sodiumMg", "potassiumMg", "saturatedFat", "freeSugar"} {
			if amount, ok := day.Nutrients[key]; ok && day.recorded() {
				known += amount.KnownItems
				total += amount.TotalItems
			}
		}
	}
	completeness := 0.0
	if total > 0 {
		completeness = math.Round(float64(known)/float64(total)*100) / 100
	}
	return domain.NutritionCoverage{RecordedDays: facts.RecordedDays, Meals: facts.Meals, TodayMeals: today.Meals, NutrientCompleteness: completeness, EnoughData: facts.RecordedDays >= 2}
}

func nutritionPlanSummary(in nutritionStateInput, today nutritionDay) domain.NutritionPlanSummary {
	plan := domain.NutritionPlanSummary{Goal: in.goal(), GoalLabel: nutritionGoalLabels[in.goal()], EnergyKcal: math.Round(today.CalorieGoal), ProteinG: math.Round(today.ProteinGoal), Source: "default"}
	if in.Profile != nil {
		if len(mapFromAny(in.Profile.HealthCondition["dashboard_targets"])) > 0 {
			plan.Source = "saved_plan"
		} else if in.Profile.TDEE != nil && *in.Profile.TDEE > 0 {
			plan.Source = "estimate"
		}
	}
	if goal, ok := in.Goals[today.Date]; ok && goal.FromPlan {
		plan.Source = "day_plan"
	}
	return plan
}

// nutritionGoals resolves each day's calorie and protein target: the day's plan when
// one is set, else the saved targets or the estimate from the profile.
func nutritionGoals(profile *domain.StatsUserProfile, plans map[string]userdomain.NutritionDay, from, to time.Time) map[string]nutritionGoal {
	var tdee *float64
	var health map[string]any
	if profile != nil {
		tdee, health = profile.TDEE, profile.HealthCondition
	}
	targets := userservice.ResolveDashboardNutritionTargets(tdee, health)
	goals := map[string]nutritionGoal{}
	for cursor := from; !cursor.After(to); cursor = cursor.AddDate(0, 0, 1) {
		date := cursor.Format("2006-01-02")
		goal := nutritionGoal{Calories: targets["calorie_target"], Protein: targets["protein_target"]}
		if day, ok := plans[date]; ok {
			if v := day.Snapshot.Targets["calorie_target"]; v > 0 {
				goal.Calories, goal.FromPlan = v, true
			}
			if v := day.Snapshot.Targets["protein_target"]; v > 0 {
				goal.Protein = v
			}
		}
		goals[date] = goal
	}
	return goals
}

// SleepReader is the slice of the sleep service the nutrition state reads.
type SleepReader interface {
	Get(ctx context.Context, userID, date string) (*domain.SleepRecord, error)
}

func (s *StatsService) ConfigureSleep(reader SleepReader) { s.sleep = reader }

// loadNutritionStateInput reads everything the state needs for one user and day.
// Optional sources (weigh-ins, water, plans, sleep) that fail are left out and logged;
// the food records and profile are required.
func (s *StatsService) loadNutritionStateInput(ctx context.Context, userID, date string) (nutritionStateInput, error) {
	now := mealClock().In(chinaTZ)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	if strings.TrimSpace(date) != "" {
		parsed, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(date), chinaTZ)
		if err != nil {
			return nutritionStateInput{}, err
		}
		if parsed.After(day) {
			parsed = day
		}
		day = parsed
	}
	from := day.AddDate(0, 0, -13)
	in := nutritionStateInput{Now: now, Date: day, Water: map[string]WaterDaily{}}
	records, err := s.repo.GetFoodRecordsForDateRange(ctx, userID, from.UTC(), day.AddDate(0, 0, 1).UTC())
	if err != nil {
		return in, err
	}
	in.Records = records
	if in.Profile, err = s.repo.GetUserProfile(ctx, userID); err != nil {
		return in, err
	}
	plans := map[string]userdomain.NutritionDay{}
	if s.nutritionPlans != nil {
		if resolved, err := s.nutritionPlans.ResolveRange(ctx, userID, from.Format("2006-01-02"), day.Format("2006-01-02")); err == nil {
			plans = resolved
		} else {
			logger.Warn(ctx, "营养状态读取每日方案失败", logger.UserID(userID), logger.Err(err))
		}
	}
	in.Goals = nutritionGoals(in.Profile, plans, from, day)
	if exercise, err := s.repo.GetExerciseLogsForDateRange(ctx, userID, day.Format("2006-01-02"), day.Format("2006-01-02")); err == nil {
		in.Exercise = exercise
	}
	if s.bodyMetrics != nil {
		// "month" covers both weeks of water; weigh-ins come back for two years regardless.
		if body, err := s.bodyMetrics.GetSummary(ctx, userID, "month"); err == nil && body != nil {
			in.Body = body
			for _, w := range body.WaterDaily {
				in.Water[w.Date] = w
			}
			if body.TodayWater.Date != "" {
				in.Water[body.TodayWater.Date] = body.TodayWater
			}
		} else if err != nil {
			logger.Warn(ctx, "营养状态读取体重喝水失败", logger.UserID(userID), logger.Err(err))
		}
	}
	if s.sleep != nil {
		in.SleepTracked = true
		if record, err := s.sleep.Get(ctx, userID, day.Format("2006-01-02")); err == nil {
			in.Sleep = record
		}
	}
	return in, nil
}

// GetDailyNutritionState is GET /api/health/nutrition-state. date is YYYY-MM-DD or
// empty for today; a future date is read as today.
func (s *StatsService) GetDailyNutritionState(ctx context.Context, userID, date string) (*domain.DailyNutritionState, error) {
	in, err := s.loadNutritionStateInput(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	return buildDailyNutritionState(in), nil
}

// GetMealImpact is GET /api/health/nutrition-state/meal-impact: what one of the
// user's records changed in its day. Records from the last three days are found.
func (s *StatsService) GetMealImpact(ctx context.Context, userID, recordID string) (*domain.MealImpact, error) {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return nil, ErrNutritionRecordNotFound
	}
	now := mealClock().In(chinaTZ)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	records, err := s.repo.GetFoodRecordsForDateRange(ctx, userID, today.AddDate(0, 0, -2).UTC(), today.AddDate(0, 0, 1).UTC())
	if err != nil {
		return nil, err
	}
	var target *domain.FoodRecord
	for i := range records {
		if records[i].ID == recordID && records[i].RecordTime != nil {
			target = &records[i]
		}
	}
	if target == nil {
		return nil, ErrNutritionRecordNotFound
	}
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	local := target.RecordTime.In(chinaTZ)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, chinaTZ)
	plans := map[string]userdomain.NutritionDay{}
	if s.nutritionPlans != nil {
		if resolved, err := s.nutritionPlans.ResolveRange(ctx, userID, day.Format("2006-01-02"), day.Format("2006-01-02")); err == nil {
			plans = resolved
		}
	}
	goal := nutritionGoals(profile, plans, day, day)[day.Format("2006-01-02")]
	return buildMealImpact(profile, records, *target, day, now, goal), nil
}
