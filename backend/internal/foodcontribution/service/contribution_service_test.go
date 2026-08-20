package service

import (
	"context"
	"testing"
	"time"

	contributiondomain "food_link/backend/internal/foodcontribution/domain"
	contributionrepo "food_link/backend/internal/foodcontribution/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/require"
)

type contributionRepoStub struct {
	created  *contributiondomain.FoodNutritionContribution
	reviewed contributiondomain.FoodNutritionContribution
	marked   int
}

func (s *contributionRepoStub) Create(_ context.Context, item *contributiondomain.FoodNutritionContribution) error {
	item.ID = "contribution-1"
	item.CreatedAt = time.Now()
	s.created = item
	return nil
}
func (s *contributionRepoStub) Mine(context.Context, string) ([]contributiondomain.FoodNutritionContribution, error) {
	return nil, nil
}
func (s *contributionRepoStub) List(context.Context, contributionrepo.ListInput) (*contributionrepo.ListResult, error) {
	return &contributionrepo.ListResult{}, nil
}
func (s *contributionRepoStub) Get(_ context.Context, _ string) (*contributiondomain.FoodNutritionContribution, error) {
	return &s.reviewed, nil
}
func (s *contributionRepoStub) MarkRewarded(context.Context, string) error { s.marked++; return nil }
func (s *contributionRepoStub) Review(_ context.Context, id, action, target, note, reviewer string) (*contributiondomain.FoodNutritionContribution, error) {
	s.reviewed = contributiondomain.FoodNutritionContribution{ID: id, UserID: "user-1", CanonicalName: "鸡蛋", Status: "approved", TargetFoodID: &target}
	if action == "reject" {
		s.reviewed.Status = "rejected"
	}
	return &s.reviewed, nil
}

type rewardStub struct{ calls int }

func (s *rewardStub) AwardStandardFoodContribution(context.Context, string, string, map[string]any) (map[string]any, error) {
	s.calls++
	return map[string]any{"awarded": s.calls == 1}, nil
}

func TestSubmitRequiresSourceOrEvidence(t *testing.T) {
	svc := NewContributionService(&contributionRepoStub{}, nil)
	_, err := svc.Submit(context.Background(), "user-1", SubmitInput{CanonicalName: "鸡蛋", KcalPer100g: 144, ProteinPer100g: 13, CarbsPer100g: 1, FatPer100g: 10})
	require.ErrorContains(t, err, "来源说明或证据图片")
}

func TestSubmitRejectsPunctuationOnlyName(t *testing.T) {
	svc := NewContributionService(&contributionRepoStub{}, nil)
	_, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		CanonicalName: "（）---", KcalPer100g: 100, SourceText: "标签",
	})
	require.ErrorContains(t, err, "必须包含文字或数字")
}

func TestSubmitNormalizesAndDeduplicatesEvidence(t *testing.T) {
	repo := &contributionRepoStub{}
	svc := NewContributionService(repo, nil)
	item, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		CanonicalName: " 熟 鸡蛋 ", KcalPer100g: 144, ProteinPer100g: 13, CarbsPer100g: 1, FatPer100g: 10,
		EvidenceImagePaths: []string{"1", "2", "2", "3", "4", "5"},
	})
	require.NoError(t, err)
	require.Equal(t, "熟鸡蛋", item.NormalizedName)
	require.Equal(t, []string{"1", "2", "3", "4", "5"}, item.EvidenceImagePaths)
}

func TestSubmitRejectsMoreThanFiveEvidenceImages(t *testing.T) {
	svc := NewContributionService(&contributionRepoStub{}, nil)
	_, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		CanonicalName: "熟鸡蛋", KcalPer100g: 144, ProteinPer100g: 13, CarbsPer100g: 1, FatPer100g: 10,
		EvidenceImagePaths: []string{"1", "2", "3", "4", "5", "6"},
	})
	require.ErrorContains(t, err, "最多上传5张")
}

func TestSubmitStoresTrustedEvidenceAsObjectKeyAndReturnsURL(t *testing.T) {
	repo := &contributionRepoStub{}
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewContributionService(repo, nil, storageClient)
	item, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		CanonicalName: "熟鸡蛋", KcalPer100g: 144, ProteinPer100g: 13, CarbsPer100g: 1, FatPer100g: 10,
		EvidenceImagePaths: []string{"https://cdn.example.com/food/user-1/evidence.jpg"},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"user-1/evidence.jpg"}, repo.created.EvidenceImagePaths)
	require.Equal(t, []string{"https://cdn.example.com/food/user-1/evidence.jpg"}, item.EvidenceImagePaths)
}

func TestSubmitRejectsExternalEvidenceURL(t *testing.T) {
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewContributionService(&contributionRepoStub{}, nil, storageClient)
	_, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		CanonicalName: "熟鸡蛋", KcalPer100g: 144,
		EvidenceImagePaths: []string{"https://tracker.example/evidence.jpg"},
	})
	require.ErrorContains(t, err, "必须来自食探图片存储")
}

func TestReviewApprovalAwardsAndMarksReward(t *testing.T) {
	repo := &contributionRepoStub{}
	reward := &rewardStub{}
	svc := NewContributionService(repo, reward)
	item, err := svc.Review(context.Background(), "contribution-1", "admin-1", ReviewInput{Action: "approve_new"})
	require.NoError(t, err)
	require.Equal(t, "approved", item.Status)
	require.Equal(t, 1, reward.calls)
	require.Equal(t, 1, repo.marked)
}

func TestReviewRejectRequiresReason(t *testing.T) {
	svc := NewContributionService(&contributionRepoStub{}, nil)
	_, err := svc.Review(context.Background(), "contribution-1", "admin-1", ReviewInput{Action: "reject"})
	require.ErrorContains(t, err, "驳回时必须填写原因")
}
