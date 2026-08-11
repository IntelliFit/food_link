package foodcategory

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInferUsesCatalogCategoryPrecedence(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "vegetable", Infer("番茄"))
	assert.Equal(t, "protein", Infer("番茄炒鸡蛋"))
	assert.Equal(t, "staple", Infer("鸡肉炒饭"))
	assert.Equal(t, "dairy", Infer("纯牛奶"))
	assert.Equal(t, "other", Infer("未知食物"))
}

func TestFilterSQLSupportsAllAndOther(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "TRUE", FilterSQL("canonical_name", "all"))
	assert.Equal(t, "TRUE", FilterSQL("canonical_name", "invalid"))
	assert.Contains(t, FilterSQL("canonical_name", "vegetable"), "%番茄%")
	assert.Contains(t, FilterSQL("canonical_name", "other"), "NOT (")
}

func TestCategoriesMatchUserCatalogLabels(t *testing.T) {
	t.Parallel()

	assert.Equal(t, []Category{
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
	}, Categories())
}
