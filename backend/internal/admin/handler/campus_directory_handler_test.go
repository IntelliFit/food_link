package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	catalogdomain "food_link/backend/internal/campuscatalog/domain"
	schooldomain "food_link/backend/internal/school/domain"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGetSchoolSummaryCountsHierarchy(t *testing.T) {
	db := newCampusDirectoryTestDB(t)
	schoolID, campusID, canteenID, windowID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Create(&schooldomain.School{ID: schoolID, Name: "测试大学", LocationType: "university", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCampus{ID: campusID, SchoolID: schoolID, Name: "主校区", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCanteen{ID: canteenID, SchoolID: schoolID, CampusID: &campusID, Name: "一食堂", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.CanteenWindow{ID: windowID, SchoolID: schoolID, CampusID: &campusID, CanteenID: canteenID, Name: "一层窗口", Status: "active"}).Error)
	require.NoError(t, db.Create(&catalogdomain.CatalogItem{ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", SchoolID: &schoolID, CampusID: &campusID, CanteenID: &canteenID, WindowID: &windowID, Name: "鸡蛋饼", OrganizationName: "测试大学", CanteenName: "一食堂", Status: "draft"}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/schools/:school_id/summary", NewCampusDirectoryHandler(db).GetSchoolSummary)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/schools/"+schoolID+"/summary", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	var envelope struct {
		Data struct {
			Counts map[string]int64 `json:"counts"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	require.Equal(t, int64(1), envelope.Data.Counts["campuses"])
	require.Equal(t, int64(1), envelope.Data.Counts["canteens"])
	require.Equal(t, int64(1), envelope.Data.Counts["windows"])
	require.Equal(t, int64(1), envelope.Data.Counts["dishes"])
}

func TestDeleteCampusRejectsExistingCanteen(t *testing.T) {
	db := newCampusDirectoryTestDB(t)
	schoolID, campusID := uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Create(&schooldomain.School{ID: schoolID, Name: "测试大学", LocationType: "university", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCampus{ID: campusID, SchoolID: schoolID, Name: "主校区", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCanteen{ID: uuid.NewString(), SchoolID: schoolID, CampusID: &campusID, Name: "一食堂", Status: "active"}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.DELETE("/campuses/:campus_id", NewCampusDirectoryHandler(db).DeleteCampus)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/campuses/"+campusID, nil))

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	var campus schooldomain.SchoolCampus
	require.NoError(t, db.First(&campus, "id = ?", campusID).Error)
	require.Equal(t, "active", campus.Status)
}

func TestUpdateCanteenIgnoresLegacyNullJSONLists(t *testing.T) {
	db := newCampusDirectoryTestDB(t)
	schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Create(&schooldomain.School{ID: schoolID, Name: "测试大学", LocationType: "university", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCampus{ID: campusID, SchoolID: schoolID, Name: "主校区", Status: "active"}).Error)
	require.NoError(t, db.Create(&schooldomain.SchoolCanteen{
		ID: canteenID, SchoolID: schoolID, CampusID: &campusID, Name: "冠军餐厅", Status: "pending_review",
		Aliases: []string{}, MealPeriods: []string{}, PaymentMethods: []string{},
	}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PATCH("/canteens/:canteen_id", NewCampusDirectoryHandler(db).UpdateCanteen)
	requestBody := `{"name":"冠军餐厅","location_text":"西南门附近","aliases":null,"meal_periods":null,"payment_methods":null}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/canteens/"+canteenID, strings.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var saved schooldomain.SchoolCanteen
	require.NoError(t, db.First(&saved, "id = ?", canteenID).Error)
	require.Equal(t, "西南门附近", saved.LocationText)
}

func TestNormalizeJSONListPatchDropsLegacyNullAndEncodesArrays(t *testing.T) {
	patch := map[string]any{
		"aliases":         nil,
		"meal_periods":    []any{"breakfast", "lunch"},
		"payment_methods": "",
	}

	require.NoError(t, normalizeJSONListPatch(patch, "aliases", "meal_periods", "payment_methods"))
	require.NotContains(t, patch, "aliases")
	require.NotContains(t, patch, "payment_methods")
	require.JSONEq(t, `["breakfast","lunch"]`, string(patch["meal_periods"].(datatypes.JSON)))
}

func newCampusDirectoryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&schooldomain.School{}, &schooldomain.SchoolCampus{}, &schooldomain.SchoolCanteen{},
		&schooldomain.CanteenWindow{}, &catalogdomain.CatalogItem{},
	))
	return db
}
