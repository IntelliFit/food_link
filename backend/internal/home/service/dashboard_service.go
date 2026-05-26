package service

import (
	"context"
	"math"
	"slices"
	"strings"
	"time"

	userrepo "food_link/backend/internal/auth/repo"
	homerepo "food_link/backend/internal/home/repo"
	usersvc "food_link/backend/internal/user/service"
	"food_link/backend/pkg/storage"
)

var mealDisplayOrder = []string{"breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack"}
var mealNames = map[string]string{
	"breakfast":       "早餐",
	"morning_snack":   "早加餐",
	"lunch":           "午餐",
	"afternoon_snack": "午加餐",
	"dinner":          "晚餐",
	"evening_snack":   "晚加餐",
	"snack":           "午加餐",
}
var mealWeights = map[string]float64{"breakfast": 3, "lunch": 4, "dinner": 3}

type DashboardService struct {
	users   *userrepo.UserRepo
	home    *homerepo.HomeRepo
	storage *storage.Client
}

func NewDashboardService(users *userrepo.UserRepo, home *homerepo.HomeRepo, storageClient ...*storage.Client) *DashboardService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &DashboardService{users: users, home: home, storage: client}
}

func (s *DashboardService) HomeDashboard(ctx context.Context, userID, date string) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	records, err := s.home.ListFoodRecordsByDate(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	expiryItems, err := s.home.ListExpiryItems(ctx, userID)
	if err != nil {
		return nil, err
	}
	exerciseBurned, err := s.home.GetExerciseBurned(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	calibrationSuggestion := s.calibrationSuggestion(ctx, userID, user, date)
	targetPlan := buildNutritionTargetPlan(user, date, exerciseBurned, nil)
	targetPlan.CalibrationSuggestion = calibrationSuggestion
	targets := targetPlan.Targets
	totalCal, totalProtein, totalCarbs, totalFat := 0.0, 0.0, 0.0, 0.0
	byMeal := map[string][]homerepo.FoodRecord{}
	for _, record := range records {
		totalCal += record.TotalCalories
		totalProtein += record.TotalProtein
		totalCarbs += record.TotalCarbs
		totalFat += record.TotalFat
		mt := normalizeMealType(record.MealType, record.RecordTime)
		byMeal[mt] = append(byMeal[mt], record)
	}

	meals := make([]map[string]any, 0)
	mealTargets := buildMealTargets(targets["calorie_target"])
	for _, mealType := range mealDisplayOrder {
		items := byMeal[mealType]
		if len(items) == 0 {
			continue
		}
		meal := s.buildMealItem(mealType, items, mealTargets[mealType])
		meals = append(meals, meal)
	}

	progress := 0.0
	if targets["calorie_target"] > 0 {
		progress = math.Min(100.0, round1(totalCal/targets["calorie_target"]*100))
	}

	return map[string]any{
		"intakeData": map[string]any{
			"current":  round1(totalCal),
			"target":   round1(targets["calorie_target"]),
			"progress": progress,
			"macros": map[string]any{
				"protein": map[string]any{"current": round1(totalProtein), "target": targets["protein_target"]},
				"carbs":   map[string]any{"current": round1(totalCarbs), "target": targets["carbs_target"]},
				"fat":     map[string]any{"current": round1(totalFat), "target": targets["fat_target"]},
			},
		},
		"meals":              meals,
		"expirySummary":      buildExpirySummary(expiryItems),
		"exerciseBurnedKcal": round1(float64(exerciseBurned)),
		"nutritionTarget":    targetPlan.Response(),
	}, nil
}

func (s *DashboardService) exerciseHistory(ctx context.Context, userID, date string) (map[string]int, error) {
	parsed, err := time.ParseInLocation("2006-01-02", date, homerepo.ChinaTZ())
	if err != nil {
		parsed = time.Now().In(homerepo.ChinaTZ())
	}
	endDate := parsed.Format("2006-01-02")
	startDate := parsed.AddDate(0, 0, -13).Format("2006-01-02")
	return s.home.ListExerciseBurnedByDateRange(ctx, userID, startDate, endDate)
}

func (s *DashboardService) calibrationSuggestion(ctx context.Context, userID string, user *userrepo.User, date string) *targetCalibrationSuggestion {
	if user == nil || s.home == nil {
		return nil
	}
	targets, source := dashboardTargetsWithSource(user)
	currentTarget := targets["calorie_target"]
	if currentTarget <= 0 || !targetEligibleForCalibration(user, date) {
		return nil
	}
	parsed, err := time.ParseInLocation("2006-01-02", date, homerepo.ChinaTZ())
	if err != nil {
		parsed = time.Now().In(homerepo.ChinaTZ())
	}
	startDate := parsed.AddDate(0, 0, -13).Format("2006-01-02")
	endDate := parsed.Format("2006-01-02")
	foodDays, err := s.home.CountFoodRecordDaysByDateRange(ctx, userID, startDate, endDate)
	if err != nil || foodDays < 7 {
		return nil
	}
	weights, err := s.home.ListWeightRecordsByDateRange(ctx, userID, startDate, endDate)
	if err != nil || len(weights) < 2 {
		return nil
	}
	first := weights[0]
	last := weights[len(weights)-1]
	if first.RecordedOn == nil || last.RecordedOn == nil {
		return nil
	}
	daysBetween := int(last.RecordedOn.In(homerepo.ChinaTZ()).Sub(first.RecordedOn.In(homerepo.ChinaTZ())).Hours() / 24)
	if daysBetween < 7 {
		return nil
	}
	weightDelta := last.WeightKg - first.WeightKg
	dietGoal := userDietGoal(user)
	delta := recommendedCalibrationDelta(dietGoal, weightDelta)
	if delta == 0 {
		return nil
	}
	suggested := roundToNearest10(clampFloat(currentTarget+delta, 900, 5000))
	if suggested == currentTarget {
		return nil
	}
	return &targetCalibrationSuggestion{
		Available:      true,
		SuggestedKcal:  suggested,
		CurrentKcal:    round1(currentTarget),
		DeltaKcal:      round1(suggested - currentTarget),
		Reason:         calibrationReason(dietGoal, weightDelta),
		FoodRecordDays: int(foodDays),
		WeightRecords:  len(weights),
		Source:         source,
	}
}

func (s *DashboardService) PosterCalorieCompare(ctx context.Context, userID, recordID string) (map[string]any, error) {
	record, err := s.home.GetFoodRecordByID(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if record == nil || record.UserID != userID {
		return nil, nil
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	targetDate := time.Now().In(homerepo.ChinaTZ()).Format("2006-01-02")
	if record.RecordTime != nil {
		targetDate = record.RecordTime.In(homerepo.ChinaTZ()).Format("2006-01-02")
	}
	records, err := s.home.ListFoodRecordsByDate(ctx, userID, targetDate)
	if err != nil {
		return nil, err
	}
	mealType := normalizeMealType(record.MealType, record.RecordTime)
	targetPlan := buildNutritionTargetPlan(user, targetDate, 0, nil)
	targets := buildMealTargets(targetPlan.Targets["calorie_target"])
	baselineDate := previousChinaDate(targetDate)
	baselineRows, err := s.home.ListFoodRecordsByDate(ctx, userID, baselineDate)
	if err != nil {
		return nil, err
	}
	currentKcal := round1(record.TotalCalories)
	baselineKcal := 0.0
	hasBaseline := false
	for _, row := range baselineRows {
		if normalizeMealType(row.MealType, row.RecordTime) == mealType {
			baselineKcal += row.TotalCalories
			hasBaseline = true
		}
	}
	_ = records
	return map[string]any{
		"has_baseline":   hasBaseline,
		"baseline_kcal":  round1(baselineKcal),
		"delta_kcal":     round1(currentKcal - baselineKcal),
		"current_kcal":   currentKcal,
		"meal_plan_kcal": round1(targets[mealType]),
	}, nil
}

type nutritionTargetPlan struct {
	Targets               map[string]float64
	BaseCalorieTarget     float64
	SuggestedCalorie      float64
	TodayExerciseKcal     float64
	ExerciseAddedKcal     float64
	ExerciseSurplusKcal   float64
	ExerciseThresholdKcal float64
	RecentExerciseAvg     float64
	RecentExerciseDays    int
	ActivityMultiplier    float64
	TargetSource          string
	DietGoal              string
	Explanation           string
	MacroExplanation      string
	CalibrationSuggestion *targetCalibrationSuggestion
}

type targetCalibrationSuggestion struct {
	Available      bool    `json:"available"`
	SuggestedKcal  float64 `json:"suggested_kcal"`
	CurrentKcal    float64 `json:"current_kcal"`
	DeltaKcal      float64 `json:"delta_kcal"`
	Reason         string  `json:"reason"`
	FoodRecordDays int     `json:"food_record_days"`
	WeightRecords  int     `json:"weight_records"`
	Source         string  `json:"source"`
}

func (p nutritionTargetPlan) Response() map[string]any {
	return map[string]any{
		"source":                   p.TargetSource,
		"diet_goal":                p.DietGoal,
		"base_calorie_target":      round1(p.BaseCalorieTarget),
		"suggested_calorie_target": round1(p.SuggestedCalorie),
		"today_exercise_kcal":      round1(p.TodayExerciseKcal),
		"exercise_added_kcal":      round1(p.ExerciseAddedKcal),
		"exercise_surplus_kcal":    round1(p.ExerciseSurplusKcal),
		"exercise_threshold_kcal":  round1(p.ExerciseThresholdKcal),
		"recent_exercise_avg_kcal": round1(p.RecentExerciseAvg),
		"recent_exercise_days":     p.RecentExerciseDays,
		"activity_multiplier":      round1(p.ActivityMultiplier),
		"explanation":              p.Explanation,
		"macro_explanation":        p.MacroExplanation,
		"calibration_suggestion":   p.CalibrationSuggestion,
	}
}

func buildNutritionTargetPlan(user *userrepo.User, date string, todayExerciseKcal int, exerciseHistory map[string]int) nutritionTargetPlan {
	targets, source := dashboardTargetsWithSource(user)
	plan := nutritionTargetPlan{
		Targets:            targets,
		BaseCalorieTarget:  targets["calorie_target"],
		SuggestedCalorie:   targets["calorie_target"],
		TodayExerciseKcal:  float64(todayExerciseKcal),
		TargetSource:       source,
		DietGoal:           userDietGoal(user),
		ActivityMultiplier: userDailyLifeActivityMultiplier(user),
	}
	_ = date
	_ = exerciseHistory
	if source == "manual" {
		plan.Explanation = "使用你手动保存的长期基础目标。"
		plan.MacroExplanation = "三大营养素沿用自定义目标。"
		return plan
	}
	if source == "system_initial" {
		plan.Explanation = "使用注册健康档案后生成的长期基础目标。"
		plan.MacroExplanation = "三大营养素按体重和饮食目标分配；目标不会因当天运动自动变化。"
		return plan
	}
	if source == "profile" {
		plan.Explanation = "使用健康档案估算的长期基础目标。"
		plan.MacroExplanation = "三大营养素按体重和饮食目标分配；目标不会因当天运动自动变化。"
		return plan
	}

	base := baseCalorieTarget(user)
	base = applyDietGoalCalorieAdjustment(base, plan.DietGoal)
	suggested := roundToNearest10(clampFloat(base, 900, 5000))
	macros := distributeMacroTargets(suggested, userWeightKg(user), plan.DietGoal, 0)

	plan.Targets = map[string]float64{
		"calorie_target": round1(suggested),
		"protein_target": round1(macros["protein"]),
		"carbs_target":   round1(macros["carbs"]),
		"fat_target":     round1(macros["fat"]),
	}
	plan.BaseCalorieTarget = round1(base)
	plan.SuggestedCalorie = round1(suggested)
	plan.TargetSource = "dynamic"
	plan.Explanation = buildTargetExplanation(plan)
	plan.MacroExplanation = "蛋白按体重和目标保持稳定，脂肪保留健康下限，其余热量分配给碳水。"
	return plan
}

func dashboardTargets(user *userrepo.User) map[string]float64 {
	targets, _ := dashboardTargetsWithSource(user)
	return targets
}

func dashboardTargetsWithSource(user *userrepo.User) (map[string]float64, string) {
	targets := map[string]float64{
		"calorie_target": 2000,
		"protein_target": 120,
		"carbs_target":   250,
		"fat_target":     65,
	}
	if user == nil {
		return targets, "default"
	}
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		if user.TDEE != nil && *user.TDEE > 0 {
			targets["calorie_target"] = round1(*user.TDEE)
			return targets, "profile"
		}
		return targets, "default"
	}
	if value, _ := healthCondition["dashboard_targets_mode"].(string); value == "manual" || value == "system_initial" {
		dashboard := dashboardTargetMap(healthCondition["dashboard_targets"])
		hasManual := false
		for _, key := range []string{"calorie_target", "protein_target", "carbs_target", "fat_target"} {
			if val, ok := dashboard[key]; ok {
				if num, ok := toFloat64(val); ok && num > 0 {
					targets[key] = num
					hasManual = true
				}
			}
		}
		if hasManual {
			if value == "system_initial" {
				return targets, "system_initial"
			}
			return targets, "manual"
		}
	}
	if user.TDEE != nil && *user.TDEE > 0 {
		targets["calorie_target"] = round1(*user.TDEE)
		return targets, "profile"
	}
	return targets, "default"
}

func dashboardTargetMap(raw any) map[string]any {
	switch value := raw.(type) {
	case map[string]any:
		return value
	case map[string]float64:
		out := make(map[string]any, len(value))
		for key, val := range value {
			out[key] = val
		}
		return out
	default:
		return map[string]any{}
	}
}

func baseCalorieTarget(user *userrepo.User) float64 {
	weight := userWeightKg(user)
	if weight <= 0 {
		weight = 60
	}
	gender := ""
	if user != nil && user.Gender != nil {
		gender = *user.Gender
	}
	bmr := calculateBMRForHome(gender, weight)
	if user != nil && user.BMR != nil && *user.BMR > 0 {
		bmr = *user.BMR
	}
	return bmr * userDailyLifeActivityMultiplier(user)
}

func applyDietGoalCalorieAdjustment(tdee float64, goal string) float64 {
	switch goal {
	case "fat_loss":
		return tdee - clampFloat(tdee*0.16, 250, 500)
	case "muscle_gain":
		return tdee + clampFloat(tdee*0.10, 150, 300)
	default:
		return tdee
	}
}

func distributeMacroTargets(calorieTarget, weightKg float64, goal string, exerciseAdded float64) map[string]float64 {
	if weightKg <= 0 {
		weightKg = 60
	}
	proteinPerKg := 1.5
	switch goal {
	case "fat_loss":
		proteinPerKg = 1.8
	case "muscle_gain":
		proteinPerKg = 1.8
	}
	protein := clampFloat(weightKg*proteinPerKg, 60, 220)
	fat := clampFloat(weightKg*0.8, 40, calorieTarget*0.3/9)
	if goal == "fat_loss" {
		fat = clampFloat(weightKg*0.7, 35, calorieTarget*0.28/9)
	}
	remaining := calorieTarget - protein*4 - fat*9
	if remaining < calorieTarget*0.25 {
		fat = clampFloat((calorieTarget-protein*4-calorieTarget*0.25)/9, 35, fat)
		remaining = calorieTarget - protein*4 - fat*9
	}
	carbs := math.Max(0, remaining/4)
	if exerciseAdded > 0 {
		carbs = carbs + math.Min(exerciseAdded*0.2/4, 25)
	}
	return map[string]float64{"protein": protein, "carbs": carbs, "fat": fat}
}

func userDailyLifeActivityMultiplier(user *userrepo.User) float64 {
	return usersvc.DailyLifeActivityMultiplier(userDailyLifeActivityLevel(user))
}

func userDailyLifeActivityLevel(user *userrepo.User) string {
	if user != nil && user.HealthCondition != nil {
		if value, ok := user.HealthCondition["daily_life_activity_level"].(string); ok && strings.TrimSpace(value) != "" {
			return usersvc.NormalizeDailyLifeActivityLevel(value)
		}
	}
	if user != nil && user.ActivityLevel != nil {
		return usersvc.NormalizeDailyLifeActivityLevel(*user.ActivityLevel)
	}
	return "sedentary"
}

func userDietGoal(user *userrepo.User) string {
	if user == nil || user.DietGoal == nil {
		return "maintain"
	}
	goal := strings.TrimSpace(*user.DietGoal)
	if goal == "" || goal == "none" {
		return "maintain"
	}
	return goal
}

func userWeightKg(user *userrepo.User) float64 {
	if user != nil && user.Weight != nil && *user.Weight > 0 {
		return *user.Weight
	}
	return 60
}

func calculateBMRForHome(gender string, weightKg float64) float64 {
	if gender == "male" {
		return math.Max(0, (48.5*weightKg+2954.7)/4.184)
	}
	return math.Max(0, (41.9*weightKg+2869.1)/4.184)
}

func buildTargetExplanation(plan nutritionTargetPlan) string {
	parts := []string{}
	switch plan.DietGoal {
	case "fat_loss":
		parts = append(parts, "已在日常消耗基础上保留温和热量缺口")
	case "muscle_gain":
		parts = append(parts, "已在日常消耗基础上增加少量盈余")
	default:
		parts = append(parts, "按维持体重目标估算基础摄入")
	}
	parts = append(parts, "目标作为长期基础值保持稳定，不随当天运动自动变化")
	return strings.Join(parts, "；") + "。"
}

func targetEligibleForCalibration(user *userrepo.User, date string) bool {
	if user == nil {
		return false
	}
	lastUpdated := dashboardTargetsUpdatedAt(user)
	if lastUpdated.IsZero() {
		if user.CreatedAt == nil {
			return false
		}
		lastUpdated = *user.CreatedAt
	}
	parsed, err := time.ParseInLocation("2006-01-02", date, homerepo.ChinaTZ())
	if err != nil {
		parsed = time.Now().In(homerepo.ChinaTZ())
	}
	return parsed.Sub(lastUpdated.In(homerepo.ChinaTZ())) >= 14*24*time.Hour
}

func dashboardTargetsUpdatedAt(user *userrepo.User) time.Time {
	if user == nil || user.HealthCondition == nil {
		return time.Time{}
	}
	raw, _ := user.HealthCondition["dashboard_targets_updated_at"].(string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	if t, err := time.ParseInLocation("2006-01-02", raw, homerepo.ChinaTZ()); err == nil {
		return t
	}
	return time.Time{}
}

func recommendedCalibrationDelta(goal string, weightDelta float64) float64 {
	switch goal {
	case "fat_loss":
		if weightDelta >= -0.2 {
			return -100
		}
		if weightDelta <= -1.5 {
			return 100
		}
	case "muscle_gain":
		if weightDelta <= 0.1 {
			return 100
		}
		if weightDelta >= 1.2 {
			return -100
		}
	default:
		if weightDelta >= 1.0 {
			return -100
		}
		if weightDelta <= -1.0 {
			return 100
		}
	}
	return 0
}

func calibrationReason(goal string, weightDelta float64) string {
	switch goal {
	case "fat_loss":
		if weightDelta >= -0.2 {
			return "最近14天体重下降不明显，建议小幅降低基础目标。"
		}
		return "最近14天体重下降较快，建议小幅提高基础目标。"
	case "muscle_gain":
		if weightDelta <= 0.1 {
			return "最近14天体重增长不明显，建议小幅提高基础目标。"
		}
		return "最近14天体重增长较快，建议小幅降低基础目标。"
	default:
		if weightDelta >= 1.0 {
			return "最近14天体重有上升趋势，建议小幅降低基础目标。"
		}
		return "最近14天体重有下降趋势，建议小幅提高基础目标。"
	}
}

func roundToNearest10(value float64) float64 {
	return math.Round(value/10) * 10
}

func clampFloat(value, min, max float64) float64 {
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

func buildMealTargets(calorieTarget float64) map[string]float64 {
	out := map[string]float64{}
	totalWeight := 0.0
	for _, weight := range mealWeights {
		totalWeight += weight
	}
	remaining := calorieTarget
	mainMeals := []string{"breakfast", "lunch", "dinner"}
	for _, mealType := range mainMeals[:2] {
		portion := round1(calorieTarget * mealWeights[mealType] / totalWeight)
		out[mealType] = portion
		remaining = round1(remaining - portion)
	}
	out["dinner"] = round1(remaining)
	out["morning_snack"] = 150.0
	out["afternoon_snack"] = 150.0
	out["evening_snack"] = 150.0
	return out
}

func normalizeMealType(mealType string, recordTime *time.Time) string {
	mealType = strings.TrimSpace(mealType)
	if slices.Contains(mealDisplayOrder, mealType) {
		return mealType
	}
	if mealType == "snack" {
		if recordTime != nil {
			hour := recordTime.In(homerepo.ChinaTZ()).Hour()
			if hour < 17 {
				return "afternoon_snack"
			}
		}
		return "evening_snack"
	}
	return "afternoon_snack"
}

func (s *DashboardService) buildMealItem(mealType string, records []homerepo.FoodRecord, mealTarget float64) map[string]any {
	mealCal, mealProtein, mealCarbs, mealFat, mealWater := 0.0, 0.0, 0.0, 0.0, 0.0
	imagePaths := make([]string, 0)
	seen := map[string]bool{}
	entries := make([]map[string]any, 0, len(records))
	var primaryRecordID string
	timeLabel := "00:00"
	for idx, record := range records {
		if idx == 0 {
			primaryRecordID = record.ID
			if record.RecordTime != nil {
				timeLabel = record.RecordTime.In(homerepo.ChinaTZ()).Format("15:04")
			}
		}
		recordWater := totalFoodRecordWaterMl(record.Items)
		recordRatio := foodRecordIntakeRatio(record.Items)
		mealCal += record.TotalCalories
		mealProtein += record.TotalProtein
		mealCarbs += record.TotalCarbs
		mealFat += record.TotalFat
		mealWater += recordWater
		recordImagePaths := make([]string, 0)
		recordSeen := map[string]bool{}
		for _, imagePath := range record.ImagePaths {
			imagePath = s.resolveFoodImageURL(imagePath)
			if imagePath != "" && !seen[imagePath] {
				imagePaths = append(imagePaths, imagePath)
				seen[imagePath] = true
			}
			if imagePath != "" && !recordSeen[imagePath] {
				recordImagePaths = append(recordImagePaths, imagePath)
				recordSeen[imagePath] = true
			}
		}
		if record.ImagePath != nil {
			resolved := s.resolveFoodImageURL(*record.ImagePath)
			if resolved != "" && !seen[resolved] {
				imagePaths = append(imagePaths, resolved)
				seen[resolved] = true
			}
			if resolved != "" && !recordSeen[resolved] {
				recordImagePaths = append(recordImagePaths, resolved)
				recordSeen[resolved] = true
			}
		}
		title := ""
		if len(record.Items) > 0 {
			if name, _ := record.Items[0]["name"].(string); name != "" {
				title = name
			}
		}
		if title == "" && record.Description != nil {
			title = strings.Split(strings.TrimSpace(*record.Description), "\n")[0]
		}
		entries = append(entries, map[string]any{
			"id":             record.ID,
			"record_time":    record.RecordTime,
			"total_calories": round1(record.TotalCalories),
			"total_protein":  round1(record.TotalProtein),
			"total_carbs":    round1(record.TotalCarbs),
			"total_fat":      round1(record.TotalFat),
			"water_ml":       round1(recordWater),
			"intake_ratio":   round1(recordRatio),
			"title":          title,
			"image_path":     firstOrNil(recordImagePaths),
			"image_paths":    recordImagePaths,
			"full_record":    record,
		})
	}
	progress := 0.0
	if mealTarget > 0 {
		progress = round1(mealCal / mealTarget * 100)
	}
	tags := []string{}
	if strings.Contains(mealType, "snack") {
		tags = append(tags, "加餐参考，不计入总目标")
	}
	titles := make([]string, 0, len(entries))
	for _, entry := range entries {
		if title, _ := entry["title"].(string); title != "" {
			titles = append(titles, title)
		}
	}
	return map[string]any{
		"type":                mealType,
		"name":                mealNames[mealType],
		"time":                timeLabel,
		"calorie":             round1(mealCal),
		"protein":             round1(mealProtein),
		"carbs":               round1(mealCarbs),
		"fat":                 round1(mealFat),
		"water_ml":            round1(mealWater),
		"intake_ratio":        round1(foodRecordIntakeRatioFromRecords(records)),
		"target":              round1(mealTarget),
		"progress":            progress,
		"tags":                tags,
		"image_path":          firstOrNil(imagePaths),
		"image_paths":         imagePaths,
		"primary_record_id":   primaryRecordID,
		"description":         strings.Join(titles, "、"),
		"meal_record_entries": entries,
	}
}

func foodRecordIntakeRatioFromRecords(records []homerepo.FoodRecord) float64 {
	totalWeight, totalIntake := 0.0, 0.0
	for _, record := range records {
		weight, intake := foodItemsWeightAndIntake(record.Items)
		totalWeight += weight
		totalIntake += intake
	}
	if totalWeight <= 0 {
		return 100
	}
	return totalIntake / totalWeight * 100
}

func foodRecordIntakeRatio(items []map[string]any) float64 {
	weight, intake := foodItemsWeightAndIntake(items)
	if weight <= 0 {
		return 100
	}
	return intake / weight * 100
}

func foodItemsWeightAndIntake(items []map[string]any) (float64, float64) {
	totalWeight, totalIntake := 0.0, 0.0
	for _, item := range items {
		weight, weightOK := toFloat64(item["weight"])
		if !weightOK || weight <= 0 {
			continue
		}
		intake, intakeOK := toFloat64(item["intake"])
		if !intakeOK {
			if ratio, ok := toFloat64(item["ratio"]); ok && ratio >= 0 {
				intake = weight * ratio / 100
			} else {
				intake = weight
			}
		}
		if intake < 0 {
			intake = 0
		}
		totalWeight += weight
		totalIntake += intake
	}
	return totalWeight, totalIntake
}

func totalFoodRecordWaterMl(items []map[string]any) float64 {
	total := 0.0
	for _, item := range items {
		waterMl := waterMlFromHomeFoodItem(item)
		if waterMl <= 0 {
			continue
		}
		if ratio, ok := toFloat64(item["ratio"]); ok && ratio >= 0 {
			total += waterMl * ratio / 100
			continue
		}
		intake, intakeOK := toFloat64(item["intake"])
		weight, weightOK := toFloat64(item["weight"])
		if intakeOK && weightOK && intake > 0 && weight > 0 {
			total += waterMl * intake / weight
			continue
		}
		total += waterMl
	}
	return total
}

func waterMlFromHomeFoodItem(item map[string]any) float64 {
	for _, key := range []string{"water_ml", "waterMl"} {
		if value, ok := toFloat64(item[key]); ok {
			return value
		}
	}
	if nutrients, ok := item["nutrients"].(map[string]any); ok {
		for _, key := range []string{"water_ml", "waterMl"} {
			if value, ok := toFloat64(nutrients[key]); ok {
				return value
			}
		}
	}
	return 0
}

func (s *DashboardService) resolveFoodImageURL(path string) string {
	if s.storage == nil {
		return strings.TrimSpace(path)
	}
	return s.storage.ResolveReferenceURL("food-images", path)
}

type homeExpirySummaryItem struct {
	item map[string]any
	rank int
	days int
}

func buildExpirySummary(items []homerepo.ExpiryItem) map[string]any {
	today := time.Now().In(homerepo.ChinaTZ()).Truncate(24 * time.Hour)
	activeItems := make([]homerepo.ExpiryItem, 0, len(items))
	for _, item := range items {
		if item.Status == "" || item.Status == "active" {
			activeItems = append(activeItems, item)
		}
	}
	summaries := make([]homeExpirySummaryItem, 0)
	for _, item := range activeItems {
		urgency := "fresh"
		label := "保鲜中"
		days := 9999
		if item.ExpireDate != nil {
			expireDate := item.ExpireDate.In(homerepo.ChinaTZ()).Truncate(24 * time.Hour)
			days = int(expireDate.Sub(today).Hours() / 24)
			switch {
			case days < 0:
				urgency, label = "expired", "已过期"
			case days == 0:
				urgency, label = "today", "今天到期"
			case days <= 3:
				urgency, label = "soon", "即将到期"
			}
		}
		rank := map[string]int{"expired": 0, "today": 1, "soon": 2, "fresh": 3}[urgency]
		summaries = append(summaries, homeExpirySummaryItem{
			rank: rank,
			days: days,
			item: map[string]any{
				"id":                item.ID,
				"user_id":           item.UserID,
				"food_name":         deref(item.FoodName),
				"name":              deref(item.FoodName),
				"status":            item.Status,
				"expire_date":       item.ExpireDate,
				"deadline_label":    formatExpiryDeadlineLabel(item.ExpireDate),
				"urgency":           urgency,
				"urgency_label":     label,
				"urgency_level":     homeExpiryUrgencyLevel(urgency),
				"days_until_expire": days,
				"days_left":         days,
				"storage_type":      deref(item.StorageType),
				"storage_location":  homeExpiryStorageLabel(deref(item.StorageType)),
				"quantity_text":     deref(item.QuantityNote),
				"note":              deref(item.Note),
			},
		})
	}
	slices.SortFunc(summaries, func(a, b homeExpirySummaryItem) int {
		if a.rank != b.rank {
			return a.rank - b.rank
		}
		return a.days - b.days
	})
	out := make([]map[string]any, 0)
	for idx, item := range summaries {
		if idx >= 3 {
			break
		}
		out = append(out, item.item)
	}
	return map[string]any{
		"count":        len(activeItems),
		"pendingCount": len(activeItems),
		"soonCount":    countHomeExpiryUrgency(summaries, "today", "soon"),
		"overdueCount": countHomeExpiryUrgency(summaries, "expired"),
		"items":        out,
	}
}

func formatExpiryDeadlineLabel(expireDate *time.Time) *string {
	if expireDate == nil {
		return nil
	}
	label := expireDate.In(homerepo.ChinaTZ()).Format("01-02")
	return &label
}

func homeExpiryUrgencyLevel(urgency string) string {
	switch urgency {
	case "expired":
		return "overdue"
	case "today":
		return "today"
	case "soon":
		return "soon"
	default:
		return "normal"
	}
}

func homeExpiryStorageLabel(value string) string {
	switch value {
	case "room_temp":
		return "常温"
	case "frozen":
		return "冷冻"
	case "refrigerated":
		return "冷藏"
	default:
		return ""
	}
}

func countHomeExpiryUrgency(items []homeExpirySummaryItem, values ...string) int {
	wanted := map[string]struct{}{}
	for _, value := range values {
		wanted[value] = struct{}{}
	}
	count := 0
	for _, item := range items {
		urgency, _ := item.item["urgency"].(string)
		if _, ok := wanted[urgency]; ok {
			count++
		}
	}
	return count
}

func previousChinaDate(date string) string {
	parsed, _ := time.ParseInLocation("2006-01-02", date, homerepo.ChinaTZ())
	return parsed.Add(-24 * time.Hour).Format("2006-01-02")
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func toFloat64(v any) (float64, bool) {
	switch value := v.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func firstOrNil(items []string) any {
	if len(items) == 0 {
		return nil
	}
	return items[0]
}
