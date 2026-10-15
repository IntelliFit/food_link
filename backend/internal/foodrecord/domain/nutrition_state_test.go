package domain

import "testing"

func TestInferAuthoritativeNutritionStateOnlyUsesExplicitSourceDescriptions(t *testing.T) {
	for _, c := range []struct {
		name, source, state, basis string
		ok                         bool
	}{
		{"Rice, white, long-grain, raw", "USDA FoodData Central", "raw", "dry_raw", true},
		{"Rice, white, cooked", "USDA FoodData Central", "cooked", "cooked_edible", true},
		{"Chicken, breast, meat only, raw", "美国农业部食物数据中心（SR Legacy）", "raw", "raw_edible", true},
		{"Chicken, breast, meat only, cooked, roasted", "USDA", "baked", "cooked_edible", true},
		{"Mushrooms, dried", "USDA", "dehydrated", "dry", true},
		{"Chicken, raw or cooked", "USDA", "", "", false},
		{"卤鸭腿", "历史识别记录营养均值", "", "", false},
		{"Baking powder", "USDA", "", "", false},
		{"Chicken breast", "USDA", "", "", false},
		{"Seeds, sesame butter, tahini, from raw and stone ground kernels", "USDA", "", "", false},
		{"Soup, with cooked rice", "USDA", "", "", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, ok := InferAuthoritativeNutritionState(c.name, c.source)
			if ok != c.ok || got.FoodState != c.state || got.WeightBasis != c.basis {
				t.Fatalf("got %+v/%v", got, ok)
			}
		})
	}
}
