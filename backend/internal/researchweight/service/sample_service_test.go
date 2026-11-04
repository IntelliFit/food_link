package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/migration/do"
	"food_link/backend/internal/researchweight/domain"
	researchrepo "food_link/backend/internal/researchweight/repo"

	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	samples    map[string]*domain.Sample
	count      int64
	labeled    []*do.FoodWeightLabeledSampleDO
	rewarded   []string
	containers []domain.Container
}

func newFakeRepo() *fakeRepo { return &fakeRepo{samples: map[string]*domain.Sample{}} }

func (f *fakeRepo) Create(_ context.Context, sample *domain.Sample) (*domain.Sample, bool, error) {
	sample.ID = fmt.Sprintf("11111111-2222-3333-4444-%012d", len(f.samples)+1)
	f.samples[sample.ID] = sample
	return sample, true, nil
}
func (f *fakeRepo) FindByClientKey(_ context.Context, userID, clientKey string) (*domain.Sample, error) {
	for _, sample := range f.samples {
		if sample.UserID == userID && sample.ClientKey == clientKey {
			copySample := *sample
			return &copySample, nil
		}
	}
	return nil, nil
}
func (f *fakeRepo) UsedPhotoKeys(_ context.Context, userID string, keys []string) ([]string, error) {
	var used []string
	for _, sample := range f.samples {
		for _, photo := range sample.Photos {
			if sample.UserID == userID && slices.Contains(keys, photo.ObjectKey) {
				used = append(used, photo.ObjectKey)
			}
		}
	}
	return used, nil
}
func (f *fakeRepo) CountSince(context.Context, string, time.Time) (int64, error) { return f.count, nil }
func (f *fakeRepo) Mine(context.Context, string, int) ([]domain.Sample, error)   { return nil, nil }
func (f *fakeRepo) MineSummary(context.Context, string) (domain.MineSummary, error) {
	return domain.MineSummary{}, nil
}
func (f *fakeRepo) Get(_ context.Context, id string) (*domain.Sample, error) {
	copySample := *f.samples[id]
	return &copySample, nil
}
func (f *fakeRepo) List(context.Context, domain.ListFilter) (*domain.ListResult, error) {
	return &domain.ListResult{}, nil
}
func (f *fakeRepo) Review(_ context.Context, id string, updates map[string]any) (*domain.Sample, error) {
	sample := f.samples[id]
	if sample.Status != domain.StatusPending {
		return nil, researchrepo.ErrNotPending
	}
	sample.Status = updates["status"].(string)
	if tier, ok := updates["quality_tier"].(string); ok {
		sample.QualityTier = &tier
	}
	if credits, ok := updates["reward_credits"].(int); ok {
		sample.RewardCredits = credits
	}
	copySample := *sample
	return &copySample, nil
}
func (f *fakeRepo) MarkRewarded(_ context.Context, id string) error {
	now := time.Now()
	f.samples[id].RewardedAt = &now
	return nil
}
func (f *fakeRepo) Promote(_ context.Context, id string, build func(*domain.Sample) *do.FoodWeightLabeledSampleDO) (*domain.Sample, error) {
	labeled := build(f.samples[id])
	f.labeled = append(f.labeled, labeled)
	f.samples[id].BenchmarkSampleID = &labeled.ID
	return f.samples[id], nil
}

func (f *fakeRepo) ListContainers(_ context.Context, userID string) ([]domain.Container, error) {
	var active []domain.Container
	for _, container := range f.containers {
		if container.UserID == userID && container.Status == domain.ContainerActive {
			active = append(active, container)
		}
	}
	return active, nil
}
func (f *fakeRepo) CreateContainer(_ context.Context, container *domain.Container) error {
	f.containers = append(f.containers, *container)
	return nil
}
func (f *fakeRepo) ArchiveContainer(_ context.Context, userID, id string) error {
	for index := range f.containers {
		if f.containers[index].ID == id && f.containers[index].UserID == userID && f.containers[index].Status == domain.ContainerActive {
			f.containers[index].Status = domain.ContainerArchived
			return nil
		}
	}
	return researchrepo.ErrNotPromotable
}

type fakeRewards struct {
	calls    []int
	failNext bool
}

func (f *fakeRewards) AwardResearchWeightSample(_ context.Context, _, _ string, credits int, _ map[string]any) (map[string]any, error) {
	if f.failNext {
		f.failNext = false
		return nil, errors.New("ledger unavailable")
	}
	f.calls = append(f.calls, credits)
	return map[string]any{"awarded": true}, nil
}

type fakeStore struct{}

func (fakeStore) ResolveObjectKey(_, value string) string { return keyOf(value) }
func (fakeStore) BuildAccessURL(_, key string) string     { return "https://cdn.test/" + key }
func (fakeStore) UploadBytes(_, key string, _ []byte, _ string) (string, error) {
	return "https://cdn.test/" + key, nil
}

func newTestService() (*SampleService, *fakeRepo, *fakeRewards) {
	repo, rewards := newFakeRepo(), &fakeRewards{}
	svc := NewSampleService(repo, rewards, fakeStore{})
	svc.now = func() time.Time { return time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC) }
	return svc, repo, rewards
}

func TestSubmitReturnsResolvedPhotoURLs(t *testing.T) {
	svc, _, _ := newTestService()
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, "https://cdn.test/research-weight/u1/top.jpg", view.Photos[2].URL)
	require.Equal(t, 592.9, view.TotalNetGrams)
}

func TestSubmitEnforcesDailyLimit(t *testing.T) {
	svc, repo, _ := newTestService()
	repo.count = domain.DailySubmissionLimit
	_, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.ErrorContains(t, err, "24小时内")
}

func TestReviewApproveAwardsDefaultCreditsOnce(t *testing.T) {
	svc, repo, rewards := newTestService()
	view, err := svc.Submit(context.Background(), "u1", itemizedInput())
	require.NoError(t, err)
	reviewed, err := svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "a"})
	require.NoError(t, err)
	require.Equal(t, domain.StatusApproved, reviewed.Status)
	require.Equal(t, "A", *reviewed.QualityTier)
	require.Equal(t, []int{4}, rewards.calls)
	require.NotNil(t, repo.samples[view.ID].RewardedAt)
}

func TestReviewRequiresTierAndRejectReason(t *testing.T) {
	svc, _, rewards := newTestService()
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve"})
	require.ErrorContains(t, err, "等级")
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "reject"})
	require.ErrorContains(t, err, "原因")
	zero := 0
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "C", RewardCredits: &zero})
	require.NoError(t, err)
	require.Empty(t, rewards.calls)
}

func TestPromoteMapsItemizedSampleOntoBenchmarkRow(t *testing.T) {
	svc, repo, _ := newTestService()
	input := itemizedInput()
	input.Items[2].Name = "面条"
	view, err := svc.Submit(context.Background(), "u1", input)
	require.NoError(t, err)
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "A"})
	require.NoError(t, err)
	promoted, err := svc.Promote(context.Background(), view.ID, PromoteInput{})
	require.NoError(t, err)
	require.NotNil(t, promoted.BenchmarkSampleID)
	labeled := repo.labeled[0]
	require.Equal(t, "research-202610", labeled.BatchName)
	require.Equal(t, "items", labeled.LabelType)
	require.Equal(t, map[string]any{"面条": 250.0, "牛肉": 77.6, "面条#2": 265.3}, labeled.Items)
	require.Equal(t, 592.9, *labeled.TotalWeightGrams)
	require.Equal(t, "research-weight/u1/top.jpg", *labeled.ImageObjectKey)
	require.Equal(t, view.ID, labeled.Metadata["research_sample_id"])
}

func TestPromoteWholeSampleUsesTotalLabelAndValidatesBatch(t *testing.T) {
	svc, repo, _ := newTestService()
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	_, err = svc.Promote(context.Background(), view.ID, PromoteInput{BatchName: "bad name!"})
	require.ErrorContains(t, err, "批次名")
	_, err = svc.Promote(context.Background(), view.ID, PromoteInput{BatchName: "pilot_1"})
	require.NoError(t, err)
	require.Equal(t, "total", repo.labeled[0].LabelType)
	require.Equal(t, map[string]any{"__total__": 592.9}, repo.labeled[0].Items)
}

func TestReviewRetryPaysRewardAfterFailedPayout(t *testing.T) {
	svc, repo, rewards := newTestService()
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	rewards.failNext = true
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "B"})
	require.Error(t, err)
	require.Nil(t, repo.samples[view.ID].RewardedAt)

	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "B"})
	require.NoError(t, err)
	require.Equal(t, []int{2}, rewards.calls)
	require.NotNil(t, repo.samples[view.ID].RewardedAt)

	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "reject", ReviewNote: "x"})
	require.ErrorIs(t, err, researchrepo.ErrNotPending)
}

func TestSubmitRejectsPhotosOutsideTheUsersResearchPrefix(t *testing.T) {
	svc, _, _ := newTestService()
	_, err := svc.Submit(context.Background(), "u2", wholeInput())
	require.ErrorContains(t, err, "照片必须来自食探上传")

	input := wholeInput()
	input.Photos[2].URL = "https://cdn.test/research-weight/u1/../u2/top.jpg"
	_, err = svc.Submit(context.Background(), "u1", input)
	require.Error(t, err)
}

func TestSubmitRejectsReusedEvaluationPhotosButKeepsTare(t *testing.T) {
	svc, _, _ := newTestService()
	_, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)

	reused := wholeInput()
	reused.ClientKey = "sample-key-0002"
	_, err = svc.Submit(context.Background(), "u1", reused)
	require.ErrorContains(t, err, "之前的样本")

	fresh := wholeInput()
	fresh.ClientKey = "sample-key-0003"
	fresh.Photos[1].URL = "https://cdn.test/research-weight/u1/g2.jpg"
	fresh.Photos[2].URL = "https://cdn.test/research-weight/u1/top2.jpg"
	fresh.Photos[3].URL = "https://cdn.test/research-weight/u1/angle2.jpg"
	_, err = svc.Submit(context.Background(), "u1", fresh)
	require.NoError(t, err)
}

func TestSubmitSameKeyReturnsSavedRowButRefusesAnEditedDraft(t *testing.T) {
	svc, repo, _ := newTestService()
	first, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	again, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, first.ID, again.ID)
	require.Len(t, repo.samples, 1)

	edited := wholeInput()
	edited.GrossReadingGrams = floatPtr(950)
	_, err = svc.Submit(context.Background(), "u1", edited)
	require.ErrorContains(t, err, "已经提交过")
}

func TestUploadsSniffFileContent(t *testing.T) {
	svc, _, _ := newTestService()
	jpeg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 64)...)
	url, err := svc.UploadImage(context.Background(), "u1", jpeg)
	require.NoError(t, err)
	require.Contains(t, url, "research-weight/u1/photos/")
	require.True(t, strings.HasSuffix(url, ".jpg"))
	_, err = svc.UploadImage(context.Background(), "u1", []byte("<html>not an image</html>"))
	require.Error(t, err)

	mp4 := append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, make([]byte, 32)...)
	url, err = svc.UploadVideo(context.Background(), "u1", mp4, ".mp4", "video/mp4")
	require.NoError(t, err)
	require.Contains(t, url, "research-weight/u1/videos/")
	_, err = svc.UploadVideo(context.Background(), "u1", jpeg, ".mp4", "video/mp4")
	require.Error(t, err)
}

func savedContainerFor(userID string) domain.Container {
	container := savedLibrary()["c1"]
	container.UserID, container.Status = userID, domain.ContainerActive
	return container
}

func TestSubmitMultiUsesOnlyTheUsersOwnSavedContainers(t *testing.T) {
	svc, repo, rewards := newTestService()
	repo.containers = []domain.Container{savedContainerFor("u2")}
	_, err := svc.Submit(context.Background(), "u1", multiInput())
	require.ErrorContains(t, err, "不存在或已停用")

	repo.containers = append(repo.containers, savedContainerFor("u1"))
	view, err := svc.Submit(context.Background(), "u1", multiInput())
	require.NoError(t, err)
	require.Equal(t, 960.8, view.TotalNetGrams)
	require.Equal(t, "https://cdn.test/research-weight/u1/photos/lib.jpg", view.Photos[len(view.Photos)-1].URL)
	require.Empty(t, view.Flags)

	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "B"})
	require.NoError(t, err)
	require.Equal(t, []int{4}, rewards.calls, "3 boxes: 2 + 1 per extra box")
}

func TestDefaultRewardCreditsCapsMultiMeals(t *testing.T) {
	boxes := func(n int) *domain.Sample {
		return &domain.Sample{WeighingMode: domain.ModeMulti, Items: make([]domain.Item, n)}
	}
	require.Equal(t, 2, DefaultRewardCredits(boxes(1)))
	require.Equal(t, 3, DefaultRewardCredits(boxes(2)))
	require.Equal(t, 6, DefaultRewardCredits(boxes(8)))
	require.Equal(t, 4, DefaultRewardCredits(&domain.Sample{WeighingMode: domain.ModeItemized}))
	require.Equal(t, 2, DefaultRewardCredits(&domain.Sample{WeighingMode: domain.ModeWhole}))
}

func TestSubmitLetsAnEmptyBoxPhotoBackTwoMeals(t *testing.T) {
	svc, repo, _ := newTestService()
	repo.containers = []domain.Container{savedContainerFor("u1")}
	_, err := svc.Submit(context.Background(), "u1", multiInput())
	require.NoError(t, err)

	next := multiInput()
	next.ClientKey = "sample-key-multi-2"
	for index := range next.Photos {
		if next.Photos[index].Role != domain.RoleContainerTare {
			next.Photos[index].URL = strings.Replace(next.Photos[index].URL, ".jpg", "-b.jpg", 1)
		}
	}
	_, err = svc.Submit(context.Background(), "u1", next)
	require.NoError(t, err, "empty-box photos and the saved box photo may repeat")

	again := multiInput()
	again.ClientKey = "sample-key-multi-3"
	_, err = svc.Submit(context.Background(), "u1", again)
	require.ErrorContains(t, err, "之前的样本")
}

func TestPromoteLabelsEachContainerOfAMultiMeal(t *testing.T) {
	svc, repo, _ := newTestService()
	repo.containers = []domain.Container{savedContainerFor("u1")}
	view, err := svc.Submit(context.Background(), "u1", multiInput())
	require.NoError(t, err)
	_, err = svc.Review(context.Background(), view.ID, "admin", ReviewInput{Action: "approve", QualityTier: "A"})
	require.NoError(t, err)
	_, err = svc.Promote(context.Background(), view.ID, PromoteInput{})
	require.NoError(t, err)
	labeled := repo.labeled[0]
	require.Equal(t, "items", labeled.LabelType)
	require.Equal(t, map[string]any{"米饭": 247.0, "宫保鸡丁": 383.8, "紫菜汤": 330.0}, labeled.Items)
	require.Equal(t, "research-weight/u1/meal.jpg", *labeled.ImageObjectKey)

	single := multiInput()
	single.ClientKey = "sample-key-single"
	single.Items = single.Items[:1]
	single.Photos = []PhotoInput{
		photo(domain.RoleEvalAngle, "one.jpg"),
		containerPhoto(domain.RoleContainerGross, 0, "one-g.jpg", ""),
		containerPhoto(domain.RoleContainerTare, 0, "one-t.jpg", ""),
	}
	one, err := svc.Submit(context.Background(), "u1", single)
	require.NoError(t, err)
	_, err = svc.Review(context.Background(), one.ID, "admin", ReviewInput{Action: "approve", QualityTier: "B"})
	require.NoError(t, err)
	_, err = svc.Promote(context.Background(), one.ID, PromoteInput{})
	require.NoError(t, err)
	require.Equal(t, "total", repo.labeled[1].LabelType)
	require.Equal(t, "research-weight/u1/one.jpg", *repo.labeled[1].ImageObjectKey, "falls back to the 45° photo")
}

func TestContainerLibraryValidatesInputAndOwnership(t *testing.T) {
	svc, repo, _ := newTestService()
	good := ContainerInput{Name: "美团 750ml 圆盒", ContainerType: "box", Grams: 28.46, PhotoURL: "https://cdn.test/research-weight/u1/photos/box.jpg"}
	created, err := svc.CreateContainer(context.Background(), "u1", good)
	require.NoError(t, err)
	require.Equal(t, 28.5, created.Grams)
	require.Equal(t, "https://cdn.test/research-weight/u1/photos/box.jpg", created.PhotoURL)

	bad := map[string]func(*ContainerInput){
		"empty name":    func(in *ContainerInput) { in.Name = " " },
		"unknown type":  func(in *ContainerInput) { in.ContainerType = "bag" },
		"no weight":     func(in *ContainerInput) { in.Grams = 0 },
		"too heavy":     func(in *ContainerInput) { in.Grams = 3500 },
		"foreign photo": func(in *ContainerInput) { in.PhotoURL = "https://cdn.test/research-weight/u2/photos/box.jpg" },
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			input := good
			mutate(&input)
			_, err := svc.CreateContainer(context.Background(), "u1", input)
			require.Error(t, err)
		})
	}

	for len(repo.containers) < domain.MaxSavedContainers {
		repo.containers = append(repo.containers, savedContainerFor("u1"))
	}
	_, err = svc.CreateContainer(context.Background(), "u1", good)
	require.ErrorContains(t, err, "最多保存")

	require.Error(t, svc.ArchiveContainer(context.Background(), "u2", created.ID), "cannot archive someone else's box")
	require.NoError(t, svc.ArchiveContainer(context.Background(), "u1", created.ID))
	views, err := svc.ListContainers(context.Background(), "u1")
	require.NoError(t, err)
	for _, view := range views {
		require.NotEqual(t, created.ID, view.ID)
	}
}
