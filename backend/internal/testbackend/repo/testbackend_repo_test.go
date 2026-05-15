package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/testbackend/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.Prompt{}, &domain.PromptHistory{}, &domain.TestBatch{}, &domain.TestDataset{}))
	return db
}

// ---------- PromptRepo Tests ----------

func TestPromptRepo_CreateAndGet(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	p := &domain.Prompt{Name: "test", Content: "content", ModelType: "vision", Version: 1}
	require.NoError(t, r.CreatePrompt(ctx, p))
	assert.NotEmpty(t, p.ID)

	found, err := r.GetPromptByID(ctx, p.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "test", found.Name)
}

func TestPromptRepo_ListPrompts(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "a", Content: "c", ModelType: "vision"}))
	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "b", Content: "c", ModelType: "vision"}))

	items, err := r.ListPrompts(ctx)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestPromptRepo_GetActivePromptByModelType(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "active", Content: "c", ModelType: "qwen", IsActive: true}))
	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "inactive", Content: "c", ModelType: "qwen", IsActive: false}))

	found, err := r.GetActivePromptByModelType(ctx, "qwen")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "active", found.Name)

	notFound, err := r.GetActivePromptByModelType(ctx, "gemini")
	require.NoError(t, err)
	assert.Nil(t, notFound)
}

func TestPromptRepo_UpdatePrompt(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	p := &domain.Prompt{Name: "old", Content: "c", ModelType: "vision"}
	require.NoError(t, r.CreatePrompt(ctx, p))

	updated, err := r.UpdatePrompt(ctx, p.ID, map[string]any{"name": "new"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "new", updated.Name)

	notFound, err := r.UpdatePrompt(ctx, "nonexistent", map[string]any{"name": "x"})
	require.NoError(t, err)
	assert.Nil(t, notFound)
}

func TestPromptRepo_DeletePrompt(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	p := &domain.Prompt{Name: "to-delete", Content: "c", ModelType: "vision"}
	require.NoError(t, r.CreatePrompt(ctx, p))
	require.NoError(t, r.DeletePrompt(ctx, p.ID))

	found, err := r.GetPromptByID(ctx, p.ID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestPromptRepo_DeactivateByModelType(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "a", Content: "c", ModelType: "qwen", IsActive: true}))
	require.NoError(t, r.CreatePrompt(ctx, &domain.Prompt{Name: "b", Content: "c", ModelType: "qwen", IsActive: true}))

	require.NoError(t, r.DeactivateByModelType(ctx, "qwen"))

	found, err := r.GetActivePromptByModelType(ctx, "qwen")
	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestPromptRepo_PromptHistory(t *testing.T) {
	db := setupTestDB(t)
	r := NewPromptRepo(db)
	ctx := context.Background()

	p := &domain.Prompt{Name: "test", Content: "c", ModelType: "vision", Version: 1}
	require.NoError(t, r.CreatePrompt(ctx, p))

	h := &domain.PromptHistory{PromptID: p.ID, Name: "test", Content: "c", ModelType: "vision", Version: 1}
	require.NoError(t, r.CreatePromptHistory(ctx, h))
	assert.NotEmpty(t, h.ID)

	history, err := r.ListPromptHistory(ctx, p.ID)
	require.NoError(t, err)
	assert.Len(t, history, 1)
	assert.Equal(t, 1, history[0].Version)
}

// ---------- BatchRepo Tests ----------

func TestBatchRepo_CreateAndGet(t *testing.T) {
	db := setupTestDB(t)
	r := NewBatchRepo(db)
	ctx := context.Background()

	b := &domain.TestBatch{Name: "batch-1", DatasetID: "ds-1", Status: "pending"}
	require.NoError(t, r.CreateBatch(ctx, b))
	assert.NotEmpty(t, b.ID)

	found, err := r.GetBatchByID(ctx, b.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "batch-1", found.Name)
}

func TestBatchRepo_UpdateBatch(t *testing.T) {
	db := setupTestDB(t)
	r := NewBatchRepo(db)
	ctx := context.Background()

	b := &domain.TestBatch{Name: "batch-1", DatasetID: "ds-1", Status: "pending"}
	require.NoError(t, r.CreateBatch(ctx, b))

	updated, err := r.UpdateBatch(ctx, b.ID, map[string]any{"status": "running"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "running", updated.Status)
}

// ---------- DatasetRepo Tests ----------

func TestDatasetRepo_CreateAndGet(t *testing.T) {
	db := setupTestDB(t)
	r := NewDatasetRepo(db)
	ctx := context.Background()

	d := &domain.TestDataset{Name: "ds-1", ImagePaths: []string{"/a.jpg"}, Status: "ready"}
	require.NoError(t, r.CreateDataset(ctx, d))
	assert.NotEmpty(t, d.ID)

	found, err := r.GetDatasetByID(ctx, d.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "ds-1", found.Name)
}

func TestDatasetRepo_ListDatasets(t *testing.T) {
	db := setupTestDB(t)
	r := NewDatasetRepo(db)
	ctx := context.Background()

	require.NoError(t, r.CreateDataset(ctx, &domain.TestDataset{Name: "a", ImagePaths: []string{"/a.jpg"}}))
	require.NoError(t, r.CreateDataset(ctx, &domain.TestDataset{Name: "b", ImagePaths: []string{"/b.jpg"}}))

	items, err := r.ListDatasets(ctx)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestDatasetRepo_UpdateDataset(t *testing.T) {
	db := setupTestDB(t)
	r := NewDatasetRepo(db)
	ctx := context.Background()

	d := &domain.TestDataset{Name: "ds-1", ImagePaths: []string{"/a.jpg"}, Status: "ready"}
	require.NoError(t, r.CreateDataset(ctx, d))

	updated, err := r.UpdateDataset(ctx, d.ID, map[string]any{"status": "prepared"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "prepared", updated.Status)
}
