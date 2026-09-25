package service

import (
	"context"
	"testing"

	"food_link/backend/internal/marketingqr/catalog"
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
