package service

import (
	"testing"

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
