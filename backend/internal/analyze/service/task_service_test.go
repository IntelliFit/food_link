package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/testdb"

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
	validateModes []string
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
	m.validateModes = append(m.validateModes, executionMode)
	cost := 2 * unit
	if executionMode == "strict" || executionMode == "strict_separate" || executionMode == "experimental" {
		cost = 4 * unit
	} else if executionMode == "standard_correction" {
		cost = 1 * unit
	} else if executionMode == "strict_correction" {
		cost = 2 * unit
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
	db := testdb.New(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&analyzedomain.AnalysisTask{}, &analyzedomain.PrecisionSession{}, &analyzedomain.PrecisionSessionRound{}, &authrepo.User{}, &foodrecorddomain.FoodRecord{}))
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

func TestTaskService_SubmitAnalyzeTask_StrictSeparateCreatesPrecisionPlan(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()

	mode := "strict_separate"
	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{
		ImageURLs:     []string{"https://example.com/noodle.jpg"},
		ExecutionMode: &mode,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	require.Equal(t, []string{"strict_separate"}, guard.validateModes)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, "precision_plan", task.TaskType)
	assert.Equal(t, "strict_separate", task.Payload["execution_mode"])
	assert.NotEmpty(t, task.Payload["precision_session_id"])

	var session analyzedomain.PrecisionSession
	require.NoError(t, db.First(&session, "id = ?", task.Payload["precision_session_id"]).Error)
	assert.Equal(t, "experimental", session.ExecutionMode)
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

func TestBuildSubmitTaskPayloadPreservesIntegratedPackagedCorrectionFields(t *testing.T) {
	remaining := 520.5
	offset := -480
	payload := buildSubmitTaskPayload(SubmitTaskInput{
		MealType:              "snack",
		Province:              "上海市",
		City:                  "上海市",
		District:              "徐汇区",
		DietGoal:              "fat_loss",
		ActivityTiming:        "after_training",
		UserGoal:              "减脂",
		RemainingCalories:     &remaining,
		SuggestRatioEnabled:   true,
		AdditionalContext:     "桃李面包只吃半包",
		ModelName:             "qwen3.6-flash",
		AnalysisEngine:        "db_first",
		TimezoneOffsetMinutes: &offset,
		IsMultiView:           true,
		PreviousResult: map[string]any{
			"items": []any{map[string]any{"itemId": 12, "name": "桃李豆沙小饼面包"}},
		},
		CorrectionItems: []map[string]any{{
			"sourceItemId":         12,
			"sourceName":           "桃李豆沙小饼面包",
			"name":                 "桃李豆沙小饼面包（半包）",
			"estimatedWeightGrams": 27.5,
			"nameEdited":           true,
			"weightEdited":         true,
			"nutritionEdited":      true,
			"nutrients":            map[string]any{"calories": 90.0, "protein": 4.2},
		}},
		SourceType: "Image",
	}, "2026-06-04", "fast_web_search")

	assert.Equal(t, "fast_web_search", payload["execution_mode"])
	assert.Equal(t, true, payload["suggest_ratio_enabled"])
	assert.Equal(t, &remaining, payload["remaining_calories"])
	assert.Equal(t, "桃李面包只吃半包", payload["additionalContext"])
	assert.Equal(t, "db_first", payload["analysis_engine"])
	assert.Equal(t, offset, payload["timezone_offset_minutes"])
	assert.Equal(t, true, payload["is_multi_view"])
	assert.Equal(t, "image", payload["source_type"])
	assert.NotEmpty(t, mapFromAny(payload["previousResult"]))
	items := mapSliceFromAny(payload["correctionItems"])
	require.Len(t, items, 1)
	assert.Equal(t, float64(12), numberFromAny(items[0]["sourceItemId"]))
	assert.Equal(t, "桃李豆沙小饼面包", items[0]["sourceName"])
	assert.Equal(t, "桃李豆沙小饼面包（半包）", items[0]["name"])
	assert.Equal(t, true, items[0]["nameEdited"])
	assert.Equal(t, true, items[0]["weightEdited"])
	assert.Equal(t, true, items[0]["nutritionEdited"])
	nutrients := mapFromAny(items[0]["nutrients"])
	assert.Equal(t, 90.0, nutrients["calories"])
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

	tasks, err := svc.ListTasks(ctx, "user1", "food", "", "", 10)
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

	tasks, err := svc.ListTasks(ctx, "user1", "", "", "", 10)
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

func TestTaskService_SubmitCorrectionUsesOneCredit(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
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
	require.Equal(t, []string{"standard_correction"}, guard.validateModes)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	usage := task.Payload["credit_usage"].(map[string]any)
	assert.Equal(t, 1, intFromAny(usage["cost"]))
	assert.Equal(t, true, task.Payload["is_correction"])
}

func TestTaskService_SubmitStrictSeparateCorrectionUsesPrecisionCorrectionCredits(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	guard := &mockTaskCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	imageURL := "https://example.com/meal.jpg"
	source := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "precision_plan", Status: "done", ImageURL: &imageURL}
	require.NoError(t, taskRepo.CreateTask(ctx, source))
	strictSeparate := "strict_separate"

	taskID, err := svc.SubmitAnalyzeTask(ctx, "user1", SubmitTaskInput{
		ImageURL:               imageURL,
		ExecutionMode:          &strictSeparate,
		CorrectionSourceTaskID: source.ID,
		PreviousResult:         map[string]any{"description": "old"},
		CorrectionItems:        []map[string]any{{"name": "米饭", "weight": 100}},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"strict_correction"}, guard.validateModes)

	task, err := taskRepo.GetTaskByID(ctx, taskID)
	require.NoError(t, err)
	assert.Equal(t, "precision_plan", task.TaskType)
	usage := task.Payload["credit_usage"].(map[string]any)
	assert.Equal(t, 2, intFromAny(usage["cost"]))
	assert.Equal(t, true, task.Payload["is_correction"])
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

func TestTaskService_RetryTask_ResubmitsFailedImageTaskWithExistingImages(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	publisher := &recordingTaskPublisher{}
	guard := &mockTaskCreditGuard{earnedUnits: 1}
	svc.ConfigureTaskPublisher(publisher)
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	imageURL := "https://example.com/meal.jpg"
	task := &analyzedomain.AnalysisTask{
		UserID:     "user1",
		TaskType:   "food",
		Status:     "failed",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"meal_type":      "lunch",
			"execution_mode": "standard_web_search",
			"credit_usage": map[string]any{
				"credit_group_id": "old-group",
				"cost":            2,
				"earned_units":    1,
			},
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	result, err := svc.RetryTask(ctx, task.ID, "user1")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, publisher.messages, 1)
	assert.Equal(t, result.TaskID, publisher.messages[0].TaskID)
	require.Len(t, guard.refundCalls, 1)
	require.Len(t, guard.consumeCalls, 1)

	retryTask, err := taskRepo.GetTaskByID(ctx, result.TaskID)
	require.NoError(t, err)
	require.NotNil(t, retryTask)
	assert.Equal(t, "food", retryTask.TaskType)
	assert.Equal(t, "pending", retryTask.Status)
	assert.Equal(t, []string{imageURL}, retryTask.ImagePaths)
	assert.Equal(t, task.ID, retryTask.Payload["retry_source_task_id"])
	assert.Equal(t, true, retryTask.Payload["is_retry"])
	assert.NotEqual(t, "old-group", stringFromAny(retryTask.Payload["credit_group_id"]))
	assert.Equal(t, "standard_web_search", retryTask.Payload["execution_mode"])
}

func TestTaskService_PrepareAndEnqueueInternalRetryPreservesChainWithoutCredits(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	publisher := &recordingTaskPublisher{}
	guard := &mockTaskCreditGuard{earnedUnits: 1}
	svc.ConfigureTaskPublisher(publisher)
	svc.ConfigureCreditGuard(guard)
	ctx := context.Background()
	task := &analyzedomain.AnalysisTask{
		UserID:    "system-user",
		TaskType:  "food_text",
		Status:    "failed",
		TextInput: func() *string { value := "校园菜品：番茄炒饭"; return &value }(),
		Payload: map[string]any{
			"execution_mode":         "standard",
			"campus_catalog_item_id": "catalog-item",
			"internal_benchmark":     true,
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	result, err := svc.PrepareInternalRetryTask(ctx, task.ID, "system-user")

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Empty(t, publisher.messages)
	require.Empty(t, guard.validateCalls)
	require.Empty(t, guard.consumeCalls)
	require.Empty(t, guard.refundCalls)
	retryTask, err := taskRepo.GetTaskByID(ctx, result.TaskID)
	require.NoError(t, err)
	require.Equal(t, "cancelled", retryTask.Status)
	require.Equal(t, task.ID, retryTask.Payload["retry_source_task_id"])
	require.Equal(t, true, retryTask.Payload["internal_benchmark"])
	require.Equal(t, true, retryTask.Payload["internal_retry_prepared"])
	require.Equal(t, "catalog-item", retryTask.Payload["campus_catalog_item_id"])
	require.NoError(t, taskRepo.UpdateTaskStatus(ctx, result.TaskID, "pending", nil))
	require.NoError(t, svc.EnqueuePreparedInternalTask(ctx, result.TaskID, "system-user"))
	require.Len(t, publisher.messages, 1)
	require.Equal(t, result.TaskID, publisher.messages[0].TaskID)
}

func TestTaskService_PrepareInternalRetryRejectsUserTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	imageURL := "https://example.com/user-meal.jpg"
	task := &analyzedomain.AnalysisTask{
		UserID: "user-1", TaskType: "food", Status: "failed",
		ImageURL: &imageURL, ImagePaths: []string{imageURL}, Payload: map[string]any{"execution_mode": "standard"},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	_, err := svc.PrepareInternalRetryTask(ctx, task.ID, "user-1")

	require.ErrorIs(t, err, commonerrors.ErrForbidden)
}

func TestTaskService_RetryTask_RejectsDoneTask(t *testing.T) {
	_, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	task := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "done"}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	_, err := svc.RetryTask(ctx, task.ID, "user1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "只有识别失败或超时")
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
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	recordRepo := foodrecordrepo.NewFoodRecordRepo(db)
	svc.ConfigureRecordRepo(recordRepo)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{UserID: "user1", TaskType: "food", Status: "pending"}
	require.NoError(t, taskRepo.CreateTask(ctx, task))

	// Create associated food record
	record := &foodrecorddomain.FoodRecord{ID: "fr1", UserID: "user1", SourceTaskID: &task.ID, MealType: "lunch"}
	require.NoError(t, db.Create(record).Error)

	result, err := svc.DeleteTask(ctx, task.ID, "user1")
	require.NoError(t, err)
	assert.True(t, result["deleted"].(bool))

	// Verify associated food record is also deleted
	deletedRecord, err := recordRepo.GetByUserSourceTaskID(ctx, "user1", task.ID)
	require.NoError(t, err)
	assert.Nil(t, deletedRecord)

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
