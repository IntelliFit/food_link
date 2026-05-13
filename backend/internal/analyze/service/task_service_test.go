package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recordingTaskPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingTaskPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

type mockTaskCreditGuard struct {
	earnedUnits   int
	validateCalls []int
	consumeCalls  []struct {
		userID    string
		cost      int
		reason    string
		sourceKey string
	}
	refundCalls []struct {
		userID    string
		cost      int
		reason    string
		sourceKey string
	}
}

func (m *mockTaskCreditGuard) ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string, units ...int) (map[string]any, error) {
	unit := 1
	if len(units) > 0 && units[0] > 0 {
		unit = units[0]
	}
	m.validateCalls = append(m.validateCalls, unit)
	cost := 2 * unit
	if executionMode == "strict" {
		cost = 4 * unit
	}
	earnedUnits := m.earnedUnits
	return map[string]any{
		"credit_cost": cost,
		"credit_spend_plan": map[string]any{
			"recorded_on":     recordedOn,
			"cost":            cost,
			"system_by_date":  map[string]any{recordedOn: cost},
			"earned_units":    earnedUnits,
			"total_available": cost,
		},
	}, nil
}

func (m *mockTaskCreditGuard) ConsumeEarnedCreditsOnTaskCreated(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
	if plan, ok := creditsInfo["credit_spend_plan"].(map[string]any); ok && intFromAny(plan["earned_units"]) <= 0 {
		return nil
	}
	m.consumeCalls = append(m.consumeCalls, struct {
		userID    string
		cost      int
		reason    string
		sourceKey string
	}{userID: userID, cost: cost, reason: reason, sourceKey: sourceKey})
	return nil
}

func (m *mockTaskCreditGuard) RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error {
	m.refundCalls = append(m.refundCalls, struct {
		userID    string
		cost      int
		reason    string
		sourceKey string
	}{userID: userID, cost: cost, reason: refundReason, sourceKey: refundSourceKey})
	return nil
}

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
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()

	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{ImageURLs: []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	require.Equal(t, []int{1}, guard.validateCalls)
	assert.Empty(t, guard.consumeCalls)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	usage := task.Payload["credit_usage"].(map[string]any)
	assert.Equal(t, 2, intFromAny(usage["cost"]))
	assert.Equal(t, []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}, task.ImagePaths)
}

func TestTaskService_SubmitAnalyzeTask_RejectsMoreThanThreeImages(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()

	_, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{ImageURLs: []string{
		"https://example.com/1.jpg",
		"https://example.com/2.jpg",
		"https://example.com/3.jpg",
		"https://example.com/4.jpg",
	}})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "最多支持 3 张图片")
	assert.Empty(t, guard.validateCalls)
}

func TestTaskService_EnqueueTaskPublishesQueueMessage(t *testing.T) {
	svc := &TaskService{}
	publisher := &recordingTaskPublisher{}
	svc.ConfigureTaskPublisher(publisher)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{ID: "task-1", TaskType: "food", Status: "pending"}
	err := svc.enqueueTask(ctx, task)
	require.NoError(t, err)
	require.Len(t, publisher.messages, 1)
	assert.Equal(t, "task-1", publisher.messages[0].TaskID)
	assert.Equal(t, "food", publisher.messages[0].TaskType)
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

func TestTaskService_SubmitTextTask_ReservesCreditsWithRefundGroup(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{earnedUnits: 1}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	recordedOn := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")

	taskID, err := svc.SubmitTextTask(ctx, "user1", SubmitTaskInput{TextInput: "一碗米饭", Date: recordedOn})
	require.NoError(t, err)
	require.Equal(t, []int{1}, guard.validateCalls)
	require.Len(t, guard.consumeCalls, 1)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, "food_text", task.TaskType)
	groupID := stringFromAny(task.Payload["credit_group_id"])
	require.NotEmpty(t, groupID)
	usage := task.Payload["credit_usage"].(map[string]any)
	assert.Equal(t, groupID, stringFromAny(usage["credit_group_id"]))
	assert.Equal(t, 2, intFromAny(usage["cost"]))
	assert.Equal(t, "food_analysis_reward_spend", guard.consumeCalls[0].reason)
	assert.Equal(t, "food_analysis:"+groupID, guard.consumeCalls[0].sourceKey)
}

func TestTaskService_EnqueueTaskSkipsCompletedTask(t *testing.T) {
	svc := &TaskService{}
	publisher := &recordingTaskPublisher{}
	svc.ConfigureTaskPublisher(publisher)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{ID: "task-1", TaskType: "food_text", Status: "done"}
	err := svc.enqueueTask(ctx, task)
	require.NoError(t, err)
	assert.Empty(t, publisher.messages)
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
	var imageTask *analyzedomain.AnalysisTask
	for i := range tasks {
		if tasks[i].ImageURL != nil {
			imageTask = &tasks[i]
			break
		}
	}
	require.NotNil(t, imageTask)
	assert.Equal(t, "https://cdn.example.com/food/legacy.jpg", *imageTask.ImageURL)
	assert.Equal(t, []string{"https://cdn.example.com/food/legacy.jpg"}, imageTask.ImagePaths)
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

func TestTaskService_GetTask_RefundsCreditsOnlyForFailedTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	now := time.Now()
	done := &analyzedomain.AnalysisTask{
		UserID:   "user1",
		TaskType: "food",
		Status:   "done",
		Payload: map[string]any{
			"credit_usage": map[string]any{
				"credit_group_id": "group-done",
				"cost":            2,
				"system_by_date":  map[string]any{now.Format("2006-01-02"): 2},
				"earned_units":    1,
			},
		},
		CreatedAt: &now,
	}
	failed := &analyzedomain.AnalysisTask{
		UserID:   "user1",
		TaskType: "food",
		Status:   "failed",
		Payload: map[string]any{
			"credit_usage": map[string]any{
				"credit_group_id": "group-failed",
				"cost":            2,
				"system_by_date":  map[string]any{now.Format("2006-01-02"): 1},
				"earned_units":    1,
			},
		},
		CreatedAt: &now,
	}
	require.NoError(t, taskRepo.CreateTask(ctx, done))
	require.NoError(t, taskRepo.CreateTask(ctx, failed))

	_, err := svc.GetTask(ctx, done.ID, "user1")
	require.NoError(t, err)
	assert.Empty(t, guard.consumeCalls)
	assert.Empty(t, guard.refundCalls)

	_, err = svc.GetTask(ctx, failed.ID, "user1")
	require.NoError(t, err)
	require.Len(t, guard.refundCalls, 1)
	assert.Equal(t, "food_analysis_reward_refund", guard.refundCalls[0].reason)
	assert.Equal(t, "food_analysis_refund:group-failed", guard.refundCalls[0].sourceKey)
}

func TestTaskService_GetTask_RefundsCreditsForFailedTextTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	now := time.Now()
	failed := &analyzedomain.AnalysisTask{
		UserID:   "user1",
		TaskType: "food_text",
		Status:   "failed",
		Payload: map[string]any{
			"credit_usage": map[string]any{
				"credit_group_id": "text-group-failed",
				"cost":            2,
				"system_by_date":  map[string]any{now.Format("2006-01-02"): 2},
				"earned_units":    1,
			},
		},
		CreatedAt: &now,
	}
	require.NoError(t, taskRepo.CreateTask(ctx, failed))

	_, err := svc.GetTask(ctx, failed.ID, "user1")
	require.NoError(t, err)
	require.Len(t, guard.refundCalls, 1)
	assert.Equal(t, "food_analysis_reward_refund", guard.refundCalls[0].reason)
	assert.Equal(t, "food_analysis_refund:text-group-failed", guard.refundCalls[0].sourceKey)
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

func TestTaskService_DeleteUnrecordedTasks(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()

	waiting := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done"}
	recorded := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done"}
	failed := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "failed"}
	require.NoError(t, taskRepo.CreateTask(ctx, waiting))
	require.NoError(t, taskRepo.CreateTask(ctx, recorded))
	require.NoError(t, taskRepo.CreateTask(ctx, failed))
	require.NoError(t, db.Exec(`INSERT INTO user_food_records (id, user_id, source_task_id) VALUES (?, ?, ?)`, "record-1", "user1", recorded.ID).Error)

	result, err := svc.DeleteUnrecordedTasks(ctx, "user1")
	require.NoError(t, err)
	assert.Equal(t, true, result["deleted"])
	assert.Equal(t, int64(1), result["count"])

	gotWaiting, _ := taskRepo.GetTaskByID(ctx, waiting.ID)
	assert.Nil(t, gotWaiting)
	gotRecorded, _ := taskRepo.GetTaskByID(ctx, recorded.ID)
	assert.NotNil(t, gotRecorded)
	gotFailed, _ := taskRepo.GetTaskByID(ctx, failed.ID)
	assert.NotNil(t, gotFailed)
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
