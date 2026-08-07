package service

import (
	"context"
	"errors"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
)

type maintenanceRepoFake struct {
	sources            []foodrecordrepo.NutritionEmbeddingSource
	hashes             map[string]string
	revision           foodrecordrepo.NutritionEmbeddingSourceRevision
	lockAvailable      bool
	lockCalls          int
	indexLockAvailable bool
	indexLockCalls     int
	upserted           []domain.FoodNutritionEmbedding
	deactivated        []string
}

func (f *maintenanceRepoFake) ListNutritionEmbeddingSources(context.Context) ([]foodrecordrepo.NutritionEmbeddingSource, error) {
	return f.sources, nil
}

func (f *maintenanceRepoFake) ListNutritionEmbeddingHashes(context.Context, string, int) (map[string]string, error) {
	out := make(map[string]string, len(f.hashes))
	for key, value := range f.hashes {
		out[key] = value
	}
	return out, nil
}

func (f *maintenanceRepoFake) GetNutritionEmbeddingSourceRevision(context.Context) (foodrecordrepo.NutritionEmbeddingSourceRevision, error) {
	return f.revision, nil
}

func (f *maintenanceRepoFake) TryNutritionEmbeddingSyncLock(ctx context.Context, fn func(context.Context) error) (bool, error) {
	f.lockCalls++
	if !f.lockAvailable {
		return false, nil
	}
	return true, fn(ctx)
}

func (f *maintenanceRepoFake) TryNutritionEmbeddingIndexLoadLock(ctx context.Context, fn func(context.Context) error) (bool, error) {
	f.indexLockCalls++
	if !f.indexLockAvailable {
		return false, nil
	}
	return true, fn(ctx)
}

func (f *maintenanceRepoFake) UpsertNutritionEmbeddings(_ context.Context, rows []domain.FoodNutritionEmbedding) error {
	f.upserted = append(f.upserted, rows...)
	if f.hashes == nil {
		f.hashes = map[string]string{}
	}
	for _, row := range rows {
		f.hashes[row.IdentityKey] = row.ContentHash
	}
	return nil
}

func (f *maintenanceRepoFake) DeactivateNutritionEmbeddings(_ context.Context, keys []string, _ string, _ int) error {
	f.deactivated = append(f.deactivated, keys...)
	for _, key := range keys {
		delete(f.hashes, key)
	}
	return nil
}

type maintenanceClientFake struct {
	fail  bool
	calls int
}

func (f *maintenanceClientFake) Model() string   { return "embedding-test" }
func (f *maintenanceClientFake) Dimensions() int { return 3 }

func (f *maintenanceClientFake) Embed(_ context.Context, inputs []string) ([][]float32, error) {
	f.calls++
	if f.fail {
		return nil, errors.New("temporary upstream failure")
	}
	out := make([][]float32, len(inputs))
	for index := range inputs {
		out[index] = []float32{float32(index + 1), 0.5, 0.25}
	}
	return out, nil
}

func TestNutritionEmbeddingMaintainerSyncsChangedAndStaleSources(t *testing.T) {
	sources := []foodrecordrepo.NutritionEmbeddingSource{
		{IdentityKey: "canonical:food-a", FoodID: "food-a", SourceType: "canonical", SourceID: "food-a", EmbeddingText: "煎鸡蛋"},
		{IdentityKey: "alias:alias-b", FoodID: "food-b", SourceType: "alias", SourceID: "alias-b", EmbeddingText: "茶叶蛋"},
	}
	repo := &maintenanceRepoFake{
		sources: sources,
		hashes: map[string]string{
			"alias:alias-b": EmbeddingContentHash("茶叶蛋"),
			"alias:stale":   EmbeddingContentHash("旧名称"),
		},
		revision:      foodrecordrepo.NutritionEmbeddingSourceRevision{CanonicalCount: 1, AliasCount: 1, FoodUpdatedAt: "1", AliasUpdatedAt: "1"},
		lockAvailable: true,
	}
	client := &maintenanceClientFake{}
	maintainer := NewNutritionEmbeddingMaintainer(repo, client, nil)

	result, err := maintainer.SyncOnce(context.Background(), false)
	if err != nil {
		t.Fatalf("SyncOnce returned error: %v", err)
	}
	if !result.Changed || !result.LockAcquired || result.Generated != 1 || result.Deactivated != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if client.calls != 1 {
		t.Fatalf("expected one embedding request, got %d", client.calls)
	}
	if len(repo.upserted) != 1 || repo.upserted[0].IdentityKey != "canonical:food-a" || !repo.upserted[0].IsActive {
		t.Fatalf("unexpected upsert rows: %+v", repo.upserted)
	}
	if len(repo.deactivated) != 1 || repo.deactivated[0] != "alias:stale" {
		t.Fatalf("unexpected deactivated keys: %+v", repo.deactivated)
	}

	if _, err := maintainer.SyncOnce(context.Background(), false); err != nil {
		t.Fatalf("second SyncOnce returned error: %v", err)
	}
	if repo.lockCalls != 1 {
		t.Fatalf("unchanged revision should skip distributed lock, lock calls=%d", repo.lockCalls)
	}
}

func TestNutritionEmbeddingMaintainerRetriesAfterEmbeddingFailure(t *testing.T) {
	repo := &maintenanceRepoFake{
		sources: []foodrecordrepo.NutritionEmbeddingSource{
			{IdentityKey: "canonical:food-a", FoodID: "food-a", SourceType: "canonical", SourceID: "food-a", EmbeddingText: "燕麦粥"},
		},
		hashes:        map[string]string{},
		revision:      foodrecordrepo.NutritionEmbeddingSourceRevision{CanonicalCount: 1, FoodUpdatedAt: "2"},
		lockAvailable: true,
	}
	client := &maintenanceClientFake{fail: true}
	maintainer := NewNutritionEmbeddingMaintainer(repo, client, nil)

	if _, err := maintainer.SyncOnce(context.Background(), false); err == nil {
		t.Fatal("expected embedding failure")
	}
	client.fail = false
	result, err := maintainer.SyncOnce(context.Background(), false)
	if err != nil {
		t.Fatalf("retry SyncOnce returned error: %v", err)
	}
	if result.Generated != 1 || repo.lockCalls != 2 {
		t.Fatalf("failed revision must remain retryable: result=%+v lockCalls=%d", result, repo.lockCalls)
	}
}

func TestNutritionEmbeddingMaintainerDoesNotWorkWithoutDistributedLock(t *testing.T) {
	repo := &maintenanceRepoFake{
		sources:       []foodrecordrepo.NutritionEmbeddingSource{{IdentityKey: "canonical:food-a", EmbeddingText: "桃子"}},
		hashes:        map[string]string{},
		revision:      foodrecordrepo.NutritionEmbeddingSourceRevision{CanonicalCount: 1},
		lockAvailable: false,
	}
	client := &maintenanceClientFake{}
	maintainer := NewNutritionEmbeddingMaintainer(repo, client, nil)

	result, err := maintainer.SyncOnce(context.Background(), false)
	if err != nil {
		t.Fatalf("SyncOnce returned error: %v", err)
	}
	if result.LockAcquired || client.calls != 0 || len(repo.upserted) != 0 {
		t.Fatalf("non-leader pod must not generate vectors: result=%+v calls=%d", result, client.calls)
	}
}

type retrieverRepoFake struct {
	revision foodrecordrepo.NutritionEmbeddingIndexRevision
	rows     []foodrecordrepo.NutritionEmbeddingIndexRow
	loads    int
}

func (f *retrieverRepoFake) LoadNutritionEmbeddingIndex(context.Context, string, int) ([]foodrecordrepo.NutritionEmbeddingIndexRow, error) {
	f.loads++
	return f.rows, nil
}

func (f *retrieverRepoFake) GetNutritionEmbeddingIndexRevision(context.Context, string, int) (foodrecordrepo.NutritionEmbeddingIndexRevision, error) {
	return f.revision, nil
}

func (f *retrieverRepoFake) FindNutritionFoodsByIDs(context.Context, []string) (map[string]domain.FoodNutrition, error) {
	return map[string]domain.FoodNutrition{}, nil
}

func TestNutritionSemanticRetrieverRefreshesOnlyWhenRevisionChanges(t *testing.T) {
	repo := &retrieverRepoFake{
		revision: foodrecordrepo.NutritionEmbeddingIndexRevision{ActiveCount: 1, UpdatedAt: "1"},
		rows: []foodrecordrepo.NutritionEmbeddingIndexRow{
			{IdentityKey: "canonical:food-a", FoodID: "food-a", EmbeddingBytes: EncodeEmbedding([]float32{1, 0, 0})},
		},
	}
	client := &maintenanceClientFake{}
	retriever := NewNutritionSemanticRetriever(repo, client)
	if err := retriever.Warm(context.Background()); err != nil {
		t.Fatalf("Warm returned error: %v", err)
	}
	refreshed, err := retriever.RefreshIfChanged(context.Background())
	if err != nil || refreshed || repo.loads != 1 {
		t.Fatalf("unchanged revision should not reload: refreshed=%t loads=%d err=%v", refreshed, repo.loads, err)
	}

	repo.revision = foodrecordrepo.NutritionEmbeddingIndexRevision{ActiveCount: 1, UpdatedAt: "2"}
	repo.rows = []foodrecordrepo.NutritionEmbeddingIndexRow{
		{IdentityKey: "canonical:food-b", FoodID: "food-b", EmbeddingBytes: EncodeEmbedding([]float32{0, 1, 0})},
	}
	refreshed, err = retriever.RefreshIfChanged(context.Background())
	if err != nil || !refreshed || repo.loads != 2 {
		t.Fatalf("changed revision should reload: refreshed=%t loads=%d err=%v", refreshed, repo.loads, err)
	}
	entries, ready := retriever.readySnapshot()
	if !ready || len(entries) != 1 || entries[0].foodID != "food-b" {
		t.Fatalf("unexpected refreshed entries: ready=%t entries=%+v", ready, entries)
	}
}

func TestNutritionEmbeddingMaintainerSkipsWarmWhenAnotherPodOwnsIndexLock(t *testing.T) {
	repo := &maintenanceRepoFake{indexLockAvailable: false}
	retrieverRepo := &retrieverRepoFake{
		revision: foodrecordrepo.NutritionEmbeddingIndexRevision{ActiveCount: 1, UpdatedAt: "1"},
		rows: []foodrecordrepo.NutritionEmbeddingIndexRow{
			{IdentityKey: "canonical:food-a", FoodID: "food-a", EmbeddingBytes: EncodeEmbedding([]float32{1, 0, 0})},
		},
	}
	client := &maintenanceClientFake{}
	maintainer := NewNutritionEmbeddingMaintainer(repo, client, NewNutritionSemanticRetriever(retrieverRepo, client))

	if err := maintainer.refreshIndex(context.Background(), true); err != nil {
		t.Fatalf("refreshIndex returned error: %v", err)
	}
	if repo.indexLockCalls != 1 || retrieverRepo.loads != 0 {
		t.Fatalf("non-leader must skip index load: lockCalls=%d loads=%d", repo.indexLockCalls, retrieverRepo.loads)
	}
}

func TestNutritionEmbeddingMaintainerWarmsWhenIndexLockAcquired(t *testing.T) {
	repo := &maintenanceRepoFake{indexLockAvailable: true}
	retrieverRepo := &retrieverRepoFake{
		revision: foodrecordrepo.NutritionEmbeddingIndexRevision{ActiveCount: 1, UpdatedAt: "1"},
		rows: []foodrecordrepo.NutritionEmbeddingIndexRow{
			{IdentityKey: "canonical:food-a", FoodID: "food-a", EmbeddingBytes: EncodeEmbedding([]float32{1, 0, 0})},
		},
	}
	client := &maintenanceClientFake{}
	maintainer := NewNutritionEmbeddingMaintainer(repo, client, NewNutritionSemanticRetriever(retrieverRepo, client))

	if err := maintainer.refreshIndex(context.Background(), true); err != nil {
		t.Fatalf("refreshIndex returned error: %v", err)
	}
	if repo.indexLockCalls != 1 || retrieverRepo.loads != 1 {
		t.Fatalf("leader must load index once: lockCalls=%d loads=%d", repo.indexLockCalls, retrieverRepo.loads)
	}
}
