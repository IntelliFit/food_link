package repo

import (
	"context"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func setupSampleRepo(t *testing.T) *SampleRepo {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(append(migrationdo.ResearchWeightModels(), &migrationdo.FoodWeightLabeledSampleDO{})...))
	return NewSampleRepo(db)
}

func pendingSample(userID, clientKey string) *domain.Sample {
	return &domain.Sample{
		UserID: userID, ClientKey: clientKey, Scene: "canteen", WeighingMode: domain.ModeWhole, DishName: "宫保鸡丁",
		ContainerType: "plate", TareMode: domain.TareMeasured, TareGrams: 200, TotalNetGrams: 310.5, ScalePrecisionGrams: 1,
		Items: []domain.Item{}, Photos: []domain.Photo{{Role: domain.RoleEvalTop, ObjectKey: "top.jpg"}},
		ReferenceObject: "none", Device: map[string]any{}, ConsentVersion: domain.ConsentVersion,
		ConsentedAt: time.Now(), Status: domain.StatusPending,
	}
}

func TestCreateIsIdempotentPerClientKey(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, userID := context.Background(), uuid.NewString()
	first, created, err := repo.Create(ctx, pendingSample(userID, "client-key-01"))
	require.NoError(t, err)
	require.True(t, created)
	again, created, err := repo.Create(ctx, pendingSample(userID, "client-key-01"))
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first.ID, again.ID)
	require.Equal(t, "top.jpg", again.Photos[0].ObjectKey)

	summary, err := repo.MineSummary(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, domain.MineSummary{Total: 1, Pending: 1}, summary)
	count, err := repo.CountSince(ctx, userID, time.Now().Add(-time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestReviewOnlyMovesPendingSamplesOnce(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx := context.Background()
	sample, _, err := repo.Create(ctx, pendingSample(uuid.NewString(), "client-key-02"))
	require.NoError(t, err)
	reviewed, err := repo.Review(ctx, sample.ID, map[string]any{"status": domain.StatusApproved, "quality_tier": "A", "reward_credits": 2})
	require.NoError(t, err)
	require.Equal(t, domain.StatusApproved, reviewed.Status)
	require.Equal(t, "A", *reviewed.QualityTier)
	_, err = repo.Review(ctx, sample.ID, map[string]any{"status": domain.StatusRejected})
	require.ErrorIs(t, err, ErrNotPending)

	list, err := repo.List(ctx, domain.ListFilter{Status: domain.StatusApproved, Query: "鸡丁", Limit: 10})
	require.NoError(t, err)
	require.EqualValues(t, 1, list.Total)
}

func TestPromoteCreatesOneBenchmarkRow(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx := context.Background()
	sample, _, err := repo.Create(ctx, pendingSample(uuid.NewString(), "client-key-03"))
	require.NoError(t, err)
	build := func(s *domain.Sample) *migrationdo.FoodWeightLabeledSampleDO {
		total := s.TotalNetGrams
		return &migrationdo.FoodWeightLabeledSampleDO{
			ID: uuid.NewString(), BatchName: "pilot", SampleName: s.DishName, OriginalFilename: "top.jpg",
			LabelType: "total", TotalWeightGrams: &total, Items: map[string]any{"__total__": total}, Status: "labeled", Metadata: map[string]any{},
		}
	}
	_, err = repo.Promote(ctx, sample.ID, build)
	require.ErrorIs(t, err, ErrNotPromotable)

	_, err = repo.Review(ctx, sample.ID, map[string]any{"status": domain.StatusApproved, "quality_tier": "B"})
	require.NoError(t, err)
	promoted, err := repo.Promote(ctx, sample.ID, build)
	require.NoError(t, err)
	require.NotNil(t, promoted.BenchmarkSampleID)
	_, err = repo.Promote(ctx, sample.ID, build)
	require.ErrorIs(t, err, ErrNotPromotable)

	var count int64
	require.NoError(t, repo.db.Model(&migrationdo.FoodWeightLabeledSampleDO{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestFindByClientKeyAndUsedPhotoKeysAreScopedToTheUser(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, userID := context.Background(), uuid.NewString()
	_, _, err := repo.Create(ctx, pendingSample(userID, "client-key-04"))
	require.NoError(t, err)

	found, err := repo.FindByClientKey(ctx, userID, "client-key-04")
	require.NoError(t, err)
	require.NotNil(t, found)
	missing, err := repo.FindByClientKey(ctx, uuid.NewString(), "client-key-04")
	require.NoError(t, err)
	require.Nil(t, missing)

	used, err := repo.UsedPhotoKeys(ctx, userID, []string{"top.jpg", "other.jpg"})
	require.NoError(t, err)
	require.Equal(t, []string{"top.jpg"}, used)
	used, err = repo.UsedPhotoKeys(ctx, uuid.NewString(), []string{"top.jpg"})
	require.NoError(t, err)
	require.Empty(t, used)
}

func TestContainersAreListedAndArchivedPerUser(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, owner, other := context.Background(), uuid.NewString(), uuid.NewString()
	box := &domain.Container{UserID: owner, Name: "750ml 圆盒", ContainerType: "box", Grams: 28.5, PhotoObjectKey: "k", Status: domain.ContainerActive}
	require.NoError(t, repo.CreateContainer(ctx, box))
	require.NotEmpty(t, box.ID)
	require.NoError(t, repo.CreateContainer(ctx, &domain.Container{UserID: other, Name: "碗", ContainerType: "bowl", Grams: 310, PhotoObjectKey: "k2", Status: domain.ContainerActive}))

	mine, err := repo.ListContainers(ctx, owner)
	require.NoError(t, err)
	require.Len(t, mine, 1)
	require.Equal(t, 28.5, mine[0].Grams)

	require.ErrorIs(t, repo.ArchiveContainer(ctx, other, box.ID), commonerrors.ErrNotFound)
	require.NoError(t, repo.ArchiveContainer(ctx, owner, box.ID))
	require.ErrorIs(t, repo.ArchiveContainer(ctx, owner, box.ID), commonerrors.ErrNotFound)
	mine, err = repo.ListContainers(ctx, owner)
	require.NoError(t, err)
	require.Empty(t, mine)
}

func TestMultiSampleItemsRoundTripThroughJSON(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx := context.Background()
	gross, tare := 412.3, 28.5
	sample := pendingSample(uuid.NewString(), "client-key-multi")
	sample.WeighingMode, sample.TareMode = domain.ModeMulti, domain.TarePerContainer
	sample.Items = []domain.Item{{Name: "宫保鸡丁", Grams: 383.8, GrossReadingGrams: &gross, TareGrams: &tare, TareSource: domain.TareLibrary, ContainerID: "c1", ContainerType: "box"}}
	saved, _, err := repo.Create(ctx, sample)
	require.NoError(t, err)
	stored, err := repo.Get(ctx, saved.ID)
	require.NoError(t, err)
	require.Equal(t, domain.TareLibrary, stored.Items[0].TareSource)
	require.Equal(t, 412.3, *stored.Items[0].GrossReadingGrams)
	require.Equal(t, "c1", stored.Items[0].ContainerID)
}
