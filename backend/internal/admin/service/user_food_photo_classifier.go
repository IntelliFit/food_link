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

var photoRankingClutteredSubjectMarkers = []string{
	"一大桌", "多人聚餐", "多人用餐", "聚餐", "合餐", "自助餐", "满桌", "餐桌",
	"组合", "拼盘", "三拼", "双拼", "套餐", "便当", "搭配", "不同口味",
	"多种", "多款", "多份", "若干", "两盘", "两碗", "两杯", "两份", "丰富", "丰盛",
}

var photoRankingPackageOnlyMarkers = []string{
	"营养成分表", "配料表", "食品标签", "包装", "包装食品", "包装袋", "包装盒", "外包装",
	"未拆封", "袋装", "盒装", "罐装", "瓶装", "一袋", "一盒", "一罐", "一瓶",
}

var photoRankingNonFoodSupplementMarkers = []string{
	"鱼油", "软胶囊", "胶囊", "维生素", "补充剂", "药片",
}

var photoRankingSupplementMarkers = []string{
	"蛋白粉", "增肌粉", "代餐粉", "膳食补充剂", "营养补充剂", "肌酸", "支链氨基酸", "bcaa",
}

var photoRankingLabelMarkers = map[string][]string{
	"fruit": {
		"苹果", "香蕉", "橙", "橘", "柑", "柚", "柠檬", "梨", "水蜜桃", "黄桃", "蜜桃", "油桃", "桃子", "李子", "杏子", "梅子",
		"葡萄", "提子", "青提", "红提", "草莓", "蓝莓", "树莓", "桑葚", "樱桃", "车厘子", "猕猴桃", "奇异果",
		"芒果", "菠萝", "凤梨", "榴莲", "山竹", "荔枝", "龙眼", "桂圆", "火龙果", "百香果",
		"西瓜", "哈密瓜", "甜瓜", "木瓜", "石榴", "柿子", "枣", "椰子", "杨梅", "枇杷",
	},
	"beverage": {
		"饮料", "奶茶", "咖啡", "果汁", "豆浆", "酸奶", "牛奶", "汽水", "可乐", "苏打水",
		"橙汁", "苹果汁", "葡萄汁", "西瓜汁", "甘蔗汁", "梨汁", "柠檬汁", "芒果汁", "椰子水",
		"气泡水", "椰汁", "椰奶", "茶饮", "啤酒", "红酒", "白酒", "鸡尾酒", "冰沙", "奶昔",
		"蛋白饮", "花生浆", "巴旦木奶",
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

var photoRankingSnackExplicitMarkers = []string{
	"零食组合", "零食拼盘", "多种零食", "多款零食", "休闲零食", "加工零食", "包装零食", "零嘴组合",
	"甜品拼盘", "甜点拼盘", "糕点拼盘",
}

var photoRankingMealContextMarkers = []string{
	"早餐", "早饭", "午餐", "午饭", "晚餐", "晚饭", "正餐",
}

var photoRankingSnackItemMarkers = []string{
	"薯片", "薯条", "饼干", "曲奇", "威化", "糖果", "辣条", "魔芋爽", "果冻", "布丁",
	"话梅", "果脯", "蜜饯", "肉脯", "肉干", "风干肉", "爆米花", "锅巴", "虾条", "雪饼", "仙贝",
	"蛋糕", "甜甜圈", "泡芙", "蛋挞", "马卡龙", "冰淇淋", "冰激凌", "雪糕", "慕斯", "圣代",
	"蛋白棒", "能量棒", "沙琪玛", "麻花", "月饼", "雪媚娘", "大福", "冰粉", "龟苓膏",
	"奶油面包", "酥皮面包", "甜面包", "菠萝包", "花饼", "牛轧糖",
}

var photoRankingNutSnackMarkers = []string{
	"坚果", "瓜子", "花生", "开心果", "腰果", "杏仁", "核桃", "碧根果", "夏威夷果", "巴旦木",
}

var photoRankingNutDishMarkers = []string{
	"炒", "拌", "饭", "面", "粉", "菜", "汤", "粥", "沙拉", "配", "点缀", "汤底", "酱", "馅",
}

var photoRankingMainFoodMarkers = []string{
	"米饭", "炒饭", "盖饭", "便当", "面条", "米线", "米粉", "河粉", "意面", "螺蛳粉", "炒粉", "拌面",
	"馒头", "包子", "饺子", "面包", "吐司", "火烧", "燕麦", "谷物", "粥", "汤", "火锅", "冒菜", "麻辣烫",
	"汉堡", "鸡腿堡", "牛排堡", "肉霸堡", "麦满分", "热狗", "卷饼", "披萨", "三明治", "贝果",
	"沙拉", "鸡肉", "鸡胸", "鸡翅", "鸡腿", "牛肉", "羊肉", "猪肉", "鱼", "虾", "排骨", "炒蛋", "水煮蛋",
	"鸡柳", "烤肉串", "香肠", "鸭翅", "鸭肫", "鸡蛋", "茶叶蛋", "鹌鹑蛋",
	"蔬菜", "生菜", "白菜", "圆白菜", "西兰花", "豆腐", "腐竹", "菇", "蘑菇", "莲藕", "苦菊", "黄瓜",
	"番茄", "土豆", "玉米", "红薯", "南瓜", "豆角", "四季豆", "套餐",
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
	if isRankableSingleFoodPhoto(photo) {
		labels = append(labels, "rankable")
	}
	for label, markers := range photoRankingLabelMarkers {
		if containsAny(text, markers) {
			labels = append(labels, label)
		}
	}
	if isSnackDominantPhoto(photo) {
		labels = append(labels, "snack")
	}
	labels = uniqueSortedStrings(labels)
	return UserFoodPhotoClassification{ReviewStatus: "kept", Labels: labels}
}

// isRankableSingleFoodPhoto is intentionally stricter than "kept". Kept
// photos remain useful for general analysis; rankable photos must show one
// clear food subject so leaderboard cards compare like with like.
func isRankableSingleFoodPhoto(photo repo.UserFoodPhoto) bool {
	if photo.SourceType == "packaged_correction" {
		return false
	}
	taskType := strings.ToLower(strings.TrimSpace(photo.TaskType))
	if strings.Contains(taskType, "packaged_") || strings.Contains(taskType, "expiry_") {
		return false
	}
	if photo.Nutrition == nil || photo.Nutrition.ItemCount != 1 || len(photo.Nutrition.ItemNames) != 1 {
		return false
	}
	itemName := strings.TrimSpace(photo.Nutrition.ItemNames[0])
	if itemName == "" {
		return false
	}
	description := strings.ToLower(strings.TrimSpace(photo.Description))
	itemText := strings.ToLower(itemName)
	return !containsAny(description, photoRankingMultiDishMarkers) &&
		!containsAny(description, photoRankingClutteredSubjectMarkers) &&
		!containsAny(itemText, photoRankingClutteredSubjectMarkers) &&
		!containsAny(description, photoRankingPackageOnlyMarkers) &&
		!containsAny(itemText, photoRankingPackageOnlyMarkers) &&
		!containsAny(description, photoRankingNonFoodSupplementMarkers) &&
		!containsAny(itemText, photoRankingNonFoodSupplementMarkers) &&
		!looksLikePackagedServing(description, itemText) &&
		!describesMultipleFoodSubjects(description)
}

func looksLikePackagedServing(description, itemText string) bool {
	text := description + " " + itemText
	return strings.Contains(text, "速溶咖啡") &&
		containsAny(text, []string{"条", "小包", "独立包装"})
}

func describesMultipleFoodSubjects(description string) bool {
	if strings.HasPrefix(description, "手动记录：") && strings.Count(description, "、") >= 2 {
		return true
	}
	pairedIndex := strings.Index(description, "配")
	if pairedIndex < 0 {
		return false
	}
	pairedText := description[pairedIndex+len("配"):]
	if containsAny(pairedText, []string{"及", "与", "和", "另加", "外加"}) {
		return true
	}
	// When the analysis names only one item but the description adds a fruit or
	// drink after “配”, treat the photo as multiple subjects. This intentionally
	// sacrifices recall so leaderboard cards do not include meals with sides.
	return containsAny(pairedText, photoRankingLabelMarkers["fruit"]) ||
		containsAny(pairedText, photoRankingLabelMarkers["beverage"])
}

// isSnackDominantPhoto classifies the subject of the whole photo, rather than
// treating a snack-like garnish or side item as evidence that the whole meal is
// a snack. Precision is deliberately preferred over recall for ranking labels.
func isSnackDominantPhoto(photo repo.UserFoodPhoto) bool {
	description := strings.ToLower(strings.TrimSpace(photo.Description))
	if description == "零食" || containsAny(description, photoRankingSnackExplicitMarkers) {
		return true
	}
	if containsAny(description, photoRankingMealContextMarkers) {
		return false
	}
	if photo.Nutrition == nil || len(photo.Nutrition.ItemNames) == 0 {
		return false
	}

	snackItems := 0
	comparableItems := 0
	mainItems := 0
	for _, rawName := range photo.Nutrition.ItemNames {
		name := strings.ToLower(strings.TrimSpace(rawName))
		if name == "" {
			continue
		}
		if isSnackItem(name) {
			snackItems++
			comparableItems++
			continue
		}
		if containsAny(name, photoRankingLabelMarkers["fruit"]) {
			continue
		}
		comparableItems++
		if containsAny(name, photoRankingMainFoodMarkers) {
			mainItems++
		}
	}
	if snackItems == 0 {
		return false
	}
	if mainItems > 0 {
		return false
	}
	return snackItems*2 >= comparableItems
}

func isSnackItem(name string) bool {
	if containsAny(name, []string{"巧克力粉", "巧克力酱", "巧克力碎", "奶油酱", "花生酱"}) {
		return false
	}
	if containsAny(name, photoRankingSnackItemMarkers) {
		return true
	}
	if containsAny(name, photoRankingLabelMarkers["beverage"]) {
		return false
	}
	if containsAny(name, photoRankingMainFoodMarkers) {
		return false
	}
	if strings.Contains(name, "巧克力") {
		return true
	}
	return containsAny(name, photoRankingNutSnackMarkers) && !containsAny(name, photoRankingNutDishMarkers)
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
