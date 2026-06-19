package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"food_link/backend/internal/admin/domain"
	admindomain "food_link/backend/internal/admin/domain"
	"food_link/backend/internal/admin/repo"
	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	analyzerepo "food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/migration/do"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupBenchmarkTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&do.FoodWeightLabeledSampleDO{},
		&do.BenchmarkRunDO{},
		&do.BenchmarkRunSampleDO{},
		&do.AdminAccountDO{},
		&authrepo.User{},
		&authrepo.UserTrialEntitlement{},
		&analyzedomain.AnalysisTask{},
		&analyzedomain.AnalysisFeedbackSample{},
		&analyzedomain.PrecisionSession{},
		&analyzedomain.PrecisionItemEstimate{},
	))
	return db
}

type fakeBenchmarkTaskService struct {
	taskRepo *analyzerepo.TaskRepo
	delay    time.Duration
	result   map[string]any
	err      error
}

func (f *fakeBenchmarkTaskService) SubmitInternalAnalyzeTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	task := &analyzedomain.AnalysisTask{
		UserID:   userID,
		TaskType: "food",
		Status:   "done",
		Result:   f.result,
	}
	if err := f.taskRepo.CreateTask(ctx, task); err != nil {
		return "", err
	}
	return task.ID, nil
}

func (f *fakeBenchmarkTaskService) GetTask(ctx context.Context, taskID, userID string) (*analyzedomain.AnalysisTask, error) {
	time.Sleep(f.delay)
	return f.taskRepo.GetTaskByID(ctx, taskID)
}

type fakeAdminAccountReader struct {
	account *admindomain.AdminAccount
}

func (f *fakeAdminAccountReader) FindByID(ctx context.Context, id string) (*admindomain.AdminAccount, error) {
	return f.account, nil
}

type fakeBenchmarkUserResolver struct {
	users map[string]*authrepo.User
}

func (f *fakeBenchmarkUserResolver) FindByOpenID(ctx context.Context, openID string) (*authrepo.User, error) {
	return f.users[openID], nil
}

func (f *fakeBenchmarkUserResolver) Create(ctx context.Context, user *authrepo.User) error {
	f.users[user.OpenID] = user
	return nil
}

func TestBenchmarkService_CreateSample(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	// Missing batch_name
	_, err := svc.CreateSample(ctx, domain.CreateSampleInput{SampleName: "s1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "batch_name")

	// Missing sample_name
	_, err = svc.CreateSample(ctx, domain.CreateSampleInput{BatchName: "b1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sample_name")

	// Success total sample
	total := 100.0
	sample, err := svc.CreateSample(ctx, domain.CreateSampleInput{
		BatchName:        "b1",
		SampleName:       "s1",
		OriginalFilename: "s1.jpg",
		ImageURL:         "https://example.com/s1.jpg",
		LabelType:        "total",
		TotalWeightGrams: &total,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, sample.ID)
	assert.Equal(t, "b1", sample.BatchName)
	assert.Equal(t, "s1", sample.SampleName)
	assert.Equal(t, "labeled", sample.Status)
	assert.InDelta(t, 100.0, *sample.TotalWeightGrams, 0.001)
	assert.InDelta(t, 100.0, sample.Items["__total__"], 0.001)

	// Success items sample
	sample2, err := svc.CreateSample(ctx, domain.CreateSampleInput{
		BatchName:        "b1",
		SampleName:       "s2",
		OriginalFilename: "s2.jpg",
		ImageURL:         "https://example.com/s2.jpg",
		LabelType:        "items",
		Items:            map[string]any{"米饭": 150, "红烧肉": 80},
	})
	require.NoError(t, err)
	assert.Equal(t, "labeled", sample2.Status)
	assert.Len(t, sample2.Items, 2)
}

func TestBenchmarkService_ListSamples(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, err := svc.CreateSample(ctx, domain.CreateSampleInput{
			BatchName:  "batch-a",
			SampleName: "sample-a-" + string(rune('0'+i)),
			LabelType:  "items",
			Items:      map[string]any{"item": float64(i) * 10},
		})
		require.NoError(t, err)
	}
	_, err := svc.CreateSample(ctx, domain.CreateSampleInput{
		BatchName:  "batch-b",
		SampleName: "sample-b-1",
		LabelType:  "items",
		Items:      map[string]any{"item": 5},
	})
	require.NoError(t, err)

	res, err := svc.ListSamples(ctx, domain.ListSamplesInput{Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 4, len(res.Items))

	res, err = svc.ListSamples(ctx, domain.ListSamplesInput{BatchName: "batch-a", Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 3, len(res.Items))

	res, err = svc.ListSamples(ctx, domain.ListSamplesInput{Query: "sample-b", Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 1, len(res.Items))
}

func TestBenchmarkService_resolveBenchmarkUserID(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, userRepo)
	ctx := context.Background()

	adminID := uuid.New().String()

	// First call should create benchmark user by openid
	userID1, err := svc.resolveBenchmarkUserID(ctx, adminID)
	require.NoError(t, err)
	assert.NotEmpty(t, userID1)

	// Second call should reuse the same user
	userID2, err := svc.resolveBenchmarkUserID(ctx, adminID)
	require.NoError(t, err)
	assert.Equal(t, userID1, userID2)

	// Verify it can be found by openid
	openID := uuid.NewSHA1(benchmarkOpenIDNamespace, []byte("food_link_benchmark:"+adminID)).String()
	user, err := userRepo.FindByOpenID(ctx, openID)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, userID1, user.ID)
	assert.Equal(t, "benchmark", user.Nickname)
}

func TestBenchmarkService_CreateRun_Success(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	userRepo := authrepo.NewUserRepo(db)

	total := 100.0
	ctx := context.Background()
	sample := &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        "batch-a",
		SampleName:       "sample-a-1",
		OriginalFilename: "sample-a-1.jpg",
		ImageURL:         ptrString("https://example.com/sample-a-1.jpg"),
		LabelType:        "total",
		TotalWeightGrams: &total,
		Items:            map[string]any{"__total__": total},
		Status:           "labeled",
	}
	err := benchmarkRepo.CreateSample(ctx, sample)
	require.NoError(t, err)

	fakeTaskSvc := &fakeBenchmarkTaskService{
		taskRepo: taskRepo,
		result: map[string]any{
			"items": []any{
				map[string]any{"name": "米饭", "estimatedWeightGrams": 100},
			},
			"total_weight_grams": 100,
		},
	}

	adminID := uuid.New().String()
	accountReader := &fakeAdminAccountReader{account: &admindomain.AdminAccount{
		ID:       adminID,
		Username: "admin_tester",
	}}

	svc := NewBenchmarkService(benchmarkRepo, fakeTaskSvc, accountReader, userRepo)

	run, err := svc.CreateRun(ctx, adminID, domain.CreateRunInput{
		Name:          "run-1",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{BatchNames: []string{"batch-a"}},
		ModelConfig:   domain.ModelConfig{Vision: "gemini-3-flash-preview"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, run.ID)
	assert.Equal(t, "run-1", run.Name)
	assert.Equal(t, "pending", run.Status)
	assert.Equal(t, 1, run.SampleCount)
	require.NotNil(t, run.CreatedBy)
	assert.Equal(t, adminID, *run.CreatedBy)
	require.NotNil(t, run.CreatedByUsername)
	assert.Equal(t, "admin_tester", *run.CreatedByUsername)

	// Wait for async execution
	time.Sleep(500 * time.Millisecond)

	run, err = svc.GetRun(ctx, run.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.BenchmarkRunStatusDone, run.Status)

	samples, err := svc.ListRunSamples(ctx, run.ID, 1, 10)
	require.NoError(t, err)
	require.Len(t, samples.Items, 1)
	assert.Equal(t, domain.BenchmarkSampleStatusDone, samples.Items[0].Status)
	assert.Equal(t, sample.ID, samples.Items[0].SampleID)

	metrics := domain.ToBenchmarkRunSampleDTO(&samples.Items[0]).Metrics
	assert.NotEmpty(t, metrics)
}

func TestBenchmarkService_CreateRun_NoSamples(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	_, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-empty",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{BatchNames: []string{"nonexistent"}},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "未找到符合条件的数据集样本")
}

func TestBenchmarkService_CreateRun_InvalidExecutionMode(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	_, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-bad-mode",
		ExecutionMode: "invalid_mode",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "execution_mode 无效")
}

func TestBenchmarkService_CancelRun(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	total := 50.0
	err := benchmarkRepo.CreateSample(ctx, &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        "batch-cancel",
		SampleName:       "sample-cancel",
		OriginalFilename: "sample-cancel.jpg",
		ImageURL:         ptrString("https://example.com/sample-cancel.jpg"),
		LabelType:        "total",
		TotalWeightGrams: &total,
		Items:            map[string]any{"__total__": total},
		Status:           "labeled",
	})
	require.NoError(t, err)

	run, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-cancel",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{BatchNames: []string{"batch-cancel"}},
	})
	require.NoError(t, err)

	cancelled, err := svc.CancelRun(ctx, run.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.BenchmarkRunStatusCancelled, cancelled.Status)

	_, err = svc.CancelRun(ctx, run.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "当前状态不可取消")
}

func TestBenchmarkService_DeleteRun(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	svc := NewBenchmarkService(benchmarkRepo, nil, nil, nil)
	ctx := context.Background()

	total := 50.0
	err := benchmarkRepo.CreateSample(ctx, &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        "batch-delete",
		SampleName:       "sample-delete",
		OriginalFilename: "sample-delete.jpg",
		ImageURL:         ptrString("https://example.com/sample-delete.jpg"),
		LabelType:        "total",
		TotalWeightGrams: &total,
		Items:            map[string]any{"__total__": total},
		Status:           "labeled",
	})
	require.NoError(t, err)

	run, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-delete",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{BatchNames: []string{"batch-delete"}},
	})
	require.NoError(t, err)

	err = svc.DeleteRun(ctx, run.ID)
	require.NoError(t, err)

	_, err = svc.GetRun(ctx, run.ID)
	require.Error(t, err)
}

func TestBenchmarkService_ExecuteSample_NoImageURL(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	userRepo := authrepo.NewUserRepo(db)

	ctx := context.Background()
	sample := &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        "batch-noimage",
		SampleName:       "sample-noimage",
		OriginalFilename: "sample-noimage.jpg",
		LabelType:        "total",
		Items:            map[string]any{"__total__": 100},
		Status:           "labeled",
	}
	err := benchmarkRepo.CreateSample(ctx, sample)
	require.NoError(t, err)

	fakeTaskSvc := &fakeBenchmarkTaskService{taskRepo: taskRepo}
	svc := NewBenchmarkService(benchmarkRepo, fakeTaskSvc, nil, userRepo)

	run, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-noimage",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{SampleIDs: []string{sample.ID}},
	})
	require.NoError(t, err)

	time.Sleep(300 * time.Millisecond)

	run, err = svc.GetRun(ctx, run.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.BenchmarkRunStatusDone, run.Status)

	samples, err := svc.ListRunSamples(ctx, run.ID, 1, 10)
	require.NoError(t, err)
	require.Len(t, samples.Items, 1)
	assert.Equal(t, domain.BenchmarkSampleStatusFailed, samples.Items[0].Status)
	require.NotNil(t, samples.Items[0].ErrorMessage)
	assert.Contains(t, *samples.Items[0].ErrorMessage, "没有图片")
}

func TestBenchmarkService_ExecuteSample_TaskSubmitFailure(t *testing.T) {
	db := setupBenchmarkTestDB(t)
	benchmarkRepo := repo.NewBenchmarkRepo(db)
	taskRepo := analyzerepo.NewTaskRepo(db)
	userRepo := authrepo.NewUserRepo(db)

	ctx := context.Background()
	sample := &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        "batch-fail",
		SampleName:       "sample-fail",
		OriginalFilename: "sample-fail.jpg",
		ImageURL:         ptrString("https://example.com/sample-fail.jpg"),
		LabelType:        "total",
		Items:            map[string]any{"__total__": 100},
		Status:           "labeled",
	}
	err := benchmarkRepo.CreateSample(ctx, sample)
	require.NoError(t, err)

	fakeTaskSvc := &fakeBenchmarkTaskService{
		taskRepo: taskRepo,
		err:      assert.AnError,
	}
	svc := NewBenchmarkService(benchmarkRepo, fakeTaskSvc, nil, userRepo)

	run, err := svc.CreateRun(ctx, uuid.New().String(), domain.CreateRunInput{
		Name:          "run-fail",
		ExecutionMode: "standard",
		DatasetFilter: domain.DatasetFilter{SampleIDs: []string{sample.ID}},
	})
	require.NoError(t, err)

	time.Sleep(300 * time.Millisecond)

	run, err = svc.GetRun(ctx, run.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.BenchmarkRunStatusDone, run.Status)

	samples, err := svc.ListRunSamples(ctx, run.ID, 1, 10)
	require.NoError(t, err)
	require.Len(t, samples.Items, 1)
	assert.Equal(t, domain.BenchmarkSampleStatusFailed, samples.Items[0].Status)
	require.NotNil(t, samples.Items[0].ErrorMessage)
	assert.Contains(t, *samples.Items[0].ErrorMessage, "提交任务失败")
}

func TestBenchmarkService_ComparePredictionWithGroundTruth(t *testing.T) {
	cases := []struct {
		name       string
		groundTruth map[string]any
		prediction map[string]any
		wantNameMatched bool
		wantTotalErrPct float64
	}{
		{
			name: "total match",
			groundTruth: map[string]any{
				"label_type":        "total",
				"total_weight_grams": 100.0,
			},
			prediction: map[string]any{
				"items": []any{
					map[string]any{"name": "米饭", "estimatedWeightGrams": 100.0},
				},
			},
			wantNameMatched: true,
			wantTotalErrPct: 0,
		},
		{
			name: "items match",
			groundTruth: map[string]any{
				"label_type": "items",
				"items":      map[string]any{"米饭": 150, "红烧肉": 80},
			},
			prediction: map[string]any{
				"items": []any{
					map[string]any{"name": "米饭", "estimatedWeightGrams": 150.0},
					map[string]any{"name": "红烧肉", "estimatedWeightGrams": 80.0},
				},
			},
			wantNameMatched: true,
			wantTotalErrPct: 0,
		},
		{
			name: "items mismatch weight",
			groundTruth: map[string]any{
				"label_type": "items",
				"items":      map[string]any{"米饭": 100},
			},
			prediction: map[string]any{
				"items": []any{
					map[string]any{"name": "米饭", "estimatedWeightGrams": 120.0},
				},
			},
			wantNameMatched: true,
			wantTotalErrPct: 20,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := comparePredictionWithGroundTruth(tc.prediction, tc.groundTruth)
			assert.Equal(t, tc.wantNameMatched, m.NameMatched)
			assert.InDelta(t, tc.wantTotalErrPct, m.TotalWeightErrorPct, 0.1)
			assert.NotEmpty(t, m.ItemComparisons)
		})
	}
}

func TestBenchmarkService_ParseTaskResult(t *testing.T) {
	result := map[string]any{
		"items": []any{
			map[string]any{"name": "米饭", "estimatedWeightGrams": 100},
		},
		"description":                  "一碗米饭",
		"analysis_duration_ms":         1234,
		"resolved_count":               1,
		"unresolved_count":             0,
		"total_weight_grams":           100,
		"edible_portion_applied_count": 1,
		"suggest_ratio_applied_count":  0,
		"hybrid_review":                map[string]any{"passed": true},
		"edible_portion_status":        "applied",
		"suggest_ratio_status":         "skipped",
		"analysis_engine":              "db_first",
	}

	prediction, stageOutputs := parseTaskResult(result)
	assert.NotNil(t, prediction["items"])
	assert.Equal(t, "一碗米饭", prediction["description"])
	assert.InDelta(t, 100.0, prediction["total_weight_grams"], 0.001)
	assert.Equal(t, "db_first", stageOutputs["nutrition"].(map[string]any)["engine"])
	assert.Equal(t, "applied", stageOutputs["edible"].(map[string]any)["status"])
	assert.Equal(t, 1, stageOutputs["final"].(map[string]any)["item_count"])

	// nil input should not panic
	prediction, stageOutputs = parseTaskResult(nil)
	assert.Empty(t, prediction)
	assert.Empty(t, stageOutputs)
}

func TestBenchmarkService_RunMetricsSerialization(t *testing.T) {
	m := &domain.RunMetrics{
		SampleCount:       2,
		CompletedCount:    1,
		FailedCount:       1,
		NameMatchRate:     0.5,
		TotalWeightMAPE:   10,
		TotalWeightRMSE:   5,
		ItemWeightMAPE:    8,
		ItemWeightRMSE:    4,
		AverageDurationMs: 100,
	}
	data, err := json.Marshal(m.ToMap())
	require.NoError(t, err)
	assert.NotEmpty(t, data)
}
