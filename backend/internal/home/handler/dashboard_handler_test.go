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

	svc := service.NewDashboardService(userRepo, homeRepo)
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

func TestDashboardHandler_HomeDashboardError(t *testing.T) {
	_, userRepo, homeRepo := setupDashboardTestDB(t)

	svc := service.NewDashboardService(userRepo, homeRepo)
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

	svc := service.NewDashboardService(userRepo, homeRepo)
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

	svc := service.NewDashboardService(userRepo, homeRepo)
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
