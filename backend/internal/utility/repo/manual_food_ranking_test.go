package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/utility/domain"

	"github.com/stretchr/testify/require"
)

func TestManualTitleTierReadsChineseHeadNoun(t *testing.T) {
	cases := []struct {
		title, query string
		want         int
	}{
		{"八宝粥", "八宝粥", titleTierExact},
		{"八宝粥(同茂牌)", "八宝粥", titleTierQualified},
		{"馒头 100g", "馒头", titleTierQualified},
		{"娃哈哈 桂圆莲子八宝粥 360g", "八宝粥", titleTierHeadNoun},
		{"白米饭", "米饭", titleTierHeadNoun},
		{"燕麦片（干）", "燕麦", titleTierHeadNoun},
		{"鸡胸肉丁", "鸡胸肉", titleTierHeadNoun},
		{"酸奶土豆泥", "酸奶", titleTierModifier},
		{"安慕希 风味酸奶(糯香粽子口味)", "粽子", titleTierModifier},
		{"牛奶巧克力", "牛奶", titleTierModifier},
		{"西兰花鸡胸饭", "西兰花", titleTierModifier},
		{"轻食店便当", "西兰花", titleTierNone},
	}
	for _, tc := range cases {
		require.Equal(t, tc.want, manualTitleTier(tc.title, tc.query), "%s / %s", tc.title, tc.query)
	}
}

func TestManualResultTierUsesProductNameAndApprovedAlias(t *testing.T) {
	brandOnly := domain.ManualFoodResult{Source: "packaged_food", Title: "可口可乐 蜜桃味汽水", SearchName: "蜜桃味汽水"}
	require.Equal(t, titleTierNone, manualResultTier(brandOnly, "可乐"), "the brand is not the product")
	alias := domain.ManualFoodResult{Source: "nutrition_library", Title: "白米饭", SearchExact: true}
	require.Equal(t, titleTierExact, manualResultTier(alias, "米饭"), "米饭 is an approved alias of 白米饭")
}

func TestDetectPackagedIntentKnownCategories(t *testing.T) {
	r := &ManualFoodRepo{}
	for _, q := range []string{"八宝粥", "桂圆八宝粥", "火腿肠", "薯片"} {
		require.True(t, r.detectPackagedIntent(context.Background(), q), q)
	}
	for _, q := range []string{"米饭", "包子", ""} {
		require.False(t, r.detectPackagedIntent(context.Background(), q), "without a database only known categories count: %s", q)
	}
}

func manualTitles(items []domain.ManualFoodResult) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return out
}

func TestRankManualFoodResultsPackagedQueryLeadsWithProducts(t *testing.T) {
	items := []domain.ManualFoodResult{
		{ID: "s1", Source: "nutrition_library", Title: "八宝粥", SearchExact: true},
		{ID: "c1", Source: "public_library", SourceLabel: "校园食堂", Title: "八宝粥", Subtitle: "甲大学"},
		{ID: "c2", Source: "public_library", SourceLabel: "校园食堂", Title: "八宝粥", Subtitle: "乙大学"},
		{ID: "s2", Source: "nutrition_library", Title: "八宝粥(同茂牌)"},
		{ID: "p1", Source: "packaged_food", Title: "银鹭 桂圆莲子八宝粥", SearchName: "桂圆莲子八宝粥", SearchOrder: 0},
		{ID: "p2", Source: "packaged_food", Title: "娃哈哈 木糖醇八宝粥", SearchName: "木糖醇八宝粥", SearchOrder: 1},
		{ID: "p3", Source: "packaged_food", Title: "百草味 坚果八宝粥", SearchName: "坚果八宝粥", SearchOrder: 2},
		{ID: "p4", Source: "packaged_food", Title: "娃哈哈 桂圆八宝粥", SearchName: "桂圆八宝粥", SearchOrder: 3},
		{ID: "m1", Source: "nutrition_library", Title: "八宝粥罐头外包装"},
	}
	got := manualTitles(rankManualFoodResults(items, "八宝粥", true, true))
	require.Equal(t, []string{
		"银鹭 桂圆莲子八宝粥", "娃哈哈 木糖醇八宝粥", "百草味 坚果八宝粥",
		"八宝粥", // the generic food stays on the first screen
		"娃哈哈 桂圆八宝粥",
		"八宝粥", // one canteen row per dish name; an exact name before a qualified one
		"八宝粥(同茂牌)",
		"八宝粥罐头外包装",
	}, got)
}

func TestRankManualFoodResultsUnpackagedQueryLeadsWithStandardFood(t *testing.T) {
	items := []domain.ManualFoodResult{
		{ID: "p1", Source: "packaged_food", Title: "自热米饭", SearchName: "自热米饭"},
		{ID: "c1", Source: "public_library", SourceLabel: "校园食堂", Title: "米饭", Subtitle: "甲大学"},
		{ID: "c2", Source: "public_library", SourceLabel: "校园食堂", Title: "米饭", Subtitle: "乙大学"},
		{ID: "s1", Source: "nutrition_library", Title: "米饭(含番茄蛋汁)"},
		{ID: "s2", Source: "nutrition_library", Title: "白米饭", SearchExact: true},
		{ID: "s3", Source: "nutrition_library", Title: "温州糯米饭"},
		{ID: "s4", Source: "nutrition_library", Title: "Basmati 米饭"},
		{ID: "m1", Source: "nutrition_library", Title: "米饭蛋糕"},
	}
	got := manualTitles(rankManualFoodResults(items, "米饭", false, true))
	require.Equal(t, []string{"白米饭", "米饭", "米饭(含番茄蛋汁)", "温州糯米饭", "Basmati 米饭", "自热米饭", "米饭蛋糕"}, got)
}

func TestRankManualFoodResultsGuestFrequentFoodsAreNotPersonal(t *testing.T) {
	items := []domain.ManualFoodResult{
		{ID: "catalog:牛奶", Source: "nutrition_library", SourceLabel: "常用食物", Title: "牛奶", UsageCount: 120},
		{ID: "catalog:牛奶片", Source: "nutrition_library", SourceLabel: "常用食物", Title: "牛奶片", UsageCount: 40},
		{ID: "p1", Source: "packaged_food", Title: "蒙牛 纯牛奶", SearchName: "纯牛奶", SearchOrder: 0},
		{ID: "p2", Source: "packaged_food", Title: "伊利 纯牛奶", SearchName: "纯牛奶", SearchOrder: 1},
		{ID: "p3", Source: "packaged_food", Title: "光明 鲜牛奶", SearchName: "鲜牛奶", SearchOrder: 2},
		{ID: "p4", Source: "packaged_food", Title: "特仑苏 纯牛奶", SearchName: "纯牛奶", SearchOrder: 3},
	}
	guest := manualTitles(rankManualFoodResults(items, "牛奶", true, false))
	require.Equal(t, []string{"蒙牛 纯牛奶", "伊利 纯牛奶", "光明 鲜牛奶", "牛奶", "特仑苏 纯牛奶", "牛奶片"}, guest,
		"a guest's frequent foods come from everyone's records and do not jump the queue")
	user := rankManualFoodResults(items, "牛奶", true, true)
	require.Equal(t, "catalog:牛奶", user[0].ID, "for a signed-in user the same row is their own history")
}

func TestRankManualFoodResultsKeepsOwnFoodsFirst(t *testing.T) {
	items := []domain.ManualFoodResult{
		{ID: "s1", Source: "nutrition_library", Title: "米饭", SearchExact: true},
		{ID: "own", Source: "custom", CanEdit: true, Title: "我家的米饭"},
		{ID: "shared", Source: "custom", CanEdit: false, Title: "别人的米饭"},
		{ID: "recent", Source: "nutrition_library", Title: "糙米饭", UsageCount: 3},
	}
	got := rankManualFoodResults(items, "米饭", false, true)
	require.Equal(t, "recent", got[0].ID, "foods the user logged come first, most used first")
	require.Equal(t, "own", got[1].ID)
	require.Equal(t, "s1", got[2].ID)
	require.Equal(t, "shared", got[3].ID, "other users' shared foods are not personal")
}
