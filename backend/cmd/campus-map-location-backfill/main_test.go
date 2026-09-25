package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestChoosePOIRequiresMatchingSchoolAndCampus(t *testing.T) {
	candidate := locationCandidate{Kind: "campus", SchoolName: "北京大学", CampusName: "燕园校区", City: "北京市"}
	selected, ok := choosePOI(candidate, []poi{
		{Name: "北京大学医学部", Address: "北京市海淀区学院路", Longitude: 116.36, Latitude: 39.98},
		{Name: "北京大学燕园校区", Address: "北京市海淀区颐和园路5号", Longitude: 116.31, Latitude: 39.99},
	})
	require.True(t, ok)
	require.Equal(t, "北京大学燕园校区", selected.Name)
}

func TestChoosePOIRejectsUnrelatedPlace(t *testing.T) {
	_, ok := choosePOI(locationCandidate{Kind: "school", SchoolName: "清华大学"}, []poi{
		{Name: "清华园街道", Address: "北京市海淀区", Longitude: 116.32, Latitude: 40.0},
	})
	require.False(t, ok)
}

func TestChoosePOIRequiresMatchingSchoolAndCanteen(t *testing.T) {
	candidate := locationCandidate{
		Kind: "canteen", SchoolName: "清华大学", CampusName: "清华园校区",
		CanteenName: "紫荆园", City: "北京市",
	}
	selected, ok := choosePOI(candidate, []poi{
		{Name: "紫荆园餐厅", Address: "北京市朝阳区", Longitude: 116.48, Latitude: 39.95},
		{Name: "清华大学紫荆园餐厅", Address: "清华大学清华园校区", Longitude: 116.33, Latitude: 40.01},
	})
	require.True(t, ok)
	require.Equal(t, "清华大学紫荆园餐厅", selected.Name)
}

func TestChoosePOIAcceptsNormalizedCanteenSuffix(t *testing.T) {
	candidate := locationCandidate{Kind: "canteen", SchoolName: "清华大学", CanteenName: "桃李园简约餐厅"}
	selected, ok := choosePOI(candidate, []poi{
		{Name: "清华大学桃李园餐厅", Address: "清华大学", Longitude: 116.32, Latitude: 40.0},
	})
	require.True(t, ok)
	require.Equal(t, "清华大学桃李园餐厅", selected.Name)
}

func TestChoosePOIAcceptsReviewedSchoolAbbreviationWithExactCanteen(t *testing.T) {
	candidate := locationCandidate{Kind: "canteen", SchoolName: "北京大学", CanteenName: "家园食堂"}
	selected, ok := choosePOI(candidate, []poi{
		{Name: "北大家园食堂", Address: "北京市海淀区颐和园路5号", Longitude: 116.31, Latitude: 39.99},
	})
	require.True(t, ok)
	require.Equal(t, "北大家园食堂", selected.Name)
}

func TestSearchQueriesAddsConservativeCanteenFallbacks(t *testing.T) {
	queries := searchQueries(locationCandidate{Kind: "canteen", SchoolName: "北京大学", CanteenName: "勺园食堂"})
	require.Equal(t, []string{"北京大学 勺园食堂", "北京大学 勺园", "勺园食堂", "勺园"}, queries)
}

func TestChoosePOIPrefersDiningPOIOverSameNamedCampusArea(t *testing.T) {
	candidate := locationCandidate{Kind: "canteen", SchoolName: "北京大学", CanteenName: "勺园食堂"}
	selected, ok := choosePOI(candidate, []poi{
		{Name: "勺园", Address: "北京大学内", Longitude: 116.31, Latitude: 39.99},
		{Name: "勺园餐厅", Address: "北京大学勺园7号楼", Longitude: 116.312, Latitude: 39.992},
	})
	require.True(t, ok)
	require.Equal(t, "勺园餐厅", selected.Name)
}

func TestParseLonLatAndConvertCoordinate(t *testing.T) {
	longitude, latitude, ok := parseLonLat("116.397128,39.916527")
	require.True(t, ok)
	gcjLongitude, gcjLatitude := cgcs2000ToGCJ02(longitude, latitude)
	require.InDelta(t, 116.403, gcjLongitude, 0.002)
	require.InDelta(t, 39.918, gcjLatitude, 0.002)
}

func TestLowConfidenceLocationOverrideCoversPendingFoodLocations(t *testing.T) {
	tests := []locationCandidate{
		{Kind: "canteen", SchoolName: "清华大学", CanteenName: "桃李园简约餐厅"},
		{Kind: "canteen", SchoolName: "清华大学", CampusName: "清华园校区", CanteenName: "桃李园"},
		{Kind: "campus", SchoolName: "北京大学", CampusName: "燕园校区"},
		{Kind: "school", SchoolName: "吉林工商学院"},
	}
	for _, candidate := range tests {
		selected, ok := lowConfidenceLocationOverride(candidate)
		require.True(t, ok, displayName(candidate))
		require.True(t, validCoordinate(selected.Longitude, selected.Latitude), displayName(candidate))
	}
}
