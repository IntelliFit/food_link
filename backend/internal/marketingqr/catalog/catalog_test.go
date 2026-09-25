package catalog

import (
	"testing"

	"github.com/google/uuid"
)

func TestSanshengxiaoCatalog(t *testing.T) {
	dataset := DatasetSnapshot()
	if got, want := len(dataset.Products), 73; got != want {
		t.Fatalf("商品数量 = %d，期望 %d", got, want)
	}
	if dataset.MerchantName != "三生晓" {
		t.Fatalf("商家名称 = %q", dataset.MerchantName)
	}
	if !dataset.LocationIsEstimated {
		t.Fatal("首版门店坐标应明确标记为估算")
	}

	seen := make(map[string]struct{}, len(dataset.Products))
	for _, product := range dataset.Products {
		if product.Code == "" || product.ImageKey == "" || product.PortionDescription == "" {
			t.Fatalf("商品基础字段不完整: %+v", product)
		}
		if product.Nutrition.CaloriesKcal <= 0 {
			t.Fatalf("商品缺少临时营养估算: %s", product.Name)
		}
		if _, exists := seen[product.Code]; exists {
			t.Fatalf("商品短码重复: %s", product.Code)
		}
		seen[product.Code] = struct{}{}
		if got, ok := ProductByCode(product.Code); !ok || got.ExternalID != product.ExternalID {
			t.Fatalf("无法按短码回查商品: %s", product.Code)
		}
	}

	if got, want := len(Codes()), 74; got != want {
		t.Fatalf("二维码短码数量 = %d，期望 %d", got, want)
	}
	if !IsKnownCode(TakeoutCode) {
		t.Fatal("统一外卖包装短码未注册")
	}
}

func TestPublicFoodItemIDIsStableAndUnique(t *testing.T) {
	seen := make(map[string]string, len(DatasetSnapshot().Products))
	for _, product := range DatasetSnapshot().Products {
		id, ok := PublicFoodItemID(product.Code)
		if !ok {
			t.Fatalf("商品 %s 未生成公共食物库 ID", product.Code)
		}
		if _, err := uuid.Parse(id); err != nil {
			t.Fatalf("商品 %s 的公共食物库 ID 非法: %v", product.Code, err)
		}
		if previous, exists := seen[id]; exists {
			t.Fatalf("公共食物库 ID 重复: %s 和 %s", previous, product.Code)
		}
		seen[id] = product.Code
		second, _ := PublicFoodItemID(product.Code)
		if second != id {
			t.Fatalf("商品 %s 的公共食物库 ID 不稳定", product.Code)
		}
	}
	if _, ok := PublicFoodItemID(TakeoutCode); ok {
		t.Fatal("统一外卖包装码不应生成公共食物库商品")
	}
}
