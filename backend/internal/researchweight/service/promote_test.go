package service

import (
	"context"
	"slices"
	"strings"
	"testing"

	"food_link/backend/internal/researchweight/domain"

	"github.com/stretchr/testify/require"
)

func (f *fakeRepo) ListPromotable(_ context.Context, filter domain.PromotableFilter) ([]domain.Sample, error) {
	var samples []domain.Sample
	for _, sample := range f.samples {
		if sample.Status != domain.StatusApproved || sample.BenchmarkSampleID != nil || sample.QualityTier == nil {
			continue
		}
		if !slices.Contains(filter.QualityTiers, *sample.QualityTier) {
			continue
		}
		if filter.CollectionChannel != "" && sample.CollectionChannel != filter.CollectionChannel {
			continue
		}
		samples = append(samples, *sample)
	}
	slices.SortFunc(samples, func(a, b domain.Sample) int { return strings.Compare(a.ID, b.ID) })
	if len(samples) > filter.Limit {
		samples = samples[:filter.Limit]
	}
	return samples, nil
}

func approvedSample(t *testing.T, svc *SampleService, key, dish, tier string) string {
	t.Helper()
	input := wholeInput()
	input.ClientKey, input.DishName = key, dish
	for index := range input.Photos {
		input.Photos[index].URL = "https://cdn.test/research-weight/u1/" + key + "-" + input.Photos[index].Role + ".jpg"
	}
	view, err := svc.Submit(context.Background(), "u1", input)
	require.NoError(t, err)
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: tier})
	require.NoError(t, err)
	return view.ID
}

func TestPromoteCarriesProvenanceForBenchmarkSplits(t *testing.T) {
	svc, repo, _ := newTestService()
	id := approvedSample(t, svc, "sample-key-prov", "红烧牛肉面", "A")
	_, err := svc.Promote(context.Background(), id, PromoteInput{})
	require.NoError(t, err)
	meta := repo.labeled[0].Metadata
	require.Equal(t, "u1", meta["contributor_id"])
	require.Equal(t, "personal", meta["collection_channel"])
	require.Equal(t, domain.ReviewModeManual, meta["review_mode"])
	require.Equal(t, domain.ReviewModeManual, meta["review_version"])
	require.Contains(t, meta, "campaign_id")
	require.Contains(t, meta, "auto_review")

	auto := repo.samples[approvedSample(t, svc, "sample-key-auto", "番茄炒蛋", "B")]
	auto.ReviewMode = domain.ReviewModeAuto
	auto.AutoReview = &domain.AutoReview{Version: domain.AutoReviewVersion}
	_, err = svc.Promote(context.Background(), auto.ID, PromoteInput{})
	require.NoError(t, err)
	require.Equal(t, domain.AutoReviewVersion, repo.labeled[1].Metadata["review_version"])
}

func TestPromoteRefusesTestSamples(t *testing.T) {
	svc, repo, _ := newTestService()
	id := approvedSample(t, svc, "sample-key-test", " 测试-外卖两盒", "A")
	_, err := svc.Promote(context.Background(), id, PromoteInput{})
	require.ErrorContains(t, err, "测试")
	require.Empty(t, repo.labeled)
	require.Nil(t, repo.samples[id].BenchmarkSampleID)
}

func TestPromoteBatchTakesApprovedTiersAndSkipsTestSamples(t *testing.T) {
	svc, repo, _ := newTestService()
	a := approvedSample(t, svc, "sample-key-ba", "米饭", "A")
	b := approvedSample(t, svc, "sample-key-bb", "宫保鸡丁", "B")
	c := approvedSample(t, svc, "sample-key-bc", "青菜", "C")
	test := approvedSample(t, svc, "sample-key-bt", "测试-家里白瓷碗", "A")
	pending := wholeInput()
	pending.ClientKey, pending.DishName = "sample-key-bp", "鱼香肉丝"
	for index := range pending.Photos {
		pending.Photos[index].URL = "https://cdn.test/research-weight/u1/bp-" + pending.Photos[index].Role + ".jpg"
	}
	_, err := svc.Submit(context.Background(), "u1", pending)
	require.NoError(t, err)

	result, err := svc.PromoteBatch(context.Background(), BatchPromoteInput{BatchName: "pilot_2"})
	require.NoError(t, err)
	require.Equal(t, &BatchPromoteResult{BatchName: "pilot_2", Promoted: 2, SkippedTest: 1}, result)
	require.NotNil(t, repo.samples[a].BenchmarkSampleID)
	require.NotNil(t, repo.samples[b].BenchmarkSampleID)
	require.Nil(t, repo.samples[c].BenchmarkSampleID, "C is outside the default tiers")
	require.Nil(t, repo.samples[test].BenchmarkSampleID)
	for _, labeled := range repo.labeled {
		require.Equal(t, "pilot_2", labeled.BatchName)
	}

	again, err := svc.PromoteBatch(context.Background(), BatchPromoteInput{BatchName: "pilot_2", QualityTiers: []string{"c"}})
	require.NoError(t, err)
	require.Equal(t, 1, again.Promoted)

	_, err = svc.PromoteBatch(context.Background(), BatchPromoteInput{QualityTiers: []string{"S"}})
	require.ErrorContains(t, err, "等级")
	_, err = svc.PromoteBatch(context.Background(), BatchPromoteInput{BatchName: "bad name!"})
	require.ErrorContains(t, err, "批次名")
}
