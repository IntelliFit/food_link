package repo

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestNearbyDietQueryFiltersRadiusVisibilityBudgetAndUsesCampusCoordinates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	for _, ddl := range []string{
		`CREATE TABLE public_food_library (id TEXT, user_id TEXT,food_name TEXT,description TEXT,items TEXT,status TEXT,type TEXT,total_calories REAL,total_protein REAL,total_carbs REAL,total_fat REAL,is_campus_food BOOLEAN,school_id TEXT,school_name TEXT,campus_id TEXT,campus_name TEXT,canteen_id TEXT,canteen_name TEXT,window_id TEXT,window_name TEXT,floor TEXT,price REAL,price_unit TEXT,image_path TEXT,merchant_name TEXT,merchant_address TEXT,detail_address TEXT,latitude REAL,longitude REAL,availability_status TEXT)`,
		`CREATE TABLE school_canteens (id TEXT,campus_id TEXT,school_id TEXT,status TEXT,latitude REAL,longitude REAL)`,
		`CREATE TABLE school_campuses (id TEXT,school_id TEXT,status TEXT,address TEXT,latitude REAL,longitude REAL)`,
		`CREATE TABLE schools (id TEXT,status TEXT,latitude REAL,longitude REAL,name TEXT,location_type TEXT)`,
		`CREATE TABLE user_blocks (blocker_user_id TEXT,blocked_user_id TEXT)`,
		`INSERT INTO schools VALUES ('s','active',40,116,'测试大学','university')`,
		`INSERT INTO school_campuses VALUES ('c','s','active','校区地址',40.001,116)`,
		`INSERT INTO user_blocks VALUES ('viewer','blocked')`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	for _, row := range []map[string]any{
		{"id": "merchant", "user_id": "a", "food_name": "商家鱼饭", "merchant_name": "鱼饭店", "latitude": 40.002, "longitude": 116.0, "price": 18},
		{"id": "campus", "user_id": "a", "food_name": "校内鱼饭", "is_campus_food": true, "school_id": "s", "campus_id": "c", "price": 15},
		{"id": "far", "user_id": "a", "food_name": "远处餐", "latitude": 41.0, "longitude": 116.0, "price": 10},
		{"id": "blocked", "user_id": "blocked", "food_name": "不可见", "latitude": 40.0, "longitude": 116.0, "price": 10},
		{"id": "expensive", "user_id": "a", "food_name": "超预算", "latitude": 40.0, "longitude": 116.0, "price": 50},
		{"id": "draft", "user_id": "a", "food_name": "草稿", "latitude": 40.0, "longitude": 116.0, "price": 10, "status": "draft"},
	} {
		if row["status"] == nil {
			row["status"] = "published"
		}
		row["total_calories"] = 500
		row["total_protein"] = 30
		row["items"] = `[{"name":"鱼肉"}]`
		row["price_unit"] = "份"
		require.NoError(t, db.Table("public_food_library").Create(row).Error)
	}
	max := 20.0
	f := domain.CampusDietSearchFilter{ViewerID: "viewer", Location: &domain.DietLocation{Latitude: 40, Longitude: 116, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}, RadiusKM: 3, MaxPrice: &max, Limit: 20}
	items, total, err := NewStatsRepo(db).SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	require.Len(t, items, 2)
	assert.Equal(t, "campus", items[0].SourceID)
	assert.Equal(t, "campus", items[0].LocationLevel)
	require.NotNil(t, items[0].DistanceKM)
	assert.InDelta(t, 0.11, *items[0].DistanceKM, 0.02)
	assert.Equal(t, "merchant", items[1].SourceID)
	assert.Equal(t, "鱼饭店", items[1].MerchantName)
	f.MerchantOnly = true
	items, _, err = NewStatsRepo(db).SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "merchant", items[0].SourceID)
	f.MerchantOnly = false
	f.IncludeSourceIDs = []string{"far"}
	items, _, err = NewStatsRepo(db).SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	assert.Empty(t, items)

	// Legacy rows may only carry the exact directory name and type=campus.
	// They still resolve to the known school, never bypass access as merchants.
	require.NoError(t, db.Table("public_food_library").Create(map[string]any{
		"id": "name-only-campus", "food_name": "牛肉饭", "status": "published", "type": "campus",
		"is_campus_food": false, "school_name": "测试大学", "merchant_name": "校园窗口",
		"total_calories": 500, "total_protein": 30, "price": 15, "price_unit": "元/份",
	}).Error)
	f.IncludeSourceIDs = []string{"name-only-campus"}
	items, _, err = NewStatsRepo(db).SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "s", items[0].SchoolID)
	assert.Equal(t, "school", items[0].LocationLevel)
	assert.True(t, items[0].IsCampusFood)
	f.MerchantOnly = true
	items, _, err = NewStatsRepo(db).SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	assert.Empty(t, items)
}

type countingSQLWriter struct{ statements *[]string }

func (w countingSQLWriter) Printf(format string, args ...any) {
	*w.statements = append(*w.statements, fmt.Sprintf(format, args...))
}

// Prod 2026-11-25: one nearby catalog scan near 清华 read 5288 dishes in 11 pages and counted the
// whole catalog on every page (about 0.44 s each of the 0.58 s a page took).
func TestNearbyCatalogScanCountsOnlyOnce(t *testing.T) {
	statements := []string{}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormlogger.New(countingSQLWriter{&statements}, gormlogger.Config{LogLevel: gormlogger.Info, SlowThreshold: time.Hour})})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	for _, ddl := range []string{
		`CREATE TABLE public_food_library (id TEXT, user_id TEXT,food_name TEXT,description TEXT,items TEXT,status TEXT,type TEXT,total_calories REAL,total_protein REAL,total_carbs REAL,total_fat REAL,is_campus_food BOOLEAN,school_id TEXT,school_name TEXT,campus_id TEXT,campus_name TEXT,canteen_id TEXT,canteen_name TEXT,window_id TEXT,window_name TEXT,floor TEXT,price REAL,price_unit TEXT,image_path TEXT,merchant_name TEXT,merchant_address TEXT,detail_address TEXT,latitude REAL,longitude REAL,availability_status TEXT)`,
		`CREATE TABLE school_canteens (id TEXT,campus_id TEXT,school_id TEXT,status TEXT,latitude REAL,longitude REAL)`,
		`CREATE TABLE school_campuses (id TEXT,school_id TEXT,status TEXT,address TEXT,latitude REAL,longitude REAL)`,
		`CREATE TABLE schools (id TEXT,status TEXT,latitude REAL,longitude REAL,name TEXT,location_type TEXT)`,
		`CREATE TABLE user_blocks (blocker_user_id TEXT,blocked_user_id TEXT)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	for _, id := range []string{"a", "b", "c"} {
		require.NoError(t, db.Table("public_food_library").Create(map[string]any{"id": id, "user_id": "u", "food_name": "鱼饭" + id, "merchant_name": "鱼饭店", "status": "published", "total_calories": 500, "items": `[]`, "latitude": 40.001, "longitude": 116.0}).Error)
	}
	counts := func() int {
		n := 0
		for _, s := range statements {
			if strings.Contains(strings.ToLower(s), "count(") {
				n++
			}
		}
		return n
	}
	repo := NewStatsRepo(db)
	f := domain.CampusDietSearchFilter{Location: &domain.DietLocation{Latitude: 40, Longitude: 116, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}, RadiusKM: 3, ScanCatalog: true, Limit: 2, AllowUnknownNutrition: true}
	statements = statements[:0]
	first, total, err := repo.SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	require.Len(t, first, 2)
	assert.EqualValues(t, 3, total)
	assert.Equal(t, 1, counts())

	statements = statements[:0]
	f.AfterID, f.KnownTotal = first[1].SourceID, total
	second, total, err := repo.SearchCampusDietCandidates(context.Background(), f)
	require.NoError(t, err)
	require.Len(t, second, 1)
	assert.Equal(t, "c", second[0].SourceID)
	assert.EqualValues(t, 3, total, "the first page's total is carried")
	assert.Zero(t, counts(), "a later page does not count the catalog again")
}
