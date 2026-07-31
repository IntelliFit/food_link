package main

import (
	"os"
	"path/filepath"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"

	"github.com/longbridgeapp/opencc"
	"github.com/stretchr/testify/require"
)

func TestReadTFDAPivotsLongRowsAndConvertsTraditionalChinese(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tfda.json")
	fixture := `[
{"食品分類":"豆類","資料類別":"樣品基本資料","整合編號":"H1","樣品名稱":"黃豆","俗名":"大豆,菽","樣品英文名稱":"Soy bean","內容物描述":"樣品狀態:乾貨","分析項":"熱量","含量單位":"kcal","每100克含量":" 389 ","樣本數":"2","標準差":"1.2"},
{"食品分類":"豆類","資料類別":"樣品基本資料","整合編號":"H1","樣品名稱":"黃豆","分析項":"粗蛋白","含量單位":"g","每100克含量":"35.6"},
{"食品分類":"豆類","資料類別":"樣品基本資料","整合編號":"H1","樣品名稱":"黃豆","分析項":"總碳水化合物","含量單位":"g","每100克含量":"33.0"},
{"食品分類":"豆類","資料類別":"樣品基本資料","整合編號":"H1","樣品名稱":"黃豆","分析項":"粗脂肪","含量單位":"g","每100克含量":"15.7"},
{"食品分類":"豆類","資料類別":"樣品基本資料","整合編號":"H1","樣品名稱":"黃豆","分析項":"視網醇當量(RE)","含量單位":"ug","每100克含量":"9"}
]`
	require.NoError(t, os.WriteFile(path, []byte(fixture), 0o600))
	converter, err := opencc.New("t2s")
	require.NoError(t, err)

	foods, rows, hash, err := readTFDA(path, converter)
	require.NoError(t, err)
	require.Equal(t, 5, rows)
	require.NotEmpty(t, hash)
	require.Equal(t, "黄豆", foods["H1"].CanonicalName)
	require.Equal(t, 389.0, foods["H1"].Nutrients["kcal_per_100g"].Value)
	require.NotContains(t, foods["H1"].Nutrients, "vitamin_a_rae_mcg_per_100g")
	require.NoError(t, validateFood(foods["H1"]))
}

func TestNutrientFieldRejectsUnsafeDerivedMappings(t *testing.T) {
	_, _, ok := nutrientField("視網醇當量(RE)")
	require.False(t, ok)
	_, _, ok = nutrientField("維生素K1")
	require.False(t, ok)
	field, unit, ok := nutrientField("維生素D總量(ug)")
	require.True(t, ok)
	require.Equal(t, "vitamin_d_mcg_per_100g", field)
	require.Equal(t, "ug", unit)
}

func TestValidateFoodRequiresCoreNutritionAndEnergyClosure(t *testing.T) {
	food := &sourceFood{Nutrients: map[string]nutrientValue{
		"kcal_per_100g": {Value: 389}, "protein_per_100g": {Value: 35.6},
		"carbs_per_100g": {Value: 33}, "fat_per_100g": {Value: 15.7},
	}}
	require.NoError(t, validateFood(food))
	delete(food.Nutrients, "fat_per_100g")
	require.ErrorContains(t, validateFood(food), "缺少核心营养")
	food.Nutrients["fat_per_100g"] = nutrientValue{Value: 99}
	require.ErrorContains(t, validateFood(food), "能量闭合异常")
}

func TestCanAdoptExistingRequiresExactReviewedIdentity(t *testing.T) {
	existing := fooddomain.FoodNutrition{CanonicalName: "豆浆(无糖)", Source: "项目内置初始营养数据"}
	review := reviewEntry{AdoptExisting: true, ExpectedExistingCanonical: "豆浆(无糖)", ExpectedExistingSource: "项目内置初始营养数据"}
	require.True(t, canAdoptExisting(existing, review))
	review.ExpectedExistingSource = "别的来源"
	require.False(t, canAdoptExisting(existing, review))
}

func TestParseNumberPreservesMissingInsteadOfConvertingToZero(t *testing.T) {
	_, err := parseNumber("Tr")
	require.Error(t, err)
	_, err = parseNumber("-")
	require.Error(t, err)
	value, err := parseNumber(" 0 ")
	require.NoError(t, err)
	require.Zero(t, value)
}
