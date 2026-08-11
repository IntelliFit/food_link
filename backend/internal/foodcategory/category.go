package foodcategory

import (
	"fmt"
	"sort"
	"strings"
)

// Category is a user-facing food catalog category shared by the mini program and admin console.
type Category struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

var categories = []Category{
	{Key: "staple", Label: "主食"},
	{Key: "protein", Label: "肉蛋奶"},
	{Key: "vegetable", Label: "蔬菜"},
	{Key: "fruit", Label: "水果"},
	{Key: "dairy", Label: "乳品"},
	{Key: "beverage", Label: "饮品"},
	{Key: "soup", Label: "汤饮"},
	{Key: "snack", Label: "零食"},
	{Key: "meal", Label: "菜肴"},
	{Key: "other", Label: "其他"},
}

var categoryFilterPatterns = map[string][]string{
	"soup":      {"%清汤%", "%汤%", "%羹%", "%soup%", "%broth%"},
	"beverage":  {"%咖啡%", "%美式%", "%拿铁%", "%奶茶%", "%茶饮%", "%绿茶%", "%红茶%", "%乌龙茶%", "%普洱%", "%茉莉茶%", "%饮料%", "%可乐%", "%果汁%", "%豆浆%", "%coffee%", "%latte%", "%tea%", "%drink%"},
	"snack":     {"%坚果%", "%薯片%", "%饼干%", "%曲奇%", "%巧克力%", "%方糖%", "%糖果%", "%软糖%", "%棒棒糖%", "%糕点%", "%蛋糕%", "%零食%", "%瓜子%", "%花生%", "%杏仁%", "%核桃%", "%cookie%", "%snack%", "%nuts%"},
	"meal":      {"%沙拉%", "%便当%", "%套餐%", "%外卖%", "%餐%", "%饭团%", "%炒饭%"},
	"staple":    {"%米饭%", "%白米饭%", "%糙米%", "%饭%", "%面条%", "%荞麦面%", "%馒头%", "%包子%", "%粥%", "%燕麦%", "%红薯%", "%玉米%", "%土豆%", "%紫薯%", "%南瓜%", "%面包%", "%吐司%"},
	"protein":   {"%鸡%", "%牛肉%", "%猪肉%", "%红烧肉%", "%鱼%", "%虾%", "%蛋%", "%豆腐%", "%蛋白%", "%鸭%", "%鹅%"},
	"vegetable": {"%菜%", "%西兰花%", "%生菜%", "%菠菜%", "%番茄%", "%黄瓜%", "%白菜%", "%秋葵%", "%时蔬%"},
	"fruit":     {"%苹果%", "%香蕉%", "%橙%", "%梨%", "%莓%", "%水果%", "%西瓜%", "%草莓%"},
	"dairy":     {"%奶%", "%酸奶%", "%牛奶%", "%奶酪%", "%芝士%"},
}

var categoryInferenceKeywords = map[string][]string{
	"soup":      {"清汤", "汤", "羹", "soup", "broth"},
	"beverage":  {"咖啡", "美式", "拿铁", "奶茶", "茶饮", "绿茶", "红茶", "乌龙茶", "普洱", "茉莉茶", "饮料", "可乐", "果汁", "豆浆", "coffee", "latte", "tea", "drink"},
	"snack":     {"坚果", "薯片", "饼干", "曲奇", "巧克力", "方糖", "糖果", "软糖", "棒棒糖", "糕点", "蛋糕", "零食", "瓜子", "花生", "杏仁", "核桃", "cookie", "snack", "nuts"},
	"meal":      {"沙拉", "便当", "套餐", "外卖", "餐", "饭团"},
	"staple":    {"米饭", "白米饭", "糙米", "饭", "面条", "荞麦面", "馒头", "包子", "粥", "燕麦", "红薯", "玉米", "土豆", "紫薯", "南瓜", "面包", "吐司", "rice", "noodle", "bread", "oat"},
	"protein":   {"鸡", "牛肉", "猪肉", "红烧肉", "鱼", "虾", "蛋", "豆腐", "protein", "chicken", "beef", "egg", "tofu", "fish"},
	"vegetable": {"菜", "西兰花", "生菜", "菠菜", "番茄", "蔬", "时蔬", "broccoli", "tomato", "vegetable"},
	"fruit":     {"苹果", "香蕉", "橙", "梨", "莓", "水果", "apple", "banana", "berry", "fruit"},
	"dairy":     {"奶", "酸奶", "牛奶", "奶酪", "芝士", "cheese", "milk", "yogurt"},
}

// Categories returns a defensive copy in the same order used by the mini program.
func Categories() []Category {
	result := make([]Category, len(categories))
	copy(result, categories)
	return result
}

// NormalizeFilter accepts a catalog category key and falls back to all records.
func NormalizeFilter(category string) string {
	category = strings.TrimSpace(category)
	if category == "" || category == "all" {
		return "all"
	}
	for _, item := range categories {
		if item.Key == category {
			return category
		}
	}
	return "all"
}

// FilterSQL returns a category predicate for a trusted SQL column expression.
func FilterSQL(column, category string) string {
	category = NormalizeFilter(category)
	if category == "all" {
		return "TRUE"
	}
	conditions := Conditions(column)
	if condition, ok := conditions[category]; ok {
		return condition
	}
	known := make([]string, 0, len(conditions))
	for _, condition := range conditions {
		known = append(known, "("+condition+")")
	}
	sort.Strings(known)
	return "NOT (" + strings.Join(known, " OR ") + ")"
}

// Conditions returns the shared keyword predicates used to categorize nutrition-library names.
func Conditions(column string) map[string]string {
	result := make(map[string]string, len(categoryFilterPatterns))
	for key, patterns := range categoryFilterPatterns {
		result[key] = ilikeAnySQL(column, patterns)
	}
	delete(result, "other")
	return result
}

// Infer applies the same precedence as the SQL category expression.
func Infer(text string) string {
	normalized := strings.ToLower(strings.TrimSpace(text))
	for _, key := range []string{"soup", "beverage", "snack", "meal", "staple", "protein", "vegetable", "fruit", "dairy"} {
		for _, keyword := range categoryInferenceKeywords[key] {
			if strings.Contains(normalized, strings.ToLower(keyword)) {
				return key
			}
		}
	}
	return "other"
}

func ilikeAnySQL(column string, patterns []string) string {
	quoted := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		quoted = append(quoted, "'"+strings.ReplaceAll(pattern, "'", "''")+"'")
	}
	return fmt.Sprintf("%s ILIKE ANY (ARRAY[%s])", column, strings.Join(quoted, ","))
}
