package service

import (
	"strings"
	"unicode"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
)

// Library rows imported without food_state/weight_basis (built-in staples,
// curated batches) are rejected by the shared reuse contract, which made the
// most common foods (rice, fruit, eggs, milk) unmatchable. The smart engine
// infers a profile from the row's own Chinese name, only for the categories
// below, and only when the item's own state agrees with that profile.
type smartCatalogCategory string

const (
	smartCategoryNone       smartCatalogCategory = ""
	smartCategoryCookingFat smartCatalogCategory = "cooking_fat"
	smartCategoryLiquid     smartCatalogCategory = "liquid"
	smartCategorySoup       smartCatalogCategory = "soup"
	smartCategoryStaple     smartCatalogCategory = "cooked_staple"
	smartCategoryCookedDish smartCatalogCategory = "cooked_dish"
	smartCategoryCookedMeat smartCatalogCategory = "cooked_meat"
	smartCategoryFruit      smartCatalogCategory = "fruit"
	smartCategoryVegetable  smartCatalogCategory = "vegetable"
	smartCategoryEgg        smartCatalogCategory = "egg"
	smartCategoryDryGood    smartCatalogCategory = "dry_good"
	smartCategoryDairySolid smartCatalogCategory = "dairy_solid"
)

var (
	smartCookingFatTokens = []string{"花生油", "玉米油", "橄榄油", "菜籽油", "大豆油", "植物油", "食用油", "调和油", "芝麻油", "香油", "葵花籽油", "猪油", "牛油", "黄油"}
	smartLiquidTokens     = []string{"牛奶", "酸奶", "豆浆", "可乐", "咖啡", "拿铁", "奶茶", "果汁", "汁", "汽水", "饮料", "奶昔", "茶饮", "绿茶", "红茶", "乌龙茶", "柠檬水", "苏打水"}
	smartSoupTokens       = []string{"汤", "羹"}
	smartStapleTokens     = []string{"米饭", "糙米饭", "杂粮饭", "粥", "面条", "馒头", "包子", "饺子", "馄饨", "烧麦", "花卷", "窝头", "面包", "吐司", "油条", "煎饼", "手抓饼"}
	smartDishTokens       = []string{"炒", "烧", "炖", "焖", "卤", "烤", "煎", "炸", "蒸", "煮", "拌", "宫保", "鱼香", "麻婆", "酸菜鱼"}
	smartFruitTokens      = []string{"苹果", "梨", "香蕉", "橙", "橘", "柑", "柚", "桃", "李", "杏", "葡萄", "草莓", "蓝莓", "樱桃", "芒果", "菠萝", "凤梨", "猕猴桃", "西瓜", "哈密瓜", "甜瓜", "火龙果", "荔枝", "龙眼", "桂圆", "榴莲", "山竹", "石榴", "柿", "枣", "牛油果", "百香果", "木瓜", "杨梅"}
	smartVegetableTokens  = []string{"菜", "青菜", "上海青", "生菜", "菠菜", "芹菜", "黄瓜", "番茄", "西红柿", "茄子", "冬瓜", "南瓜", "胡萝卜", "萝卜", "西兰花", "花菜", "菜花", "洋葱", "青椒", "彩椒", "辣椒", "苦瓜", "丝瓜", "土豆", "红薯", "山药", "芋头", "玉米", "香菇", "蘑菇", "金针菇", "杏鲍菇", "木耳", "海带", "紫菜", "豆芽", "莴笋", "芦笋", "秋葵", "西葫芦", "豆角", "四季豆", "荷兰豆", "毛豆"}
	smartEggTokens        = []string{"鸡蛋", "鸭蛋", "鹌鹑蛋", "蛋清", "蛋白"}
	smartDryGoodTokens    = []string{"核桃", "花生", "开心果", "腰果", "杏仁", "扁桃仁", "瓜子", "芝麻", "燕麦片", "麦片", "白砂糖", "红糖", "冰糖", "蜂蜜"}
	smartDairySolidTokens = []string{"奶酪", "芝士"}
	smartProcessedTokens  = []string{"干", "脯", "罐头", "果酱", "果汁", "饮料", "糖水", "冻干", "蜜饯", "软糖", "汁", "片"}
)

// smartCatalogCategoryForName classifies a library row by its own name. The
// order matters: a soup or stir-fry containing a vegetable is a dish, and a
// cooking fat is never mistaken for a dairy or nut row.
func smartCatalogCategoryForName(name string, kcalPer100g float64) smartCatalogCategory {
	name = strings.TrimSpace(name)
	if name == "" || !smartContainsHan(name) {
		return smartCategoryNone
	}
	switch {
	case containsAnyAnalyzeText(name, smartCookingFatTokens) && kcalPer100g >= 600:
		return smartCategoryCookingFat
	case containsAnyAnalyzeText(name, smartLiquidTokens):
		return smartCategoryLiquid
	case containsAnyAnalyzeText(name, smartSoupTokens):
		return smartCategorySoup
	case strings.Contains(name, "(熟)") || strings.Contains(name, "（熟）"):
		if containsAnyAnalyzeText(name, smartVegetableTokens) || containsAnyAnalyzeText(name, smartStapleTokens) {
			return smartCategoryStaple
		}
		return smartCategoryCookedMeat
	case containsAnyAnalyzeText(name, smartStapleTokens):
		return smartCategoryStaple
	case containsAnyAnalyzeText(name, smartDishTokens):
		return smartCategoryCookedDish
	case containsAnyAnalyzeText(name, smartEggTokens):
		return smartCategoryEgg
	case containsAnyAnalyzeText(name, smartDryGoodTokens):
		return smartCategoryDryGood
	case containsAnyAnalyzeText(name, smartDairySolidTokens):
		return smartCategoryDairySolid
	case containsAnyAnalyzeText(name, smartFruitTokens) && !containsAnyAnalyzeText(name, smartProcessedTokens) && kcalPer100g > 0 && kcalPer100g <= 200:
		return smartCategoryFruit
	case containsAnyAnalyzeText(name, smartVegetableTokens) && kcalPer100g > 0 && kcalPer100g <= 120:
		return smartCategoryVegetable
	}
	return smartCategoryNone
}

// smartItemFoodState normalizes the model's free-text state ("熟制", "液态",
// "新鲜") to the reuse-contract tokens, falling back to the item name.
func smartItemFoodState(item map[string]any) string {
	text := strings.TrimSpace(stringFromAny(firstNonNil(item["foodState"], item["food_state"])))
	name := stringFromAny(item["name"])
	nameCategory := smartCatalogCategoryForName(name, 100)
	if containsAnyAnalyzeText(text, []string{"泡", "冲", "粥", "糊"}) && !containsAnyAnalyzeText(text, []string{"未泡", "干"}) {
		return "hydrated"
	}
	if token := normalizeFoodStateToken(text); token != "" {
		// "熟香蕉" is a ripe banana, not a cooked one.
		if token == "cooked" && nameCategory == smartCategoryFruit && !containsAnyAnalyzeText(text+name, []string{"煮", "蒸", "烤", "炒", "炖", "煎", "炸", "烹", "加热"}) {
			return "raw"
		}
		return token
	}
	switch {
	case containsAnyAnalyzeText(text, []string{"液", "流体", "饮", "汤汁"}):
		return "liquid"
	case containsAnyAnalyzeText(text, []string{"新鲜", "鲜", "fresh"}):
		return "raw"
	case containsAnyAnalyzeText(text, []string{"蒸", "煮", "炖", "烧", "炒"}):
		return "cooked"
	}
	if token := normalizeFoodStateToken(name); token != "" {
		return token
	}
	switch nameCategory {
	case smartCategoryFruit, smartCategoryVegetable, smartCategoryEgg:
		return "raw"
	case smartCategoryLiquid:
		return "liquid"
	case smartCategoryStaple, smartCategoryCookedDish, smartCategoryCookedMeat, smartCategorySoup:
		return "cooked"
	case smartCategoryDryGood:
		return "dry"
	}
	return ""
}

func smartItemIsComposite(item map[string]any) bool {
	if boolFromAny(firstNonNil(item["isComposite"], item["is_composite"])) {
		return true
	}
	return !exactDatabaseCalibrationAllowed(item)
}

// smartFoodCompatibility decides whether a library row may replace the model's
// estimate for one item (or one dish component). It returns the match method
// on success and a rejection reason otherwise.
func smartFoodCompatibility(item map[string]any, food *foodrecorddomain.FoodNutrition) (string, string) {
	if food == nil {
		return "", "missing_food"
	}
	state := smartItemFoodState(item)
	if state == "" {
		return "", "unknown_item_food_state"
	}
	normalized := copyAnyMap(item)
	normalized["foodState"] = state
	if strings.TrimSpace(stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"]))) == "" {
		normalized["weightBasis"] = "as_served"
	}
	if strings.TrimSpace(food.FoodState) != "" && strings.TrimSpace(food.WeightBasis) != "" {
		reason := nutritionReuseRejection(normalized, food)
		if reason == "" {
			return "exact", ""
		}
		if reason == "food_state_conflict" && smartWaterCookedEquivalent(normalized, state, normalizeFoodStateToken(food.FoodState), smartCatalogCategoryForName(food.CanonicalName, food.KcalPer100g)) {
			return "exact_water_cooked_equivalent", ""
		}
		return "", reason
	}
	if strings.Contains(food.Source, "历史识别记录营养均值") && food.QualityReviewedAt == nil {
		return "", "unreviewed_historical_average"
	}
	category := smartCatalogCategoryForName(food.CanonicalName, food.KcalPer100g)
	if category == smartCategoryNone {
		return "", "unknown_food_state"
	}
	if reason := smartInferredStateConflict(normalized, state, category); reason != "" {
		return "", reason
	}
	return "exact_state_inferred", ""
}

// smartInferredStateConflict checks the item against a profile inferred from a
// stateless row's name. Preparation still matters where it changes nutrition
// per gram: frying adds fat, and dry goods differ from their cooked forms.
func smartInferredStateConflict(item map[string]any, state string, category smartCatalogCategory) string {
	prep := nutritionPreparation(nutritionItemEvidence(item))
	switch category {
	case smartCategoryCookingFat:
		return ""
	case smartCategoryLiquid:
		if state == "liquid" || state == "raw" || state == "packaged" {
			return ""
		}
	case smartCategorySoup, smartCategoryCookedDish:
		// A catalog average for a mixed dish or soup does not know this
		// plate's oil and proportions; the photo estimate or the ingredient
		// split is better evidence.
		return "dish_average_not_used"
	case smartCategoryStaple, smartCategoryCookedMeat:
		if (state == "cooked" || state == "baked" || (state == "hydrated" && category == smartCategoryStaple)) && prep != "deep_fried" {
			return ""
		}
	case smartCategoryFruit:
		if state == "raw" {
			return ""
		}
	case smartCategoryVegetable, smartCategoryEgg:
		if state == "raw" || smartWaterCookedEquivalent(item, state, "raw", category) {
			return ""
		}
	case smartCategoryDryGood:
		if state == "dry" || state == "raw" {
			return ""
		}
	case smartCategoryDairySolid:
		if state == "raw" || state == "packaged" || state == "dry" {
			return ""
		}
	}
	return "inferred_state_conflict"
}

// smartWaterCookedEquivalent accepts a raw row for boiled or steamed eggs and
// vegetables without added fat: water cooking barely changes their energy per
// gram, while frying, braising or roasting does and stays rejected.
func smartWaterCookedEquivalent(item map[string]any, itemState, foodState string, category smartCatalogCategory) bool {
	if itemState != "cooked" || foodState != "raw" {
		return false
	}
	if category != smartCategoryEgg && category != smartCategoryVegetable {
		return false
	}
	if smartItemIsComposite(item) || containsAnyAnalyzeText(nutritionItemEvidence(item), []string{"煎", "炒", "炸", "烤", "卤", "红烧", "油"}) {
		return false
	}
	switch nutritionPreparation(nutritionItemEvidence(item)) {
	case "", "boiled", "steamed":
		return true
	}
	return false
}

func smartContainsHan(text string) bool {
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}
