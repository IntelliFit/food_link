package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/testdb"

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
		"items": []map[string]any{{"name": "番茄炒饭", "micronutrient_analysis": "ai_precise_v1", "nutrients": map[string]any{
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

func TestUpdatePublishedItemSyncsMetadataWithoutChangingNutrition(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))

	originalPrice := 12.0
	updatedPrice := 15.0
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", AreaName: "校本部", CanteenName: "紫荆园", Floor: "1F", WindowName: "炒饭窗口",
		PriceType: "fixed", Price: &originalPrice, PriceUnit: "元/份", PortionDescription: "1份",
		ImagePaths: []string{"campus-food/old.jpg"}, CompletenessStatus: "complete", Status: "published",
		PublishedAt: &now, UpdatedAt: &now,
	}
	require.NoError(t, db.Create(item).Error)
	publicItem := &publishedCatalogItem{
		ID: item.ID, FoodName: item.Name, ImagePaths: item.ImagePaths, Status: "published", Type: "campus",
		TotalCalories: 420, TotalProtein: 12, TotalCarbs: 68, TotalFat: 11,
		Items:      []map[string]any{{"name": "番茄炒饭", "micronutrient_analysis": "ai_precise_v1"}},
		SchoolName: item.OrganizationName, CampusName: item.AreaName, CanteenName: item.CanteenName,
		Floor: item.Floor, WindowName: item.WindowName, Price: &originalPrice, PriceType: "fixed",
		PriceUnit: item.PriceUnit, PortionDescription: item.PortionDescription, PublishedAt: &now, UpdatedAt: &now,
		IsCampusFood: true,
	}
	require.NoError(t, db.Create(publicItem).Error)

	item.Name = "西红柿炒饭"
	item.Description = "名称和价格已人工复核"
	item.Price = &updatedPrice
	item.PriceUnit = "元/例"
	item.PortionDescription = "1例"
	item.ImagePaths = []string{"campus-food/new.jpg"}
	item.UpdatedAt = timePtr(now.Add(time.Hour))

	require.NoError(t, NewCatalogRepo(db).UpdateItem(context.Background(), item))

	var saved publishedCatalogItem
	require.NoError(t, db.First(&saved, "id = ?", item.ID).Error)
	require.Equal(t, "西红柿炒饭", saved.FoodName)
	require.Equal(t, "名称和价格已人工复核", saved.Description)
	require.Equal(t, updatedPrice, *saved.Price)
	require.Equal(t, "元/例", saved.PriceUnit)
	require.Equal(t, "1例", saved.PortionDescription)
	require.Equal(t, []string{"campus-food/new.jpg"}, saved.ImagePaths)
	require.Equal(t, 420.0, saved.TotalCalories)
	require.Equal(t, 12.0, saved.TotalProtein)
	require.Equal(t, 68.0, saved.TotalCarbs)
	require.Equal(t, 11.0, saved.TotalFat)
	require.Equal(t, "published", saved.Status)
}

func TestUpdatePublishedItemRollsBackWhenPublicSnapshotIsMissing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))

	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "旧名称",
		OrganizationName: "清华大学", CanteenName: "紫荆园", Status: "published",
	}
	require.NoError(t, db.Create(item).Error)
	item.Name = "新名称"

	err = NewCatalogRepo(db).UpdateItem(context.Background(), item)

	require.ErrorContains(t, err, "published campus item")
	var saved domain.CatalogItem
	require.NoError(t, db.First(&saved, "id = ?", item.ID).Error)
	require.Equal(t, "旧名称", saved.Name)
}

func TestUpdatePublishedItemPreservesAnalyzedDescriptionOnPriceOnlyEdit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))

	oldPrice, newPrice := 12.0, 13.0
	now := time.Now()
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", Status: "published",
		PriceType: "fixed", Price: &oldPrice, PriceUnit: "元/份", PublishedAt: &now, UpdatedAt: &now,
	}
	require.NoError(t, db.Create(item).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{
		ID: item.ID, FoodName: item.Name, Status: "published", Type: "campus", Description: "AI 生成的营养说明",
		ImagePaths: []string{}, Price: &oldPrice, PriceType: "fixed", PriceUnit: "元/份",
		TotalCalories: 420, Items: []map[string]any{{"name": item.Name}}, PublishedAt: &now, UpdatedAt: &now,
	}).Error)
	item.Price = &newPrice
	item.Description = ""

	require.NoError(t, NewCatalogRepo(db).UpdateItem(context.Background(), item))

	var saved publishedCatalogItem
	require.NoError(t, db.First(&saved, "id = ?", item.ID).Error)
	require.Equal(t, "AI 生成的营养说明", saved.Description)
	require.Equal(t, newPrice, *saved.Price)
}

func timePtr(value time.Time) *time.Time { return &value }

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

func TestCompleteAnalyzedItemRejectsResultWithoutPreciseMicronutrients(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "普通分析菜品",
		OrganizationName: "测试大学", CanteenName: "一食堂", Status: "analysis_pending",
	}
	require.NoError(t, db.Create(item).Error)
	repo := NewCatalogRepo(db)

	err = repo.CompleteAnalyzedItem(context.Background(), item.ID, "task-macro-only", map[string]any{
		"items": []map[string]any{{"name": "普通分析菜品", "nutrients": map[string]any{
			"calories": 320.0, "protein": 10.0, "carbs": 48.0, "fat": 8.0,
		}}},
	}, time.Now())

	require.ErrorContains(t, err, "微量营养")
	var publicCount int64
	require.NoError(t, db.Table("public_food_library").Where("id = ?", item.ID).Count(&publicCount).Error)
	require.Zero(t, publicCount)
}

func TestListPublishedItemsMissingNutritionOnlyReturnsInvalidPublicRows(t *testing.T) {
	db := testdb.New(t)
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
	require.Len(t, items, 1, "只有宏量营养的历史校园菜品仍须补做精确微量分析")

	preciseItems := []map[string]any{{
		"name": "历史菜品", "micronutrient_analysis": "ai_precise_v1", "micronutrient_source": "qwen_generated",
		"nutrients": map[string]any{"fiber": 1.0, "sodiumMg": 100.0, "potassiumMg": 200.0, "calciumMg": 20.0},
	}}
	preciseItemsJSON, err := json.Marshal(preciseItems)
	require.NoError(t, err)
	require.NoError(t, db.Model(&publishedCatalogItem{}).Where("id = ?", item.ID).Update("items", string(preciseItemsJSON)).Error)
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

func TestGetAnalysisProgressCountsCatalogStates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}))
	batchID := uuid.NewString()
	statuses := []string{"published", "published", "analysis_pending", "analysis_failed", "draft", "deleted"}
	for index, status := range statuses {
		require.NoError(t, db.Create(&domain.CatalogItem{
			ID: uuid.NewString(), BatchID: batchID, EntryType: "dish", Name: fmt.Sprintf("菜品%d", index),
			OrganizationName: "测试大学", CanteenName: "一食堂", Status: status,
		}).Error)
	}

	progress, err := NewCatalogRepo(db).GetAnalysisProgress(context.Background())
	require.NoError(t, err)
	require.Equal(t, int64(5), progress.Total)
	require.Equal(t, int64(4), progress.AnalyzableTotal)
	require.Equal(t, int64(2), progress.Completed)
	require.Equal(t, int64(1), progress.StatusCounts["analysis_pending"])
	require.Equal(t, 50.0, progress.CompletedPercent)
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
	require.Equal(t, "pending", invalidSaved.Status)
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

func TestLegacyTerminalAnalysisCandidatesCanBeClaimedOnlyOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &analyzedomain.AnalysisTask{}))
	batchID := uuid.NewString()
	legacyPending := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: batchID, EntryType: "dish", Name: "旧任务菜品",
		OrganizationName: "测试大学", CanteenName: "一食堂", Status: "analysis_pending",
	}
	legacyFailed := legacyPending
	legacyFailed.ID, legacyFailed.Name, legacyFailed.Status = uuid.NewString(), "旧失败菜品", "analysis_failed"
	currentFailed := legacyPending
	currentFailed.ID, currentFailed.Name, currentFailed.Status = uuid.NewString(), "新路径失败菜品", "analysis_failed"
	for _, fixture := range []struct {
		item     *domain.CatalogItem
		taskType string
		status   string
	}{
		{&legacyPending, "precision_plan", "done"},
		{&legacyFailed, "precision_aggregate", "failed"},
		{&currentFailed, "food_text", "failed"},
	} {
		taskID := uuid.NewString()
		fixture.item.AnalysisTaskID = &taskID
		require.NoError(t, db.Create(fixture.item).Error)
		require.NoError(t, db.Create(&analyzedomain.AnalysisTask{
			ID: taskID, UserID: "system", TaskType: fixture.taskType, Status: fixture.status,
			Payload: map[string]any{}, Result: map[string]any{},
		}).Error)
	}
	repo := NewCatalogRepo(db)

	candidates, err := repo.ListLegacyTerminalAnalysisCandidates(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, candidates, 2)

	claimed, err := repo.ClaimLegacyAnalysisRetry(context.Background(), legacyPending.ID, *legacyPending.AnalysisTaskID, "切换到普通分析路径", time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
	claimed, err = repo.ClaimLegacyAnalysisRetry(context.Background(), legacyPending.ID, *legacyPending.AnalysisTaskID, "重复抢占", time.Now())
	require.NoError(t, err)
	require.False(t, claimed)

	var saved domain.CatalogItem
	require.NoError(t, db.First(&saved, "id = ?", legacyPending.ID).Error)
	require.Equal(t, "analysis_failed", saved.Status)
	require.Nil(t, saved.AnalysisTaskID)
	require.Contains(t, saved.AnalysisError, "普通分析")
}

func TestCurrentTerminalAndOrphanAnalysisCandidatesConvergeSafely(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &analyzedomain.AnalysisTask{}))

	doneTaskID := uuid.NewString()
	legacyTaskID := uuid.NewString()
	staleStartedAt := time.Now().Add(-20 * time.Minute)
	doneItem := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "旧结果菜品",
		Status: "analysis_pending", AnalysisTaskID: &doneTaskID,
	}
	orphanItem := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "无任务菜品",
		Status: "analysis_pending", AnalysisStartedAt: &staleStartedAt, CreatedAt: &staleStartedAt, UpdatedAt: &staleStartedAt,
	}
	legacyItem := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "旧链路菜品",
		Status: "analysis_pending", AnalysisTaskID: &legacyTaskID,
	}
	require.NoError(t, db.Create(&[]domain.CatalogItem{doneItem, orphanItem, legacyItem}).Error)
	require.NoError(t, db.Create(&[]analyzedomain.AnalysisTask{
		{
			ID: doneTaskID, UserID: "system", TaskType: "food_text", Status: "done",
			Payload: map[string]any{"campus_catalog_item_id": doneItem.ID, "internal_benchmark": true}, Result: map[string]any{"items": []any{map[string]any{"name": doneItem.Name}}},
		},
		{
			ID: legacyTaskID, UserID: "system", TaskType: "precision_plan", Status: "done",
			Payload: map[string]any{"campus_catalog_item_id": legacyItem.ID}, Result: map[string]any{},
		},
	}).Error)
	repo := NewCatalogRepo(db)

	candidates, err := repo.ListCurrentTerminalAnalysisCandidates(context.Background(), 100)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	require.Equal(t, doneItem.ID, candidates[0].Item.ID)

	claimed, err := repo.MarkCurrentTerminalAnalysisFailed(context.Background(), doneItem.ID, doneTaskID, "结果不完整", time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
	claimed, err = repo.MarkCurrentTerminalAnalysisFailed(context.Background(), doneItem.ID, doneTaskID, "重复收敛", time.Now())
	require.NoError(t, err)
	require.False(t, claimed)

	staleBefore := time.Now().Add(-10 * time.Minute)
	orphanPendingCount, err := repo.CountOrphanPendingAnalysisCandidates(context.Background(), staleBefore)
	require.NoError(t, err)
	require.Equal(t, int64(1), orphanPendingCount)
	orphans, err := repo.ListOrphanAnalysisCandidates(context.Background(), staleBefore, 20)
	require.NoError(t, err)
	require.Len(t, orphans, 1)
	require.Equal(t, orphanItem.ID, orphans[0].ID)
	claimed, err = repo.ClaimOrphanAnalysis(context.Background(), orphanItem.ID, nil, staleBefore, "任务缺失", time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
	orphans, err = repo.ListOrphanAnalysisCandidates(context.Background(), staleBefore, 20)
	require.NoError(t, err)
	require.Empty(t, orphans, "刚抢占的记录不能在同一安全窗口内重复提交")
	recoveryCutoff := time.Now().Add(time.Minute)
	orphans, err = repo.ListOrphanAnalysisCandidates(context.Background(), recoveryCutoff, 20)
	require.NoError(t, err)
	require.Len(t, orphans, 1, "提交失败冷却后，analysis_failed 无任务记录必须仍可恢复")
	claimed, err = repo.ClaimOrphanAnalysis(context.Background(), orphanItem.ID, nil, recoveryCutoff, "重复抢占", time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
}

func TestPostgresCandidateQueriesComparePayloadTextWithCatalogUUID(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &analyzedomain.AnalysisTask{}))
	itemID := uuid.NewString()
	taskID := uuid.NewString()
	item := domain.CatalogItem{
		ID: itemID, BatchID: uuid.NewString(), EntryType: "dish", Name: "UUID 对账菜品",
		Status: "analysis_pending", AnalysisTaskID: &taskID,
	}
	task := analyzedomain.AnalysisTask{
		ID: taskID, UserID: "system", TaskType: "food_text", Status: "done",
		Payload: map[string]any{"campus_catalog_item_id": "历史错误值", "internal_benchmark": true}, Result: map[string]any{"items": []any{}},
	}
	require.NoError(t, db.Create(&item).Error)
	require.NoError(t, db.Create(&task).Error)
	repo := NewCatalogRepo(db)

	current, err := repo.ListCurrentTerminalAnalysisCandidates(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, current, 1)

	require.NoError(t, db.Model(&domain.CatalogItem{}).Where("id = ?", itemID).Update("status", "analysis_failed").Error)
	require.NoError(t, db.Model(&analyzedomain.AnalysisTask{}).Where("id = ?", taskID).Update("status", "failed").Error)
	failed, err := repo.ListFailedAnalysisRetryCandidates(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, failed, 1)
}

func TestFailedAnalysisRetryCandidatesExcludeTasksAlreadyRetried(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &analyzedomain.AnalysisTask{}))

	firstTaskID := uuid.NewString()
	alreadyRetriedTaskID := uuid.NewString()
	items := []domain.CatalogItem{
		{ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "首次失败", Status: "analysis_failed", AnalysisTaskID: &firstTaskID, AnalysisError: "原始模型超时"},
		{ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "重试仍失败", Status: "analysis_failed", AnalysisTaskID: &alreadyRetriedTaskID},
	}
	require.NoError(t, db.Create(&items).Error)
	require.NoError(t, db.Create(&[]analyzedomain.AnalysisTask{
		{ID: firstTaskID, UserID: "system", TaskType: "food_text", Status: "done", Payload: map[string]any{"campus_catalog_item_id": "历史错误值", "internal_benchmark": true}},
		{ID: alreadyRetriedTaskID, UserID: "system", TaskType: "food_text", Status: "failed", Payload: map[string]any{"campus_catalog_item_id": items[1].ID, "internal_benchmark": true, "retry_source_task_id": "source-task"}},
	}).Error)
	retryTaskID := uuid.NewString()
	require.NoError(t, db.Create(&analyzedomain.AnalysisTask{
		ID: retryTaskID, UserID: "system", TaskType: "food_text", Status: "cancelled",
		Payload: map[string]any{"campus_catalog_item_id": items[0].ID, "retry_source_task_id": firstTaskID, "internal_retry_prepared": true},
	}).Error)
	repo := NewCatalogRepo(db)

	candidates, err := repo.ListFailedAnalysisRetryCandidates(context.Background(), 20)

	require.NoError(t, err)
	require.Len(t, candidates, 1)
	require.Equal(t, items[0].ID, candidates[0].ID)

	claimed, err := repo.ActivatePreparedAnalysisRetry(context.Background(), items[0].ID, firstTaskID, uuid.NewString(), time.Now())
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.False(t, claimed)
	var unchanged domain.CatalogItem
	require.NoError(t, db.First(&unchanged, "id = ?", items[0].ID).Error)
	require.Equal(t, "analysis_failed", unchanged.Status)
	require.NotNil(t, unchanged.AnalysisTaskID)
	require.Equal(t, firstTaskID, *unchanged.AnalysisTaskID)

	claimed, err = repo.ActivatePreparedAnalysisRetry(context.Background(), items[0].ID, firstTaskID, retryTaskID, time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
	claimed, err = repo.ActivatePreparedAnalysisRetry(context.Background(), items[0].ID, firstTaskID, uuid.NewString(), time.Now())
	require.NoError(t, err)
	require.False(t, claimed)
	var saved domain.CatalogItem
	require.NoError(t, db.First(&saved, "id = ?", items[0].ID).Error)
	require.Equal(t, "analysis_pending", saved.Status)
	require.NotNil(t, saved.AnalysisTaskID)
	require.Equal(t, retryTaskID, *saved.AnalysisTaskID)
	require.Equal(t, "原始模型超时", saved.AnalysisError)
	var activatedTask analyzedomain.AnalysisTask
	require.NoError(t, db.First(&activatedTask, "id = ?", retryTaskID).Error)
	require.Equal(t, "pending", activatedTask.Status)
}
