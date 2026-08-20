package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCompleteAnalyzedItemStoresEmptyImagePathsForTextOnlyDish(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CollectionBatch{}, &domain.CatalogItem{}, &publishedCatalogItem{}))

	price := 20.0
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "无图牛肉",
		OrganizationName: "测试大学", CanteenName: "一食堂", PriceType: "fixed", Price: &price,
		Status: "analysis_pending",
	}
	require.NoError(t, db.Create(&domain.CollectionBatch{ID: item.BatchID, VenueType: "university"}).Error)
	require.NoError(t, db.Create(item).Error)

	err = NewCatalogRepo(db).CompleteAnalyzedItem(context.Background(), item.ID, "task-text-only", map[string]any{
		"items": []map[string]any{{"name": item.Name, "micronutrient_analysis": "ai_precise_v1", "nutrients": map[string]any{
			"calories": 280.0, "protein": 24.0, "carbs": 8.0, "fat": 16.0,
		}}},
	}, time.Now())
	require.NoError(t, err)

	var imagePathsIsNull int
	require.NoError(t, db.Raw("SELECT image_paths IS NULL FROM public_food_library WHERE id = ?", item.ID).Scan(&imagePathsIsNull).Error)
	require.Zero(t, imagePathsIsNull, "无图菜品必须保存为空数组，不能写成 SQL NULL")

	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.NotNil(t, publicItem.ImagePaths)
	require.Empty(t, publicItem.ImagePaths)
}
