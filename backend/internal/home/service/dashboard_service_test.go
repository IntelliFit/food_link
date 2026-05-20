package service

import (
	"context"
	"testing"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	homerepo "food_link/backend/internal/home/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupDashboardTestDB(t *testing.T) (*gorm.DB, *authrepo.UserRepo, *homerepo.HomeRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &homerepo.FoodRecord{}, &homerepo.ExpiryItem{}, &homerepo.DailyNutritionTarget{}))
	// ExerciseLog model doesn't have user_id/recorded_on, create table manually
	db.Exec(`CREATE TABLE user_exercise_logs (
		id INTEGER PRIMARY KEY,
		user_id TEXT,
		recorded_on TEXT,
		calories_burned INTEGER
	)`)
	return db, authrepo.NewUserRepo(db), homerepo.NewHomeRepo(db)
}

func TestDashboardService_HomeDashboard(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	svc := NewDashboardService(userRepo, homeRepo)
	ctx := context.Background()

	user := &authrepo.User{OpenID: "o1", HealthCondition: map[string]any{}}
	require.NoError(t, userRepo.Create(ctx, user))

	now := time.Now()
	require.NoError(t, db.Create(&homerepo.FoodRecord{
		ID: "r1", UserID: user.ID, MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &now,
		Items: []map[string]any{
			{"name": "粥", "weight": 300.0, "ratio": 50.0, "intake": 150.0, "water_ml": 240.0},
			{"name": "苹果", "weight": 100.0, "ratio": 100.0, "intake": 100.0, "waterMl": 85.0},
		},
	}).Error)

	result, err := svc.HomeDashboard(ctx, user.ID, now.Format("2006-01-02"))
	require.NoError(t, err)
	assert.NotNil(t, result["intakeData"])
	assert.NotNil(t, result["meals"])
	assert.NotNil(t, result["expirySummary"])
	meals, ok := result["meals"].([]map[string]any)
	require.True(t, ok)
	require.Len(t, meals, 1)
	assert.Equal(t, 205.0, meals[0]["water_ml"])
}

func TestDashboardService_HomeDashboard_NoRecords(t *testing.T) {
	_, userRepo, homeRepo := setupDashboardTestDB(t)
	svc := NewDashboardService(userRepo, homeRepo)
	ctx := context.Background()

	user := &authrepo.User{OpenID: "o1", HealthCondition: map[string]any{}}
	require.NoError(t, userRepo.Create(ctx, user))

	result, err := svc.HomeDashboard(ctx, user.ID, time.Now().Format("2006-01-02"))
	require.NoError(t, err)
	intakeData, ok := result["intakeData"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 0.0, intakeData["current"])
}

func TestDashboardService_HomeDashboard_DynamicTargetsUseProfileAndExercise(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	svc := NewDashboardService(userRepo, homeRepo)
	ctx := context.Background()

	bmr := 1500.0
	weight := 70.0
	goal := "fat_loss"
	activity := "light"
	user := &authrepo.User{
		OpenID:          "o1",
		Weight:          &weight,
		BMR:             &bmr,
		ActivityLevel:   &activity,
		DietGoal:        &goal,
		HealthCondition: map[string]any{},
	}
	require.NoError(t, userRepo.Create(ctx, user))
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs (user_id, recorded_on, calories_burned) VALUES (?, ?, ?)`, user.ID, "2024-06-15", 500).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs (user_id, recorded_on, calories_burned) VALUES (?, ?, ?)`, user.ID, "2024-06-10", 300).Error)

	result, err := svc.HomeDashboard(ctx, user.ID, "2024-06-15")
	require.NoError(t, err)
	intakeData := result["intakeData"].(map[string]any)
	assert.Equal(t, 1805.7, intakeData["target"])
	macros := intakeData["macros"].(map[string]any)
	assert.Equal(t, 126.0, macros["protein"].(map[string]any)["target"])
	assert.Greater(t, macros["carbs"].(map[string]any)["target"], 155.0)

	target, ok := result["nutritionTarget"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "dynamic", target["source"])
	assert.Equal(t, "fat_loss", target["diet_goal"])
	assert.Equal(t, 1560.0, target["base_calorie_target"])
	assert.Equal(t, 245.7, target["exercise_added_kcal"])
	assert.Equal(t, 1.3, target["activity_multiplier"])
	assert.Contains(t, target["explanation"], "今天运动明显高于近期日均水平")
}

func TestDashboardService_PosterCalorieCompare(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	svc := NewDashboardService(userRepo, homeRepo)
	ctx := context.Background()

	user := &authrepo.User{OpenID: "o1", HealthCondition: map[string]any{}}
	require.NoError(t, userRepo.Create(ctx, user))

	now := time.Now()
	require.NoError(t, db.Create(&homerepo.FoodRecord{
		ID: "r1", UserID: user.ID, MealType: "lunch", TotalCalories: 500, RecordTime: &now,
	}).Error)

	result, err := svc.PosterCalorieCompare(ctx, user.ID, "r1")
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, 500.0, result["current_kcal"])
}

func TestDashboardService_PosterCalorieCompare_NotFound(t *testing.T) {
	_, userRepo, homeRepo := setupDashboardTestDB(t)
	svc := NewDashboardService(userRepo, homeRepo)
	ctx := context.Background()

	result, err := svc.PosterCalorieCompare(ctx, "user1", "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestDashboardTargets_WithUser(t *testing.T) {
	hc := map[string]any{"dashboard_targets": map[string]any{"calorie_target": 1800.0}}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	targets := dashboardTargets(user)
	assert.Equal(t, 2000.0, targets["calorie_target"])
}

func TestDashboardTargets_NilUser(t *testing.T) {
	targets := dashboardTargets(nil)
	assert.Equal(t, 2000.0, targets["calorie_target"])
}

func TestDashboardTargets_WithHealthCondition(t *testing.T) {
	hc := map[string]any{"dashboard_targets": map[string]any{"calorie_target": 1800.0, "protein_target": 100.0}}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	targets := dashboardTargets(user)
	assert.Equal(t, 2000.0, targets["calorie_target"])
	assert.Equal(t, 120.0, targets["protein_target"])
}

func TestDashboardTargets_WithManualMode(t *testing.T) {
	hc := map[string]any{
		"dashboard_targets_mode": "manual",
		"dashboard_targets":      map[string]any{"calorie_target": 1800.0, "protein_target": 100.0},
	}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	targets := dashboardTargets(user)
	assert.Equal(t, 1800.0, targets["calorie_target"])
	assert.Equal(t, 100.0, targets["protein_target"])
}

func TestBuildNutritionTargetPlan_IgnoresLegacyManualTargets(t *testing.T) {
	hc := map[string]any{"dashboard_targets": map[string]any{
		"calorie_target": 1800.0,
		"protein_target": 100.0,
		"carbs_target":   200.0,
		"fat_target":     55.0,
	}}
	bmr := 1600.0
	weight := 70.0
	user := &authrepo.User{OpenID: "o1", BMR: &bmr, Weight: &weight, HealthCondition: hc}
	plan := buildNutritionTargetPlan(user, "2024-06-15", 500, map[string]int{"2024-06-15": 500})
	assert.Equal(t, "dynamic", plan.TargetSource)
	assert.NotEqual(t, 1800.0, plan.Targets["calorie_target"])
	assert.NotEqual(t, 100.0, plan.Targets["protein_target"])
	assert.Equal(t, 2152.1, plan.Targets["calorie_target"])
}

func TestBuildNutritionTargetPlan_SmallExerciseSurplusDoesNotCompensate(t *testing.T) {
	bmr := 1500.0
	weight := 70.0
	activity := "light"
	user := &authrepo.User{OpenID: "o1", BMR: &bmr, Weight: &weight, ActivityLevel: &activity, HealthCondition: map[string]any{}}
	history := map[string]int{
		"2024-06-01": 300,
		"2024-06-02": 300,
		"2024-06-03": 300,
		"2024-06-04": 300,
		"2024-06-05": 300,
		"2024-06-06": 300,
		"2024-06-07": 300,
	}

	plan := buildNutritionTargetPlan(user, "2024-06-15", 260, history)
	assert.Equal(t, 0.0, plan.ExerciseAddedKcal)
	assert.Equal(t, 120.0, plan.ExerciseThresholdKcal)
	assert.Contains(t, plan.Explanation, "未达到明显超量门槛")
}

func TestBaseCalorieTargetUsesDailyLifeActivityNotStoredTDEE(t *testing.T) {
	bmr := 1500.0
	tdee := 2600.0
	activity := "moderate"
	user := &authrepo.User{OpenID: "o1", BMR: &bmr, TDEE: &tdee, ActivityLevel: &activity}
	assert.Equal(t, 2100.0, baseCalorieTarget(user))
}

func TestBuildNutritionTargetPlan_ManualModeWins(t *testing.T) {
	hc := map[string]any{
		"dashboard_targets_mode": "manual",
		"dashboard_targets": map[string]any{
			"calorie_target": 1800.0,
			"protein_target": 100.0,
			"carbs_target":   200.0,
			"fat_target":     55.0,
		},
	}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	plan := buildNutritionTargetPlan(user, "2024-06-15", 500, map[string]int{"2024-06-15": 500})
	assert.Equal(t, "manual", plan.TargetSource)
	assert.Equal(t, 1800.0, plan.Targets["calorie_target"])
	assert.Equal(t, 100.0, plan.Targets["protein_target"])
	assert.Equal(t, 0.0, plan.ExerciseAddedKcal)
}

func TestBuildNutritionTargetPlan_DailyManualWinsOverGlobalManual(t *testing.T) {
	hc := map[string]any{
		"dashboard_targets_mode": "manual",
		"dashboard_targets": map[string]any{
			"calorie_target": 1800.0,
			"protein_target": 100.0,
			"carbs_target":   200.0,
			"fat_target":     55.0,
		},
	}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	plan := buildNutritionTargetPlan(user, "2024-06-15", 500, map[string]int{"2024-06-15": 500}, &homerepo.DailyNutritionTarget{
		CalorieTarget: 2100,
		ProteinTarget: 130,
		CarbsTarget:   260,
		FatTarget:     70,
	})
	assert.Equal(t, "daily_manual", plan.TargetSource)
	assert.Equal(t, 2100.0, plan.Targets["calorie_target"])
	assert.Equal(t, 130.0, plan.Targets["protein_target"])
	assert.Equal(t, 0.0, plan.ExerciseAddedKcal)
}

func TestBuildMealTargets(t *testing.T) {
	targets := buildMealTargets(2000)
	assert.Greater(t, targets["breakfast"], 0.0)
	assert.Greater(t, targets["lunch"], 0.0)
	assert.Greater(t, targets["dinner"], 0.0)
	assert.Equal(t, 150.0, targets["morning_snack"])
	assert.Equal(t, 150.0, targets["afternoon_snack"])
	assert.Equal(t, 150.0, targets["evening_snack"])
}

func TestNormalizeMealType(t *testing.T) {
	assert.Equal(t, "breakfast", normalizeMealType("breakfast", nil))
	assert.Equal(t, "lunch", normalizeMealType("lunch", nil))
	assert.Equal(t, "dinner", normalizeMealType("dinner", nil))
	// nil recordTime -> evening_snack in dashboard_service.go
	assert.Equal(t, "evening_snack", normalizeMealType("snack", nil))

	morning := time.Date(2024, 1, 1, 9, 0, 0, 0, chinaTZ)
	assert.Equal(t, "afternoon_snack", normalizeMealType("snack", &morning))

	afternoon := time.Date(2024, 1, 1, 14, 0, 0, 0, chinaTZ)
	assert.Equal(t, "afternoon_snack", normalizeMealType("snack", &afternoon))

	evening := time.Date(2024, 1, 1, 20, 0, 0, 0, chinaTZ)
	assert.Equal(t, "evening_snack", normalizeMealType("snack", &evening))
}

func TestBuildMealItem(t *testing.T) {
	now := time.Now()
	later := now.Add(30 * time.Minute)
	records := []homerepo.FoodRecord{
		{
			ID: "r1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &now,
			ImagePaths: []string{"https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/legacy.jpg"},
			Items:      []map[string]any{{"water_ml": 240.0, "ratio": 50.0}},
		},
		{
			ID: "r2", MealType: "lunch", TotalCalories: 300, TotalProtein: 10, TotalCarbs: 40, TotalFat: 8, RecordTime: &later,
			ImagePaths: []string{"https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/second.jpg"},
			Items:      []map[string]any{{"nutrients": map[string]any{"waterMl": 85.0}, "ratio": 100.0}},
		},
	}
	svc := NewDashboardService(nil, nil, storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"}))
	meal := svc.buildMealItem("lunch", records, 800)
	assert.Equal(t, "lunch", meal["type"])
	assert.Equal(t, 800.0, meal["calorie"])
	assert.Equal(t, 800.0, meal["target"])
	assert.Equal(t, 205.0, meal["water_ml"])
	assert.Equal(t, "https://cdn.example.com/food/legacy.jpg", meal["image_path"])

	entries, ok := meal["meal_record_entries"].([]map[string]any)
	require.True(t, ok)
	require.Len(t, entries, 2)
	assert.Equal(t, "r1", entries[0]["id"])
	assert.Equal(t, "https://cdn.example.com/food/legacy.jpg", entries[0]["image_path"])
	assert.Equal(t, []string{"https://cdn.example.com/food/legacy.jpg"}, entries[0]["image_paths"])
	assert.Equal(t, "r2", entries[1]["id"])
	assert.Equal(t, "https://cdn.example.com/food/second.jpg", entries[1]["image_path"])
	assert.Equal(t, []string{"https://cdn.example.com/food/second.jpg"}, entries[1]["image_paths"])
}

func TestTotalFoodRecordWaterMl(t *testing.T) {
	assert.Equal(t, 0.0, totalFoodRecordWaterMl(nil))
	assert.Equal(t, 150.0, totalFoodRecordWaterMl([]map[string]any{{"water_ml": 300.0, "ratio": 50.0, "weight": 300.0, "intake": 150.0}}))
	assert.Equal(t, 80.0, totalFoodRecordWaterMl([]map[string]any{{"waterMl": 200.0, "weight": 500.0, "intake": 200.0}}))
	assert.Equal(t, 125.5, totalFoodRecordWaterMl([]map[string]any{{"nutrients": map[string]any{"water_ml": 125.5}}}))
}

func TestBuildExpirySummary(t *testing.T) {
	now := time.Now()
	today := now.In(chinaTZ).Truncate(24 * time.Hour)
	items := []homerepo.ExpiryItem{
		{ID: "e1", UserID: "u1", FoodName: strPtr("milk"), ExpireDate: &today, Status: "active", StorageType: strPtr("refrigerated"), QuantityNote: strPtr("2盒")},
		{ID: "e2", FoodName: strPtr("egg"), ExpireDate: ptrTime(today.AddDate(0, 0, 3)), Status: "active"},
		{ID: "e3", FoodName: strPtr("bread"), ExpireDate: ptrTime(today.AddDate(0, 0, -1)), Status: "active"},
	}
	summary := buildExpirySummary(items)
	assert.Equal(t, 3, summary["count"])
	assert.Equal(t, 3, summary["pendingCount"])
	assert.Equal(t, 2, summary["soonCount"])
	assert.Equal(t, 1, summary["overdueCount"])
	summaryItems, ok := summary["items"].([]map[string]any)
	require.True(t, ok)
	assert.Len(t, summaryItems, 3)
	assert.Equal(t, "expired", summaryItems[0]["urgency"])
	assert.Equal(t, "today", summaryItems[1]["urgency"])
	assert.Equal(t, "soon", summaryItems[2]["urgency"])
	assert.Equal(t, "milk", summaryItems[1]["food_name"])
	deadlineLabel, ok := summaryItems[1]["deadline_label"].(*string)
	require.True(t, ok)
	assert.Equal(t, today.Format("01-02"), *deadlineLabel)
	assert.Equal(t, "冷藏", summaryItems[1]["storage_location"])
	assert.Equal(t, "2盒", summaryItems[1]["quantity_text"])
}

func TestPreviousChinaDate(t *testing.T) {
	result := previousChinaDate("2024-06-15")
	assert.Equal(t, "2024-06-14", result)
}

func TestRound1(t *testing.T) {
	assert.Equal(t, 1.2, round1(1.23))
	assert.Equal(t, 1.3, round1(1.25))
}

func TestToFloat64(t *testing.T) {
	v, ok := toFloat64(1.5)
	assert.True(t, ok)
	assert.Equal(t, 1.5, v)

	v, ok = toFloat64(float32(1.5))
	assert.True(t, ok)
	assert.Equal(t, 1.5, v)

	v, ok = toFloat64(10)
	assert.True(t, ok)
	assert.Equal(t, 10.0, v)

	v, ok = toFloat64(int64(10))
	assert.True(t, ok)
	assert.Equal(t, 10.0, v)

	_, ok = toFloat64("string")
	assert.False(t, ok)
}

func TestDeref(t *testing.T) {
	assert.Equal(t, "value", deref(strPtr("value")))
	assert.Equal(t, "", deref(nil))
}

func TestFirstOrNil(t *testing.T) {
	assert.Equal(t, "a", firstOrNil([]string{"a", "b"}))
	assert.Nil(t, firstOrNil([]string{}))
}

func strPtr(s string) *string {
	return &s
}

func ptrTime(t time.Time) *time.Time {
	return &t
}
