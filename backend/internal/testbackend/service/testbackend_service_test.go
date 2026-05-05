package service

import (
	"context"
	"os"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/testbackend/domain"
	"food_link/backend/internal/testbackend/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type mockLLMClient struct {
	result map[string]any
	err    error
}

func (m *mockLLMClient) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	return m.result, m.err
}

func setupTestDB(t *testing.T) (*repo.PromptRepo, *repo.BatchRepo, *repo.DatasetRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.Prompt{}, &domain.PromptHistory{}, &domain.TestBatch{}, &domain.TestDataset{}))
	return repo.NewPromptRepo(db), repo.NewBatchRepo(db), repo.NewDatasetRepo(db)
}

func newService(t *testing.T) (*TestBackendService, *repo.PromptRepo, *repo.BatchRepo, *repo.DatasetRepo) {
	pr, br, dr := setupTestDB(t)
	return NewTestBackendService(pr, br, dr, &mockLLMClient{result: map[string]any{"items": []any{}}}, &mockLLMClient{result: map[string]any{"items": []any{}}}), pr, br, dr
}

// ---------- Prompt Tests ----------

func TestTestBackendService_ListPrompts(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	require.NoError(t, pr.CreatePrompt(ctx, &domain.Prompt{Name: "a", Content: "c", ModelType: "vision"}))
	require.NoError(t, pr.CreatePrompt(ctx, &domain.Prompt{Name: "b", Content: "c", ModelType: "vision"}))

	items, err := svc.ListPrompts(ctx)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestTestBackendService_CreatePrompt(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	p, err := svc.CreatePrompt(ctx, CreatePromptInput{Name: "test", Content: "content", ModelType: "vision"})
	require.NoError(t, err)
	assert.Equal(t, "test", p.Name)
	assert.Equal(t, 1, p.Version)

	_, err = svc.CreatePrompt(ctx, CreatePromptInput{Name: "", Content: "c", ModelType: "vision"})
	require.Error(t, err)
}

func TestTestBackendService_GetPrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	p := &domain.Prompt{Name: "test", Content: "c", ModelType: "vision"}
	require.NoError(t, pr.CreatePrompt(ctx, p))

	found, err := svc.GetPrompt(ctx, p.ID)
	require.NoError(t, err)
	assert.Equal(t, "test", found.Name)

	_, err = svc.GetPrompt(ctx, "nonexistent")
	require.Error(t, err)
}

func TestTestBackendService_GetActivePrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	require.NoError(t, pr.CreatePrompt(ctx, &domain.Prompt{Name: "active", Content: "c", ModelType: "qwen", IsActive: true}))

	found, err := svc.GetActivePrompt(ctx, "qwen")
	require.NoError(t, err)
	assert.Equal(t, "active", found.Name)

	_, err = svc.GetActivePrompt(ctx, "gemini")
	require.Error(t, err)
}

func TestTestBackendService_UpdatePrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	p := &domain.Prompt{Name: "old", Content: "c", ModelType: "vision", Version: 1}
	require.NoError(t, pr.CreatePrompt(ctx, p))

	newName := "new"
	updated, err := svc.UpdatePrompt(ctx, p.ID, UpdatePromptInput{Name: &newName})
	require.NoError(t, err)
	assert.Equal(t, "new", updated.Name)
	assert.Equal(t, 2, updated.Version)

	// History should be saved
	history, err := pr.ListPromptHistory(ctx, p.ID)
	require.NoError(t, err)
	assert.Len(t, history, 1)

	emptyName := ""
	_, err = svc.UpdatePrompt(ctx, p.ID, UpdatePromptInput{Name: &emptyName})
	require.Error(t, err)

	_, err = svc.UpdatePrompt(ctx, "nonexistent", UpdatePromptInput{Name: &newName})
	require.Error(t, err)
}

func TestTestBackendService_DeletePrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	p := &domain.Prompt{Name: "to-delete", Content: "c", ModelType: "vision"}
	require.NoError(t, pr.CreatePrompt(ctx, p))

	require.NoError(t, svc.DeletePrompt(ctx, p.ID))

	_, err := svc.GetPrompt(ctx, p.ID)
	require.Error(t, err)

	err = svc.DeletePrompt(ctx, "nonexistent")
	require.Error(t, err)
}

func TestTestBackendService_ActivatePrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	require.NoError(t, pr.CreatePrompt(ctx, &domain.Prompt{Name: "a", Content: "c", ModelType: "qwen", IsActive: true}))
	p2 := &domain.Prompt{Name: "b", Content: "c", ModelType: "qwen", IsActive: false}
	require.NoError(t, pr.CreatePrompt(ctx, p2))

	activated, err := svc.ActivatePrompt(ctx, p2.ID)
	require.NoError(t, err)
	assert.True(t, activated.IsActive)

	// Original active should be deactivated
	original, err := pr.GetPromptByID(ctx, p2.ID)
	require.NoError(t, err)
	assert.True(t, original.IsActive)

	_, err = svc.ActivatePrompt(ctx, "nonexistent")
	require.Error(t, err)
}

func TestTestBackendService_GetPromptHistory(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	p := &domain.Prompt{Name: "test", Content: "c", ModelType: "vision", Version: 1}
	require.NoError(t, pr.CreatePrompt(ctx, p))
	require.NoError(t, pr.CreatePromptHistory(ctx, &domain.PromptHistory{PromptID: p.ID, Name: "old", Content: "c", ModelType: "vision", Version: 1}))

	history, err := svc.GetPromptHistory(ctx, p.ID)
	require.NoError(t, err)
	assert.Len(t, history, 1)

	_, err = svc.GetPromptHistory(ctx, "nonexistent")
	require.Error(t, err)
}

// ---------- Analyze Tests ----------

func TestTestBackendService_Analyze(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	_, err := svc.Analyze(ctx, AnalyzeInput{ImageURL: ""})
	require.Error(t, err)

	result, err := svc.Analyze(ctx, AnalyzeInput{ImageURL: "https://example.com/img.jpg", ModelName: "qwen"})
	require.NoError(t, err)
	assert.NotNil(t, result["result"])
}

func TestTestBackendService_AnalyzeWithPrompt(t *testing.T) {
	svc, pr, _, _ := newService(t)
	ctx := context.Background()

	p := &domain.Prompt{Name: "custom", Content: "custom prompt", ModelType: "qwen", IsActive: true}
	require.NoError(t, pr.CreatePrompt(ctx, p))

	result, err := svc.Analyze(ctx, AnalyzeInput{ImageURL: "https://example.com/img.jpg", PromptID: p.ID})
	require.NoError(t, err)
	assert.Equal(t, p.ID, result["prompt_id"])
}

// ---------- Batch Tests ----------

func TestTestBackendService_PrepareBatch(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	_, err := svc.PrepareBatch(ctx, PrepareBatchInput{DatasetID: ""})
	require.Error(t, err)

	b, err := svc.PrepareBatch(ctx, PrepareBatchInput{DatasetID: "ds-1", Config: map[string]any{"model": "qwen"}})
	require.NoError(t, err)
	assert.Equal(t, "pending", b.Status)
	assert.Equal(t, "ds-1", b.DatasetID)
}

func TestTestBackendService_StartBatch(t *testing.T) {
	svc, _, br, _ := newService(t)
	ctx := context.Background()

	b := &domain.TestBatch{Name: "batch", DatasetID: "ds-1", Status: "pending"}
	require.NoError(t, br.CreateBatch(ctx, b))

	started, err := svc.StartBatch(ctx, StartBatchInput{BatchID: b.ID})
	require.NoError(t, err)
	assert.Equal(t, "running", started.Status)

	_, err = svc.StartBatch(ctx, StartBatchInput{BatchID: b.ID})
	require.Error(t, err)

	_, err = svc.StartBatch(ctx, StartBatchInput{BatchID: "nonexistent"})
	require.Error(t, err)
}

func TestTestBackendService_GetBatch(t *testing.T) {
	svc, _, br, _ := newService(t)
	ctx := context.Background()

	b := &domain.TestBatch{Name: "batch", DatasetID: "ds-1", Status: "pending"}
	require.NoError(t, br.CreateBatch(ctx, b))

	found, err := svc.GetBatch(ctx, b.ID)
	require.NoError(t, err)
	assert.Equal(t, "batch", found.Name)

	_, err = svc.GetBatch(ctx, "nonexistent")
	require.Error(t, err)
}

// ---------- Dataset Tests ----------

func TestTestBackendService_ListDatasets(t *testing.T) {
	svc, _, _, dr := newService(t)
	ctx := context.Background()

	require.NoError(t, dr.CreateDataset(ctx, &domain.TestDataset{Name: "a", ImagePaths: []string{"/a.jpg"}}))
	require.NoError(t, dr.CreateDataset(ctx, &domain.TestDataset{Name: "b", ImagePaths: []string{"/b.jpg"}}))

	items, err := svc.ListDatasets(ctx)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestTestBackendService_ImportLocalDataset(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	_, err := svc.ImportLocalDataset(ctx, ImportDatasetInput{Name: ""})
	require.Error(t, err)

	_, err = svc.ImportLocalDataset(ctx, ImportDatasetInput{Name: "test", ImagePaths: []string{}})
	require.Error(t, err)

	d, err := svc.ImportLocalDataset(ctx, ImportDatasetInput{Name: "test", ImagePaths: []string{"/a.jpg"}})
	require.NoError(t, err)
	assert.Equal(t, "test", d.Name)
	assert.Equal(t, "ready", d.Status)
}

func TestTestBackendService_PrepareDataset(t *testing.T) {
	svc, _, _, dr := newService(t)
	ctx := context.Background()

	d := &domain.TestDataset{Name: "ds", ImagePaths: []string{"/a.jpg"}, Status: "ready"}
	require.NoError(t, dr.CreateDataset(ctx, d))

	prepared, err := svc.PrepareDataset(ctx, d.ID)
	require.NoError(t, err)
	assert.Equal(t, "prepared", prepared.Status)

	_, err = svc.PrepareDataset(ctx, "nonexistent")
	require.Error(t, err)
}

// ---------- Auth Tests ----------

func TestTestBackendService_Login(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	os.Setenv("TEST_BACKEND_PASSWORD", "secret123")
	defer os.Unsetenv("TEST_BACKEND_PASSWORD")

	require.NoError(t, svc.Login(ctx, "secret123"))

	err := svc.Login(ctx, "wrong")
	require.Error(t, err)
	assert.Equal(t, commonerrors.ErrUnauthorized, err)
}

func TestTestBackendService_Login_DefaultPassword(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	os.Unsetenv("TEST_BACKEND_PASSWORD")
	require.NoError(t, svc.Login(ctx, "test-backend-password"))
}

func TestTestBackendService_Logout(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	require.NoError(t, svc.Logout(ctx))
}

// ---------- Legacy Tests ----------

func TestTestBackendService_LegacyBatchUpload(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	result, err := svc.LegacyBatchUpload(ctx, LegacyBatchUploadInput{ImageURLs: []string{"/a.jpg"}})
	require.NoError(t, err)
	assert.Equal(t, "legacy batch upload stub", result["message"])
}

func TestTestBackendService_LegacySingleImage(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()

	_, err := svc.LegacySingleImage(ctx, LegacySingleImageInput{ImageURL: ""})
	require.Error(t, err)

	result, err := svc.LegacySingleImage(ctx, LegacySingleImageInput{ImageURL: "/a.jpg"})
	require.NoError(t, err)
	assert.Equal(t, "legacy single image stub", result["message"])
}

// ---------- ResolveModelConfig ----------

func TestResolveModelConfig(t *testing.T) {
	provider, model := resolveModelConfig("")
	assert.Equal(t, "qwen", provider)
	assert.Equal(t, "qwen-vl-max", model)

	provider, model = resolveModelConfig("gemini")
	assert.Equal(t, "gemini", provider)
	assert.Equal(t, "gemini-3-flash-preview", model)

	provider, model = resolveModelConfig("gemini-pro")
	assert.Equal(t, "gemini", provider)
	assert.Equal(t, "gemini-pro", model)
}
