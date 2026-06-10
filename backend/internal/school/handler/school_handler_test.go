package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gormsqlite "gorm.io/driver/sqlite"
	"gorm.io/gorm"

	_ "modernc.org/sqlite"
)

type testSchoolDO struct {
	ID        string     `gorm:"column:id;type:text;primaryKey"`
	Name      string     `gorm:"column:name;type:text;not null"`
	Province  *string    `gorm:"column:province;type:text"`
	City      *string    `gorm:"column:city;type:text"`
	Level     *string    `gorm:"column:level;type:text"`
	Is985     *bool      `gorm:"column:is_985;type:boolean;default:false"`
	Is211     *bool      `gorm:"column:is_211;type:boolean;default:false"`
	LogoURL   *string    `gorm:"column:logo_url;type:text"`
	Status    string     `gorm:"column:status;type:text;not null;default:'active'"`
	CreatedAt *time.Time `gorm:"column:created_at;type:datetime;default:current_timestamp"`
}

func (testSchoolDO) TableName() string { return "schools" }

func setupSchoolTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(gormsqlite.New(gormsqlite.Config{
		DriverName: "sqlite",
		DSN:        ":memory:",
	}), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&testSchoolDO{}))

	now := time.Now()
	beijing := "北京市"
	shanghai := "上海市"
	zhejiang := "浙江省"
	jiangsu := "江苏省"
	hangzhou := "杭州市"
	nanjing := "南京市"
	suzhou := "苏州市"
	trueVal := true
	falseVal := false

	schools := []testSchoolDO{
		{ID: "school-1", Name: "北京大学", Province: &beijing, City: &beijing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-2", Name: "清华大学", Province: &beijing, City: &beijing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-3", Name: "中国人民大学", Province: &beijing, City: &beijing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-4", Name: "北京航空航天大学", Province: &beijing, City: &beijing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-5", Name: "复旦大学", Province: &shanghai, City: &shanghai, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-6", Name: "上海交通大学", Province: &shanghai, City: &shanghai, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-7", Name: "同济大学", Province: &shanghai, City: &shanghai, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-8", Name: "浙江大学", Province: &zhejiang, City: &hangzhou, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-9", Name: "南京大学", Province: &jiangsu, City: &nanjing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-10", Name: "东南大学", Province: &jiangsu, City: &nanjing, Is985: &trueVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-11", Name: "上海大学", Province: &shanghai, City: &shanghai, Is985: &falseVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-12", Name: "苏州大学", Province: &jiangsu, City: &suzhou, Is985: &falseVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-13", Name: "北京邮电大学", Province: &beijing, City: &beijing, Is985: &falseVal, Is211: &trueVal, Status: "active", CreatedAt: &now},
		{ID: "school-14", Name: "上海理工大学", Province: &shanghai, City: &shanghai, Is985: &falseVal, Is211: &falseVal, Status: "active", CreatedAt: &now},
		{ID: "school-15", Name: "杭州电子科技大学", Province: &zhejiang, City: &hangzhou, Is985: &falseVal, Is211: &falseVal, Status: "active", CreatedAt: &now},
	}

	require.NoError(t, db.Create(&schools).Error)
	return db
}

func setupSchoolRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewSchoolHandler(db, nil)
	r.GET("/api/schools", h.Search)
	r.GET("/api/schools/provinces", h.Provinces)
	return r
}

func parseSchoolResponse(t *testing.T, body []byte) map[string]any {
	var resp map[string]any
	require.NoError(t, json.Unmarshal(body, &resp))
	return resp
}

func TestSchoolHandler_Search_EmptyKeyword(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.Len(t, data, 15)

	// 验证包含知名大学
	var names []string
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Contains(t, names, "北京大学")
	assert.Contains(t, names, "清华大学")
	assert.Contains(t, names, "复旦大学")
	assert.Contains(t, names, "上海交通大学")
	assert.Contains(t, names, "浙江大学")
	assert.Contains(t, names, "南京大学")
}

func TestSchoolHandler_Search_Beijing(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=北京", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	first := data[0].(map[string]any)
	assert.Equal(t, "北京大学", first["name"])

	// 应该包含名字中带有"北京"的高校
	var names []string
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Contains(t, names, "北京航空航天大学")
	assert.Contains(t, names, "北京邮电大学")
}

func TestSchoolHandler_Search_Tsinghua(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=清华", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	first := data[0].(map[string]any)
	assert.Equal(t, "清华大学", first["name"])
}

func TestSchoolHandler_Search_Fudan(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=复旦", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	first := data[0].(map[string]any)
	assert.Equal(t, "复旦大学", first["name"])
}

func TestSchoolHandler_Search_SJTU(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=上海交通", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	first := data[0].(map[string]any)
	assert.Equal(t, "上海交通大学", first["name"])
}

func TestSchoolHandler_Search_ZhejiangUniversity(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=浙江", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	var names []string
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Contains(t, names, "浙江大学")
	// "杭州电子科技大学" 不包含 "浙江" 二字，不应被匹配
}

func TestSchoolHandler_Search_NanjingUniversity(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=南京", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	var names []string
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Contains(t, names, "南京大学")
	// "东南大学" 不包含 "南京" 二字，不应被匹配
}

func TestSchoolHandler_Search_NotFound(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=不存在的高校名称", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	assert.Empty(t, data)
}

func TestSchoolHandler_Search_Limit(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?limit=5", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	assert.Len(t, data, 5)
}

func TestSchoolHandler_Search_SortOrder(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=上海", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 3)

	// 985 优先于 211，211 优先于非 211
	names := make([]string, 0, len(data))
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}

	// 名字中包含"上海"的学校：
	// 985: 上海交通大学
	// 211: 上海大学
	// 非211: 上海理工大学
	// （注意：复旦大学、同济大学 不包含"上海"二字，不会被匹配）
	assert.Contains(t, names, "上海交通大学")
	assert.Contains(t, names, "上海大学")
	assert.Contains(t, names, "上海理工大学")

	// 验证排序：985 在 211 前面，211 在非211前面
	sjtuIdx := indexOf(names, "上海交通大学")
	shdxIdx := indexOf(names, "上海大学")
	shlgIdx := indexOf(names, "上海理工大学")

	assert.Less(t, sjtuIdx, shdxIdx, "985 学校应该排在 211 学校前面")
	assert.Less(t, shdxIdx, shlgIdx, "211 学校应该排在非211学校前面")
}

func TestSchoolHandler_Search_InactiveExcluded(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	// 插入一个 inactive 学校
	now := time.Now()
	inactiveName := "Inactive School"
	db.Table("schools").Create(&testSchoolDO{
		ID:        "school-inactive",
		Name:      inactiveName,
		Status:    "inactive",
		CreatedAt: &now,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=Inactive", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	assert.Empty(t, data, "inactive 学校不应该被搜索到")
}

func TestSchoolHandler_Search_ByProvince(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?province=北京市", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(data), 1)

	var names []string
	for _, item := range data {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Contains(t, names, "北京大学")
	assert.Contains(t, names, "清华大学")
	assert.NotContains(t, names, "复旦大学")
	assert.NotContains(t, names, "上海交通大学")
}

func TestSchoolHandler_Search_KeywordAndProvince(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?province=上海市&keyword=交通", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.Len(t, data, 1)
	assert.Equal(t, "上海交通大学", data[0].(map[string]any)["name"])
}

func TestSchoolHandler_Provinces(t *testing.T) {
	db := setupSchoolTestDB(t)
	r := setupSchoolRouter(db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools/provinces", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	provinces, ok := resp["data"].([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(provinces), 3)

	var names []string
	for _, p := range provinces {
		names = append(names, p.(string))
	}
	assert.Contains(t, names, "北京市")
	assert.Contains(t, names, "上海市")
	assert.Contains(t, names, "浙江省")
	assert.NotContains(t, names, "")
}

func TestSchoolHandler_Search_LogoURLNormalization(t *testing.T) {
	db := setupSchoolTestDB(t)

	storageClient := storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewSchoolHandler(db, storageClient)
	r.GET("/api/schools", h.Search)

	logoKey := "school-badges/school-1/abc123.png"
	require.NoError(t, db.Table("schools").Where("id = ?", "school-1").Update("logo_url", logoKey).Error)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=北京大学", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.Len(t, data, 1)

	school := data[0].(map[string]any)
	assert.Equal(t, "北京大学", school["name"])
	assert.Equal(t, "https://cdn.example.com/food/school-badges/school-1/abc123.png", school["logo_url"])
}

func TestSchoolHandler_Search_LogoURLAlreadyAbsolute(t *testing.T) {
	db := setupSchoolTestDB(t)

	storageClient := storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewSchoolHandler(db, storageClient)
	r.GET("/api/schools", h.Search)

	absoluteURL := "https://other.cdn.com/badge.png"
	require.NoError(t, db.Table("schools").Where("id = ?", "school-1").Update("logo_url", absoluteURL).Error)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/schools?keyword=北京大学", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	resp := parseSchoolResponse(t, w.Body.Bytes())
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].([]any)
	require.True(t, ok)
	require.Len(t, data, 1)

	school := data[0].(map[string]any)
	assert.Equal(t, absoluteURL, school["logo_url"])
}

func indexOf(slice []string, val string) int {
	for i, v := range slice {
		if v == val {
			return i
		}
	}
	return -1
}
