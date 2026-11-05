package service

import (
	"regexp"
	"strings"
)

// A vegetable dish is recomputed from the model's own split (vegetable grams
// plus oil grams) with this table instead of the live library. On repeated
// runs of the same photo the model gives the same oil grams (8/8/8/8 g) while
// its own calories swing (48-80 kcal for 122 g cabbage + 8 g oil); summing its
// split cut the spread from 16% to 10%. The library cannot be used for this:
// it aliases raw vegetables to stir-fried rows (卷心菜 -> 清炒卷心菜), which
// counts the oil twice, and many raw rows are inactive.
//
// Values are per 100 g raw: the library's reviewed built-in rows where they
// exist, otherwise the Chinese food composition table, rounded.
type smartReferenceUnit struct {
	kcal, protein, carbs, fat float64
}

var smartReferenceIngredients = map[string]smartReferenceUnit{
	"卷心菜": {24, 1.3, 4.6, 0.2},
	"大白菜": {18, 1.3, 3.0, 0.2},
	"娃娃菜": {15.8, 1.4, 3.0, 0.2},
	"小白菜": {17, 1.5, 2.6, 0.2},
	"上海青": {13, 1.5, 2.2, 0.2},
	"油菜":  {25, 1.8, 3.8, 0.5},
	"青菜":  {20, 1.7, 3.0, 0.3},
	"菠菜":  {23, 2.9, 3.6, 0.4},
	"生菜":  {15, 1.4, 2.9, 0.2},
	"油麦菜": {14, 1.4, 2.1, 0.2},
	"空心菜": {19, 2.2, 4.0, 0.2},
	"菜心":  {25, 2.8, 3.4, 0.5},
	"芥兰":  {22, 2.8, 2.6, 0.4},
	"韭菜":  {29, 2.4, 4.2, 0.3},
	"西兰花": {34, 2.8, 6.6, 0.4},
	"花菜":  {25, 1.9, 5.0, 0.3},
	"豆芽":  {23.7, 2.4, 3.7, 0.2},
	"黄豆芽": {47, 4.5, 4.5, 1.6},
	"土豆":  {77, 2.0, 17.5, 0.1},
	"胡萝卜": {41, 0.9, 9.6, 0.2},
	"番茄":  {18, 0.9, 3.9, 0.2},
	"茄子":  {24, 1.0, 5.7, 0.2},
	"黄瓜":  {15, 0.7, 3.6, 0.1},
	"西葫芦": {18, 1.2, 3.2, 0.2},
	"丝瓜":  {20, 1.0, 4.2, 0.2},
	"冬瓜":  {13, 0.4, 2.6, 0.1},
	"南瓜":  {26, 1.0, 6.5, 0.1},
	"苦瓜":  {19, 0.8, 4.0, 0.2},
	"青椒":  {22, 1.0, 5.2, 0.2},
	"彩椒":  {31, 1.0, 6.0, 0.3},
	"豆角":  {34, 2.0, 6.5, 0.2},
	"荷兰豆": {49, 3.1, 8.1, 0.6},
	"芹菜":  {16, 0.7, 3.0, 0.2},
	"莴笋":  {15, 1.0, 2.8, 0.1},
	"白萝卜": {17.6, 0.8, 3.8, 0.2},
	"莲藕":  {73, 1.9, 16.4, 0.2},
	"山药":  {57, 1.9, 12.4, 0.2},
	"洋葱":  {40, 1.1, 9.3, 0.1},
	"木耳":  {27, 1.5, 6.0, 0.2},
	"香菇":  {34, 2.2, 6.8, 0.5},
	"金针菇": {37, 2.7, 7.8, 0.3},
	"杏鲍菇": {35, 3.0, 6.0, 0.2},
	"平菇":  {24, 1.9, 4.6, 0.3},
	"大蒜":  {128, 4.5, 27.6, 0.2},
	"植物油": {899, 0, 0, 99.9},

	// Meat, eggs, soy and staples, per 100 g raw (Chinese food composition
	// table; generic pork uses a lean-and-fat composite, not the fatty 肥瘦
	// row, because dishes mostly use sliced meat).
	"猪肉":  {210, 19.0, 0, 15.0},
	"猪瘦肉": {143, 20.3, 1.5, 6.2},
	"五花肉": {518, 9.3, 0, 53.0},
	"排骨":  {278, 16.7, 0.7, 23.1},
	"猪肉末": {263, 16.9, 0, 21.2},
	"鸡肉":  {167, 19.3, 1.3, 9.4},
	"鸡胸肉": {133, 19.4, 2.5, 5.0},
	"鸡腿肉": {181, 16.0, 0, 13.0},
	"牛肉":  {125, 19.9, 2.0, 4.2},
	"羊肉":  {203, 19.0, 0, 14.1},
	"鱼肉":  {113, 16.6, 0, 5.2},
	"虾仁":  {87, 16.4, 0, 2.4},
	"鸡蛋":  {144, 13.3, 2.8, 8.8},
	"豆腐":  {82, 8.1, 4.2, 3.7},
	"豆腐干": {140, 16.2, 11.5, 3.6},
	"大米":  {346, 7.4, 77.9, 0.8},
	"米饭":  {116, 2.6, 25.9, 0.3},
	"面条":  {284, 8.3, 61.9, 0.7},
	"米粉":  {346, 8.0, 78.2, 0.1},
	"面粉":  {362, 11.2, 73.6, 1.5},
	"白砂糖": {400, 0, 99.9, 0},
	"花生":  {574, 24.8, 21.7, 44.3},
	"玉米粒": {112, 4.0, 22.8, 1.2},
}

// smartReferenceCooked holds the cooked row where cooking changes the value
// per gram (meat loses water, rice and noodles absorb it). Each state is its
// own row: a cooked ingredient never borrows the raw value. Vegetables keep
// the raw row, since their own water loss is small and the oil is listed
// separately. Cooked meat values follow cooked composition data (roasted or
// braised lean, no added oil).
var smartReferenceCooked = map[string]smartReferenceUnit{
	"猪肉":  {270, 27.0, 0, 17.5},
	"猪瘦肉": {200, 28.0, 1.5, 9.0},
	"五花肉": {450, 13.0, 0, 44.0},
	"排骨":  {300, 24.0, 0, 22.5},
	"猪肉末": {297, 25.7, 0, 20.8},
	"鸡肉":  {215, 26.0, 0, 12.0},
	"鸡胸肉": {165, 31.0, 0, 3.6},
	"鸡腿肉": {210, 26.0, 0, 11.0},
	"牛肉":  {190, 30.0, 0, 7.5},
	"羊肉":  {260, 26.0, 0, 17.0},
	"鱼肉":  {130, 20.0, 0, 5.5},
	"虾仁":  {99, 21.0, 0, 1.1},
	"鸡蛋":  {150, 13.5, 1.5, 9.5},
	"大米":  {116, 2.6, 25.9, 0.3},
	"面条":  {110, 3.6, 23.0, 0.5},
	"米粉":  {110, 1.8, 25.0, 0.2},
	"面粉":  {223, 7.0, 47.0, 1.1},
	"花生":  {581, 21.7, 23.0, 48.0},
}

// smartReferenceAliases maps everyday spellings to a table entry.
var smartReferenceAliases = map[string]string{
	"包菜": "卷心菜", "圆白菜": "卷心菜", "甘蓝": "卷心菜", "结球甘蓝": "卷心菜", "包心菜": "卷心菜", "洋白菜": "卷心菜", "高丽菜": "卷心菜",
	"白菜": "大白菜", "黄芽白": "大白菜",
	"小油菜": "油菜", "绿叶菜": "青菜", "绿叶蔬菜": "青菜", "时蔬": "青菜", "通菜": "空心菜", "芥蓝": "芥兰",
	"西蓝花": "西兰花", "菜花": "花菜", "花椰菜": "花菜", "绿豆芽": "豆芽",
	"马铃薯": "土豆", "西红柿": "番茄", "尖椒": "青椒", "辣椒": "青椒", "四季豆": "豆角", "芸豆": "豆角",
	"萝卜": "白萝卜", "藕": "莲藕", "黑木耳": "木耳", "鲜香菇": "香菇", "蒜": "大蒜",
	"食用油": "植物油", "烹调油": "植物油", "花生油": "植物油", "大豆油": "植物油", "菜籽油": "植物油", "玉米油": "植物油",
	"调和油": "植物油", "橄榄油": "植物油", "芝麻油": "植物油", "香油": "植物油", "辣椒油": "植物油", "红油": "植物油",
	"葵花籽油": "植物油", "猪油": "植物油",
	"肉": "猪肉", "肉片": "猪瘦肉", "肉丝": "猪瘦肉", "瘦肉": "猪瘦肉", "猪里脊": "猪瘦肉", "里脊": "猪瘦肉", "里脊肉": "猪瘦肉",
	"猪五花肉": "五花肉", "五花": "五花肉", "肋条肉": "五花肉", "猪排骨": "排骨", "肉末": "猪肉末", "猪肉馅": "猪肉末", "肉馅": "猪肉末", "肉沫": "猪肉末",
	"鸡腿": "鸡腿肉", "去骨鸡腿肉": "鸡腿肉", "鸡块": "鸡肉", "鸡丁": "鸡肉", "鸡胸": "鸡胸肉",
	"牛肉片": "牛肉", "牛肉丝": "牛肉", "牛腩": "牛肉", "瘦牛肉": "牛肉", "羊肉片": "羊肉", "鱼": "鱼肉", "鱼片": "鱼肉", "虾": "虾仁",
	"蛋": "鸡蛋", "全蛋": "鸡蛋", "蛋液": "鸡蛋", "鸡蛋液": "鸡蛋", "炒鸡蛋": "鸡蛋", "北豆腐": "豆腐", "嫩豆腐": "豆腐", "豆干": "豆腐干", "香干": "豆腐干",
	"白米饭": "米饭", "白饭": "米饭", "饭": "米饭", "米": "大米", "白米": "大米", "粳米": "大米",
	"面": "面条", "小麦面条": "面条", "挂面": "面条", "米线": "米粉", "小麦粉": "面粉", "小麦面粉": "面粉",
	"白糖": "白砂糖", "糖": "白砂糖", "冰糖": "白砂糖", "花生仁": "花生", "花生米": "花生", "玉米": "玉米粒",
}

var smartReferenceCutSuffix = regexp.MustCompile(`(丝|片|块|段|丁|条|碎|末)$`)

// smartReferenceIngredient looks a component up by its own name, then without
// a cut suffix ("土豆丝" -> "土豆"). It returns the per-100 g unit and the
// table name.
// smartReferenceIngredientState picks the row for the component's state: a
// cooked component uses the cooked row when one exists ("大米" cooked is rice,
// "面粉" cooked is the steamed dough of a bun).
func smartReferenceIngredientState(name, state string) (map[string]any, string, bool) {
	unit, label, ok := smartReferenceIngredient(name)
	if !ok || !smartComponentCooked(state) {
		return unit, label, ok
	}
	if cooked, found := smartReferenceCooked[label]; found {
		return map[string]any{"calories": cooked.kcal, "protein": cooked.protein, "carbs": cooked.carbs, "fat": cooked.fat}, label + "(熟)", true
	}
	return unit, label, ok
}

// smartComponentCooked treats an unstated state as cooked: dish components
// are what is on the plate.
func smartComponentCooked(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "生", "raw", "生的", "未煮":
		return false
	}
	return true
}

func smartReferenceIngredient(name string) (map[string]any, string, bool) {
	name = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(name, "新鲜"), "鲜"))
	for _, candidate := range []string{name, smartReferenceCutSuffix.ReplaceAllString(name, "")} {
		if alias, ok := smartReferenceAliases[candidate]; ok {
			candidate = alias
		}
		if unit, ok := smartReferenceIngredients[candidate]; ok {
			return map[string]any{"calories": unit.kcal, "protein": unit.protein, "carbs": unit.carbs, "fat": unit.fat}, candidate, true
		}
	}
	return nil, "", false
}

// smartReferenceDish reports a dish made only of table ingredients (vegetables,
// meat, eggs, soy, staples), cooking oil, water and seasonings, with at least
// one food besides the oil. Such a dish never reads the library.
func smartReferenceDish(components []smartComponent) bool {
	vegetable := false
	for _, component := range components {
		if smartIsWater(component.name) || smartIsSeasoning(component.name) {
			continue
		}
		_, label, ok := smartReferenceIngredient(component.name)
		if !ok {
			return false
		}
		if label != "植物油" {
			vegetable = true
		}
	}
	return vegetable
}
