package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/marketingqr/catalog"
	"food_link/backend/internal/marketingqr/domain"
	publicfooddomain "food_link/backend/internal/publicfood/domain"
)

func TestLandingUsesEstimatedProductCatalog(t *testing.T) {
	dataset := catalog.DatasetSnapshot()
	product := dataset.Products[0]
	service := NewMarketingQRService(nil, nil)

	landing, err := service.Landing(context.Background(), product.Code)
	if err != nil {
		t.Fatalf("Landing() error = %v", err)
	}
	if landing.Kind != "product" || landing.Title != product.Name {
		t.Fatalf("商品落地页不匹配: %+v", landing)
	}
	if landing.Nutrition == nil || landing.Nutrition.CaloriesKcal <= 0 {
		t.Fatalf("商品落地页缺少营养估算: %+v", landing)
	}
	if !landing.LocationIsEstimated || landing.NutritionNotice == "" {
		t.Fatalf("估算边界未明确展示: %+v", landing)
	}
}

func TestLandingSupportsUnifiedTakeoutCode(t *testing.T) {
	service := NewMarketingQRService(nil, nil)
	landing, err := service.Landing(context.Background(), catalog.TakeoutCode)
	if err != nil {
		t.Fatalf("Landing() error = %v", err)
	}
	if landing.Kind != "takeout" || landing.Code != catalog.TakeoutCode {
		t.Fatalf("统一外卖落地页不匹配: %+v", landing)
	}
}

func TestLandingRejectsUnknownCode(t *testing.T) {
	service := NewMarketingQRService(nil, nil)
	if _, err := service.Landing(context.Background(), "missing"); err == nil {
		t.Fatal("未知二维码短码应返回错误")
	}
}

func TestApplyPublicFoodOverrideKeepsEstimateFlagsUntilVerified(t *testing.T) {
	lat, lng := 43.894229, 125.280655
	landing := &domain.Landing{
		LocationIsEstimated: true,
		NutritionNotice:     "营养数据为临时估算。",
		DataVersion:         "estimate-v1",
	}
	applyPublicFoodOverride(landing, &publicfooddomain.PublicFoodItem{
		ID: "food-1", Latitude: &lat, Longitude: &lng,
		TotalCalories: 200, NutritionStatus: "pending",
	}, nil)
	if !landing.LocationIsEstimated || landing.NutritionNotice != "营养数据为临时估算。" || landing.DataVersion != "estimate-v1" {
		t.Fatalf("未核验公共库数据不应伪装为已核验: %+v", landing)
	}

	verifiedAt := time.Now()
	applyPublicFoodOverride(landing, &publicfooddomain.PublicFoodItem{
		ID: "food-1", Latitude: &lat, Longitude: &lng,
		TotalCalories: 210, NutritionStatus: "current", NutritionVersion: 2, LastVerifiedAt: &verifiedAt,
	}, nil)
	if landing.LocationIsEstimated || landing.DataVersion != "public-food-2" {
		t.Fatalf("已核验公共库数据应替换估算标记: %+v", landing)
	}
}
