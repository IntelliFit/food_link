package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTaskServiceTestDB(t *testing.T) (*gorm.DB, *repo.TaskRepo, *repo.PrecisionRepo, *authrepo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&analyzedomain.AnalysisTask{}, &analyzedomain.PrecisionSession{}, &analyzedomain.PrecisionSessionRound{}, &authrepo.User{}))
	require.NoError(t, db.Exec(`CREATE TABLE user_food_records (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		source_task_id TEXT
	)`).Error)
	return db, repo.NewTaskRepo(db), repo.NewPrecisionRepo(db), authrepo.NewUserRepo(db)
}

func TestTaskService_SubmitAnalyzeTask_EmptyInput(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	_, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{})
	assert.Error(t, err)
}

func TestTaskService_SubmitAnalyzeTask_Success(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	imageURL := "https://example.com/img.jpg"
	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{ImageURL: imageURL})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, "food", task.TaskType)
	assert.Equal(t, "pending", task.Status)
}

func TestTaskService_SubmitAnalyzeTask_WithImages(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}

func TestTaskService_SubmitTextTask_EmptyText(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	_, err := svc.SubmitTextTask(ctx, "user1", SubmitTaskInput{})
	assert.Error(t, err)
}

func TestTaskService_SubmitTextTask_Success(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	taskID, err := svc.SubmitTextTask(ctx, "user1", SubmitTaskInput{TextInput: "一碗米饭"})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, "food_text", task.TaskType)
}

func TestTaskService_ListTasks(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewTaskService(taskRepo, precisionRepo, userRepo, storageClient)
	ctx := context.Background()

	legacyURL := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/legacy.jpg"
	require.NoError(t, taskRepo.CreateTask(ctx, &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending", ImageURL: &legacyURL}))
	require.NoError(t, taskRepo.CreateTask(ctx, &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done"}))

	tasks, err := svc.ListTasks(ctx, "user1", "food", "", 10)
	require.NoError(t, err)
	assert.Len(t, tasks, 2)
	assert.Equal(t, "https://cdn.example.com/food/legacy.jpg", *tasks[0].ImageURL)
	assert.Equal(t, []string{"https://cdn.example.com/food/legacy.jpg"}, tasks[0].ImagePaths)
}

func TestTaskService_ListTasksCollapsesRepeatedSameDayInput(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	now := time.Now()
	olderCreatedAt := now.Add(-10 * time.Minute)
	newerCreatedAt := now.Add(-5 * time.Minute)
	imageURL := "https://example.com/meal.jpg"
	older := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done", ImageURL: &imageURL, CreatedAt: &olderCreatedAt}
	newer := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done", ImageURL: &imageURL, CreatedAt: &newerCreatedAt}
	require.NoError(t, taskRepo.CreateTask(ctx, older))
	require.NoError(t, taskRepo.CreateTask(ctx, newer))

	tasks, err := svc.ListTasks(ctx, "user1", "", "", 10)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, newer.ID, tasks[0].ID)
}

func TestTaskService_SubmitCorrectionStoresChainRoot(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	imageURL := "https://example.com/meal.jpg"
	source := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done", ImageURL: &imageURL}
	require.NoError(t, taskRepo.CreateTask(ctx, source))

	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{
		ImageURL:               imageURL,
		CorrectionSourceTaskID: source.ID,
		PreviousResult:         map[string]any{"description": "old"},
		CorrectionItems:        []map[string]any{{"name": "米饭", "weight": 100}},
	})
	require.NoError(t, err)
	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, true, task.Payload["is_correction"])
	assert.Equal(t, source.ID, task.Payload["correction_source_task_id"])
	assert.Equal(t, source.ID, task.Payload["correction_root_task_id"])
}

func TestTaskService_CountTasks(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	require.NoError(t, taskRepo.CreateTask(ctx, &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending"}))

	count, err := svc.CountTasks(ctx, "user1")
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)
}

func TestTaskService_CountTasksByStatus(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	require.NoError(t, taskRepo.CreateTask(ctx, &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending"}))

	counts, err := svc.CountTasksByStatus(ctx, "user1")
	require.NoError(t, err)
	assert.Equal(t, int64(1), counts["recognizing"])
	assert.Equal(t, int64(0), counts["waiting_record"])
	assert.Equal(t, int64(0), counts["recorded"])
	assert.Equal(t, false, counts["has_unseen_waiting_record"])
}

func TestTaskService_CountTasksByStatusWaitingRecordUsesRecentWindow(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	now := time.Now()
	recentCreatedAt := now.Add(-2 * time.Hour)
	oldCreatedAt := now.Add(-25 * time.Hour)

	recentWaiting := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done", CreatedAt: &recentCreatedAt}
	oldWaiting := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food_text", Status: "done", CreatedAt: &oldCreatedAt}
	recentRecorded := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done", CreatedAt: &recentCreatedAt}
	require.NoError(t, taskRepo.CreateTask(ctx, recentWaiting))
	require.NoError(t, taskRepo.CreateTask(ctx, oldWaiting))
	require.NoError(t, taskRepo.CreateTask(ctx, recentRecorded))
	require.NoError(t, db.Exec(`INSERT INTO user_food_records (id, user_id, source_task_id) VALUES (?, ?, ?)`, "record1", "user1", recentRecorded.ID).Error)

	counts, err := svc.CountTasksByStatus(ctx, "user1")
	require.NoError(t, err)
	assert.Equal(t, int64(1), counts["waiting_record"])
	assert.Equal(t, true, counts["has_unseen_waiting_record"])
}

func TestTaskService_GetTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewTaskService(taskRepo, precisionRepo, userRepo, storageClient)
	ctx := context.Background()

	legacyURL := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/legacy.jpg"
	task := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending", ImageURL: &legacyURL}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	found, err := svc.GetTask(ctx, task.ID, "user1")
	require.NoError(t, err)
	assert.Equal(t, task.ID, found.ID)
	assert.Equal(t, "https://cdn.example.com/food/legacy.jpg", *found.ImageURL)
	assert.Equal(t, []string{"https://cdn.example.com/food/legacy.jpg"}, found.ImagePaths)

	_, err = svc.GetTask(ctx, task.ID, "user2")
	assert.Error(t, err)

	_, err = svc.GetTask(ctx, "nonexistent", "user1")
	assert.Error(t, err)
}

func TestTaskService_UpdateTaskResult(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending"}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	err := svc.UpdateTaskResult(ctx, task.ID, "user1", map[string]any{"result": "ok"})
	require.NoError(t, err)

	err = svc.UpdateTaskResult(ctx, task.ID, "user2", map[string]any{})
	assert.Error(t, err)
}

func TestTaskService_DeleteTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending"}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	result, err := svc.DeleteTask(ctx, task.ID, "user1")
	require.NoError(t, err)
	assert.True(t, result["deleted"].(bool))

	_, err = svc.DeleteTask(ctx, task.ID, "user2")
	assert.Error(t, err)
}

func TestTaskService_CleanupTimeoutTasks(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	_, err := svc.CleanupTimeoutTasks(ctx, 30, "wrong-key", "expected-key")
	assert.Error(t, err)

	count, err := svc.CleanupTimeoutTasks(ctx, 30, "expected-key", "expected-key")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestTaskService_CreateBatchTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	taskID, err := svc.CreateBatchTask(ctx, "user1", []string{"https://example.com/1.jpg"}, map[string]any{}, map[string]any{"items": []any{}})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}

func TestTaskService_ValidateQuota(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	err := svc.ValidateQuota(ctx, "user1")
	require.NoError(t, err)
}
