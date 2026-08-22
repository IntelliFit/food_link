package service

import (
	"testing"

	"food_link/backend/internal/admin/repo"

	"github.com/stretchr/testify/assert"
)

func TestClassifyUserFoodPhotoForRanking(t *testing.T) {
	tests := []struct {
		name   string
		photo  repo.UserFoodPhoto
		status string
		labels []string
		reason string
	}{
		{
			name:   "keeps fruit and beverage with overlapping labels",
			photo:  photoWithNutrition("香蕉牛奶", "香蕉", "牛奶"),
			status: "kept", labels: []string{"beverage", "fruit"},
		},
		{
			name:   "recognizes named fruit juice as beverage",
			photo:  photoWithNutrition("中式家常午餐", "油炸花生米", "橙汁"),
			status: "kept", labels: []string{"beverage", "fruit", "home_cooked", "snack"},
		},
		{
			name: "adds takeout only from explicit context",
			photo: func() repo.UserFoodPhoto {
				photo := photoWithNutrition("外卖盒中的牛肉饭", "牛肉饭")
				photo.TaskType = "food"
				return photo
			}(),
			status: "kept", labels: []string{"takeout"},
		},
		{
			name: "excludes nutrition label task",
			photo: func() repo.UserFoodPhoto {
				photo := photoWithNutrition("营养成分表", "薯片")
				photo.TaskType = "packaged_nutrition_label"
				return photo
			}(),
			status: "excluded", reason: "label_or_package_only",
		},
		{
			name:   "excludes failed analysis",
			photo:  repo.UserFoodPhoto{Status: "failed"},
			status: "excluded", reason: "unusable",
		},
		{
			name:   "excludes photo without rankable food",
			photo:  repo.UserFoodPhoto{Status: "completed", Description: "普通照片"},
			status: "excluded", reason: "unusable",
		},
		{
			name:   "excludes complex multi dish scene",
			photo:  photoWithNutrition("餐桌上摆放着多盘菜，是一桌饭菜", "菜1", "菜2", "菜3"),
			status: "excluded", reason: "multi_dish_scene",
		},
		{
			name:   "keeps a single plate with many identified ingredients",
			photo:  photoWithNutrition("一份鸡肉沙拉", "鸡胸肉", "生菜", "玉米", "鸡蛋", "番茄", "黄瓜"),
			status: "kept", labels: []string{},
		},
		{
			name:   "excludes sports supplement from food ranking",
			photo:  photoWithNutrition("训练后冲泡乳清蛋白粉", "乳清蛋白粉"),
			status: "excluded", reason: "other",
		},
		{
			name:   "does not classify oyster mushroom or walnut as fruit",
			photo:  photoWithNutrition("杏鲍菇炒核桃", "杏鲍菇", "核桃"),
			status: "kept", labels: []string{"snack"},
		},
		{
			name:   "recognizes explicit restaurant chain context",
			photo:  photoWithNutrition("麦当劳双层牛肉堡套餐", "牛肉堡", "可乐"),
			status: "kept", labels: []string{"beverage", "restaurant"},
		},
		{
			name:   "keeps unlabeled meal instead of guessing context",
			photo:  photoWithNutrition("番茄炒蛋和米饭", "番茄炒蛋", "米饭"),
			status: "kept", labels: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := ClassifyUserFoodPhotoForRanking(tt.photo)
			assert.Equal(t, tt.status, actual.ReviewStatus)
			assert.Equal(t, tt.labels, actual.Labels)
			assert.Equal(t, tt.reason, actual.ExclusionReason)
		})
	}
}

func photoWithNutrition(description string, names ...string) repo.UserFoodPhoto {
	return repo.UserFoodPhoto{
		Status:      "completed",
		Description: description,
		Nutrition: &repo.UserFoodPhotoNutrition{
			ItemCount: len(names),
			ItemNames: names,
		},
	}
}
