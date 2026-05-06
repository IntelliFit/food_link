package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	userrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/home/repo"
	"food_link/backend/internal/home/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupDashboardTestDB(t *testing.T) (*gorm.DB, *userrepo.UserRepo, *repo.HomeRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&userrepo.User{}, &repo.FoodRecord{}, &repo.ExpiryItem{}))
	// user_exercise_logs table is queried with user_id and recorded_on but ExerciseLog model doesn't define them
	require.NoError(t, db.Exec("CREATE TABLE IF NOT EXISTS user_exercise_logs (calories_burned INTEGER, user_id TEXT, recorded_on TEXT)").Error)
	return db, userrepo.NewUserRepo(db), repo.NewHomeRepo(db)
}

func setupDashboardRouter(h *DashboardHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/home/dashboard", h.HomeDashboard)
	r.GET("/api/food-record/:record_id/poster-calorie-compare", h.PosterCalorieCompare)
	return r
}

func TestDashboardHandler_HomeDashboard(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	now := time.Now()

	userID := uuid.New().String()
	db.Create(&userrepo.User{ID: userID, OpenID: "openid"})
	db.Create(&repo.FoodRecord{ID: uuid.New().String(), UserID: userID, MealType: "lunch", TotalCalories: 500, RecordTime: &now})

	svc := service.NewDashboardService(userRepo, homeRepo, nil)
	h := NewDashboardHandler(svc)
	r := setupDashboardRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/home/dashboard?date="+service.ChinaToday(), nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NotNil(t, resp["intakeData"])
}

func TestDashboardHandler_HomeDashboardMealEntriesKeepOwnImages(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	firstTime := time.Date(2026, 5, 9, 8, 30, 0, 0, chinaTZ).UTC()
	secondTime := time.Date(2026, 5, 9, 5, 6, 0, 0, chinaTZ).UTC()
	firstImage := "breakfast-rice.jpg"
	secondImage := "breakfast-chips.jpg"

	db.Create(&userrepo.User{ID: "test-user-id", OpenID: "openid"})
	db.Create(&repo.FoodRecord{
		ID:            "breakfast-rice",
		UserID:        "test-user-id",
		MealType:      "breakfast",
		TotalCalories: 505.2,
		RecordTime:    &firstTime,
		ImagePath:     &firstImage,
	})
	db.Create(&repo.FoodRecord{
		ID:            "breakfast-chips",
		UserID:        "test-user-id",
		MealType:      "breakfast",
		TotalCalories: 557.4,
		RecordTime:    &secondTime,
		ImagePath:     &secondImage,
	})

	svc := service.NewDashboardService(userRepo, homeRepo)
	h := NewDashboardHandler(svc)
	r := setupDashboardRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/home/dashboard?date=2026-05-09", nil)
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Meals []struct {
			Type              string `json:"type"`
			MealRecordEntries []struct {
				ID         string   `json:"id"`
				ImagePath  string   `json:"image_path"`
				ImagePaths []string `json:"image_paths"`
			} `json:"meal_record_entries"`
		} `json:"meals"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.Len(t, resp.Meals, 1)
	require.Equal(t, "breakfast", resp.Meals[0].Type)
	require.Len(t, resp.Meals[0].MealRecordEntries, 2)

	imagesByID := map[string]string{}
	imageListsByID := map[string][]string{}
	for _, entry := range resp.Meals[0].MealRecordEntries {
		imagesByID[entry.ID] = entry.ImagePath
		imageListsByID[entry.ID] = entry.ImagePaths
	}
	assert.Equal(t, firstImage, imagesByID["breakfast-rice"])
	assert.Equal(t, []string{firstImage}, imageListsByID["breakfast-rice"])
	assert.Equal(t, secondImage, imagesByID["breakfast-chips"])
	assert.Equal(t, []string{secondImage}, imageListsByID["breakfast-chips"])
}

func TestDashboardHandler_HomeDashboardError(t *testing.T) {
	_, userRepo, homeRepo := setupDashboardTestDB(t)

	svc := service.NewDashboardService(userRepo, homeRepo, nil)
	h := NewDashboardHandler(svc)
	r := setupDashboardRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/home/dashboard", nil)
	r.ServeHTTP(w, req)

	// No user in DB but service returns data with defaults; should be 200
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDashboardHandler_PosterCalorieCompare(t *testing.T) {
	db, userRepo, homeRepo := setupDashboardTestDB(t)
	now := time.Now()

	recordID := uuid.New().String()
	db.Create(&userrepo.User{ID: "test-user-id", OpenID: "openid"})
	db.Create(&repo.FoodRecord{ID: recordID, UserID: "test-user-id", MealType: "lunch", TotalCalories: 500, RecordTime: &now})

	svc := service.NewDashboardService(userRepo, homeRepo, nil)
	h := NewDashboardHandler(svc)
	r := setupDashboardRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/"+recordID+"/poster-calorie-compare", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NotNil(t, resp["current_kcal"])
}

func TestDashboardHandler_PosterCalorieCompareNotFound(t *testing.T) {
	_, userRepo, homeRepo := setupDashboardTestDB(t)

	svc := service.NewDashboardService(userRepo, homeRepo, nil)
	h := NewDashboardHandler(svc)
	r := setupDashboardRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/nonexistent/poster-calorie-compare", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "记录不存在", resp["detail"])
}
