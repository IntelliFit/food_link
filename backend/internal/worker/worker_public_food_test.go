package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	campuscatalogdomain "food_link/backend/internal/campuscatalog/domain"
	campuscatalogrepo "food_link/backend/internal/campuscatalog/repo"
	publicfooddomain "food_link/backend/internal/publicfood/domain"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	publicfoodservice "food_link/backend/internal/publicfood/service"
	"food_link/backend/internal/taskqueue"

	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/testdb"

	"gorm.io/gorm"
)

type recordingWorkerPublicFoodPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingWorkerPublicFoodPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

type recordingWorkerPublicFoodQueue struct {
	recordingWorkerPublicFoodPublisher
}

func (q *recordingWorkerPublicFoodQueue) Subscribe(ctx context.Context, opts taskqueue.SubscribeOptions) (<-chan taskqueue.Delivery, error) {
	ch := make(chan taskqueue.Delivery)
	close(ch)
	return ch, nil
}

func (q *recordingWorkerPublicFoodQueue) Close(ctx context.Context) error {
	return nil
}

func setupWorkerPublicFoodTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := testdb.New(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(
		&analyzedomain.AnalysisTask{},
		&analyzedomain.PrecisionSession{},
		&analyzedomain.PrecisionSessionRound{},
		&analyzedomain.PrecisionItemEstimate{},
		&publicfooddomain.PublicFoodItem{},
		&campuscatalogdomain.CatalogItem{},
	))
	return db
}

func TestWorkerProcessFoodPublishesCatalogItemOnlyAfterNutritionSucceeds(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	taskRepo := analyzerepo.NewTaskRepo(db)
	catalog := campuscatalogrepo.NewCatalogRepo(db)
	imageURL := "https://example.com/campus-catalog-rice.jpg"
	price := 12.0
	item := &campuscatalogdomain.CatalogItem{
		ID: "catalog-food-1", BatchID: "batch-1", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", Floor: "2F", WindowName: "炒饭档口",
		PriceType: "fixed", Price: &price, PriceUnit: "元/份", PortionDescription: "1份",
		ImagePaths: []string{imageURL}, CompletenessStatus: "complete", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	task := &analyzedomain.AnalysisTask{
		ID: "task-catalog-food-1", UserID: "system-user-1", TaskType: "food", Status: "pending",
		ImageURL: &imageURL, ImagePaths: []string{imageURL}, Payload: map[string]any{
			"source_type": "image", "public_food_source_type": "campus_public_food",
			"public_food_item_id": item.ID, "campus_catalog_item_id": item.ID,
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))
	require.NoError(t, catalog.LinkAnalysisTask(ctx, item.ID, task.ID))

	var beforeCount int64
	require.NoError(t, db.Table("public_food_library").Where("id = ?", item.ID).Count(&beforeCount).Error)
	require.Zero(t, beforeCount)

	runner := &Runner{tasks: taskRepo, analyze: &fakeWorkerAnalyzeRunner{result: map[string]any{
		"description": "一份番茄炒饭", "insight": "主食份量适中", "items": []any{map[string]any{
			"name": "番茄炒饭", "nutrients": map[string]any{"calories": 420.0, "protein": 12.0, "carbs": 68.0, "fat": 11.0},
		}},
	}}}
	runner.ConfigureCampusCatalog(catalog)
	require.NoError(t, runner.processFood(ctx, task))

	var publicItem publicfooddomain.PublicFoodItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "published", publicItem.Status)
	require.Equal(t, 420.0, publicItem.TotalCalories)
	require.Equal(t, 12.0, publicItem.TotalProtein)

	var savedCatalog campuscatalogdomain.CatalogItem
	require.NoError(t, db.First(&savedCatalog, "id = ?", item.ID).Error)
	require.Equal(t, "published", savedCatalog.Status)
	require.Equal(t, task.ID, *savedCatalog.AnalysisTaskID)
	require.NotNil(t, savedCatalog.AnalysisCompletedAt)
}

func TestWorkerFailureKeepsNewCatalogItemOutOfClientLibrary(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	taskRepo := analyzerepo.NewTaskRepo(db)
	catalog := campuscatalogrepo.NewCatalogRepo(db)
	item := &campuscatalogdomain.CatalogItem{
		ID: "catalog-food-failed", BatchID: "batch-1", EntryType: "dish", Name: "鸡蛋饼",
		OrganizationName: "清华大学", CanteenName: "紫荆园", CompletenessStatus: "complete", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	task := &analyzedomain.AnalysisTask{
		ID: "task-catalog-food-failed", UserID: "system-user-1", TaskType: "food", Status: "processing",
		Payload: map[string]any{"public_food_source_type": "campus_public_food", "campus_catalog_item_id": item.ID, "internal_benchmark": true},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))
	require.NoError(t, catalog.LinkAnalysisTask(ctx, item.ID, task.ID))
	runner := &Runner{tasks: taskRepo}
	runner.ConfigureCampusCatalog(catalog)

	require.NoError(t, runner.failTask(ctx, task, errors.New("模型返回内容无法解析")))

	var savedCatalog campuscatalogdomain.CatalogItem
	require.NoError(t, db.First(&savedCatalog, "id = ?", item.ID).Error)
	require.Equal(t, "analysis_failed", savedCatalog.Status)
	require.Contains(t, savedCatalog.AnalysisError, "模型返回内容无法解析")
	var publicCount int64
	require.NoError(t, db.Table("public_food_library").Where("id = ?", item.ID).Count(&publicCount).Error)
	require.Zero(t, publicCount)
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
		Status:       "pending",
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
	runner := &Runner{tasks: taskRepo, publicFood: publicFood, analyze: analyze}

	require.NoError(t, runner.processFood(context.Background(), task))

	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Equal(t, "published", saved.Status)
	require.NotNil(t, saved.PublishedAt)
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
	publisher := &recordingWorkerPublicFoodQueue{}
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
			"precision_session_id":            task.Payload["precision_session_id"],
			"round_index":                     1,
			"split_strategy":                  "single_shot",
			"public_food_source_type":         "campus_public_food",
			"public_food_item_id":             itemID,
			"micronutrient_analysis_required": true,
			"execution_mode":                  "strict_separate",
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, aggregateTask))
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, itemID, aggregateTask.ID))
	preciseEstimateItems, err := (&fakeWorkerAnalyzeRunner{}).ApplyDBFirstToItemsWithPreciseMicronutrients(ctx, []map[string]any{
		{"name": "鸡胸肉", "nutrients": map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0}},
		{"name": "米饭", "nutrients": map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6}},
	}, "")
	require.NoError(t, err)
	require.NoError(t, precisionRepo.CreateItemEstimate(ctx, &analyzedomain.PrecisionItemEstimate{
		SessionID:  stringFromMap(task.Payload, "precision_session_id"),
		RoundIndex: 1,
		ItemIndex:  0,
		ItemKey:    "group_0",
		ItemName:   "鸡胸肉米饭",
		Status:     "done",
		Result:     map[string]any{"items": preciseEstimateItems},
	}))
	runner := &Runner{tasks: taskRepo, precision: precisionRepo, publicFood: publicFood, analyze: &fakeWorkerAnalyzeRunner{}}
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

func TestWorkerProcessPrecisionPlanRelinksCampusPublicFoodToAggregateTask(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	ctx := context.Background()
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	precisionRepo := analyzerepo.NewPrecisionRepo(db)
	publisher := &recordingWorkerPublicFoodQueue{}
	imageURL := "https://example.com/campus-plan-relink.jpg"
	item := &publicfooddomain.PublicFoodItem{
		ID:           "public-food-plan-relink",
		UserID:       "user-1",
		FoodName:     "牛肉盖饭",
		Status:       "pending",
		Type:         "campus",
		IsCampusFood: true,
		ImagePath:    &imageURL,
		ImagePaths:   []string{imageURL},
	}
	require.NoError(t, publicFood.CreateItem(ctx, item))
	session := &analyzedomain.PrecisionSession{
		ID:            "precision-session-plan-relink",
		UserID:        "user-1",
		SourceType:    "image",
		ExecutionMode: "strict_separate",
		Status:        "estimating",
		RoundIndex:    1,
		LatestInputs: map[string]any{
			"image_url":         imageURL,
			"image_urls":        []string{imageURL},
			"additionalContext": "菜品名称：牛肉盖饭",
		},
	}
	require.NoError(t, precisionRepo.CreateSession(ctx, session))
	planTask := &analyzedomain.AnalysisTask{
		ID:         "task-campus-precision-plan-relink",
		UserID:     "user-1",
		TaskType:   "precision_plan",
		Status:     "pending",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"precision_session_id":            session.ID,
			"round_index":                     1,
			"source_type":                     "image",
			"execution_mode":                  "strict_separate",
			"public_food_source_type":         "campus_public_food",
			"public_food_item_id":             item.ID,
			"micronutrient_analysis_required": true,
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, planTask))
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, item.ID, planTask.ID))
	runner := &Runner{
		tasks:      taskRepo,
		precision:  precisionRepo,
		publicFood: publicFood,
		queue:      publisher,
		analyze: &fakeWorkerAnalyzeRunner{result: map[string]any{
			"precisionStatus":      "ready_for_estimate",
			"splitStrategy":        "single_shot",
			"detectedItemsSummary": []any{"米饭", "牛肉"},
			"itemsToEstimate": []any{
				map[string]any{"item_key": "rice", "item_name": "米饭", "item_hint": "只估计米饭", "requires_reference": false, "uncertainty_level": "medium"},
				map[string]any{"item_key": "beef", "item_name": "牛肉", "item_hint": "只估计牛肉", "requires_reference": false, "uncertainty_level": "medium"},
			},
		}},
	}

	require.NoError(t, runner.processPrecisionPlan(ctx, planTask))

	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.NotNil(t, saved.AnalysisTaskID)
	require.NotEqual(t, planTask.ID, *saved.AnalysisTaskID)
	aggregateTask, err := taskRepo.GetTaskByID(ctx, *saved.AnalysisTaskID)
	require.NoError(t, err)
	require.NotNil(t, aggregateTask)
	require.Equal(t, "precision_aggregate", aggregateTask.TaskType)
	require.Equal(t, item.ID, aggregateTask.Payload["public_food_item_id"])
	require.Equal(t, "campus_public_food", aggregateTask.Payload["public_food_source_type"])
	require.Equal(t, true, aggregateTask.Payload["micronutrient_analysis_required"])
	require.Len(t, publisher.messages, 2)
	childTask, err := taskRepo.GetTaskByID(ctx, publisher.messages[0].TaskID)
	require.NoError(t, err)
	require.NotNil(t, childTask)
	require.Equal(t, "campus_public_food", childTask.Payload["public_food_source_type"])
	require.Equal(t, true, childTask.Payload["micronutrient_analysis_required"])
	require.Equal(t, aggregateTask.ID, publisher.messages[1].TaskID)
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
		Status:       "pending",
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
	preciseEstimateItems, err := (&fakeWorkerAnalyzeRunner{}).ApplyDBFirstToItemsWithPreciseMicronutrients(ctx, []map[string]any{
		{"name": "鸡胸肉", "nutrients": map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0}},
		{"name": "米饭", "nutrients": map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6}},
	}, "")
	require.NoError(t, err)
	require.NoError(t, precisionRepo.CreateItemEstimate(ctx, &analyzedomain.PrecisionItemEstimate{
		SessionID:  session.ID,
		RoundIndex: 1,
		ItemIndex:  0,
		ItemKey:    "group_0",
		ItemName:   "鸡胸肉和米饭",
		Status:     "done",
		Result:     map[string]any{"items": preciseEstimateItems},
	}))
	task := &analyzedomain.AnalysisTask{
		ID:         "task-campus-precision-aggregate-1",
		UserID:     "user-1",
		TaskType:   "precision_aggregate",
		Status:     "pending",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload: map[string]any{
			"precision_session_id":            session.ID,
			"round_index":                     1,
			"split_strategy":                  "single_shot",
			"public_food_source_type":         "campus_public_food",
			"public_food_item_id":             item.ID,
			"micronutrient_analysis_required": true,
			"execution_mode":                  "strict_separate",
		},
	}
	require.NoError(t, taskRepo.CreateTask(ctx, task))
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, item.ID, task.ID))
	runner := &Runner{tasks: taskRepo, precision: precisionRepo, publicFood: publicFood, analyze: &fakeWorkerAnalyzeRunner{}}

	require.NoError(t, runner.processPrecisionAggregate(ctx, task))

	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Equal(t, "published", saved.Status)
	require.NotNil(t, saved.PublishedAt)
	require.Equal(t, 458.0, saved.TotalCalories)
	require.Equal(t, 42.0, saved.TotalProtein)
	require.Equal(t, 56.0, saved.TotalCarbs)
	require.InEpsilon(t, 4.6, saved.TotalFat, 0.001)
	require.Len(t, saved.Items, 2)
	require.Equal(t, "ai_precise_v1", saved.Items[0]["micronutrient_analysis"])
	var savedTask analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&savedTask).Error)
	require.Equal(t, "done", savedTask.Status)
}
