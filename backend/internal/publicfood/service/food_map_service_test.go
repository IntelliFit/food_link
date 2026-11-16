package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"

	"github.com/stretchr/testify/require"
)

func TestMapSpotFromCandidateUsesDirectMerchantLocation(t *testing.T) {
	lat, lng := 43.894229, 125.280655
	spot, ok := mapSpotFromCandidate(repo.MapFoodCandidate{
		ID: "food-1", FoodName: "鲜榨苹果汁", MerchantName: "三生晓",
		DetailAddress: "吉林工商学院一食堂二楼", DirectLatitude: &lat, DirectLongitude: &lng,
	})
	if !ok {
		t.Fatal("有效商品坐标应生成地图点")
	}
	if spot.Key != "food:43.89423:125.28065" || spot.LocationLevel != "food" || spot.LocationName != "三生晓" {
		t.Fatalf("商品地图点不正确: %+v", spot)
	}
	if spot.FeaturedItem.ID != "food-1" || spot.FeaturedItem.Latitude == nil || spot.FeaturedItem.Longitude == nil {
		t.Fatalf("代表商品不完整: %+v", spot.FeaturedItem)
	}
}

func TestMapSpotFromCandidatePrefersSQLSpotKey(t *testing.T) {
	latitude, longitude := 31.2749, 121.5423
	spot, ok := mapSpotFromCandidate(repo.MapFoodCandidate{
		ID: "food-1", SpotKey: "food:31.27490:121.54230", SpotFoodCount: 279, DirectLatitude: &latitude, DirectLongitude: &longitude,
	})
	if !ok || spot.Key != "food:31.27490:121.54230" || spot.FoodCount != 279 {
		t.Fatalf("unexpected spot: %+v ok=%v", spot, ok)
	}
}

func TestMapSpotCacheReusesSpotsUntilExpiry(t *testing.T) {
	current := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	var pending []func()
	cache := mapSpotCache{now: func() time.Time { return current }, async: func(task func()) { pending = append(pending, task) }}
	loads := 0
	load := func(context.Context) ([]domain.PublicFoodMapSpot, error) {
		loads++
		return []domain.PublicFoodMapSpot{{Key: fmt.Sprintf("food:%d", loads)}}, nil
	}
	for range 3 {
		if _, err := cache.get(load, context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if loads != 1 {
		t.Fatalf("loads = %d, want 1 while fresh", loads)
	}
	current = current.Add(mapSpotCacheTTL)
	for range 3 {
		spots, err := cache.get(load, context.Background())
		if err != nil || spots[0].Key != "food:1" {
			t.Fatalf("expired read should return the stale spots at once: %v %v", spots, err)
		}
	}
	if len(pending) != 1 {
		t.Fatalf("refreshes started = %d, want 1", len(pending))
	}
	pending[0]()
	spots, _ := cache.get(load, context.Background())
	if loads != 2 || spots[0].Key != "food:2" {
		t.Fatalf("loads=%d spots=%v, want refreshed spots", loads, spots)
	}
}

func TestMapSpotCacheDoesNotKeepFailures(t *testing.T) {
	cache := mapSpotCache{}
	if _, err := cache.get(func(context.Context) ([]domain.PublicFoodMapSpot, error) { return nil, errors.New("db down") }, context.Background()); err == nil {
		t.Fatal("want error")
	}
	spots, err := cache.get(func(context.Context) ([]domain.PublicFoodMapSpot, error) { return []domain.PublicFoodMapSpot{{Key: "a"}}, nil }, context.Background())
	if err != nil || len(spots) != 1 {
		t.Fatalf("spots=%v err=%v", spots, err)
	}
}

func TestMapSpotCacheKeepsStaleSpotsWhenRefreshFails(t *testing.T) {
	current := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	cache := mapSpotCache{now: func() time.Time { return current }, async: func(task func()) { task() }}
	ok := func(context.Context) ([]domain.PublicFoodMapSpot, error) { return []domain.PublicFoodMapSpot{{Key: "a"}}, nil }
	if _, err := cache.get(ok, context.Background()); err != nil {
		t.Fatal(err)
	}
	current = current.Add(mapSpotCacheTTL)
	failing := func(context.Context) ([]domain.PublicFoodMapSpot, error) { return nil, errors.New("db down") }
	if _, err := cache.get(failing, context.Background()); err != nil {
		t.Fatal(err)
	}
	spots, err := cache.get(ok, context.Background())
	if err != nil || len(spots) != 1 || spots[0].Key != "a" {
		t.Fatalf("spots=%v err=%v, want stale spots kept", spots, err)
	}
	if cache.refreshing {
		t.Fatal("refresh flag should clear after a failed refresh")
	}
}

func TestFilterMapSpotsNearKeepsOrderAndRadius(t *testing.T) {
	spots := []domain.PublicFoodMapSpot{
		{Key: "beijing", Latitude: 39.9042, Longitude: 116.4074},
		{Key: "shanghai", Latitude: 31.2304, Longitude: 121.4737},
		{Key: "tianjin", Latitude: 39.0842, Longitude: 117.2009},
	}
	near := FilterMapSpotsNear(spots, 39.9, 116.4, 150)
	if len(near) != 2 || near[0].Key != "beijing" || near[1].Key != "tianjin" {
		t.Fatalf("near = %v", near)
	}
	if len(spots) != 3 {
		t.Fatal("input must not change")
	}
	if got := FilterMapSpotsNear(spots, 0, 0, 10); len(got) != 0 {
		t.Fatalf("got %v, want none", got)
	}
}

func TestValidMapSpotKey(t *testing.T) {
	for key, want := range map[string]bool{
		"food:31.27490:121.54230":                      true,
		"canteen:5f3c1d9e-8a7b-4c6d-9e0f-1a2b3c4d5e6f": true,
		"school:5f3c1d9e-8a7b-4c6d-9e0f-1a2b3c4d5e6f":  true,
		"":                     false,
		"food:abc:def":         false,
		"canteen:1' OR '1'='1": false,
		"window:5f3c1d9e-8a7b-4c6d-9e0f-1a2b3c4d5e6f": false,
	} {
		if got := validMapSpotKey(key); got != want {
			t.Errorf("validMapSpotKey(%q) = %v, want %v", key, got, want)
		}
	}
}

func TestMapSpotFromCandidateFallsBackToCanteen(t *testing.T) {
	lat, lng := 40.003, 116.326
	spot, ok := mapSpotFromCandidate(repo.MapFoodCandidate{
		ID: "food-2", FoodName: "套餐", SchoolName: "清华大学",
		DirectorySchool: "清华大学", DirectoryCanteenID: "canteen-1", DirectoryCanteen: "紫荆园",
		CanteenLatitude: &lat, CanteenLongitude: &lng,
	})
	if !ok || spot.Key != "canteen:canteen-1" || spot.LocationName != "清华大学 · 紫荆园" {
		t.Fatalf("食堂回退地图点不正确: %+v", spot)
	}
}

func TestMapSpotFromCandidateRejectsMissingLocation(t *testing.T) {
	if _, ok := mapSpotFromCandidate(repo.MapFoodCandidate{ID: "food-3"}); ok {
		t.Fatal("无坐标条目不应进入地图")
	}
}

func TestMapSpotFromCandidatePrefersDirectThenCanteenThenCampusThenSchool(t *testing.T) {
	directLatitude, directLongitude := 31.2, 121.5
	canteenLatitude, canteenLongitude := 39.995, 116.315
	campusLatitude, campusLongitude := 39.99, 116.31
	schoolLatitude, schoolLongitude := 40.0, 116.32
	candidate := repo.MapFoodCandidate{
		ID: "food-1", FoodName: "测试套餐", MerchantName: "测试食堂",
		DirectLatitude: &directLatitude, DirectLongitude: &directLongitude,
		DirectoryCanteenID: "canteen-1", DirectoryCanteen: "勺园食堂", CanteenLocation: "燕园校区",
		CanteenLatitude: &canteenLatitude, CanteenLongitude: &canteenLongitude,
		DirectoryCampusID: "campus-1", DirectoryCampus: "燕园校区", CampusAddress: "颐和园路5号",
		CampusLatitude: &campusLatitude, CampusLongitude: &campusLongitude,
		DirectorySchoolID: "school-1", DirectorySchool: "北京大学",
		SchoolLatitude: &schoolLatitude, SchoolLongitude: &schoolLongitude,
	}

	spot, ok := mapSpotFromCandidate(candidate)
	require.True(t, ok)
	require.Equal(t, "food", spot.LocationLevel)
	require.Equal(t, "测试食堂", spot.LocationName)
	require.Equal(t, directLatitude, spot.Latitude)

	candidate.DirectLatitude, candidate.DirectLongitude = nil, nil
	spot, ok = mapSpotFromCandidate(candidate)
	require.True(t, ok)
	require.Equal(t, "canteen", spot.LocationLevel)
	require.Equal(t, "北京大学 · 勺园食堂", spot.LocationName)
	require.Equal(t, canteenLatitude, spot.Latitude)

	candidate.CanteenLatitude, candidate.CanteenLongitude = nil, nil
	spot, ok = mapSpotFromCandidate(candidate)
	require.True(t, ok)
	require.Equal(t, "campus", spot.LocationLevel)
	require.Equal(t, "北京大学 · 燕园校区", spot.LocationName)
	require.Equal(t, campusLatitude, spot.Latitude)

	candidate.CampusLatitude, candidate.CampusLongitude = nil, nil
	spot, ok = mapSpotFromCandidate(candidate)
	require.True(t, ok)
	require.Equal(t, "school", spot.LocationLevel)
	require.Equal(t, "北京大学", spot.LocationName)
	require.Equal(t, schoolLatitude, spot.Latitude)
}

func TestMapSpotFromCandidateRejectsMissingCoordinates(t *testing.T) {
	_, ok := mapSpotFromCandidate(repo.MapFoodCandidate{ID: "food-1", DirectorySchoolID: "school-1"})
	require.False(t, ok)
}
