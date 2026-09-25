package publicfoodsync

import (
	"context"
	"fmt"
	"testing"

	"food_link/backend/internal/marketingqr/catalog"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type testSchool struct {
	ID           string
	Name         string
	Status       string
	LocationType string
	Latitude     *float64
	Longitude    *float64
}

func (testSchool) TableName() string { return "schools" }

type testCampus struct {
	ID        string
	SchoolID  string
	Name      string
	Status    string
	Latitude  *float64
	Longitude *float64
}

func (testCampus) TableName() string { return "school_campuses" }

type testCanteen struct {
	ID        string
	SchoolID  string
	CampusID  string
	Name      string
	Status    string
	Latitude  *float64
	Longitude *float64
}

func (testCanteen) TableName() string { return "school_canteens" }

type testWindow struct {
	ID        string
	CanteenID string
	Name      string
	Status    string
}

func (testWindow) TableName() string { return "canteen_windows" }

func TestSyncerSeedsPublicLibraryOnceAndPreservesCorrections(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:marketing-sync-%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&publicFoodSeedRow{}, &testSchool{}, &testCampus{}, &testCanteen{}, &testWindow{}); err != nil {
		t.Fatal(err)
	}
	lat, lng := 43.894, 125.281
	if err := db.Create(&testSchool{ID: "school-1", Name: "吉林工商学院", Status: "active", LocationType: "university", Latitude: &lat, Longitude: &lng}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&testCampus{ID: "campus-1", SchoolID: "school-1", Name: "卡伦湖校区", Status: "active", Latitude: &lat, Longitude: &lng}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&testCanteen{ID: "canteen-1", SchoolID: "school-1", CampusID: "campus-1", Name: "一食堂", Status: "active", Latitude: &lat, Longitude: &lng}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&testWindow{ID: "window-1", CanteenID: "canteen-1", Name: "三生晓", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}

	syncer := New(db)
	dryRun, err := syncer.Run(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if dryRun.WouldInsert != 73 || dryRun.Inserted != 0 {
		t.Fatalf("预检统计不正确: %+v", dryRun)
	}

	first, err := syncer.Run(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if first.Inserted != 73 || first.PublishedLinked != 73 || first.MapReadyProducts != 73 || first.MapSpotCount != 1 {
		t.Fatalf("首次同步统计不正确: %+v", first)
	}
	if first.Directory.SchoolID != "school-1" || first.Directory.CanteenID != "canteen-1" || first.Directory.WindowID != "window-1" {
		t.Fatalf("目录关联不正确: %+v", first.Directory)
	}

	freshJuiceID, ok := catalog.PublicFoodItemID("ssx471984")
	if !ok {
		t.Fatal("鲜榨苹果汁缺少稳定 ID")
	}
	correctedLatitude := 44.001
	if err := db.Table("public_food_library").Where("id = ?", freshJuiceID).Updates(map[string]any{
		"food_name": "鲜榨苹果汁（核验版）", "total_calories": 999, "latitude": correctedLatitude,
	}).Error; err != nil {
		t.Fatal(err)
	}

	second, err := syncer.Run(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if second.Inserted != 0 || second.ExistingByID != 73 || second.PublishedLinked != 73 {
		t.Fatalf("重复同步不应新增商品: %+v", second)
	}
	var preserved struct {
		FoodName      string
		TotalCalories float64
		Latitude      float64
	}
	if err := db.Table("public_food_library").Select("food_name, total_calories, latitude").Where("id = ?", freshJuiceID).Scan(&preserved).Error; err != nil {
		t.Fatal(err)
	}
	if preserved.FoodName != "鲜榨苹果汁（核验版）" || preserved.TotalCalories != 999 || preserved.Latitude != correctedLatitude {
		t.Fatalf("人工修订被同步覆盖: %+v", preserved)
	}
}
