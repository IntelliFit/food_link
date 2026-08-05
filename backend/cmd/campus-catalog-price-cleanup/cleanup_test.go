package main

import (
	"context"
	"testing"

	"food_link/backend/internal/campuscatalog/domain"
	publicfooddomain "food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNormalizeBareSellingUnit(t *testing.T) {
	price := 12.0
	item := completeItem()
	item.Price = &price
	item.PriceUnit = "支"
	item.PriceText = "12元/支"

	updated, candidate, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "元/支", updated.PriceUnit)
	require.Equal(t, "元/支", candidate.NormalizedUnit)
	require.Equal(t, item.PortionDescription, updated.PortionDescription)
	require.Equal(t, item.Price, updated.Price)
}

func TestNormalizeUnitUsesCleanPriceTextUnit(t *testing.T) {
	price := 14.0
	item := completeItem()
	item.Price = &price
	item.PriceUnit = "份。【待确认：挂牌价格被反光遮挡】"
	item.PriceText = "14元/份。【待确认：挂牌价格被反光遮挡】"

	updated, _, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "元/份", updated.PriceUnit)
}

func TestNormalizeKeepsCanonicalUnit(t *testing.T) {
	price := 14.0
	item := completeItem()
	item.Price = &price
	item.PriceUnit = "元/份"
	item.PriceText = "14元/份"

	updated, _, ok := cleanCatalogPrice(item)
	require.False(t, ok)
	require.Equal(t, item, updated)
}

func TestNormalizeKeepsPortionSeparate(t *testing.T) {
	price := 5.0
	item := completeItem()
	item.Price = &price
	item.PriceUnit = "杯/瓶"
	item.PriceText = "5元/杯/瓶"
	item.PortionDescription = "每份500ml"

	updated, _, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "元/杯/瓶", updated.PriceUnit)
	require.Equal(t, "每份500ml", updated.PortionDescription)
}

func TestAuditDetectsNumericMismatch(t *testing.T) {
	price := 12.0
	item := completeItem()
	item.Price = &price
	item.PriceUnit = "份"
	item.PriceText = "14元/份"

	require.Equal(t, []string{"数值价格与原文不一致"}, auditPriceIssues(item))
}

func TestAuditAcceptsRangeAmounts(t *testing.T) {
	minPrice, maxPrice := 18.0, 35.0
	item := completeItem()
	item.Price = nil
	item.PriceMin = &minPrice
	item.PriceMax = &maxPrice
	item.PriceType = "range"
	item.PriceUnit = "杯"
	item.PriceText = "18 元/杯；35 元/壶"

	require.Empty(t, auditPriceIssues(item))
}

func TestCleanupRepairsQuantityMisreadAsRangeBound(t *testing.T) {
	minPrice, maxPrice := 6.0, 24.0
	item := completeItem()
	item.Price = nil
	item.PriceMin = &minPrice
	item.PriceMax = &maxPrice
	item.PriceType = "range"
	item.PriceUnit = "份"
	item.PriceText = "24元/份，6个（一份起售）"

	updated, candidate, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "fixed", updated.PriceType)
	require.NotNil(t, updated.Price)
	require.Equal(t, 24.0, *updated.Price)
	require.Nil(t, updated.PriceMin)
	require.Nil(t, updated.PriceMax)
	require.Equal(t, "元/份", updated.PriceUnit)
	require.Equal(t, "6个", updated.PortionDescription)
	require.Contains(t, candidate.Reason, "价格区间混入起售数量或克重")
}

func TestCleanupRepairsWeightMisreadAsRangeBound(t *testing.T) {
	minPrice, maxPrice := 138.0, 500.0
	item := completeItem()
	item.Price = nil
	item.PriceMin = &minPrice
	item.PriceMax = &maxPrice
	item.PriceType = "by_weight"
	item.PriceUnit = "斤（500g）"
	item.PriceText = "138元/斤（500g）"

	updated, _, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "by_weight", updated.PriceType)
	require.NotNil(t, updated.Price)
	require.Equal(t, 138.0, *updated.Price)
	require.Equal(t, "500g", updated.PortionDescription)
}

func TestCleanupAddsCurrencyMarkerToNumericCombo(t *testing.T) {
	price := 8.0
	item := completeItem()
	item.Price = &price
	item.PriceType = "combo"
	item.PriceText = "原文列出多个套餐价位，未注明规格"

	updated, _, ok := cleanCatalogPrice(item)
	require.True(t, ok)
	require.Equal(t, "8元；原文列出多个套餐价位，未注明规格", updated.PriceText)
	require.Equal(t, "元", updated.PriceUnit)
}

func TestAuditPublishedNutritionFlagsMissingAnalysisAndCalories(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publicfooddomain.PublicFoodItem{}))
	item := completeItem()
	item.Status = "published"
	require.NoError(t, db.Create(&item).Error)
	require.NoError(t, db.Create(&publicfooddomain.PublicFoodItem{
		ID: item.ID, FoodName: item.Name, Status: "published", IsCampusFood: true,
	}).Error)
	report := auditReport{NutritionIssueCounts: map[string]int{}, NutritionIssueItems: []nutritionIssue{}}

	require.NoError(t, auditPublishedNutrition(context.Background(), db, &report))
	require.Len(t, report.NutritionIssueItems, 1)
	require.Equal(t, 1, report.NutritionIssueCounts["已上线菜品缺少AI分析任务"])
	require.Equal(t, 1, report.NutritionIssueCounts["已上线菜品缺少有效热量"])
}

func completeItem() domain.CatalogItem {
	return domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Name: "测试菜品", OrganizationName: "测试大学", CanteenName: "测试食堂",
		PriceType: "fixed", ImagePaths: []string{"campus-food/test.jpg"}, MissingFields: []string{}, CompletenessStatus: "complete", Status: "draft",
	}
}
