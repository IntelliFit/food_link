package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestPublicFoodRepo_CanteenAliasesShareDirectoryAndDishes(t *testing.T) {
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	db := setupPublicFoodRepoTestDB(t)
	t.Cleanup(func() {
		if connection, err := db.DB(); err == nil {
			_ = connection.Close()
		}
	})
	require.NoError(t, db.Exec(`INSERT INTO schools (id, name, location_type) VALUES
		('alias-short', 'AI原点社区', 'community'),
		('alias-long', '北京AI原点社区', 'community'),
		('other-community', '另一个社区', 'community')`).Error)

	now := time.Now().UTC()
	fixtures := []struct{ id, schoolID, name, city, district, canteen string }{
		{"short-missing-city", "alias-short", "AI原点社区", "", "", "原点食堂"},
		{"long-with-city", "alias-long", "北京AI原点社区", "北京市", "海淀区", "原点食堂"},
		{"short-with-city", "alias-short", "AI原点社区", "北京", "海淀区", "原点食堂"},
		{"second-canteen", "alias-long", "北京AI原点社区", "", "", "原点二食堂"},
		{"same-name-other-city", "alias-short", "AI原点社区", "上海市", "", "原点食堂"},
		{"unrelated", "other-community", "另一个社区", "北京", "", "原点食堂"},
	}
	for _, fixture := range fixtures {
		schoolID := fixture.schoolID
		require.NoError(t, db.Create(&domain.PublicFoodItem{
			ID: fixture.id, UserID: "alias-contributor", FoodName: fixture.id,
			SchoolID: &schoolID, SchoolName: fixture.name, CanteenName: fixture.canteen,
			City: fixture.city, District: fixture.district, Status: "published", Type: "common",
			TotalCalories: 420, TotalProtein: 25, Items: preciseCampusItemsForTest(),
			PublishedAt: &now, CreatedAt: &now,
		}).Error)
	}

	r := NewPublicFoodRepo(db)
	locations, err := r.ListCanteenLocations(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, locations, 4, "two Beijing aliases must merge without merging canteens or other cities")

	var organizationKey, canteenKey string
	for _, location := range locations {
		if location.OrganizationName == "AI原点社区" && location.City == "北京" && location.CanteenName == "原点食堂" {
			organizationKey, canteenKey = location.OrganizationKey, location.CanteenKey
			require.EqualValues(t, 3, location.FoodCount)
		}
	}
	require.NotEmpty(t, organizationKey)
	require.NotEmpty(t, canteenKey)

	items, err := r.ListPublished(context.Background(), ListFilter{
		CanteenScope: "community", VenueOrganizationKey: organizationKey, Limit: 20,
	})
	require.NoError(t, err)
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	require.ElementsMatch(t, []string{"short-missing-city", "long-with-city", "short-with-city", "second-canteen"}, ids)

	items, err = r.ListPublished(context.Background(), ListFilter{
		CanteenScope: "community", VenueOrganizationKey: organizationKey, VenueCanteenKey: canteenKey, Limit: 20,
	})
	require.NoError(t, err)
	ids = ids[:0]
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	require.ElementsMatch(t, []string{"short-missing-city", "long-with-city", "short-with-city"}, ids)
}
