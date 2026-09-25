package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
)

func (s *PublicFoodService) ListMapSpots(ctx context.Context, userID string) ([]domain.PublicFoodMapSpot, error) {
	candidates, err := s.repo.ListPublishedMapCandidates(ctx, userID)
	if err != nil {
		return nil, err
	}
	spots := make([]domain.PublicFoodMapSpot, 0)
	spotIndexes := make(map[string]int)
	for _, candidate := range candidates {
		spot, ok := mapSpotFromCandidate(candidate)
		if !ok {
			continue
		}
		if index, exists := spotIndexes[spot.Key]; exists {
			spots[index].FoodCount++
			continue
		}
		spot.FeaturedItem = s.normalizePublicFoodItem(spot.FeaturedItem)
		spotIndexes[spot.Key] = len(spots)
		spots = append(spots, spot)
	}
	sort.SliceStable(spots, func(left, right int) bool {
		if spots[left].FoodCount != spots[right].FoodCount {
			return spots[left].FoodCount > spots[right].FoodCount
		}
		return spots[left].LocationName < spots[right].LocationName
	})
	return spots, nil
}

func mapSpotFromCandidate(candidate repo.MapFoodCandidate) (domain.PublicFoodMapSpot, bool) {
	latitude, longitude, level, key := 0.0, 0.0, "", ""
	locationName, address := "", ""
	switch {
	case validMapCoordinate(candidate.DirectLatitude, candidate.DirectLongitude):
		latitude, longitude, level = *candidate.DirectLatitude, *candidate.DirectLongitude, "food"
		key = fmt.Sprintf("food:%.5f:%.5f", latitude, longitude)
		locationName = firstText(candidate.MerchantName, candidate.CanteenName, candidate.CampusName, candidate.SchoolName, "FoodLink 用户点亮")
		address = firstText(candidate.DetailAddress, candidate.MerchantAddress, candidate.CampusLocationText)
	case candidate.DirectoryCanteenID != "" && validMapCoordinate(candidate.CanteenLatitude, candidate.CanteenLongitude):
		latitude, longitude, level = *candidate.CanteenLatitude, *candidate.CanteenLongitude, "canteen"
		key = "canteen:" + candidate.DirectoryCanteenID
		locationName = joinMapLocation(candidate.DirectorySchool, candidate.DirectoryCanteen)
		address = joinMapLocation(candidate.DirectoryCampus, candidate.CanteenLocation, candidate.CampusAddress)
	case candidate.DirectoryCampusID != "" && validMapCoordinate(candidate.CampusLatitude, candidate.CampusLongitude):
		latitude, longitude, level = *candidate.CampusLatitude, *candidate.CampusLongitude, "campus"
		key = "campus:" + candidate.DirectoryCampusID
		locationName = joinMapLocation(candidate.DirectorySchool, firstText(candidate.DirectoryCampus, candidate.CampusName))
		address = candidate.CampusAddress
	case candidate.DirectorySchoolID != "" && validMapCoordinate(candidate.SchoolLatitude, candidate.SchoolLongitude):
		latitude, longitude, level = *candidate.SchoolLatitude, *candidate.SchoolLongitude, "school"
		key = "school:" + candidate.DirectorySchoolID
		locationName = firstText(candidate.DirectorySchool, candidate.SchoolName)
		address = joinMapLocation(candidate.SchoolProvince, candidate.SchoolCity)
	default:
		return domain.PublicFoodMapSpot{}, false
	}
	featured := domain.PublicFoodItem{
		ID: candidate.ID, UserID: candidate.UserID, FoodName: candidate.FoodName, Description: candidate.Description,
		ImagePath: candidate.ImagePath, ImagePaths: []string{}, Items: []map[string]any{}, UserTags: []string{},
		TotalCalories: candidate.TotalCalories, TotalProtein: candidate.TotalProtein, TotalCarbs: candidate.TotalCarbs, TotalFat: candidate.TotalFat,
		Type: candidate.Type, LikeCount: candidate.LikeCount, CommentCount: candidate.CommentCount, CollectionCount: candidate.CollectionCount,
		PublishedAt: candidate.PublishedAt, CreatedAt: candidate.CreatedAt, UpdatedAt: candidate.UpdatedAt,
		MerchantName: candidate.MerchantName, MerchantAddress: candidate.MerchantAddress, DetailAddress: candidate.DetailAddress,
		Latitude: &latitude, Longitude: &longitude, IsCampusFood: candidate.IsCampusFood || candidate.Type == publicFoodTypeCampus,
		SchoolID: candidate.SchoolID, CampusID: candidate.CampusID, CanteenID: candidate.CanteenID,
		SchoolName: candidate.SchoolName, CampusName: candidate.CampusName, CanteenName: candidate.CanteenName,
		CampusLocationText: candidate.CampusLocationText, Status: "published",
	}
	return domain.PublicFoodMapSpot{
		Key: key, Latitude: latitude, Longitude: longitude, LocationLevel: level,
		LocationName: locationName, Address: address, FoodCount: 1, FeaturedItem: featured,
	}, true
}

func validMapCoordinate(latitude, longitude *float64) bool {
	return latitude != nil && longitude != nil && *latitude >= -90 && *latitude <= 90 && *longitude >= -180 && *longitude <= 180 && !(*latitude == 0 && *longitude == 0)
}

func firstText(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func joinMapLocation(values ...string) string {
	seen := make(map[string]struct{}, len(values))
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		parts = append(parts, value)
	}
	return strings.Join(parts, " · ")
}
