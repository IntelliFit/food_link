package service

import (
	"testing"

	"food_link/backend/internal/publicfood/repo"
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
