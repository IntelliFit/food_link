package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func (f *fakeCommunityRepo) FindVenueCollectorApplication(_ context.Context, _, _, _, _ string) (*domain.CollectorApplication, error) {
	if f.collectorApplication != nil && f.collectorApplication.Status == "pending" {
		return f.collectorApplication, nil
	}
	return nil, nil
}

func (f *fakeCommunityRepo) HasActiveVenueCollectorScope(context.Context, string, string, string, string, time.Time) (bool, error) {
	return f.collectorAllowed, nil
}

func TestVenueCollectorsApplyAndPublishAllCanteenTypes(t *testing.T) {
	for _, venueType := range []string{"community", "office_park", "corporate"} {
		t.Run(venueType, func(t *testing.T) {
			repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{}}
			svc := NewCatalogService(repo, nil)
			application, err := svc.ApplyCollector(context.Background(), uuid.NewString(), CollectorApplicationInput{
				VenueType: venueType, OrganizationName: "北京AI原点社区", CanteenName: "原点食堂",
			})
			require.NoError(t, err)
			require.Empty(t, application.SchoolID)
			require.Equal(t, venueType, application.VenueType)
			require.Equal(t, "AI原点社区", application.OrganizationName)
			input := CreateBatchInput{ClientBatchKey: "batch-" + venueType, VenueType: venueType, OrganizationName: "AI原点社区", CanteenName: "原点食堂",
				Entries: []CreateCatalogItemInput{{Name: "鸡腿饭", ImagePaths: []string{"campus-food/dish.jpg"}, PriceType: "unknown"}}}
			_, err = svc.CreateCollectorBatch(context.Background(), uuid.NewString(), input)
			require.ErrorContains(t, err, "尚未获得该食堂范围")
			repo.collectorAllowed = true
			result, err := svc.CreateCollectorBatch(context.Background(), uuid.NewString(), input)
			require.NoError(t, err)
			require.Equal(t, venueType, result.Batch.VenueType)
			require.Nil(t, result.Batch.SchoolID)
			require.Len(t, result.Items, 1)
			require.Equal(t, "published", result.Items[0].Status)
			require.Equal(t, "collector_batch", result.Items[0].SourceChannel)
		})
	}
}

func TestVenueCollectorRejectsInvalidOrMixedLocation(t *testing.T) {
	svc := NewCatalogService(&fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{}}, nil)
	for _, input := range []CollectorApplicationInput{
		{VenueType: "unknown", OrganizationName: "机构"},
		{VenueType: "community"},
		{VenueType: "corporate", OrganizationName: "公司", SchoolID: uuid.NewString()},
	} {
		_, err := svc.ApplyCollector(context.Background(), uuid.NewString(), input)
		require.Error(t, err)
	}
}
