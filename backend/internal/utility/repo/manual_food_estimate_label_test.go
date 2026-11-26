package repo

import (
	"testing"
	"time"

	fooddomain "food_link/backend/internal/foodrecord/domain"
)

func TestManualNutritionResultLabelsEstimates(t *testing.T) {
	reviewed := time.Now()
	cases := []struct {
		name string
		row  fooddomain.FoodNutrition
		want string
	}{
		{"reviewed AI estimate", fooddomain.FoodNutrition{CanonicalName: "卤鸡腿", Source: "qwen_generated", QualityTier: "reviewed_estimate", KcalPer100g: 208}, "估算"},
		{"DeepSeek estimate", fooddomain.FoodNutrition{CanonicalName: "米饭", Source: "AI估算（DeepSeek）", QualityTier: "reviewed_estimate", KcalPer100g: 126}, "估算"},
		{"unreviewed recognition average", fooddomain.FoodNutrition{CanonicalName: "汤面", Source: "历史识别记录营养均值", QualityTier: "legacy_curated", KcalPer100g: 154}, "估算"},
		{"reviewed recognition average", fooddomain.FoodNutrition{CanonicalName: "烤鸭", Source: "历史识别记录营养均值", QualityTier: "legacy_curated", KcalPer100g: 297, QualityReviewedAt: &reviewed}, "标准食物"},
		{"built-in table value", fooddomain.FoodNutrition{CanonicalName: "白米饭", Source: "项目内置初始营养数据", QualityTier: "legacy_curated", KcalPer100g: 116}, "标准食物"},
		{"USDA row", fooddomain.FoodNutrition{CanonicalName: "Bananas, raw", Source: "美国农业部食物数据中心（SR Legacy）", QualityTier: "authoritative", KcalPer100g: 89}, "标准食物"},
	}
	for _, tc := range cases {
		got := manualFoodResultFromNutrition(tc.row, 1)
		if got.SourceLabel != tc.want {
			t.Errorf("%s: label %q, want %q", tc.name, got.SourceLabel, tc.want)
		}
		if tc.want == "估算" && got.Subtitle != "估算值，仅供参考" {
			t.Errorf("%s: subtitle %q", tc.name, got.Subtitle)
		}
	}
}
