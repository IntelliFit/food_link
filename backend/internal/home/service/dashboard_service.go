package service

import (
	"context"
	"math"
	"slices"
	"strings"
	"time"

	userrepo "food_link/backend/internal/auth/repo"
	homerepo "food_link/backend/internal/home/repo"
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
	users *userrepo.UserRepo
	home  *homerepo.HomeRepo
}

func NewDashboardService(users *userrepo.UserRepo, home *homerepo.HomeRepo) *DashboardService {
	return &DashboardService{users: users, home: home}
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

	targets := dashboardTargets(user)
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
		meal := buildMealItem(mealType, items, mealTargets[mealType])
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
	}, nil
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
	targets := buildMealTargets(dashboardTargets(user)["calorie_target"])
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

func dashboardTargets(user *userrepo.User) map[string]float64 {
	targets := map[string]float64{
		"calorie_target": 2000,
		"protein_target": 120,
		"carbs_target":   250,
		"fat_target":     65,
	}
	if user == nil {
		return targets
	}
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		return targets
	}
	dashboard, _ := healthCondition["dashboard_targets"].(map[string]any)
	for _, key := range []string{"calorie_target", "protein_target", "carbs_target", "fat_target"} {
		if val, ok := dashboard[key]; ok {
			if num, ok := toFloat64(val); ok && num > 0 {
				targets[key] = num
			}
		}
	}
	return targets
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

func buildMealItem(mealType string, records []homerepo.FoodRecord, mealTarget float64) map[string]any {
	mealCal, mealProtein, mealCarbs, mealFat := 0.0, 0.0, 0.0, 0.0
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
		mealCal += record.TotalCalories
		mealProtein += record.TotalProtein
		mealCarbs += record.TotalCarbs
		mealFat += record.TotalFat
		for _, imagePath := range record.ImagePaths {
			if imagePath != "" && !seen[imagePath] {
				imagePaths = append(imagePaths, imagePath)
				seen[imagePath] = true
			}
		}
		if record.ImagePath != nil && *record.ImagePath != "" && !seen[*record.ImagePath] {
			imagePaths = append(imagePaths, *record.ImagePath)
			seen[*record.ImagePath] = true
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
			"title":          title,
			"image_path":     firstOrNil(imagePaths),
			"image_paths":    imagePaths,
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

func buildExpirySummary(items []homerepo.ExpiryItem) map[string]any {
	today := time.Now().In(homerepo.ChinaTZ()).Truncate(24 * time.Hour)
	type summaryItem struct {
		item map[string]any
		rank int
		days int
	}
	summaries := make([]summaryItem, 0)
	for _, item := range items {
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
		summaries = append(summaries, summaryItem{
			rank: rank,
			days: days,
			item: map[string]any{
				"id":                item.ID,
				"name":              deref(item.Name),
				"status":            item.Status,
				"expire_date":       item.ExpireDate,
				"urgency":           urgency,
				"urgency_label":     label,
				"days_until_expire": days,
				"storage_type":      deref(item.StorageType),
			},
		})
	}
	slices.SortFunc(summaries, func(a, b summaryItem) int {
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
		"count": len(items),
		"items": out,
	}
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
