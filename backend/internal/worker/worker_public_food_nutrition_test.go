package worker

import (
	"context"
	"errors"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	publicfooddomain "food_link/backend/internal/publicfood/domain"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func uploadNutritionResult() map[string]any {
	return map[string]any{
		"description": "一份鸡胸肉配米饭",
		"insight":     "蛋白质充足",
		"items": []any{
			map[string]any{"name": "鸡胸肉", "nutrients": map[string]any{"calories": 198.0, "protein": 37.0, "carbs": 0.0, "fat": 4.0}},
			map[string]any{"name": "米饭", "nutrients": map[string]any{"calories": 260.0, "protein": 5.0, "carbs": 56.0, "fat": 0.6}},
		},
	}
}

type uploadNutritionFixture struct {
	db         *gorm.DB
	publicFood *publicfoodrepo.PublicFoodRepo
	tasks      *analyzerepo.TaskRepo
	item       *publicfooddomain.PublicFoodItem
	task       *analyzedomain.AnalysisTask
}

func newUploadNutritionFixture(t *testing.T, item *publicfooddomain.PublicFoodItem, text string) uploadNutritionFixture {
	t.Helper()
	db := setupWorkerPublicFoodTestDB(t)
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	tasks := analyzerepo.NewTaskRepo(db)
	ctx := context.Background()
	require.NoError(t, publicFood.CreateItem(ctx, item))
	task, err := publicFood.CreateModerationTask(ctx, item.UserID, item.ID, text, item.ImagePaths)
	require.NoError(t, err)
	require.NoError(t, publicFood.LinkAnalysisTask(ctx, item.ID, task.ID))
	return uploadNutritionFixture{db: db, publicFood: publicFood, tasks: tasks, item: item, task: task}
}

func (f uploadNutritionFixture) saved(t *testing.T) publicfooddomain.PublicFoodItem {
	t.Helper()
	var saved publicfooddomain.PublicFoodItem
	require.NoError(t, f.db.Where("id = ?", f.item.ID).First(&saved).Error)
	return saved
}

func (f uploadNutritionFixture) savedTask(t *testing.T) analyzedomain.AnalysisTask {
	t.Helper()
	var saved analyzedomain.AnalysisTask
	require.NoError(t, f.db.Where("id = ?", f.task.ID).First(&saved).Error)
	return saved
}

func merchantUpload(id string) *publicfooddomain.PublicFoodItem {
	image := "https://example.com/" + id + ".jpg"
	return &publicfooddomain.PublicFoodItem{
		ID: id, UserID: "user-1", MerchantName: "街角小馆", Type: "common", Status: "pending",
		ImagePath: &image, ImagePaths: []string{image, "https://example.com/" + id + "-side.jpg"},
		NutritionStatus: "pending", AvailabilityStatus: "available", ContentVersion: 1,
	}
}

func TestPublicFoodModerationFillsNutritionAfterPublishing(t *testing.T) {
	f := newUploadNutritionFixture(t, merchantUpload("00000000-0000-4000-8000-000000000101"), "街角小馆")
	analyze := &fakeWorkerAnalyzeRunner{result: uploadNutritionResult()}
	runner := &Runner{tasks: f.tasks, publicFood: f.publicFood, analyze: analyze}

	require.NoError(t, runner.processPublicFoodModeration(context.Background(), f.task))

	saved := f.saved(t)
	require.Equal(t, "published", saved.Status)
	require.NotNil(t, saved.PublishedAt)
	require.Equal(t, 458.0, saved.TotalCalories)
	require.Equal(t, 42.0, saved.TotalProtein)
	require.Equal(t, "鸡胸肉、米饭", saved.FoodName, "a blank name is filled from the recognised foods")
	require.Equal(t, "一份鸡胸肉配米饭", saved.Description)
	require.Equal(t, "current", saved.NutritionStatus)
	require.EqualValues(t, 1, saved.NutritionVersion)
	require.Len(t, saved.Items, 2)
	require.Equal(t, f.item.ImagePaths, analyze.input.ImageURLs, "every uploaded photo is analysed together")
	require.Equal(t, "user-1", analyze.userID)

	savedTask := f.savedTask(t)
	require.Equal(t, "done", savedTask.Status)
	require.Equal(t, "filled", savedTask.Result["nutrition"])
}

func TestPublicFoodModerationKeepsUploaderNameAndNutrition(t *testing.T) {
	item := merchantUpload("00000000-0000-4000-8000-000000000102")
	item.FoodName = "大盘鸡"
	item.TotalCalories = 820
	f := newUploadNutritionFixture(t, item, "大盘鸡 街角小馆")
	runner := &Runner{tasks: f.tasks, publicFood: f.publicFood, analyze: &fakeWorkerAnalyzeRunner{result: uploadNutritionResult()}}

	require.NoError(t, runner.processPublicFoodModeration(context.Background(), f.task))

	saved := f.saved(t)
	require.Equal(t, "published", saved.Status)
	require.Equal(t, "大盘鸡", saved.FoodName)
	require.Equal(t, 820.0, saved.TotalCalories)
	require.Equal(t, "kept", f.savedTask(t).Result["nutrition"])
}

func TestPublicFoodModerationRecordsFailedNutritionButStaysPublished(t *testing.T) {
	for name, analyze := range map[string]*fakeWorkerAnalyzeRunner{
		"analysis error": {err: errors.New("model timeout")},
		"no foods":       {result: map[string]any{"items": []any{}}},
	} {
		t.Run(name, func(t *testing.T) {
			f := newUploadNutritionFixture(t, merchantUpload("00000000-0000-4000-8000-000000000103"), "街角小馆")
			runner := &Runner{tasks: f.tasks, publicFood: f.publicFood, analyze: analyze}

			require.NoError(t, runner.processPublicFoodModeration(context.Background(), f.task))

			saved := f.saved(t)
			require.Equal(t, "published", saved.Status)
			require.Equal(t, "failed", saved.NutritionStatus)
			require.Zero(t, saved.TotalCalories)
			savedTask := f.savedTask(t)
			require.Equal(t, "done", savedTask.Status)
			require.Equal(t, "failed", savedTask.Result["nutrition"])
		})
	}
}

func TestPublicFoodModerationSkipsAnalysisForRejectedText(t *testing.T) {
	f := newUploadNutritionFixture(t, merchantUpload("00000000-0000-4000-8000-000000000104"), "赌博小馆")
	analyze := &fakeWorkerAnalyzeRunner{result: uploadNutritionResult()}
	runner := &Runner{tasks: f.tasks, publicFood: f.publicFood, analyze: analyze}

	require.NoError(t, runner.processPublicFoodModeration(context.Background(), f.task))

	require.Equal(t, "rejected", f.saved(t).Status)
	require.Empty(t, analyze.input.ImageURLs, "rejected uploads must not spend an analysis")
}

func TestPublicFoodModerationWithoutPhotosOnlyChecksText(t *testing.T) {
	db := setupWorkerPublicFoodTestDB(t)
	publicFood := publicfoodrepo.NewPublicFoodRepo(db)
	item := merchantUpload("00000000-0000-4000-8000-000000000105")
	require.NoError(t, publicFood.CreateItem(context.Background(), item))
	task, err := publicFood.CreateModerationTask(context.Background(), item.UserID, item.ID, "街角小馆", nil)
	require.NoError(t, err)
	_, hasImages := task.Payload["nutrition_image_urls"]
	require.False(t, hasImages)
	analyze := &fakeWorkerAnalyzeRunner{result: uploadNutritionResult()}
	runner := &Runner{tasks: analyzerepo.NewTaskRepo(db), publicFood: publicFood, analyze: analyze}

	require.NoError(t, runner.processPublicFoodModeration(context.Background(), task))

	var saved analyzedomain.AnalysisTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&saved).Error)
	require.Equal(t, "done", saved.Status)
	require.Nil(t, saved.Result["nutrition"])
	require.Empty(t, analyze.input.ImageURLs)
}
