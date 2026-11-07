package service

import (
	"context"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func savedUploadAndTask(t *testing.T, db *gorm.DB, id string) (domain.PublicFoodItem, *analyzedomain.AnalysisTask) {
	t.Helper()
	var item domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", id).First(&item).Error)
	var tasks []analyzedomain.AnalysisTask
	require.NoError(t, db.Where("task_type = ?", "public_food_library_text").Find(&tasks).Error)
	for i := range tasks {
		if tasks[i].Payload["item_id"] == id {
			return item, &tasks[i]
		}
	}
	return item, nil
}

func TestCreateMerchantUploadQueuesNutritionInBackground(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	merchant := "街角小馆"
	images := []string{"https://example.com/a.jpg", "https://example.com/b.jpg"}

	id, err := svc.Create(context.Background(), "user-1", CreateInput{MerchantName: &merchant, ImagePaths: images})
	require.NoError(t, err)

	item, task := savedUploadAndTask(t, db, id)
	require.NotNil(t, task, "the upload gets a background task")
	require.Equal(t, "pending", item.NutritionStatus)
	require.NotNil(t, item.AnalysisTaskID)
	require.Equal(t, task.ID, *item.AnalysisTaskID, "the dish page follows the task while nutrition is analysed")
	require.ElementsMatch(t, images, stringsOf(task.Payload["nutrition_image_urls"]))
}

func TestCreateMerchantUploadWithNutritionSkipsBackgroundAnalysis(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))
	name := "大盘鸡"
	merchant := "街角小馆"

	id, err := svc.Create(context.Background(), "user-1", CreateInput{
		FoodName: &name, MerchantName: &merchant, ImagePaths: []string{"https://example.com/a.jpg"},
		TotalCalories: 820, Items: []map[string]any{{"name": "大盘鸡"}},
	})
	require.NoError(t, err)

	item, task := savedUploadAndTask(t, db, id)
	require.NotNil(t, task, "the text is still checked")
	_, wantsNutrition := task.Payload["nutrition_image_urls"]
	require.False(t, wantsNutrition)
	require.Nil(t, item.AnalysisTaskID)
	require.Equal(t, "current", item.NutritionStatus, "supplied nutrition is shown as soon as the dish is published")
	require.EqualValues(t, 1, item.NutritionVersion)
}

func TestCreateMerchantUploadWithoutTextOrPhotosPublishesAtOnce(t *testing.T) {
	db := setupPublicFoodServiceTestDB(t)
	svc := NewPublicFoodService(repo.NewPublicFoodRepo(db))

	id, err := svc.Create(context.Background(), "user-1", CreateInput{})
	require.NoError(t, err)

	item, task := savedUploadAndTask(t, db, id)
	require.Nil(t, task)
	require.Equal(t, "published", item.Status)
}

func stringsOf(value any) []string {
	switch values := value.(type) {
	case []string:
		return values
	case []any:
		out := make([]string, 0, len(values))
		for _, v := range values {
			if s, ok := v.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
