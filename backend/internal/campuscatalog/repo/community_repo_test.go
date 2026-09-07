package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type communityTestUser struct {
	ID        string
	Nickname  string
	Telephone string
}

func (communityTestUser) TableName() string { return "weapp_user" }

type communityTestSchool struct{ ID, Name, Status string }

func (communityTestSchool) TableName() string { return "schools" }

type communityTestCampus struct{ ID, SchoolID, Name, Status string }

func (communityTestCampus) TableName() string { return "school_campuses" }

type communityTestCanteen struct{ ID, SchoolID, CampusID, Name, Status string }

func (communityTestCanteen) TableName() string { return "school_canteens" }

func openCommunityRepoDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&domain.CollectionBatch{}, &domain.CatalogItem{}, &domain.Revision{}, &domain.CollectorApplication{}, &domain.CollectorScope{}, &publishedCatalogItem{},
		&communityTestUser{}, &communityTestSchool{}, &communityTestCampus{}, &communityTestCanteen{},
	))
	return db
}

func seedVersionedPublishedItem(t *testing.T, db *gorm.DB) domain.CatalogItem {
	t.Helper()
	now := time.Now()
	batch := domain.CollectionBatch{ID: uuid.NewString(), ClientBatchKey: uuid.NewString(), VenueType: "university", OrganizationName: "示例大学", CanteenName: "第一食堂", Status: "submitted", SourceChannel: "user_single"}
	require.NoError(t, db.Create(&batch).Error)
	price := 10.0
	item := domain.CatalogItem{
		ID: uuid.NewString(), BatchID: batch.ID, EntryType: "dish", Name: "青椒肉丝",
		OrganizationName: "示例大学", AreaName: "主校区", CanteenName: "第一食堂", Floor: "一层",
		PriceType: "fixed", Price: &price, ImagePaths: []string{"campus-food/a.jpg"}, MissingFields: []string{},
		CompletenessStatus: "complete", Status: "published", PublishedAt: &now,
		Version: 2, SourceChannel: "user_single", NutritionVersion: 2, NutritionStatus: "current", AvailabilityStatus: "available",
		CreatedAt: &now, UpdatedAt: &now,
	}
	require.NoError(t, db.Create(&item).Error)
	require.NoError(t, db.Create(&publishedCatalogItem{
		ID: item.ID, FoodName: item.Name, Status: "published", Type: "campus", IsCampusFood: true,
		TotalCalories: 320, TotalProtein: 18, ImagePaths: item.ImagePaths,
		ContentVersion: 2, NutritionVersion: 2, NutritionStatus: "current", AvailabilityStatus: "available",
		CreatedAt: &now, UpdatedAt: &now, PublishedAt: &now,
	}).Error)
	return item
}

func TestApplyRevisionUpdatesCatalogHistoryAndProjectionAtomically(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	newPrice := 12.0
	item.Price = &newPrice
	item.Floor = "二层"
	item.Version = 3
	updatedAt := time.Now()
	item.UpdatedAt = &updatedAt
	revision := domain.Revision{
		ID: uuid.NewString(), CatalogItemID: item.ID, BaseVersion: 2, ResultVersion: 3,
		ActorType: "user", ActorUserID: stringPointerRepo(uuid.NewString()), ActionType: "update",
		BeforeSnapshot: map[string]any{"price": 10.0, "floor": "一层"}, ProposedPatch: map[string]any{"price": 12.0, "floor": "二层"},
		AfterSnapshot: map[string]any{"price": 12.0, "floor": "二层"}, ChangedFields: []string{"floor", "price"}, CreatedAt: &updatedAt,
	}

	repo := NewCatalogRepo(db)
	require.NoError(t, repo.ApplyRevision(context.Background(), &item, &revision))

	var stored domain.CatalogItem
	require.NoError(t, db.First(&stored, "id = ?", item.ID).Error)
	require.Equal(t, int64(3), stored.Version)
	require.Equal(t, "二层", stored.Floor)
	require.Equal(t, 12.0, *stored.Price)

	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, int64(3), publicItem.ContentVersion)
	require.Equal(t, 12.0, *publicItem.Price)
	require.Equal(t, 320.0, publicItem.TotalCalories, "元数据纠错必须保留已有营养快照")

	var revisions []domain.Revision
	require.NoError(t, db.Where("catalog_item_id = ?", item.ID).Find(&revisions).Error)
	require.Len(t, revisions, 1)
	require.Equal(t, int64(2), revisions[0].BaseVersion)
}

func TestApplyRevisionRejectsStaleVersionWithoutAppendingHistory(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	item.Version = 2
	revision := domain.Revision{
		ID: uuid.NewString(), CatalogItemID: item.ID, BaseVersion: 1, ResultVersion: 2,
		ActorType: "user", ActorUserID: stringPointerRepo(uuid.NewString()), ActionType: "update",
		BeforeSnapshot: map[string]any{}, ProposedPatch: map[string]any{"floor": "三层"}, AfterSnapshot: map[string]any{}, ChangedFields: []string{"floor"},
	}

	err := NewCatalogRepo(db).ApplyRevision(context.Background(), &item, &revision)
	require.ErrorIs(t, err, domain.ErrVersionConflict)
	var count int64
	require.NoError(t, db.Model(&domain.Revision{}).Where("catalog_item_id = ?", item.ID).Count(&count).Error)
	require.Zero(t, count)
}

func TestCompleteAnalyzedItemDiscardsOldContentVersion(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	taskID := "task-old"
	require.NoError(t, db.Model(&domain.CatalogItem{}).Where("id = ?", item.ID).Updates(map[string]any{
		"version": 3, "nutrition_source_version": 2, "nutrition_status": "stale", "analysis_task_id": taskID,
	}).Error)

	err := NewCatalogRepo(db).CompleteAnalyzedItemForVersion(context.Background(), item.ID, taskID, 2, map[string]any{
		"items": []map[string]any{{"name": "旧结果", "micronutrient_analysis": "ai_precise_v1", "nutrients": map[string]any{"calories": 999.0}}},
	}, time.Now())
	require.True(t, errors.Is(err, domain.ErrStaleAnalysisResult))

	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, 320.0, publicItem.TotalCalories)
	require.Equal(t, int64(2), publicItem.NutritionVersion)
}

func TestCompleteAnalyzedItemRecognizesOldTaskAfterMetadataOnlyRevision(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	require.NoError(t, db.Model(&domain.CatalogItem{}).Where("id = ?", item.ID).Updates(map[string]any{
		"version": 3, "nutrition_source_version": 2, "nutrition_status": "current",
	}).Error)

	err := NewCatalogRepo(db).CompleteAnalyzedItemForVersion(context.Background(), item.ID, "task-v2", 2, map[string]any{}, time.Now())

	require.ErrorIs(t, err, domain.ErrStaleAnalysisResult)
}

func TestMarkCommunityAnalysisFailedUpdatesMatchingPublicProjection(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	repo := NewCatalogRepo(db)
	failedAt := time.Now()

	require.NoError(t, repo.MarkCommunityAnalysisFailed(context.Background(), item.ID, item.Version, "上游超时", failedAt))

	var stored domain.CatalogItem
	require.NoError(t, db.First(&stored, "id = ?", item.ID).Error)
	require.Equal(t, "failed", stored.NutritionStatus)
	require.Equal(t, "上游超时", stored.AnalysisError)
	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "failed", publicItem.NutritionStatus)
}

func TestMarkCommunityAnalysisFailedIgnoresSupersededVersion(t *testing.T) {
	db := openCommunityRepoDB(t)
	item := seedVersionedPublishedItem(t, db)
	repo := NewCatalogRepo(db)

	require.NoError(t, repo.MarkCommunityAnalysisFailed(context.Background(), item.ID, item.Version-1, "旧任务失败", time.Now()))

	var stored domain.CatalogItem
	require.NoError(t, db.First(&stored, "id = ?", item.ID).Error)
	require.Equal(t, "current", stored.NutritionStatus)
	var publicItem publishedCatalogItem
	require.NoError(t, db.First(&publicItem, "id = ?", item.ID).Error)
	require.Equal(t, "current", publicItem.NutritionStatus)
}

func TestReviewCollectorApplicationExpiresOldScopeBeforeRenewal(t *testing.T) {
	db := openCommunityRepoDB(t)
	now := time.Now()
	userID, schoolID, adminID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	oldExpiry := now.Add(-time.Hour)
	oldScope := domain.CollectorScope{
		ID: uuid.NewString(), UserID: userID, SchoolID: schoolID, Status: "active",
		GrantedByAdminID: adminID, ExpiresAt: &oldExpiry, CreatedAt: &oldExpiry, UpdatedAt: &oldExpiry,
	}
	application := domain.CollectorApplication{
		ID: uuid.NewString(), UserID: userID, SchoolID: schoolID, Status: "pending", CreatedAt: &now, UpdatedAt: &now,
	}
	require.NoError(t, db.Create(&oldScope).Error)
	require.NoError(t, db.Create(&application).Error)
	newExpiry := now.Add(30 * 24 * time.Hour)

	updated, scope, err := NewCatalogRepo(db).ReviewCollectorApplication(
		context.Background(), application.ID, adminID, "approved", "续期", &newExpiry, now,
	)

	require.NoError(t, err)
	require.Equal(t, "approved", updated.Status)
	require.NotNil(t, scope)
	require.NotEqual(t, oldScope.ID, scope.ID)
	require.Equal(t, "active", scope.Status)
	var storedOld domain.CollectorScope
	require.NoError(t, db.First(&storedOld, "id = ?", oldScope.ID).Error)
	require.Equal(t, "expired", storedOld.Status)
}

func TestListCollectorApplicationsIncludesUserAndDirectoryLabels(t *testing.T) {
	db := openCommunityRepoDB(t)
	userID, schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Create(&communityTestUser{ID: userID, Nickname: "校园小马", Telephone: "13800000000"}).Error)
	require.NoError(t, db.Create(&communityTestSchool{ID: schoolID, Name: "示例大学", Status: "active"}).Error)
	require.NoError(t, db.Create(&communityTestCampus{ID: campusID, SchoolID: schoolID, Name: "主校区", Status: "active"}).Error)
	require.NoError(t, db.Create(&communityTestCanteen{ID: canteenID, SchoolID: schoolID, CampusID: campusID, Name: "第一食堂", Status: "active"}).Error)
	now := time.Now()
	require.NoError(t, db.Create(&domain.CollectorApplication{
		ID: uuid.NewString(), UserID: userID, SchoolID: schoolID, CampusID: &campusID, CanteenID: &canteenID,
		Status: "pending", CreatedAt: &now, UpdatedAt: &now,
	}).Error)

	items, total, err := NewCatalogRepo(db).ListCollectorApplications(context.Background(), "", "pending", 20, 0)

	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, "校园小马", items[0].UserNickname)
	require.Equal(t, "13800000000", items[0].UserTelephone)
	require.Equal(t, "示例大学", items[0].SchoolName)
	require.Equal(t, "主校区", items[0].CampusName)
	require.Equal(t, "第一食堂", items[0].CanteenName)
	require.NoError(t, db.Create(&domain.CollectorScope{
		ID: uuid.NewString(), UserID: userID, SchoolID: schoolID, CampusID: &campusID, CanteenID: &canteenID,
		Status: "active", GrantedByAdminID: uuid.NewString(), CreatedAt: &now, UpdatedAt: &now,
	}).Error)
	scopes, err := NewCatalogRepo(db).ListCollectorScopes(context.Background(), userID, true)
	require.NoError(t, err)
	require.Len(t, scopes, 1)
	require.Equal(t, "示例大学", scopes[0].SchoolName)
	require.Equal(t, "主校区", scopes[0].CampusName)
	require.Equal(t, "第一食堂", scopes[0].CanteenName)
}
