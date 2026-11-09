package repo

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/researchweight/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestListPromotableFiltersByTierChannelAndBenchmarkState(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, userID := context.Background(), uuid.NewString()
	approve := func(key, tier, channel string) string {
		sample := pendingSample(userID, key)
		sample.CollectionChannel = channel
		created, _, err := repo.Create(ctx, sample)
		require.NoError(t, err)
		if tier != "" {
			_, err = repo.Review(ctx, created.ID, map[string]any{"status": domain.StatusApproved, "quality_tier": tier})
			require.NoError(t, err)
		}
		return created.ID
	}
	a := approve("client-key-p1", "A", "personal")
	b := approve("client-key-p2", "B", "campus_self_scale")
	approve("client-key-p3", "C", "personal")
	approve("client-key-p4", "", "personal")
	promoted := approve("client-key-p5", "A", "personal")
	_, err := repo.Promote(ctx, promoted, func(s *domain.Sample) *migrationdo.FoodWeightLabeledSampleDO {
		total := s.TotalNetGrams
		return &migrationdo.FoodWeightLabeledSampleDO{
			ID: uuid.NewString(), BatchName: "pilot", SampleName: s.DishName, OriginalFilename: "top.jpg",
			LabelType: "total", TotalWeightGrams: &total, Items: map[string]any{"__total__": total}, Status: "labeled", Metadata: map[string]any{},
		}
	})
	require.NoError(t, err)

	ids := func(filter domain.PromotableFilter) []string {
		samples, err := repo.ListPromotable(ctx, filter)
		require.NoError(t, err)
		out := []string{}
		for _, sample := range samples {
			out = append(out, sample.ID)
		}
		return out
	}
	require.Equal(t, []string{a, b}, ids(domain.PromotableFilter{QualityTiers: []string{"A", "B"}, Limit: 10}))
	require.Equal(t, []string{b}, ids(domain.PromotableFilter{QualityTiers: []string{"A", "B"}, CollectionChannel: "campus_self_scale", Limit: 10}))
	require.Equal(t, []string{a}, ids(domain.PromotableFilter{QualityTiers: []string{"A", "B"}, Limit: 1}))
}
