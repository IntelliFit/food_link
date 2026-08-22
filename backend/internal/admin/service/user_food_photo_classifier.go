package service

import (
	"sort"
	"strings"

	"food_link/backend/internal/admin/repo"
)

type UserFoodPhotoClassification struct {
	ReviewStatus    string
	Labels          []string
	ExclusionReason string
}

var photoRankingNonFoodMarkers = []string{
	"非食物", "不是食物", "未检测到食物", "未识别到食物", "无法识别食物", "无食物",
}

var photoRankingMultiDishMarkers = []string{
	"一桌菜", "一桌子菜", "一桌饭菜", "一桌子饭菜", "满桌菜", "满桌饭菜", "宴席", "宴会菜",
	"多道菜", "多盘菜", "多份菜肴", "桌上摆满", "餐桌上摆放着多盘", "聚餐场景",
}

var photoRankingSupplementMarkers = []string{
	"蛋白粉", "增肌粉", "代餐粉", "膳食补充剂", "营养补充剂", "肌酸", "支链氨基酸", "bcaa",
}

var photoRankingLabelMarkers = map[string][]string{
	"fruit": {
		"苹果", "香蕉", "橙", "橘", "柑", "柚", "柠檬", "梨", "水蜜桃", "黄桃", "蜜桃", "油桃", "桃子", "李子", "杏子", "梅子",
		"葡萄", "提子", "草莓", "蓝莓", "树莓", "桑葚", "樱桃", "车厘子", "猕猴桃", "奇异果",
		"芒果", "菠萝", "凤梨", "榴莲", "山竹", "荔枝", "龙眼", "桂圆", "火龙果", "百香果",
		"西瓜", "哈密瓜", "甜瓜", "木瓜", "石榴", "柿子", "枣", "椰子", "杨梅", "枇杷",
	},
	"snack": {
		"薯片", "薯条", "饼干", "曲奇", "威化", "糖果", "巧克力", "辣条", "果冻", "布丁",
		"坚果", "瓜子", "花生", "开心果", "腰果", "杏仁", "核桃", "碧根果", "夏威夷果",
		"话梅", "果脯", "蜜饯", "肉脯", "肉干", "海苔", "爆米花", "锅巴", "虾条", "雪饼", "仙贝",
		"蛋糕", "面包", "吐司", "甜甜圈", "泡芙", "蛋挞", "马卡龙", "冰淇淋", "冰激凌",
		"雪糕", "慕斯", "芝士", "奶油", "华夫饼", "松饼", "可颂", "甜品",
	},
	"beverage": {
		"饮料", "奶茶", "咖啡", "果汁", "豆浆", "酸奶", "牛奶", "汽水", "可乐", "苏打水",
		"橙汁", "苹果汁", "葡萄汁", "西瓜汁", "甘蔗汁", "梨汁", "柠檬汁", "芒果汁", "椰子水",
		"气泡水", "椰汁", "椰奶", "茶饮", "啤酒", "红酒", "白酒", "鸡尾酒", "冰沙", "奶昔",
	},
	"takeout": {
		"外卖", "配送餐", "打包盒", "一次性餐盒", "外卖盒", "外带", "takeaway", "delivery",
	},
	"home_cooked": {
		"家常", "自制", "自家做", "自己做", "家庭烹饪", "在家做",
	},
	"restaurant": {
		"堂食", "餐厅", "饭店", "餐馆", "食堂", "自助餐", "火锅店", "烧烤店", "沙县小吃",
		"麦当劳", "肯德基", "必胜客", "汉堡王", "海底捞", "兰州拉面",
	},
}

// ClassifyUserFoodPhotoForRanking applies conservative, deterministic rules to
// decide whether a photo is useful for food ranking. Context labels are only
// added when the existing analysis text contains an explicit signal.
func ClassifyUserFoodPhotoForRanking(photo repo.UserFoodPhoto) UserFoodPhotoClassification {
	text := normalizedPhotoClassificationText(photo)
	if containsAny(text, photoRankingNonFoodMarkers) {
		return excludedPhotoClassification("non_food")
	}
	if containsAny(text, photoRankingMultiDishMarkers) {
		return excludedPhotoClassification("multi_dish_scene")
	}
	if containsAny(text, photoRankingSupplementMarkers) {
		return excludedPhotoClassification("other")
	}

	taskType := strings.ToLower(strings.TrimSpace(photo.TaskType))
	if strings.Contains(taskType, "packaged_nutrition_label") || strings.Contains(taskType, "expiry_recognize") {
		return excludedPhotoClassification("label_or_package_only")
	}

	status := strings.ToLower(strings.TrimSpace(photo.Status))
	if status == "failed" || status == "error" || status == "cancelled" || status == "canceled" || status == "violated" {
		return excludedPhotoClassification("unusable")
	}
	if photo.Nutrition == nil || photo.Nutrition.ItemCount == 0 || len(photo.Nutrition.ItemNames) == 0 {
		return excludedPhotoClassification("unusable")
	}
	labels := make([]string, 0, len(photoRankingLabelMarkers)+1)
	for label, markers := range photoRankingLabelMarkers {
		if containsAny(text, markers) {
			labels = append(labels, label)
		}
	}
	labels = uniqueSortedStrings(labels)
	return UserFoodPhotoClassification{ReviewStatus: "kept", Labels: labels}
}

func normalizedPhotoClassificationText(photo repo.UserFoodPhoto) string {
	parts := []string{photo.Description}
	if photo.Nutrition != nil {
		parts = append(parts, photo.Nutrition.ItemNames...)
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func containsAny(text string, markers []string) bool {
	for _, marker := range markers {
		if strings.Contains(text, strings.ToLower(marker)) {
			return true
		}
	}
	return false
}

func excludedPhotoClassification(reason string) UserFoodPhotoClassification {
	return UserFoodPhotoClassification{ReviewStatus: "excluded", ExclusionReason: reason}
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
