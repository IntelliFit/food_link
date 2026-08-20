package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsZeroNutritionWaterName(t *testing.T) {
	for _, name := range []string{"百岁山", "三得利", "农夫山泉饮用天然水", "景田矿泉水", "白开水"} {
		require.True(t, isZeroNutritionWaterName(name), name)
	}
	for _, name := range []string{"三得利荷叶茉莉风味饮料", "农夫山泉东方树叶", "雪碧", "番茄炒蛋", ""} {
		require.False(t, isZeroNutritionWaterName(name), name)
	}
}
