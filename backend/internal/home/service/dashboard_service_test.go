package service

import (
	"context"
	"testing"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	homerepo "food_link/backend/internal/home/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupDashboardTestDB(t *testing.T) (*gorm.DB, *authrepo.UserRepo, *homerepo.HomeRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&authrepo.User{}, &homerepo.FoodRecord{}, &homerepo.ExpiryItem{}))
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
	}).Error)

	result, err := svc.HomeDashboard(ctx, user.ID, now.Format("2006-01-02"))
	require.NoError(t, err)
	assert.NotNil(t, result["intakeData"])
	assert.NotNil(t, result["meals"])
	assert.NotNil(t, result["expirySummary"])
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
	assert.Equal(t, 1800.0, targets["calorie_target"])
}

func TestDashboardTargets_NilUser(t *testing.T) {
	targets := dashboardTargets(nil)
	assert.Equal(t, 2000.0, targets["calorie_target"])
}

func TestDashboardTargets_WithHealthCondition(t *testing.T) {
	hc := map[string]any{"dashboard_targets": map[string]any{"calorie_target": 1800.0, "protein_target": 100.0}}
	user := &authrepo.User{OpenID: "o1", HealthCondition: hc}
	targets := dashboardTargets(user)
	assert.Equal(t, 1800.0, targets["calorie_target"])
	assert.Equal(t, 100.0, targets["protein_target"])
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
	records := []homerepo.FoodRecord{
		{ID: "r1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &now},
	}
	meal := buildMealItem("lunch", records, 800)
	assert.Equal(t, "lunch", meal["type"])
	assert.Equal(t, 500.0, meal["calorie"])
	assert.Equal(t, 800.0, meal["target"])
}

func TestBuildExpirySummary(t *testing.T) {
	now := time.Now()
	today := now.In(chinaTZ).Truncate(24 * time.Hour)
	items := []homerepo.ExpiryItem{
		{ID: "e1", Name: strPtr("milk"), ExpireDate: &today, Status: "active"},
		{ID: "e2", Name: strPtr("egg"), ExpireDate: ptrTime(today.AddDate(0, 0, 3)), Status: "active"},
		{ID: "e3", Name: strPtr("bread"), ExpireDate: ptrTime(today.AddDate(0, 0, -1)), Status: "active"},
	}
	summary := buildExpirySummary(items)
	assert.Equal(t, 3, summary["count"])
	summaryItems, ok := summary["items"].([]map[string]any)
	require.True(t, ok)
	assert.Len(t, summaryItems, 3)
	assert.Equal(t, "expired", summaryItems[0]["urgency"])
	assert.Equal(t, "today", summaryItems[1]["urgency"])
	assert.Equal(t, "soon", summaryItems[2]["urgency"])
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
