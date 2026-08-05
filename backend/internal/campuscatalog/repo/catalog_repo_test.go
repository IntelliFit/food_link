package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicPriceTypeMapsCatalogEnums(t *testing.T) {
	require.Equal(t, "fixed", publicPriceType("fixed"))
	require.Equal(t, "weight", publicPriceType("by_weight"))
	require.Equal(t, "unknown", publicPriceType("freeform"))
}

func TestCompleteAnalyzedItemPublishesNutritionAndCatalogAtomically(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))

	price := 12.0
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", PriceType: "fixed", Price: &price,
		PriceUnit: "元/份", ImagePaths: []string{"campus-food/rice.jpg"}, CompletenessStatus: "complete", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	repo := NewCatalogRepo(db)
	completedAt := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)

	require.NoError(t, repo.CompleteAnalyzedItem(context.Background(), item.ID, "task-1", map[string]any{
		"description": "一份番茄炒饭",
		"items": []map[string]any{{"name": "番茄炒饭", "nutrients": map[string]any{
			"calories": 420.0, "protein": 12.0, "carbs": 68.0, "fat": 11.0,
		}}},
	}, completedAt))

	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "published", publicItem.Status)
	require.Equal(t, 420.0, publicItem.TotalCalories)
	require.Equal(t, 12.0, publicItem.TotalProtein)
	require.Equal(t, "task-1", *publicItem.AnalysisTaskID)

	var catalog domain.CatalogItem
	require.NoError(t, db.First(&catalog, "id = ?", item.ID).Error)
	require.Equal(t, "published", catalog.Status)
	require.Equal(t, "task-1", *catalog.AnalysisTaskID)
	require.NotNil(t, catalog.AnalysisCompletedAt)
}

func TestCompleteAnalyzedItemRejectsEmptyNutritionWithoutPublishing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "未知菜品",
		OrganizationName: "清华大学", CanteenName: "紫荆园", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	repo := NewCatalogRepo(db)

	err = repo.CompleteAnalyzedItem(context.Background(), item.ID, "task-empty", map[string]any{"items": []map[string]any{}}, time.Now())

	require.Error(t, err)
	var publicCount int64
	require.NoError(t, db.Table("public_food_library").Where("id = ?", item.ID).Count(&publicCount).Error)
	require.Zero(t, publicCount)
}

func TestListPublishedItemsMissingNutritionOnlyReturnsInvalidPublicRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "历史菜品",
		OrganizationName: "北京大学", CanteenName: "家园食堂", Status: "published",
	}
	require.NoError(t, db.Create(item).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{ID: item.ID, FoodName: item.Name, Status: "published", IsCampusFood: true}).Error)
	repo := NewCatalogRepo(db)

	items, err := repo.ListPublishedItemsMissingNutrition(context.Background(), 100)
	require.NoError(t, err)
	require.Len(t, items, 1)

	taskID := uuid.NewString()
	require.NoError(t, db.Model(&publishedCatalogItem{}).Where("id = ?", item.ID).
		Updates(map[string]any{"analysis_task_id": taskID, "total_calories": 320.0}).Error)
	items, err = repo.ListPublishedItemsMissingNutrition(context.Background(), 100)
	require.NoError(t, err)
	require.Empty(t, items)
}

func TestListItemsFiltersHierarchyAndHydratesClientNutrition(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	windowID, otherWindowID := uuid.NewString(), uuid.NewString()
	item := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "鸡蛋饼",
		SchoolID: &schoolID, CampusID: &campusID, CanteenID: &canteenID, WindowID: &windowID,
		OrganizationName: "测试大学", CanteenName: "一食堂", Status: "published",
	}
	other := item
	other.ID, other.WindowID, other.Name = uuid.NewString(), &otherWindowID, "咖喱炒饭"
	require.NoError(t, db.Create(&item).Error)
	require.NoError(t, db.Create(&other).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{
		ID: item.ID, FoodName: item.Name, Status: "published", IsCampusFood: true,
		TotalCalories: 320, TotalProtein: 12, TotalCarbs: 42, TotalFat: 9,
	}).Error)

	items, total, err := NewCatalogRepo(db).ListItems(context.Background(), domain.CatalogItemFilter{
		SchoolID: schoolID, CanteenID: canteenID, WindowID: windowID, Limit: 50,
	})

	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, item.ID, items[0].ID)
	require.Equal(t, "published", items[0].ClientStatus)
	require.NotNil(t, items[0].TotalCalories)
	require.Equal(t, 320.0, *items[0].TotalCalories)
}

func TestSoftDeleteItemAlsoHidesClientVersion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	item := domain.CatalogItem{ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "待删除菜品", OrganizationName: "测试大学", CanteenName: "一食堂", Status: "published"}
	require.NoError(t, db.Create(&item).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{ID: item.ID, FoodName: item.Name, Status: "published", IsCampusFood: true}).Error)

	require.NoError(t, NewCatalogRepo(db).SoftDeleteItem(context.Background(), item.ID))

	var catalog domain.CatalogItem
	var publicItem publishedCatalogItem
	require.NoError(t, db.Unscoped().First(&catalog, "id = ?", item.ID).Error)
	require.NoError(t, db.Unscoped().First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "deleted", catalog.Status)
	require.Equal(t, "deleted", publicItem.Status)
}

func TestHidePublicItemForNutritionBackfillOnlyHidesInvalidVersion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&publishedCatalogItem{}))
	invalid := &publishedCatalogItem{ID: uuid.NewString(), FoodName: "零营养旧数据", Status: "published", TotalCalories: 0}
	taskID := uuid.NewString()
	valid := &publishedCatalogItem{ID: uuid.NewString(), FoodName: "有效旧版", Status: "published", AnalysisTaskID: &taskID, TotalCalories: 360}
	require.NoError(t, db.Create(invalid).Error)
	require.NoError(t, db.Create(valid).Error)
	repo := NewCatalogRepo(db)

	require.NoError(t, repo.HidePublicItemForNutritionBackfill(context.Background(), invalid.ID))
	require.NoError(t, repo.HidePublicItemForNutritionBackfill(context.Background(), valid.ID))

	var invalidSaved, validSaved publishedCatalogItem
	require.NoError(t, db.First(&invalidSaved, "id = ?", invalid.ID).Error)
	require.NoError(t, db.First(&validSaved, "id = ?", valid.ID).Error)
	require.Equal(t, "analysis_pending", invalidSaved.Status)
	require.Equal(t, "published", validSaved.Status)
}

func TestMarkAnalysisFailedPreservesExistingClientVersion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "已上线旧版",
		OrganizationName: "清华大学", CanteenName: "紫荆园", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{
		ID: item.ID, FoodName: item.Name, Status: "published", IsCampusFood: true, TotalCalories: 360,
	}).Error)
	repo := NewCatalogRepo(db)

	require.NoError(t, repo.MarkAnalysisFailed(context.Background(), item.ID, "模型超时", time.Now()))

	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "published", publicItem.Status)
	require.Equal(t, 360.0, publicItem.TotalCalories)
}
