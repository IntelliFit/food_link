package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/storage"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupServiceTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?_fk=1"), &gorm.Config{})
	require.NoError(t, err)
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

func TestFoodRecordService_Save_WithDate(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	dateStr := "2024-06-15"
	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		Date:          &dateStr,
		TotalCalories: 500,
	})
	require.NoError(t, err)
	assert.NotNil(t, record.RecordTime)
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	assert.Equal(t, 15, record.RecordTime.In(chinaTZ).Day())
}

func TestFoodRecordService_Save_WithSourceTaskID(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)
	ctx := context.Background()

	payload := map[string]any{"recorded_on": "2024-06-20"}
	task := &analyzedomain.AnalysisTask{UserID: "u1", TaskType: "analyze", Payload: payload}
	require.NoError(t, db.Create(task).Error)

	record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{
		MealType:      "lunch",
		SourceTaskID:  &task.ID,
		TotalCalories: 500,
	})
	require.NoError(t, err)
	assert.NotNil(t, record.RecordTime)
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
	tm := svc.buildRecordTime(&invalidDate, nil)
	assert.NotNil(t, tm)
	// falls back to today
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	assert.Equal(t, time.Now().In(chinaTZ).Day(), tm.In(chinaTZ).Day())
}

func TestFoodRecordService_buildRecordTime_SourceTaskNoPayload(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze"}
	require.NoError(t, db.Create(task).Error)

	tm := svc.buildRecordTime(nil, &task.ID)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_hydrateRecord(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	// nil record
	assert.Nil(t, svc.hydrateRecord(nil))

	// already has image paths
	record := &domain.FoodRecord{ImagePaths: []string{"img.jpg"}}
	result := svc.hydrateRecord(record)
	assert.Equal(t, []string{"img.jpg"}, result.ImagePaths)

	// with source task id
	imagePaths := []string{"task_img.jpg"}
	task := &analyzedomain.AnalysisTask{ID: uuid.New().String(), UserID: "u1", TaskType: "analyze", ImagePaths: imagePaths}
	require.NoError(t, db.Create(task).Error)

	record2 := &domain.FoodRecord{SourceTaskID: &task.ID}
	result2 := svc.hydrateRecord(record2)
	assert.Equal(t, []string{"task_img.jpg"}, result2.ImagePaths)

	// with image path fallback
	imgPath := "fallback.jpg"
	record3 := &domain.FoodRecord{ImagePath: &imgPath}
	result3 := svc.hydrateRecord(record3)
	assert.Equal(t, []string{"fallback.jpg"}, result3.ImagePaths)
}

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

	tm := svc.buildRecordTime(nil, &taskID)
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
	tm := svc.buildRecordTime(nil, &taskID)
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

	tm := svc.buildRecordTime(nil, &task.ID)
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

	tm := svc.buildRecordTime(nil, &task.ID)
	assert.NotNil(t, tm)
}

func TestFoodRecordService_buildRecordTime_TaskValidRecordedOn(t *testing.T) {
	db := setupServiceTestDB(t)
	r := foodrepo.NewFoodRecordRepo(db)
	tr := foodrepo.NewAnalysisTaskRepo(db)
	ur := repo.NewUserRepo(db)
	svc := NewFoodRecordService(r, tr, ur)

	// Mock the task repo to return a task with valid recorded_on
	patches := ApplyMethod(reflect.TypeOf(tr), "GetByID", func(_ *foodrepo.AnalysisTaskRepo, _ context.Context, _ string) (*analyzedomain.AnalysisTask, error) {
		return &analyzedomain.AnalysisTask{
			ID:      "task-1",
			UserID:  "u1",
			Payload: map[string]any{"recorded_on": "2024-06-20"},
		}, nil
	})
	defer patches.Reset()

	taskID := "task-1"
	tm := svc.buildRecordTime(nil, &taskID)
	assert.NotNil(t, tm)
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	assert.Equal(t, 20, tm.In(chinaTZ).Day())
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
	tm := svc.buildRecordTime(&emptyDate, nil)
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
