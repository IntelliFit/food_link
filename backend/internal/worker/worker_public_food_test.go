package worker

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	publicfooddomain "food_link/backend/internal/publicfood/domain"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	publicfoodservice "food_link/backend/internal/publicfood/service"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/logger"

	"github.com/stretchr/testify/require"
	gormsqlite "gorm.io/driver/sqlite"
	"gorm.io/gorm"

	_ "modernc.org/sqlite"
)

type recordingWorkerPublicFoodPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingWorkerPublicFoodPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

func setupWorkerPublicFoodTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(gormsqlite.New(gormsqlite.Config{
		DriverName: "sqlite",
		DSN:        ":memory:",
	}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(
		&analyzedomain.AnalysisTask{},
		&analyzedomain.PrecisionSession{},
		&analyzedomain.PrecisionSessionRound{},
		&analyzedomain.PrecisionItemEstimate{},
		&publicfooddomain.PublicFoodItem{},
	))
	return db
}

func TestWorkerProcessFoodWritesBackCampusPublicFood(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	imageURL := "https://example.com/campus-food.jpg"
	item := &publicfooddomain.PublicFoodItem{
		ID:           "public-food-1",
		UserID:       "user-1",
		FoodName:     "鸡胸肉套餐",
		Status:       "published",
		IsCampusFood: true,
		ImagePath:    &imageURL,
		ImagePaths:   []string{imageURL},
	}
	require.NoError(t, publicFood.CreateItem(context.Background(), item))
	task := &analyzedomain.AnalysisTask{
		ID:         "task-campus-food-1",
		UserID:     "user-1",
		TaskType:   "food",
		Status:     "pending",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"source_type":         "campus_public_food",
			"public_food_item_id": item.ID,
		},
	}
	require.NoError(t, taskRepo.CreateTask(context.Background(), task))
	require.NoError(t, publicFood.LinkAnalysisTask(context.Background(), item.ID, task.ID))
	analyze := &fakeWorkerAnalyzeRunner{result: map[string]any{
		"description": "鸡胸肉套餐",
		"insight":     "高蛋白，适合训练后",
		"items": []any{
			map[string]any{
				"name": "鸡胸肉",
				"nutrients": map[string]any{
					"calories": 198.0,
					"protein":  37.0,
					"carbs":    0.0,
					"fat":      4.0,
				},
			},
			map[string]any{
				"name": "米饭",
				"nutrients": map[string]any{
					"calories": 260.0,
					"protein":  5.0,
					"carbs":    56.0,
					"fat":      0.6,
				},
			},
		},
	}}
	runner := &Runner{tasks: taskRepo, publicFood: publicFood, analyze: analyze, log: logger.L()}

	require.NoError(t, runner.processFood(context.Background(), task))

	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Equal(t, 458.0, saved.TotalCalories)
	require.Equal(t, 42.0, saved.TotalProtein)
	require.Equal(t, 56.0, saved.TotalCarbs)
	require.InEpsilon(t, 4.6, saved.TotalFat, 0.001)
	require.Equal(t, "鸡胸肉套餐", saved.Description)
	require.Equal(t, "高蛋白，适合训练后", saved.Insight)

	var savedTask analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&savedTask).Error)
	require.Equal(t, "done", savedTask.Status)
}

func TestCampusPublicFoodSubmitWaitsForWorkerCaloriesRecognition(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	publisher := &recordingWorkerPublicFoodPublisher{}
	analyzeTaskSvc := analyzeservice.NewTaskService(taskRepo, precisionRepo, authrepo.NewUserRepo(db))
	analyzeTaskSvc.ConfigureTaskPublisher(publisher)
	svc := publicfoodservice.NewPublicFoodService(publicFood)
	svc.ConfigureCampusAnalyzeTaskSubmitter(analyzeTaskSvc)
	imageURL := "https://example.com/campus-chicken-rice.jpg"
	foodName := "鸡胸肉米饭"
	schoolName := "北京大学"
	canteenName := "学一食堂"

	itemID, err := svc.Create(ctx, "user-1", publicfoodservice.CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &schoolName,
		CanteenName:  &canteenName,
		ImagePath:    &imageURL,
		ImagePaths:   []string{imageURL},
	})
	require.NoError(t, err)
	require.Len(t, publisher.messages, 1)

	task, err := taskRepo.GetTaskByID(ctx, publisher.messages[0].TaskID)
	require.NoError(t, err)
	require.NotNil(t, task)
	require.Equal(t, "precision_plan", task.TaskType)
	require.Equal(t, "pending", task.Status)
	require.Equal(t, itemID, task.Payload["public_food_item_id"])
	require.Equal(t, "campus_public_food", task.Payload["public_food_source_type"])
	require.Equal(t, "image", task.Payload["source_type"])
	require.Equal(t, "strict_separate", task.Payload["execution_mode"])

	aggregateTask := &analyzedomain.AnalysisTask{
		UserID:     "user-1",
		TaskType:   "precision_aggregate",
		Status:     "pending",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"precision_session_id":    task.Payload["precision_session_id"],
			"round_index":             1,
			"split_strategy":          "single_shot",
			"public_food_source_type": "campus_public_food",
			"public_food_item_id":     itemID,
			"execution_mode":          "strict_separate",
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, aggregateTask))
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, itemID, aggregateTask.ID))
	require.NoError(t, precisionRepo.CreateItemEstimate(ctx, &analyzedomain.PrecisionItemEstimate{
		SessionID:  stringFromMap(task.Payload, "precision_session_id"),
		RoundIndex: 1,
		ItemIndex:  0,
		ItemKey:    "group_0",
		ItemName:   "鸡胸肉米饭",
		Status:     "done",
		Result: map[string]any{
			"items": []map[string]any{
				{"name": "鸡胸肉", "nutrients": map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0}},
				{"name": "米饭", "nutrients": map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6}},
			},
		},
	}))
	runner := &Runner{tasks: taskRepo, precision: precisionRepo, publicFood: publicFood, analyze: &fakeWorkerAnalyzeRunner{}, log: logger.L()}
	go func() {
		_ = runner.processPrecisionAggregate(context.Background(), aggregateTask)
	}()

	deadline := time.Now().Add(3 * time.Minute)
	for {
		var saved publicfooddomain.PublicFoodItem
		require.NoError(t, db.Where("id = ?", itemID).First(&saved).Error)
		savedTask, err := taskRepo.GetTaskByID(ctx, aggregateTask.ID)
		require.NoError(t, err)
		if savedTask != nil && savedTask.Status == "done" && saved.TotalCalories > 0 {
			require.Equal(t, 458.0, saved.TotalCalories)
			require.Equal(t, 42.0, saved.TotalProtein)
			require.Equal(t, 56.0, saved.TotalCarbs)
			require.InEpsilon(t, 4.6, saved.TotalFat, 0.001)
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("校园食堂菜品热量识别在 3 分钟内未完成，task_status=%s total_calories=%.1f", savedTask.Status, saved.TotalCalories)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func TestWorkerProcessPrecisionAggregateWritesBackCampusPublicFood(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	imageURL := "https://example.com/campus-precision-food.jpg"
	item := &publicfooddomain.PublicFoodItem{
		ID:           "public-food-precision-1",
		UserID:       "user-1",
		FoodName:     "鸡胸肉米饭",
		Status:       "published",
		IsCampusFood: true,
		ImagePath:    &imageURL,
		ImagePaths:   []string{imageURL},
	}
	require.NoError(t, publicFood.CreateItem(ctx, item))
	session := &analyzedomain.PrecisionSession{
		ID:            "precision-session-campus-1",
		UserID:        "user-1",
		SourceType:    "image",
		ExecutionMode: "experimental",
		Status:        "estimating",
		RoundIndex:    1,
		LatestInputs:  map[string]any{},
	}
	require.NoError(t, precisionRepo.CreateSession(ctx, session))
	require.NoError(t, precisionRepo.CreateItemEstimate(ctx, &analyzedomain.PrecisionItemEstimate{
		SessionID:  session.ID,
		RoundIndex: 1,
		ItemIndex:  0,
		ItemKey:    "group_0",
		ItemName:   "鸡胸肉和米饭",
		Status:     "done",
		Result: map[string]any{
			"items": []map[string]any{
				{"name": "鸡胸肉", "nutrients": map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0}},
				{"name": "米饭", "nutrients": map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6}},
			},
		},
	}))
	task := &analyzedomain.AnalysisTask{
		ID:         "task-campus-precision-aggregate-1",
		UserID:     "user-1",
		TaskType:   "precision_aggregate",
		Status:     "pending",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"precision_session_id":    session.ID,
			"round_index":             1,
			"split_strategy":          "single_shot",
			"public_food_source_type": "campus_public_food",
			"public_food_item_id":     item.ID,
			"execution_mode":          "strict_separate",
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, item.ID, task.ID))
	runner := &Runner{tasks: taskRepo, precision: precisionRepo, publicFood: publicFood, analyze: &fakeWorkerAnalyzeRunner{}, log: logger.L()}

	require.NoError(t, runner.processPrecisionAggregate(ctx, task))

	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Equal(t, 458.0, saved.TotalCalories)
	require.Equal(t, 42.0, saved.TotalProtein)
	require.Equal(t, 56.0, saved.TotalCarbs)
	require.InEpsilon(t, 4.6, saved.TotalFat, 0.001)
	var savedTask analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&savedTask).Error)
	require.Equal(t, "done", savedTask.Status)
}
