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
}

var smartReferenceCutSuffix = regexp.MustCompile(`(丝|片|块|段|丁|条|碎|末)$`)

// smartReferenceIngredient looks a component up by its own name, then without
// a cut suffix ("土豆丝" -> "土豆"). It returns the per-100 g unit and the
// table name.
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

// smartReferenceDish reports a dish made only of table vegetables, cooking
// oil, water and seasonings, with at least one vegetable. Dishes with meat,
// eggs or tofu keep the library path.
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
