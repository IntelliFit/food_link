package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"food_link/backend/pkg/testdb"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type mockWaterLogRecorder struct {
	logs []healthdomain.BodyWaterLog
	err  error
}

func (m *mockWaterLogRecorder) CreateWaterLog(ctx context.Context, log *healthdomain.BodyWaterLog) error {
	if m.err != nil {
		return m.err
	}
	m.logs = append(m.logs, *log)
	return nil
}

func (m *mockWaterLogRecorder) ReduceWaterLogsByDateSource(ctx context.Context, userID string, recordedOn string, sourceType string, amountMl int) (int, error) {
	if m.err != nil {
		return 0, m.err
	}
	if amountMl <= 0 {
		return 0, nil
	}
	targetDate, err := time.ParseInLocation("2006-01-02", recordedOn, chinaTZ)
	if err != nil {
		return 0, err
	}
	reduced := 0
	nextLogs := make([]healthdomain.BodyWaterLog, 0, len(m.logs))
	for _, log := range m.logs {
		if reduced >= amountMl || log.UserID != userID || log.SourceType != sourceType || log.RecordedOn == nil || log.RecordedOn.In(chinaTZ).Format("2006-01-02") != targetDate.Format("2006-01-02") {
			nextLogs = append(nextLogs, log)
			continue
		}
		remaining := amountMl - reduced
		if log.AmountMl <= remaining {
			reduced += log.AmountMl
			continue
		}
		log.AmountMl -= remaining
		reduced += remaining
		nextLogs = append(nextLogs, log)
	}
	m.logs = nextLogs
	return reduced, nil
}

func (m *mockWaterLogRecorder) SumWaterByDateSource(ctx context.Context, userID string, recordedOn string, sourceType string) (int64, error) {
	if m.err != nil {
		return 0, m.err
	}
	total := int64(0)
	for _, log := range m.logs {
		if log.UserID != userID || log.SourceType != sourceType || log.RecordedOn == nil || log.RecordedOn.In(chinaTZ).Format("2006-01-02") != recordedOn {
			continue
		}
		total += int64(log.AmountMl)
	}
	return total, nil
}

func setupServiceTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&domain.FoodRecord{},
		&domain.CriticalSample{},
		&domain.FoodNutrition{},
		&domain.FoodNutritionAlias{},
		&domain.FoodUnresolvedLog{},
		&repo.User{},
		&analyzedomain.AnalysisTask{},
	))
	return db
}

func TestNewFoodRecordService(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	assert.NotNil(t, svc)
}

func TestFoodRecordService_Save(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		TotalCalories: 500,
		TotalProtein:  20,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, record.ID)
	assert.Equal(t, "lunch", record.MealType)

	// invalid meal type
	_, err = svc.Save(ctx, "u1", SaveFoodRecordInput{MealType: "invalid"})
	assert.Error(t, err)
}

func TestFoodRecordService_SavePersistsValidEatingMood(t *testing.T) {
	db := setupServiceTestDB(t)
	svc := NewFoodRecordService(foodrepo.NewFoodRecordRepo(db), foodrepo.NewAnalysisTaskRepo(db), repo.NewUserRepo(db))
	mood := "calm"

	record, err := svc.Save(context.Background(), "u1", SaveFoodRecordInput{MealType: "lunch", EatingMood: &mood})
	require.NoError(t, err)
	require.NotNil(t, record.EatingMood)
	assert.Equal(t, "calm", *record.EatingMood)

	invalidMood := "sad"
	_, err = svc.Save(context.Background(), "u1", SaveFoodRecordInput{MealType: "lunch", EatingMood: &invalidMood})
	require.Error(t, err)
}

func TestZeroNutritionGateRejectsSuspiciousItem(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:   "如实酸奶",
		Weight: 135,
		Intake: 135,
	}})

	require.Error(t, err)
	appErr, ok := err.(*commonerrors.AppError)
	require.True(t, ok)
	assert.Equal(t, 10002, appErr.Code)
	assert.Contains(t, appErr.Message, "如实酸奶")
}

func TestZeroNutritionGateRejectsMixedVegetableDish(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:   "香菇油麦菜",
		Weight: 100,
		Intake: 100,
	}})

	require.Error(t, err)
	appErr, ok := err.(*commonerrors.AppError)
	require.True(t, ok)
	assert.Equal(t, 10002, appErr.Code)
	assert.Contains(t, appErr.Message, "香菇油麦菜")
}

func TestZeroNutritionGateAllowsKnownZeroDrink(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:    "白开水",
		Weight:  250,
		Intake:  250,
		WaterMl: 250,
	}})
	require.NoError(t, err)
}

func TestZeroNutritionGateAllowsEdibleIce(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:    "食用冰",
		Weight:  100,
		Intake:  100,
		WaterMl: 100,
	}})
	require.NoError(t, err)
}

func TestZeroNutritionGateAllowsIceCube(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:    "冰块",
		Weight:  80,
		Intake:  80,
		WaterMl: 80,
	}})
	require.NoError(t, err)
}

func TestZeroNutritionGateAllowsZeroNutritionWithWater(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:    "某含水零卡食物",
		Weight:  100,
		Intake:  100,
		WaterMl: 50,
	}})
	require.NoError(t, err)
}

func TestZeroNutritionGateRejectsZeroNutritionWithoutWater(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:    "某零卡但无水食物",
		Weight:  100,
		Intake:  100,
		WaterMl: 0,
	}})
	require.Error(t, err)
	appErr, ok := err.(*commonerrors.AppError)
	require.True(t, ok)
	assert.Equal(t, 10002, appErr.Code)
	assert.Contains(t, appErr.Message, "某零卡但无水食物")
}

func TestZeroNutritionGateAllowsNonZeroItem(t *testing.T) {
	err := validateNoSuspiciousZeroNutritionItems([]domain.FoodItem{{
		Name:   "双汇玉米热狗肠",
		Weight: 40,
		Intake: 40,
		Nutrients: domain.FoodItemNutrients{
			Calories: 81.17,
			Protein:  4.4,
			Carbs:    6,
			Fat:      4.4,
		},
	}})
	require.NoError(t, err)
}

func TestFoodRecordService_Save_WithDate(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	dateStr := time.Now().In(chinaTZ).AddDate(0, 0, -1).Format("2006-01-02")
	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		Date:          &dateStr,
		TotalCalories: 500,
	})
	require.NoError(t, err)
	assert.NotNil(t, record.RecordTime)
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	assert.Equal(t, dateStr, record.RecordTime.In(chinaTZ).Format("2006-01-02"))
}

func TestFoodRecordService_Save_AddsFoodWaterToBodyWater(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	waterRecorder := &mockWaterLogRecorder{}
	svc := NewFoodRecordService(r, tr, ur)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	dateStr := time.Now().In(chinaTZ).AddDate(0, 0, -1).Format("2006-01-02")
	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType: "lunch",
		Date:     &dateStr,
		Items: []domain.FoodItem{
			{Name: "粥", Weight: 300, Ratio: 50, Intake: 150, WaterMl: 240},
			{Name: "苹果", Weight: 100, Ratio: 100, Intake: 100, WaterMl: 85},
			{Name: "炸物", Weight: 80, Ratio: 100, Intake: 80, WaterMl: 0},
		},
		TotalCalories: 500,
	})

	require.NoError(t, err)
	require.NotNil(t, record)
	require.Len(t, waterRecorder.logs, 1)
	assert.Equal(t, "u1", waterRecorder.logs[0].UserID)
	assert.Equal(t, 205, waterRecorder.logs[0].AmountMl)
	assert.Equal(t, "ai_food_record:"+record.ID, waterRecorder.logs[0].SourceType)
	require.NotNil(t, waterRecorder.logs[0].RecordedOn)
	assert.Equal(t, dateStr, waterRecorder.logs[0].RecordedOn.In(chinaTZ).Format("2006-01-02"))
}

func TestFoodRecordService_Update_AdjustsFoodWaterDiff(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	waterRecorder := &mockWaterLogRecorder{}
	svc := NewFoodRecordService(r, tr, ur)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	recordTime := time.Now().In(chinaTZ)
	record := &domain.FoodRecord{
		UserID:     "u1",
		MealType:   "lunch",
		RecordTime: &recordTime,
		Items: []domain.FoodItem{
			{Name: "粥", Weight: 300, Ratio: 50, Intake: 150, WaterMl: 240},
			{Name: "苹果", Weight: 100, Ratio: 100, Intake: 100, WaterMl: 85},
		},
	}
	require.NoError(t, r.Create(ctx, record))
	recordedOn := foodRecordWaterDate(record.RecordTime)
	require.NoError(t, svc.recordFoodWaterAmount(ctx, "u1", record.ID, recordedOn, 205))

	_, err := svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{
		Items: []domain.FoodItem{{Name: "苹果", Weight: 100, Ratio: 100, Intake: 100, WaterMl: 85}},
	})

	require.NoError(t, err)
	require.Len(t, waterRecorder.logs, 1)
	assert.Equal(t, 85, waterRecorder.logs[0].AmountMl)
}

func TestFoodRecordService_Delete_ReducesFoodWater(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	waterRecorder := &mockWaterLogRecorder{}
	svc := NewFoodRecordService(r, tr, ur)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	recordTime := time.Now().In(chinaTZ)
	record := &domain.FoodRecord{
		UserID:     "u1",
		MealType:   "lunch",
		RecordTime: &recordTime,
		Items:      []domain.FoodItem{{Name: "粥", Weight: 300, Ratio: 50, Intake: 150, WaterMl: 240}},
	}
	require.NoError(t, r.Create(ctx, record))
	recordedOn := foodRecordWaterDate(record.RecordTime)
	require.NoError(t, svc.recordFoodWaterAmount(ctx, "u1", record.ID, recordedOn, 50))

	err := svc.Delete(ctx, "u1", record.ID)

	require.NoError(t, err)
	assert.Empty(t, waterRecorder.logs)
}

func TestFoodRecordService_Delete_DoesNotReduceUnrelatedLegacyAIWater(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	recordTime := time.Now().In(chinaTZ)
	waterRecorder := &mockWaterLogRecorder{logs: []healthdomain.BodyWaterLog{{
		UserID:     "u1",
		AmountMl:   900,
		RecordedOn: &recordTime,
		SourceType: "ai",
	}}}
	svc := NewFoodRecordService(r, tr, ur)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	record := &domain.FoodRecord{
		UserID:     "u1",
		MealType:   "afternoon_snack",
		RecordTime: &recordTime,
		Items:      []domain.FoodItem{{Name: "冰淇淋", Weight: 130, Ratio: 100, Intake: 130, WaterMl: 72}},
	}
	require.NoError(t, r.Create(ctx, record))

	err := svc.Delete(ctx, "u1", record.ID)

	require.NoError(t, err)
	require.Len(t, waterRecorder.logs, 1)
	assert.Equal(t, 900, waterRecorder.logs[0].AmountMl)
	assert.Equal(t, "ai", waterRecorder.logs[0].SourceType)
}

func TestTotalFoodWaterIntakeMl(t *testing.T) {
	assert.Equal(t, 0, totalFoodWaterIntakeMl(nil))
	assert.Equal(t, 150, totalFoodWaterIntakeMl([]domain.FoodItem{{WaterMl: 300, Ratio: 50, Weight: 300, Intake: 150}}))
	assert.Equal(t, 80, totalFoodWaterIntakeMl([]domain.FoodItem{{WaterMl: 200, Weight: 500, Intake: 200}}))
	assert.Equal(t, 0, totalFoodWaterIntakeMl([]domain.FoodItem{{WaterMl: 200, Ratio: 0, Weight: 500, Intake: 0}}))
	assert.Equal(t, 126, totalFoodWaterIntakeMl([]domain.FoodItem{{WaterMl: 125.5}}))
}

func TestFoodRecordService_Save_WithSourceTaskID(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	recordedOn := time.Now().In(chinaTZ).Format("2006-01-02")
	payload := map[string]any{"recorded_on": recordedOn}
	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze", Payload: payload}
	require.NoError(t, db.Create(task).Error)

	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		SourceTaskID:  &task.ID,
		TotalCalories: 500,
	})
	require.NoError(t, err)
	assert.NotNil(t, record.RecordTime)
}

func TestFoodRecordService_Save_SourceTaskIDIsIdempotent(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "food"}
	require.NoError(t, db.Create(task).Error)

	first, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "dinner",
		SourceTaskID:  &task.ID,
		TotalCalories: 18,
	})
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.False(t, first.AlreadySaved)

	second, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		SourceTaskID:  &task.ID,
		TotalCalories: 999,
	})
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, first.ID, second.ID)
	assert.True(t, second.AlreadySaved)

	var count int64
	require.NoError(t, db.Model(&domain.FoodRecord{}).Where("user_id = ? AND source_task_id = ?", "u1", task.ID).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestFoodRecordService_Save_SourceTaskIDBackfillsMissingWater(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	waterRecorder := &mockWaterLogRecorder{}
	svc := NewFoodRecordService(r, tr, ur)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "food"}
	require.NoError(t, db.Create(task).Error)

	first, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:     "dinner",
		SourceTaskID: &task.ID,
		Items: []domain.FoodItem{
			{Name: "咖啡", Weight: 900, Ratio: 100, Intake: 900, WaterMl: 900},
		},
		TotalCalories: 18,
	})
	require.NoError(t, err)
	require.Len(t, waterRecorder.logs, 1)
	waterRecorder.logs = nil

	second, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:     "dinner",
		SourceTaskID: &task.ID,
		Items: []domain.FoodItem{
			{Name: "咖啡", Weight: 900, Ratio: 100, Intake: 900, WaterMl: 900},
		},
		TotalCalories: 18,
	})
	require.NoError(t, err)
	assert.True(t, second.AlreadySaved)
	assert.Equal(t, first.ID, second.ID)
	require.Len(t, waterRecorder.logs, 1)
	assert.Equal(t, 900, waterRecorder.logs[0].AmountMl)
	assert.Equal(t, "ai_food_record:"+first.ID, waterRecorder.logs[0].SourceType)
}

func TestFoodRecordService_List(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	require.NoError(t, r.Create(ctx, &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}))

	records, err := svc.List(ctx, "u1", "")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "lunch", records[0].MealType)
}

func TestFoodRecordService_List_WithTaskImages(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	imagePaths := []string{"img1.jpg", "img2.jpg"}
	task := &analyzedomain.AnalysisTask{UserID: "u1", TaskType: "analyze", ImagePaths: imagePaths}
	require.NoError(t, db.Create(task).Error)

	now := time.Now().UTC()
	require.NoError(t, r.Create(ctx, &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, SourceTaskID: &task.ID}))

	records, err := svc.List(ctx, "u1", "")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Len(t, records[0].ImagePaths, 2)
}

func TestFoodRecordService_List_WithImagePathFallback(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	imgPath := "img1.jpg"
	now := time.Now().UTC()
	taskID := "task-fallback-1"
	rec := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, ImagePath: &imgPath, SourceTaskID: &taskID}
	require.NoError(t, r.Create(ctx, rec))

	records, err := svc.List(ctx, "u1", "")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Len(t, records[0].ImagePaths, 1)
}

func TestFoodRecordService_Get(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}
	require.NoError(t, r.Create(ctx, record))

	found, err := svc.Get(ctx, "u1", record.ID)
	require.NoError(t, err)
	assert.NotNil(t, found)
	assert.Equal(t, "lunch", found.MealType)

	// not found
	_, err = svc.Get(ctx, "u1", "nonexistent")
	assert.Equal(t, commonerrors.ErrNotFound, err)

	// forbidden
	_, err = svc.Get(ctx, "u2", record.ID)
	assert.Equal(t, commonerrors.ErrForbidden, err)
}

func TestFoodRecordService_Update(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}
	require.NoError(t, r.Create(ctx, record))

	mealType := "dinner"
	updated, err := svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{MealType: &mealType})
	require.NoError(t, err)
	assert.Equal(t, "dinner", updated.MealType)

	// empty update
	_, err = svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{})
	assert.Error(t, err)

	// invalid meal type
	invalidMeal := "invalid"
	_, err = svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{MealType: &invalidMeal})
	assert.Error(t, err)

	// not found
	_, err = svc.Update(ctx, "u1", "nonexistent", UpdateFoodRecordInput{MealType: &mealType})
	assert.Equal(t, commonerrors.ErrNotFound, err)
}

func TestFoodRecordService_Delete(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now}
	require.NoError(t, r.Create(ctx, record))

	err := svc.Delete(ctx, "u1", record.ID)
	require.NoError(t, err)

	// not found
	err = svc.Delete(ctx, "u1", "nonexistent")
	assert.Equal(t, commonerrors.ErrNotFound, err)
}

func TestFoodRecordService_Share(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}
	require.NoError(t, r.Create(ctx, record))

	public := true
	require.NoError(t, ur.Create(ctx, &repo.User{OpenID: "o1", PublicRecords: &public}))
	user, _ := ur.FindByOpenID(ctx, "o1")
	require.NoError(t, db.Model(&domain.FoodRecord{}).Where("id = ?", record.ID).Update("user_id", user.ID).Error)

	shared, err := svc.Share(ctx, record.ID)
	require.NoError(t, err)
	assert.NotNil(t, shared)

	// not found
	_, err = svc.Share(ctx, "nonexistent")
	assert.Equal(t, commonerrors.ErrNotFound, err)
}

func TestFoodRecordService_ShareInvalidID(t *testing.T) {
	svc := NewFoodRecordService(nil, nil, nil)

	_, err := svc.Share(context.Background(), "not-a-real-record")

	require.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestFoodRecordService_Share_PrivateRecords(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	public := false
	require.NoError(t, ur.Create(ctx, &repo.User{OpenID: "o1", PublicRecords: &public}))
	user, err := ur.FindByOpenID(ctx, "o1")
	require.NoError(t, err)
	require.NotNil(t, user)

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: user.ID, MealType: "lunch", RecordTime: &now}
	require.NoError(t, r.Create(ctx, record))

	_, err = svc.Share(ctx, record.ID)
	assert.Equal(t, commonerrors.ErrForbidden, err)
}

func TestFoodRecordService_SaveCriticalSamples(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	// empty items
	err := svc.SaveCriticalSamples(ctx, "u1", nil)
	assert.Error(t, err)

	items := []domain.CriticalSample{{FoodName: "apple", AIWeight: 100, UserWeight: 120}}
	err = svc.SaveCriticalSamples(ctx, "u1", items)
	require.NoError(t, err)
}

func TestFoodRecordService_buildRecordTime_InvalidDate(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	invalidDate := "not-a-date"
	tm, err := svc.buildRecordTime(context.Background(), &invalidDate, nil)
	assert.Error(t, err)
	assert.Nil(t, tm)
}

func TestFoodRecordService_buildRecordTime_SourceTaskNoPayload(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze"}
	require.NoError(t, db.Create(task).Error)

	tm, err := svc.buildRecordTime(context.Background(), nil, &task.ID)
	require.NoError(t, err)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_hydrateRecord(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewFoodRecordService(r, tr, ur, storageClient)

	// nil record
	assert.Nil(t, svc.hydrateRecord(nil))

	// already has image paths
	record := &domain.FoodRecord{ImagePaths: []string{"img.jpg"}}
	result := svc.hydrateRecord(record)
	assert.Equal(t, []string{"https://cdn.example.com/food/img.jpg"}, result.ImagePaths)

	// with source task id
	imagePaths := []string{"https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/task_img.jpg"}
	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze", ImagePaths: imagePaths}
	require.NoError(t, db.Create(task).Error)

	record2 := &domain.FoodRecord{SourceTaskID: &task.ID}
	result2 := svc.hydrateRecord(record2)
	assert.Equal(t, []string{"https://cdn.example.com/food/task_img.jpg"}, result2.ImagePaths)
	require.NotNil(t, result2.ImagePath)
	assert.Equal(t, "https://cdn.example.com/food/task_img.jpg", *result2.ImagePath)

	// with image path fallback
	imgPath := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/fallback.jpg"
	record3 := &domain.FoodRecord{ImagePath: &imgPath}
	result3 := svc.hydrateRecord(record3)
	assert.Equal(t, []string{"https://cdn.example.com/food/fallback.jpg"}, result3.ImagePaths)
}

func TestFoodRecordService_List_HydratesManualSourceImages(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn.example.com/food"})
	svc := NewFoodRecordService(r, tr, ur, storageClient)

	manualSource := "nutrition_library"
	manualSourceID := "nut-rice-1"
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:            manualSourceID,
		CanonicalName: "白米饭",
		ImagePath:     strPtr("nutrition/rice.jpg"),
		KcalPer100g:   151,
		IsActive:      true,
	}).Error)

	now := time.Now()
	record := &domain.FoodRecord{
		ID:            uuid.New().String(),
		UserID:        "u1",
		MealType:      "lunch",
		TotalCalories: 151,
		RecordTime:    &now,
		Items: []domain.FoodItem{{
			Name:              "白米饭",
			Weight:            100,
			Intake:            100,
			ManualSource:      &manualSource,
			ManualSourceID:    &manualSourceID,
			ManualSourceTitle: strPtr("白米饭"),
		}},
	}
	require.NoError(t, db.Create(record).Error)

	records, err := svc.List(context.Background(), "u1", now.In(chinaTZ).Format("2006-01-02"))
	require.NoError(t, err)
	require.Len(t, records, 1)
	require.NotNil(t, records[0].ImagePath)
	assert.Equal(t, "https://cdn.example.com/food/nutrition/rice.jpg", *records[0].ImagePath)
	assert.Equal(t, []string{"https://cdn.example.com/food/nutrition/rice.jpg"}, records[0].ImagePaths)
}

func strPtr(v string) *string { return &v }

func TestNewUploadService(t *testing.T) {
	client := &storage.Client{}
	svc := NewUploadService(client)
	assert.NotNil(t, svc)
}

func TestUploadService_UploadFile_NoExt(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBytes", func(_ *storage.Client, _, _ string, _ []byte, _ string) (string, error) {
		return "https://example.com/test.jpg", nil
	})
	defer patches.Reset()

	client := &storage.Client{}
	svc := NewUploadService(client)
	url, err := svc.UploadFile([]byte("test"), "", "")
	require.NoError(t, err)
	assert.NotEmpty(t, url)
}

func TestUploadService_UploadFile_NoDotExt(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBytes", func(_ *storage.Client, _, _ string, _ []byte, _ string) (string, error) {
		return "https://example.com/test.png", nil
	})
	defer patches.Reset()

	client := &storage.Client{}
	svc := NewUploadService(client)
	url, err := svc.UploadFile([]byte("test"), "png", "")
	require.NoError(t, err)
	assert.NotEmpty(t, url)
}

func TestFoodRecordService_Save_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "Create", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _ *domain.FoodRecord) error {
		return errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.Save(ctx, "u1", SaveFoodRecordInput{MealType: "lunch", TotalCalories: 500})
	assert.Error(t, err)
}

func TestFoodRecordService_List_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "ListByUser", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _, _ string, _ int) ([]domain.FoodRecord, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.List(ctx, "u1", "")
	assert.Error(t, err)
}

func TestFoodRecordService_Get_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "GetByID", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _ string) (*domain.FoodRecord, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.Get(ctx, "u1", "id1")
	assert.Error(t, err)
}

func TestFoodRecordService_Update_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "Update", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _, _ string, _ map[string]any) (*domain.FoodRecord, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	mealType := "dinner"
	_, err := svc.Update(ctx, "u1", "id1", UpdateFoodRecordInput{MealType: &mealType})
	assert.Error(t, err)
}

func TestFoodRecordService_Delete_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patchGet := ApplyMethod(reflect.TypeOf(r), "GetByID", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _ string) (*domain.FoodRecord, error) {
		return &domain.FoodRecord{ID: "id1", UserID: "u1", MealType: "lunch"}, nil
	})
	defer patchGet.Reset()

	patches := ApplyMethod(reflect.TypeOf(r), "Delete", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _, _ string) error {
		return errors.New("db error")
	})
	defer patches.Reset()

	err := svc.Delete(ctx, "u1", "id1")
	assert.Error(t, err)
}

func TestFoodRecordService_Share_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "GetByID", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _ string) (*domain.FoodRecord, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.Share(ctx, "id1")
	assert.Error(t, err)
}

func TestFoodRecordService_Share_UserRepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now}
	require.NoError(t, r.Create(ctx, record))

	patches := ApplyMethod(reflect.TypeOf(ur), "FindByID", func(_ *repo.UserRepo, _ context.Context, _ string) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.Share(ctx, record.ID)
	assert.Error(t, err)
}

func TestFoodRecordService_SaveCriticalSamples_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "InsertCriticalSamples", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _ string, _ []domain.CriticalSample) error {
		return errors.New("db error")
	})
	defer patches.Reset()

	items := []domain.CriticalSample{{FoodName: "apple", AIWeight: 100, UserWeight: 120}}
	err := svc.SaveCriticalSamples(ctx, "u1", items)
	assert.Error(t, err)
}

func TestFoodNutritionService_Search_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodNutritionRepo(db)
	svc := NewFoodNutritionService(r)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "Search", func(_ *foodrepo.FoodNutritionRepo, _ context.Context, _ string, _ int) ([]domain.FoodNutrition, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.Search(ctx, "apple", 10)
	assert.Error(t, err)
}

func TestFoodNutritionService_GetUnresolvedTop_RepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodNutritionRepo(db)
	svc := NewFoodNutritionService(r)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(r), "GetUnresolvedTop", func(_ *foodrepo.FoodNutritionRepo, _ context.Context, _ int) ([]domain.FoodUnresolvedLog, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.GetUnresolvedTop(ctx, 10)
	assert.Error(t, err)
}

func TestUploadService_UploadBase64_StorageError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBase64", func(_ *storage.Client, _, _, _, _ string) (string, error) {
		return "", errors.New("storage error")
	})
	defer patches.Reset()

	client := &storage.Client{}
	svc := NewUploadService(client)
	_, err := svc.UploadBase64("data:image/jpeg;base64,test")
	assert.Error(t, err)
}

func TestUploadService_UploadFile_StorageError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBytes", func(_ *storage.Client, _, _ string, _ []byte, _ string) (string, error) {
		return "", errors.New("storage error")
	})
	defer patches.Reset()

	client := &storage.Client{}
	svc := NewUploadService(client)
	_, err := svc.UploadFile([]byte("test"), ".jpg", "image/jpeg")
	assert.Error(t, err)
}

func TestFoodRecordService_buildRecordTime_TaskRepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	taskID := uuid.New().String()
	patches := ApplyMethod(reflect.TypeOf(tr), "GetByID", func(_ *foodrepo.AnalysisTaskRepo, _ context.Context, _ string) (*analyzedomain.AnalysisTask, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	tm, err := svc.buildRecordTime(context.Background(), nil, &taskID)
	require.NoError(t, err)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_Update_Fields(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}
	require.NoError(t, r.Create(ctx, record))

	calories := 600.0
	protein := 25.0
	carbs := 70.0
	fat := 20.0
	weight := 300

	updated, err := svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{
		TotalCalories:    &calories,
		TotalProtein:     &protein,
		TotalCarbs:       &carbs,
		TotalFat:         &fat,
		TotalWeightGrams: &weight,
	})
	require.NoError(t, err)
	assert.Equal(t, 600.0, updated.TotalCalories)
	assert.Equal(t, 25.0, updated.TotalProtein)
	assert.Equal(t, 70.0, updated.TotalCarbs)
	assert.Equal(t, 20.0, updated.TotalFat)
	assert.Equal(t, 300, updated.TotalWeightGrams)
}

func TestFoodRecordService_buildRecordTime_NilTask(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	// task ID that doesn't exist - returns nil task
	taskID := "nonexistent-task"
	tm, err := svc.buildRecordTime(context.Background(), nil, &taskID)
	require.NoError(t, err)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_buildRecordTime_TaskNoPayload(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze"}
	require.NoError(t, db.Create(task).Error)

	tm, err := svc.buildRecordTime(context.Background(), nil, &task.ID)
	require.NoError(t, err)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_buildRecordTime_TaskInvalidDate(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	payload := map[string]any{"recorded_on": "not-a-date"}
	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze", Payload: payload}
	require.NoError(t, db.Create(task).Error)

	tm, err := svc.buildRecordTime(context.Background(), nil, &task.ID)
	assert.Error(t, err)
	assert.Nil(t, tm)
}

func TestFoodRecordService_buildRecordTime_TaskValidRecordedOn(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)

	// Mock the task repo to return a task with valid recorded_on
	patches := ApplyMethod(reflect.TypeOf(tr), "GetByID", func(_ *foodrepo.AnalysisTaskRepo, _ context.Context, _ string) (*analyzedomain.AnalysisTask, error) {
		return &analyzedomain.AnalysisTask{
			ID:      "task-1",
			UserID:  "u1",
			Payload: map[string]any{"recorded_on": time.Now().In(chinaTZ).Format("2006-01-02")},
		}, nil
	})
	defer patches.Reset()

	taskID := "task-1"
	tm, err := svc.buildRecordTime(context.Background(), nil, &taskID)
	require.NoError(t, err)
	assert.NotNil(t, tm)
	assert.Equal(t, time.Now().In(chinaTZ).Day(), tm.In(chinaTZ).Day())
}

func TestNormalizeMealType_SnackEvening(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	// hour >= 17 should be evening_snack
	evening := time.Date(2024, 1, 1, 20, 0, 0, 0, chinaTZ)
	assert.Equal(t, "evening_snack", normalizeMealType("snack", &evening))
}

func TestNormalizeMealType_SnackNilTime(t *testing.T) {
	// when recordTime is nil, it uses current time - just verify it returns one of the valid snack types
	result := normalizeMealType("snack", nil)
	assert.True(t, result == "morning_snack" || result == "afternoon_snack" || result == "evening_snack")
}

func TestNormalizeMealType_Unknown(t *testing.T) {
	// unknown meal type defaults to afternoon_snack
	assert.Equal(t, "afternoon_snack", normalizeMealType("unknown", nil))
}

func TestFoodRecordService_buildRecordTime_EmptyDate(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	emptyDate := ""
	tm, err := svc.buildRecordTime(context.Background(), &emptyDate, nil)
	require.NoError(t, err)
	assert.NotNil(t, tm)
}

func TestNormalizeMealType_SnackNilTimeMorning(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	morning := time.Date(2024, 1, 1, 9, 0, 0, 0, chinaTZ)
	assert.Equal(t, "morning_snack", normalizeMealType("snack", &morning))
}

func TestNormalizeMealType_SnackNilTimeAfternoon(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	afternoon := time.Date(2024, 1, 1, 14, 0, 0, 0, chinaTZ)
	assert.Equal(t, "afternoon_snack", normalizeMealType("snack", &afternoon))
}

func TestNormalizeMealType_SnackNowMorning(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	morning := time.Date(2024, 1, 1, 9, 0, 0, 0, chinaTZ)
	patches := ApplyFunc(time.Now, func() time.Time { return morning })
	defer patches.Reset()
	assert.Equal(t, "morning_snack", normalizeMealType("snack", nil))
}

func TestNormalizeMealType_SnackNowAfternoon(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	afternoon := time.Date(2024, 1, 1, 14, 0, 0, 0, chinaTZ)
	patches := ApplyFunc(time.Now, func() time.Time { return afternoon })
	defer patches.Reset()
	assert.Equal(t, "afternoon_snack", normalizeMealType("snack", nil))
}

func TestNormalizeMealType_SnackNowEvening(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	evening := time.Date(2024, 1, 1, 20, 0, 0, 0, chinaTZ)
	patches := ApplyFunc(time.Now, func() time.Time { return evening })
	defer patches.Reset()
	assert.Equal(t, "evening_snack", normalizeMealType("snack", nil))
}

func TestFoodRecordService_Update_Items(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	now := time.Now().UTC()
	record := &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &now, TotalCalories: 500}
	require.NoError(t, r.Create(ctx, record))

	items := []domain.FoodItem{{Name: "apple", Weight: 100}}
	patches := ApplyMethod(reflect.TypeOf(r), "Update", func(_ *foodrepo.FoodRecordRepo, _ context.Context, _, _ string, updates map[string]any) (*domain.FoodRecord, error) {
		// Verify items is in updates
		assert.NotNil(t, updates["items"])
		return record, nil
	})
	defer patches.Reset()

	_, err := svc.Update(ctx, "u1", record.ID, UpdateFoodRecordInput{Items: items})
	require.NoError(t, err)
}

func TestFoodRecordService_hydrateRecord_TaskRepoError(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	r2 := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, r2, ur)

	taskID := uuid.New().String()
	patches := ApplyMethod(reflect.TypeOf(r2), "GetImagePathsByID", func(_ *foodrepo.AnalysisTaskRepo, _ context.Context, _ string) ([]string, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	record := &domain.FoodRecord{SourceTaskID: &taskID}
	result := svc.hydrateRecord(record)
	assert.NotNil(t, result)
}

func TestFoodRecordService_hydrateRecord_FillsMissingNutrientsFromSourceTask(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	task := &analyzedomain.AnalysisTask{
		ID:       "task-nutrients",
		UserID:   "u1",
		TaskType: "food",
		Status:   "done",
		Result: map[string]any{
			"items": []any{
				map[string]any{
					"name":    "李子",
					"waterMl": 120.0,
					"nutrients": map[string]any{
						"calories":       100.2,
						"protein":        1.5,
						"carbs":          25.0,
						"fat":            0.5,
						"fiber":          2.6,
						"sugar":          18.0,
						"calciumMg":      12.0,
						"ironMg":         0.4,
						"vitaminCMg":     8.0,
						"vitaminARaeMcg": 3.0,
					},
				},
			},
		},
	}
	require.NoError(t, db.Create(task).Error)

	record := &domain.FoodRecord{
		UserID:       "u1",
		MealType:     "breakfast",
		SourceTaskID: &task.ID,
		Items: []domain.FoodItem{
			{
				Name:      "李子",
				Weight:    180,
				Ratio:     100,
				Intake:    180,
				Nutrients: domain.FoodItemNutrients{},
			},
		},
		TotalCalories: 100.2,
		TotalProtein:  1.5,
		TotalCarbs:    25,
		TotalFat:      0.5,
	}
	require.NoError(t, r.Create(ctx, record))

	fetched, err := svc.Get(ctx, "u1", record.ID)
	require.NoError(t, err)
	require.Len(t, fetched.Items, 1)
	assert.Equal(t, 100.2, fetched.Items[0].Nutrients.Calories)
	assert.Equal(t, 1.5, fetched.Items[0].Nutrients.Protein)
	assert.Equal(t, 25.0, fetched.Items[0].Nutrients.Carbs)
	assert.Equal(t, 0.5, fetched.Items[0].Nutrients.Fat)
	assert.Equal(t, 2.6, fetched.Items[0].Nutrients.Fiber)
	assert.Equal(t, 12.0, fetched.Items[0].Nutrients.CalciumMg)
	assert.Equal(t, 0.4, fetched.Items[0].Nutrients.IronMg)
	assert.Equal(t, 8.0, fetched.Items[0].Nutrients.VitaminCMg)
	assert.Equal(t, 120.0, fetched.Items[0].WaterMl)
}

func TestInferDefaultMealTypeFromLocalTime(t *testing.T) {
	cases := []struct {
		hour, min int
		expected  string
	}{
		{4, 30, "evening_snack"},
		{5, 0, "breakfast"},
		{10, 29, "breakfast"},
		{10, 30, "morning_snack"},
		{11, 29, "morning_snack"},
		{11, 30, "lunch"},
		{14, 29, "lunch"},
		{14, 30, "afternoon_snack"},
		{16, 59, "afternoon_snack"},
		{17, 0, "dinner"},
		{20, 59, "dinner"},
		{21, 0, "evening_snack"},
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("%02d:%02d", c.hour, c.min), func(t *testing.T) {
			ref := time.Date(2026, 6, 22, c.hour, c.min, 0, 0, chinaTZ)
			assert.Equal(t, c.expected, inferDefaultMealTypeFromLocalTime(ref))
		})
	}
}

func TestShiftMealTypeByExistingRecord(t *testing.T) {
	ref := time.Date(2026, 6, 22, 12, 10, 0, 0, chinaTZ)
	lastRecord := time.Date(2026, 6, 22, 7, 0, 0, 0, chinaTZ)

	// 早餐已存在且间隔 > 1h -> 午餐
	records := []domain.FoodRecord{
		{MealType: "breakfast", RecordTime: &lastRecord},
	}
	assert.Equal(t, "lunch", shiftMealTypeByExistingRecords("breakfast", ref, records))

	// 间隔 <= 1h -> 保持早餐
	withinHour := time.Date(2026, 6, 22, 11, 30, 0, 0, chinaTZ)
	records = []domain.FoodRecord{
		{MealType: "breakfast", RecordTime: &withinHour},
	}
	assert.Equal(t, "breakfast", shiftMealTypeByExistingRecords("breakfast", ref, records))

	// 基础餐次非正餐 -> 不推演
	records = []domain.FoodRecord{
		{MealType: "morning_snack", RecordTime: &lastRecord},
	}
	assert.Equal(t, "morning_snack", shiftMealTypeByExistingRecords("morning_snack", ref, records))

	// 三餐均已存在 -> 推到晚加餐
	lunchTime := time.Date(2026, 6, 22, 8, 0, 0, 0, chinaTZ)
	dinnerTime := time.Date(2026, 6, 22, 9, 0, 0, 0, chinaTZ)
	records = []domain.FoodRecord{
		{MealType: "breakfast", RecordTime: &lastRecord},
		{MealType: "lunch", RecordTime: &lunchTime},
		{MealType: "dinner", RecordTime: &dinnerTime},
	}
	assert.Equal(t, "evening_snack", shiftMealTypeByExistingRecords("breakfast", ref, records))

	// 早餐和午餐已存在 -> 晚餐
	records = []domain.FoodRecord{
		{MealType: "breakfast", RecordTime: &lastRecord},
		{MealType: "lunch", RecordTime: &lunchTime},
	}
	assert.Equal(t, "dinner", shiftMealTypeByExistingRecords("breakfast", ref, records))

	// 无记录 -> 保持
	assert.Equal(t, "breakfast", shiftMealTypeByExistingRecords("breakfast", ref, nil))
}
