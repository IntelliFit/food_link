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
			status: "kept", labels: []string{"beverage", "fruit", "home_cooked"},
		},
		{
			name:   "merges baked desserts into snack",
			photo:  photoWithNutrition("奶油蛋糕", "蛋糕"),
			status: "kept", labels: []string{"rankable", "snack"},
		},
		{
			name: "does not add a packaged food label",
			photo: func() repo.UserFoodPhoto {
				photo := photoWithNutrition("袋装薯片", "薯片")
				photo.SourceType = "packaged_correction"
				return photo
			}(),
			status: "kept", labels: []string{"snack"},
		},
		{
			name: "adds takeout only from explicit context",
			photo: func() repo.UserFoodPhoto {
				photo := photoWithNutrition("外卖盒中的牛肉饭", "牛肉饭")
				photo.TaskType = "food"
				return photo
			}(),
			status: "kept", labels: []string{"rankable", "takeout"},
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
			status: "kept", labels: []string{},
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
		{
			name:   "does not classify eel rice as snack because of seaweed",
			photo:  photoWithNutrition("鳗鱼饭配玉米及海藻", "烤鳗鱼", "白米饭", "甜玉米粒", "中华海草", "海苔碎"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not classify fast food meal as snack because of fries",
			photo:  photoWithNutrition("麦当劳汉堡薯条鸡翅与咖啡", "麦辣鸡腿汉堡", "麦辣鸡翅", "薯条", "McCafe咖啡"),
			status: "kept", labels: []string{"beverage", "restaurant"},
		},
		{
			name:   "does not classify restaurant dinner as snack because of nut yogurt",
			photo:  photoWithNutrition("丰盛的新疆特色晚餐", "新疆大盘鸡", "皮带面", "烤羊排", "手撕包菜", "坚果酸奶"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "does not classify breakfast as snack because of toast",
			photo:  photoWithNutrition("牛奶搭配全麦面包的便捷早餐", "纯牛奶", "全麦面包"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "keeps explicit packaged snack assortment",
			photo:  photoWithNutrition("多种包装加工零食组合", "风干肉", "海苔肉松饼", "巧克力味饼干"),
			status: "kept", labels: []string{"snack"},
		},
		{
			name:   "does not let a small snack side classify a full meal",
			photo:  photoWithNutrition("白切鸡配米饭、炒白菜及小零食", "米饭", "白切鸡", "清炒白菜", "威化饼干"),
			status: "kept", labels: []string{},
		},
		{
			name:   "classifies chocolate milk as beverage rather than snack",
			photo:  photoWithNutrition("一盒巧克力牛奶", "巧克力牛奶"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "does not classify oatmeal with nuts as snack",
			photo:  photoWithNutrition("燕麦片配纯牛奶及每日坚果", "纯牛奶", "每日坚果", "燕麦片"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "keeps cake and sweet bread bakery assortment",
			photo:  photoWithNutrition("蓝莓酥皮蛋糕配抹茶奶油面包", "蓝莓酥皮蛋糕", "抹茶奶油面包"),
			status: "kept", labels: []string{"fruit", "snack"},
		},
		{
			name:   "marks one clear fruit as rankable",
			photo:  photoWithNutrition("一个完整苹果", "苹果"),
			status: "kept", labels: []string{"fruit", "rankable"},
		},
		{
			name:   "does not rank an aggregate assortment returned as one item",
			photo:  photoWithNutrition("多种包装零食组合", "混合零食"),
			status: "kept", labels: []string{"snack"},
		},
		{
			name:   "does not rank a three item combo returned as one item",
			photo:  photoWithNutrition("孜然香辣味炸肉、盐酥鸡及杏鲍菇三拼", "招牌炸肉、盐酥鸡、杏鲍菇混合三拼"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank one reported item when description shows a meal with sides",
			photo:  photoWithNutrition("牛肉面配烤肉串及可乐", "牛肉面"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "does not rank a meal paired with fruit",
			photo:  photoWithNutrition("吉野家煎鸡饭配青提", "煎鸡饭"),
			status: "kept", labels: []string{"fruit"},
		},
		{
			name:   "does not rank supplements beside fruit",
			photo:  photoWithNutrition("钙维生素D软胶囊配青提与樱桃", "钙维生素D软胶囊"),
			status: "kept", labels: []string{"fruit"},
		},
		{
			name:   "does not rank package nutrition information as visible food",
			photo:  photoWithNutrition("一份包装食品的营养成分表", "360克包装食品"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank an instant coffee sachet",
			photo:  photoWithNutrition("麦斯威尔速溶咖啡1条", "麦斯威尔速溶咖啡1条"),
			status: "kept", labels: []string{"beverage"},
		},
		{
			name:   "does not rank a visibly packaged food",
			photo:  photoWithNutrition("手持包装山楂棒", "山楂棒"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank a distant food scene",
			photo:  photoWithNutrition("餐厅远景中的一份意大利面", "意大利面"),
			status: "kept", labels: []string{"restaurant"},
		},
		{
			name:   "does not rank food with a cluttered background",
			photo:  photoWithNutrition("桌面杂物旁的一碗牛肉面", "牛肉面"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank several plates of the same dish",
			photo:  photoWithNutrition("两盘麻辣烫串串，含蔬菜、豆制品、丸子等", "麻辣烫串串"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank assorted sushi",
			photo:  photoWithNutrition("四枚不同口味的军舰寿司", "什锦军舰寿司"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank a bento with several mains",
			photo:  photoWithNutrition("烤鸡腿什锦便当，含鸡腿、牛肉及番茄蛋", "烤鸡腿什锦饭"),
			status: "kept", labels: []string{},
		},
		{
			name:   "does not rank a manual aggregate collapsed to one item",
			photo:  photoWithNutrition("手动记录：汤面（含双煎蛋、肉末、青菜）、熟切鸡肉、综合点心", "汤面、熟切鸡肉、综合点心"),
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
