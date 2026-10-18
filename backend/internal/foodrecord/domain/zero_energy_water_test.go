package domain

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestZeroEnergyFoodRecognizesBrandedPlainWater(t *testing.T) {
	for _, name := range []string{
		"农夫山泉饮用天然水", "怡宝纯净水", "百岁山天然矿泉水", "依云天然矿泉水", "娃哈哈纯净饮用水",
		"景田饮用纯净水", "康师傅矿物质水", "冰露包装饮用水", "瓶装矿泉水", "屈臣氏蒸馏水", "无糖苏打水",
	} {
		require.True(t, ZeroEnergyFood(name), name)
	}
}

func TestZeroEnergyFoodKeepsSweetenedOrFlavouredWaterOut(t *testing.T) {
	for _, name := range []string{
		"农夫山泉维生素水", "柠檬味苏打水", "蜂蜜柚子水", "电解质水", "水果味气泡水", "含糖苏打水",
		"椰子水", "红豆水", "糖水", "绿豆汤水", "水煮鱼", "水饺", "水蜜桃",
	} {
		require.False(t, ZeroEnergyFood(name), name)
	}
}

func TestValidateFoodNutritionValuesAcceptsZeroCalorieBrandedWater(t *testing.T) {
	require.NoError(t, ValidateFoodNutritionValues("农夫山泉饮用天然水", 550, 0, 0, 0, 0))
	require.Error(t, ValidateFoodNutritionValues("电解质水", 550, 0, 0, 0, 0))
}
