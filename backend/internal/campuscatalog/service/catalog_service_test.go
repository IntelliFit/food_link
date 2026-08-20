package service

import (
	"context"
	"errors"
	"testing"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/require"
)

type fakeCatalogRepo struct {
	existing            *domain.CollectionBatch
	existingItems       []domain.CatalogItem
	existingItem        *domain.CatalogItem
	createdBatch        *domain.CollectionBatch
	createdItems        []domain.CatalogItem
	updatedItem         *domain.CatalogItem
	publishedItem       *domain.CatalogItem
	publishedBy         string
	analysisPendingItem *domain.CatalogItem
	analysisFailedItem  *domain.CatalogItem
	linkedTaskID        string
	missingNutrition    []domain.CatalogItem
	hiddenPublicItemID  string
	legacyCandidates    []domain.LegacyAnalysisCandidate
	currentCandidates   []domain.CurrentAnalysisCandidate
	orphanCandidates    []domain.CatalogItem
	claimLegacy         bool
	claimCurrent        bool
	claimOrphan         bool
	completedLegacyID   string
	completeErr         error
	markedCurrentIDs    []string
	analysisProgress    *domain.AnalysisProgress
	failedCandidates    []domain.CatalogItem
	claimFailed         bool
	activatedFailedID   string
}

func (f *fakeCatalogRepo) FindBatchByClientKey(context.Context, string) (*domain.CollectionBatch, error) {
	return f.existing, nil
}

func (f *fakeCatalogRepo) CreateBatchWithItems(_ context.Context, batch *domain.CollectionBatch, items []domain.CatalogItem) error {
	copyBatch := *batch
	f.createdBatch = &copyBatch
	f.createdItems = append([]domain.CatalogItem(nil), items...)
	return nil
}

func (f *fakeCatalogRepo) ListBatches(context.Context, int, int) ([]domain.CollectionBatch, int64, error) {
	return nil, 0, nil
}

func (f *fakeCatalogRepo) ListItemsByBatch(context.Context, string) ([]domain.CatalogItem, error) {
	return append([]domain.CatalogItem(nil), f.existingItems...), nil
}

func (f *fakeCatalogRepo) ListItems(context.Context, domain.CatalogItemFilter) ([]domain.CatalogItem, int64, error) {
	items := append([]domain.CatalogItem(nil), f.existingItems...)
	return items, int64(len(items)), nil
}

func (f *fakeCatalogRepo) GetAnalysisProgress(context.Context) (*domain.AnalysisProgress, error) {
	if f.analysisProgress != nil {
		return f.analysisProgress, nil
	}
	return &domain.AnalysisProgress{Total: 10, AnalyzableTotal: 8, Completed: 3, CompletedPercent: 37.5}, nil
}

func (f *fakeCatalogRepo) ListFailedAnalysisRetryCandidates(context.Context, int) ([]domain.CatalogItem, error) {
	return append([]domain.CatalogItem(nil), f.failedCandidates...), nil
}

func (f *fakeCatalogRepo) ActivatePreparedAnalysisRetry(_ context.Context, itemID, sourceTaskID, retryTaskID string, startedAt time.Time) (bool, error) {
	if !f.claimFailed {
		return false, nil
	}
	f.claimFailed = false
	f.activatedFailedID = itemID
	f.linkedTaskID = retryTaskID
	return true, nil
}

func (f *fakeCatalogRepo) ListPublishedItemsMissingNutrition(context.Context, int) ([]domain.CatalogItem, error) {
	return append([]domain.CatalogItem(nil), f.missingNutrition...), nil
}

func (f *fakeCatalogRepo) HidePublicItemForNutritionBackfill(_ context.Context, itemID string) error {
	f.hiddenPublicItemID = itemID
	return nil
}

func (f *fakeCatalogRepo) FindItemByID(context.Context, string) (*domain.CatalogItem, error) {
	return f.existingItem, nil
}

func (f *fakeCatalogRepo) UpdateItem(_ context.Context, item *domain.CatalogItem) error {
	copyItem := *item
	f.updatedItem = &copyItem
	return nil
}

func (f *fakeCatalogRepo) MarkAnalysisPending(_ context.Context, item *domain.CatalogItem, adminID string, startedAt time.Time) error {
	copyItem := *item
	copyItem.Status = "analysis_pending"
	copyItem.AnalysisError = ""
	copyItem.AnalysisStartedAt = &startedAt
	f.analysisPendingItem = &copyItem
	f.publishedBy = adminID
	return nil
}

func (f *fakeCatalogRepo) LinkAnalysisTask(_ context.Context, itemID, taskID string) error {
	f.linkedTaskID = taskID
	return nil
}

func (f *fakeCatalogRepo) MarkAnalysisFailed(_ context.Context, itemID, message string, failedAt time.Time) error {
	if f.existingItem != nil {
		copyItem := *f.existingItem
		copyItem.Status = "analysis_failed"
		copyItem.AnalysisError = message
		f.analysisFailedItem = &copyItem
	}
	return nil
}

func (f *fakeCatalogRepo) ListCurrentTerminalAnalysisCandidates(context.Context, int) ([]domain.CurrentAnalysisCandidate, error) {
	return append([]domain.CurrentAnalysisCandidate(nil), f.currentCandidates...), nil
}

func (f *fakeCatalogRepo) MarkCurrentTerminalAnalysisFailed(_ context.Context, itemID, taskID, message string, failedAt time.Time) (bool, error) {
	if !f.claimCurrent {
		return false, nil
	}
	f.markedCurrentIDs = append(f.markedCurrentIDs, itemID)
	return true, nil
}

func (f *fakeCatalogRepo) CountOrphanPendingAnalysisCandidates(context.Context, time.Time) (int64, error) {
	var count int64
	for index := range f.orphanCandidates {
		if f.orphanCandidates[index].Status == "analysis_pending" {
			count++
		}
	}
	return count, nil
}

func (f *fakeCatalogRepo) ListOrphanAnalysisCandidates(context.Context, time.Time, int) ([]domain.CatalogItem, error) {
	return append([]domain.CatalogItem(nil), f.orphanCandidates...), nil
}

func (f *fakeCatalogRepo) ClaimOrphanAnalysis(_ context.Context, itemID string, expectedTaskID *string, staleBefore time.Time, message string, claimedAt time.Time) (bool, error) {
	if !f.claimOrphan {
		return false, nil
	}
	f.claimOrphan = false
	for index := range f.orphanCandidates {
		if f.orphanCandidates[index].ID == itemID {
			copyItem := f.orphanCandidates[index]
			copyItem.Status = "analysis_failed"
			copyItem.AnalysisTaskID = nil
			copyItem.AnalysisError = message
			f.existingItem = &copyItem
			break
		}
	}
	return true, nil
}

func (f *fakeCatalogRepo) ListLegacyTerminalAnalysisCandidates(context.Context, int) ([]domain.LegacyAnalysisCandidate, error) {
	return append([]domain.LegacyAnalysisCandidate(nil), f.legacyCandidates...), nil
}

func (f *fakeCatalogRepo) ClaimLegacyAnalysisRetry(_ context.Context, itemID, taskID, message string, claimedAt time.Time) (bool, error) {
	if !f.claimLegacy {
		return false, nil
	}
	f.claimLegacy = false
	for index := range f.legacyCandidates {
		if f.legacyCandidates[index].Item.ID == itemID {
			copyItem := f.legacyCandidates[index].Item
			copyItem.Status = "analysis_failed"
			copyItem.AnalysisTaskID = nil
			copyItem.AnalysisError = message
			f.existingItem = &copyItem
			break
		}
	}
	return true, nil
}

func (f *fakeCatalogRepo) CompleteAnalyzedItem(_ context.Context, itemID, taskID string, result map[string]any, completedAt time.Time) error {
	f.completedLegacyID = itemID
	return f.completeErr
}

func (f *fakeCatalogRepo) TryAnalysisMaintenanceLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	return true, fn(ctx)
}

func (f *fakeCatalogRepo) SoftDeleteItem(context.Context, string) error { return nil }

type fakeCatalogAnalyzeSubmitter struct {
	taskID         string
	err            error
	userID         string
	input          analyzeservice.SubmitTaskInput
	textInput      analyzeservice.SubmitTaskInput
	retriedTaskID  string
	retriedItemID  string
	enqueuedTaskID string
}

func (f *fakeCatalogAnalyzeSubmitter) SubmitInternalAnalyzeTask(_ context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error) {
	f.userID = userID
	f.input = input
	return f.taskID, f.err
}

func (f *fakeCatalogAnalyzeSubmitter) PrepareInternalCampusRetryTask(_ context.Context, taskID, userID, catalogItemID string) (*analyzeservice.RetryTaskResult, error) {
	f.userID = userID
	f.retriedTaskID = taskID
	f.retriedItemID = catalogItemID
	if f.err != nil {
		return nil, f.err
	}
	return &analyzeservice.RetryTaskResult{TaskID: f.taskID, SourceTaskID: taskID}, nil
}

func (f *fakeCatalogAnalyzeSubmitter) EnqueuePreparedInternalTask(_ context.Context, taskID, userID string) error {
	f.userID = userID
	f.enqueuedTaskID = taskID
	return nil
}

func (f *fakeCatalogAnalyzeSubmitter) SubmitInternalTextTask(_ context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error) {
	f.userID = userID
	f.textInput = input
	return f.taskID, f.err
}

type fakeCatalogAnalysisUserResolver struct {
	userID string
	err    error
}

func (f fakeCatalogAnalysisUserResolver) ResolveInternalAnalysisUserID(context.Context, string, string) (string, error) {
	return f.userID, f.err
}

func TestCreateBatchSupportsMealWindowsAndIncompleteEvidence(t *testing.T) {
	repo := &fakeCatalogRepo{}
	storageClient := storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn-food-images.example.com",
	})
	svc := NewCatalogService(repo, storageClient)
	capturedAt := time.Date(2026, 7, 14, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	fixedPrice := 3.0

	result, err := svc.CreateBatch(context.Background(), "admin-1", CreateBatchInput{
		ClientBatchKey:      "assistant-tsinghua-20260714",
		VenueType:           "university",
		OrganizationName:    "清华大学",
		AreaName:            "清华园校区",
		CanteenName:         "桃李园",
		DefaultFloor:        "一层",
		DefaultWindowName:   "老北京炸鸡",
		DefaultWindowLayout: "continuous_counter",
		DefaultServiceMode:  "mixed",
		DefaultMealPeriods:  []string{"lunch", "dinner"},
		CapturedAt:          &capturedAt,
		Entries: []CreateCatalogItemInput{
			{
				EntryType:      "stall_overview",
				ImageKind:      "menu_board",
				ImagePaths:     []string{"https://cdn-food-images.example.com/campus-food/menu.jpg"},
				PriceType:      "unknown",
				ServiceMode:    "malatang",
				RawText:        "麻辣烫，可选清汤、骨汤、番茄汤",
				SourceFilename: "窗口菜单.jpg",
			},
			{
				EntryType:  "menu_item",
				Name:       "美味无骨鸡腿肉",
				ImageKind:  "price_tag",
				PriceType:  "fixed",
				Price:      &fixedPrice,
				PriceUnit:  "元/两",
				ImagePaths: nil,
			},
		},
	})

	require.NoError(t, err)
	require.NotNil(t, repo.createdBatch)
	require.Len(t, repo.createdItems, 2)
	require.Equal(t, "桃李园", result.Batch.CanteenName)
	require.Equal(t, []string{"lunch", "dinner"}, repo.createdItems[0].MealPeriods)
	require.Equal(t, "连续长档口", windowLayoutLabel(repo.createdItems[0].WindowLayout))
	require.Equal(t, []string{"price"}, repo.createdItems[0].MissingFields)
	require.Equal(t, []string{"image"}, repo.createdItems[1].MissingFields)
	require.Equal(t, "campus-food/menu.jpg", repo.createdItems[0].ImagePaths[0])
	require.Equal(t, "https://cdn-food-images.example.com/campus-food/menu.jpg", result.Items[0].ImagePaths[0])
}

func TestCreateBatchSupportsOfficeParkAndNoPhotoPlaceholder(t *testing.T) {
	repo := &fakeCatalogRepo{}
	svc := NewCatalogService(repo, nil)

	result, err := svc.CreateBatch(context.Background(), "admin-2", CreateBatchInput{
		ClientBatchKey:   "ai-vision-center-1",
		VenueType:        "office_park",
		OrganizationName: "AI远景中心",
		AreaName:         "A座",
		CanteenName:      "园区食堂",
		Entries: []CreateCatalogItemInput{{
			EntryType:   "stall_overview",
			WindowName:  "自选打菜区",
			ServiceMode: "self_select",
			PriceType:   "freeform",
			PriceText:   "按最终所选菜品结算",
		}},
	})

	require.NoError(t, err)
	require.Equal(t, "office_park", result.Batch.VenueType)
	require.Equal(t, "自选打菜区", result.Items[0].Name)
	require.Equal(t, []string{"image"}, result.Items[0].MissingFields)
}

func TestCreateBatchRejectsInvalidRangePrice(t *testing.T) {
	repo := &fakeCatalogRepo{}
	svc := NewCatalogService(repo, nil)
	minPrice := 20.0
	maxPrice := 10.0

	_, err := svc.CreateBatch(context.Background(), "admin", CreateBatchInput{
		ClientBatchKey:   "bad-range",
		VenueType:        "university",
		OrganizationName: "清华大学",
		CanteenName:      "紫荆园",
		Entries: []CreateCatalogItemInput{{
			EntryType: "dish",
			Name:      "测试菜",
			PriceType: "range",
			PriceMin:  &minPrice,
			PriceMax:  &maxPrice,
		}},
	})

	require.Error(t, err)
	require.Nil(t, repo.createdBatch)
}

func TestCreateBatchIsIdempotentByClientKey(t *testing.T) {
	existing := &domain.CollectionBatch{ID: "batch-1", ClientBatchKey: "same-key", CanteenName: "桃李园"}
	repo := &fakeCatalogRepo{
		existing:      existing,
		existingItems: []domain.CatalogItem{{ID: "item-1", BatchID: "batch-1", Name: "鸡排"}},
	}
	svc := NewCatalogService(repo, nil)

	result, err := svc.CreateBatch(context.Background(), "admin", CreateBatchInput{ClientBatchKey: "same-key"})

	require.NoError(t, err)
	require.True(t, result.Idempotent)
	require.Len(t, result.Items, 1)
	require.Equal(t, 1, result.Batch.ItemCount)
	require.Nil(t, repo.createdBatch)
}

func TestUpdateItemSupportsProgressiveEnrichment(t *testing.T) {
	price := 6.5
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID:                 "item-1",
		BatchID:            "batch-1",
		EntryType:          "menu_item",
		OrganizationName:   "清华大学",
		CanteenName:        "紫荆园",
		PriceType:          "unknown",
		ImageKind:          "menu_board",
		MissingFields:      []string{"image", "name", "price"},
		CompletenessStatus: "incomplete",
		Status:             "draft",
	}}
	storageClient := storage.New(config.StorageConfig{CDNFoodImagesBaseURL: "https://cdn-food-images.example.com"})
	svc := NewCatalogService(repo, storageClient)

	item, err := svc.UpdateItem(context.Background(), "admin-1", "item-1", UpdateCatalogItemInput{
		EntryType:          "menu_item",
		Name:               "番茄炒饭",
		Floor:              "2F",
		WindowName:         "中式炒饭",
		WindowLayout:       "standard",
		MealPeriods:        []string{"lunch", "dinner"},
		AvailableWeekdays:  []string{"monday", "friday"},
		AvailabilityNote:   "晚餐可能提前售罄",
		ServiceMode:        "fixed_portion",
		PriceType:          "fixed",
		Price:              &price,
		PriceUnit:          "元/份",
		PortionDescription: "一盘",
		ImagePaths:         []string{"https://cdn-food-images.example.com/campus-food/tomato-rice.jpg"},
		ImageKind:          "dish",
		Notes:              "已人工复核",
	})

	require.NoError(t, err)
	require.NotNil(t, repo.updatedItem)
	require.Equal(t, "番茄炒饭", repo.updatedItem.Name)
	require.Equal(t, []string{"lunch", "dinner"}, repo.updatedItem.MealPeriods)
	require.Equal(t, []string{"monday", "friday"}, repo.updatedItem.AvailableWeekdays)
	require.Equal(t, []string{"campus-food/tomato-rice.jpg"}, repo.updatedItem.ImagePaths)
	require.Empty(t, repo.updatedItem.MissingFields)
	require.Equal(t, "complete", repo.updatedItem.CompletenessStatus)
	require.Equal(t, "https://cdn-food-images.example.com/campus-food/tomato-rice.jpg", item.ImagePaths[0])
}

func TestUpdateItemRejectsUnknownItem(t *testing.T) {
	svc := NewCatalogService(&fakeCatalogRepo{}, nil)

	_, err := svc.UpdateItem(context.Background(), "admin-1", "missing", UpdateCatalogItemInput{})

	require.Error(t, err)
}

func TestUpdatePublishedItemKeepsPublishedWithoutReanalysis(t *testing.T) {
	price := 8.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "published", Name: "旧名称",
		OrganizationName: "清华大学", CanteenName: "紫荆园",
	}}
	svc := NewCatalogService(repo, nil)

	item, err := svc.UpdateItem(context.Background(), "admin-1", "item-1", UpdateCatalogItemInput{
		EntryType: "dish", Name: "新名称", ImageKind: "dish", ImagePaths: []string{"campus-food/new.jpg"},
		PriceType: "fixed", Price: &price, ServiceMode: "fixed_portion", WindowLayout: "standard",
	})

	require.NoError(t, err)
	require.Equal(t, "published", repo.updatedItem.Status)
	require.Equal(t, "published", item.Status)
}

func TestPublishChangesPendingSyncsMetadataWithoutAnalysis(t *testing.T) {
	price := 8.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "changes_pending", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", PriceType: "fixed", Price: &price,
	}}
	svc := NewCatalogService(repo, nil)

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.NotNil(t, repo.updatedItem)
	require.Equal(t, "published", repo.updatedItem.Status)
	require.Equal(t, "published", item.Status)
	require.Nil(t, repo.analysisPendingItem)
}

func TestUpdatePublishedItemRejectsRemovingName(t *testing.T) {
	publishedAt := time.Now()
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "published", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", PublishedAt: &publishedAt,
	}}
	svc := NewCatalogService(repo, nil)

	_, err := svc.UpdateItem(context.Background(), "admin-1", "item-1", UpdateCatalogItemInput{
		EntryType: "dish", Name: "", PriceType: "unknown", ServiceMode: "fixed_portion", WindowLayout: "standard",
	})

	require.ErrorContains(t, err, "必须保留名称")
	require.Nil(t, repo.updatedItem)
}

func TestUpdateItemRejectsChangesWhileAnalysisIsPending(t *testing.T) {
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "analysis_pending",
		OrganizationName: "清华大学", CanteenName: "紫荆园",
	}}
	svc := NewCatalogService(repo, nil)

	_, err := svc.UpdateItem(context.Background(), "admin-1", "item-1", UpdateCatalogItemInput{})

	require.Error(t, err)
	require.Contains(t, err.Error(), "AI 分析进行中")
	require.Nil(t, repo.updatedItem)
}

func TestPublishItemAllowsMissingImageAndUsesExistingTextAnalysis(t *testing.T) {
	price := 12.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "draft", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", PriceType: "fixed", Price: &price,
		MissingFields: []string{"image"}, CompletenessStatus: "incomplete", RawText: "番茄炒饭 12 元/份",
	}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-text-1"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.Equal(t, "analysis_pending", item.Status)
	require.Equal(t, "task-text-1", repo.linkedTaskID)
	require.Equal(t, "text", submitter.textInput.SourceType)
	require.Equal(t, "standard", *submitter.textInput.ExecutionMode)
	require.Contains(t, submitter.textInput.TextInput, "番茄炒饭")
	require.Contains(t, submitter.textInput.TextInput, "番茄炒饭 12 元/份")
	require.Empty(t, submitter.input.SourceType)
}

func TestPublishItemAllowsMissingPriceButStillRejectsMissingName(t *testing.T) {
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", Status: "draft", MissingFields: []string{"image", "price"}, CompletenessStatus: "incomplete",
	}}
	svc := NewCatalogService(repo, nil)

	_, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.Error(t, err)
	require.Contains(t, err.Error(), "补齐名称")
	require.Nil(t, repo.analysisPendingItem)
}

func TestPublishItemAllowsNamedItemWithoutPrice(t *testing.T) {
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "draft", EntryType: "dish", Name: "番茄炒蛋",
		OrganizationName: "清华大学", CanteenName: "紫荆园", PriceType: "unknown",
		MissingFields: []string{"image", "price"}, CompletenessStatus: "incomplete", RawText: "番茄炒蛋",
	}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-text-1"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.Equal(t, "analysis_pending", item.Status)
	require.Equal(t, "text", submitter.textInput.SourceType)
	require.Equal(t, "task-text-1", repo.linkedTaskID)
}

func TestPublishItemRejectsStallOverview(t *testing.T) {
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", Status: "draft", EntryType: "stall_overview", Name: "桃园食堂档口介绍",
		MissingFields: []string{"price"},
	}}
	svc := NewCatalogService(repo, nil)

	_, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.ErrorContains(t, err, "档口介绍")
	require.Nil(t, repo.analysisPendingItem)
}

func TestPublishItemQueuesExistingFoodAnalysisBeforePublishing(t *testing.T) {
	price := 12.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "draft", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", ImagePaths: []string{"campus-food/rice.jpg"},
		PriceType: "fixed", Price: &price, CompletenessStatus: "complete",
	}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-1"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.NotNil(t, repo.analysisPendingItem)
	require.Equal(t, "admin-1", repo.publishedBy)
	require.Equal(t, "analysis_pending", item.Status)
	require.Equal(t, "task-1", repo.linkedTaskID)
	require.Equal(t, "system-user-1", submitter.userID)
	require.Equal(t, "standard", *submitter.input.ExecutionMode)
	require.Equal(t, "campus_public_food", submitter.input.ExtraPayload["public_food_source_type"])
	require.Equal(t, "item-1", submitter.input.ExtraPayload["campus_catalog_item_id"])
	require.Equal(t, true, submitter.input.ExtraPayload["micronutrient_analysis_required"])
	require.Equal(t, "image", submitter.input.SourceType)
}

func TestPublishItemDoesNotDuplicatePendingAnalysis(t *testing.T) {
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", Status: "analysis_pending", CompletenessStatus: "complete", AnalysisTaskID: stringPtr("task-existing"),
	}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-new"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.Equal(t, "analysis_pending", item.Status)
	require.Empty(t, submitter.userID)
	require.Empty(t, repo.linkedTaskID)
}

func TestPublishItemMarksAnalysisFailedWhenSubmissionFails(t *testing.T) {
	price := 12.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "draft", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "清华大学", CanteenName: "紫荆园", ImagePaths: []string{"campus-food/rice.jpg"},
		PriceType: "fixed", Price: &price, CompletenessStatus: "complete",
	}}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(&fakeCatalogAnalyzeSubmitter{err: errors.New("queue unavailable")}, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	_, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.Error(t, err)
	require.NotNil(t, repo.analysisFailedItem)
	require.Equal(t, "analysis_failed", repo.analysisFailedItem.Status)
}

func TestPublishItemRetriesImageTimeoutWithTextWithoutRemovingImages(t *testing.T) {
	price := 12.0
	repo := &fakeCatalogRepo{existingItem: &domain.CatalogItem{
		ID: "item-1", BatchID: "batch-1", Status: "analysis_failed", EntryType: "dish", Name: "紫薯花卷",
		OrganizationName: "AI原点社区", CanteenName: "园区食堂", ImagePaths: []string{"campus-food/roll.jpg"},
		PriceType: "fixed", Price: &price, CompletenessStatus: "complete", AnalysisError: "AI 识别服务响应超时，请稍后重试",
	}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-text-retry"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	item, err := svc.PublishItem(context.Background(), "admin-1", "item-1")

	require.NoError(t, err)
	require.Equal(t, "analysis_pending", item.Status)
	require.Equal(t, []string{"campus-food/roll.jpg"}, item.ImagePaths)
	require.Equal(t, "text", submitter.textInput.SourceType)
	require.Contains(t, submitter.textInput.TextInput, "紫薯花卷")
	require.Empty(t, submitter.input.SourceType)
}

func TestPublishedNutritionBackfillReusesSingleTaskPrecisePublishPath(t *testing.T) {
	price := 18.0
	item := domain.CatalogItem{
		ID: "item-history", BatchID: "batch-1", Status: "published", EntryType: "dish", Name: "柠檬金汤大锅（酸辣）",
		OrganizationName: "北京大学", CanteenName: "家园食堂", ImagePaths: []string{"campus-food/lemon-soup.jpg"},
		PriceType: "fixed", Price: &price, CompletenessStatus: "complete",
	}
	repo := &fakeCatalogRepo{existingItem: &item, missingNutrition: []domain.CatalogItem{item}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "task-history"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user-1"})

	queued, err := svc.SubmitPublishedNutritionBackfill(context.Background(), 100)

	require.NoError(t, err)
	require.Equal(t, 1, queued)
	require.Equal(t, "standard", *submitter.input.ExecutionMode)
	require.Equal(t, "item-history", submitter.input.ExtraPayload["campus_catalog_item_id"])
	require.Equal(t, true, submitter.input.ExtraPayload["micronutrient_analysis_required"])
	require.Equal(t, "item-history", repo.hiddenPublicItemID)
}

func TestRepairLegacyAnalysisRetriesTerminalTaskThroughCurrentPipeline(t *testing.T) {
	price := 12.0
	item := domain.CatalogItem{
		ID: "legacy-item", BatchID: "batch-1", Status: "analysis_pending", EntryType: "dish", Name: "番茄炒饭",
		OrganizationName: "测试大学", CanteenName: "一食堂", PriceType: "fixed", Price: &price,
	}
	taskID := "legacy-plan-task"
	item.AnalysisTaskID = &taskID
	repo := &fakeCatalogRepo{
		legacyCandidates: []domain.LegacyAnalysisCandidate{{
			Item: item, TaskID: taskID, TaskType: "precision_plan", TaskStatus: "done", TaskResult: map[string]any{},
		}},
		claimLegacy: true,
	}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "standard-task"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RepairLegacyAnalysisTasks(context.Background(), 20)

	require.NoError(t, err)
	require.Equal(t, 1, summary.Retried)
	require.Equal(t, "standard-task", repo.linkedTaskID)
	require.Equal(t, "standard", *submitter.textInput.ExecutionMode)
	require.Equal(t, true, submitter.textInput.ExtraPayload["micronutrient_analysis_required"])
}

func TestRepairCurrentAnalysisMarksUnpublishableDoneTaskForRetry(t *testing.T) {
	item := domain.CatalogItem{ID: "current-item", Status: "analysis_pending"}
	taskID := "current-done-task"
	item.AnalysisTaskID = &taskID
	repo := &fakeCatalogRepo{
		currentCandidates: []domain.CurrentAnalysisCandidate{{
			Item: item, TaskID: taskID, TaskType: "food_text", TaskStatus: "done",
			TaskResult: map[string]any{"items": []any{map[string]any{"name": "红菜汤"}}},
		}},
		claimCurrent: true,
		completeErr:  errors.New("missing precise nutrition"),
	}
	svc := NewCatalogService(repo, nil)

	summary, err := svc.RepairCurrentAnalysisTasks(context.Background(), 100)

	require.NoError(t, err)
	require.Equal(t, 1, summary.Scanned)
	require.Equal(t, 1, summary.MarkedFailed)
	require.Equal(t, []string{item.ID}, repo.markedCurrentIDs)
}

func TestRepairCurrentAnalysisResubmitsPendingItemWithoutTask(t *testing.T) {
	price := 8.0
	item := domain.CatalogItem{
		ID: "orphan-item", BatchID: "batch-1", EntryType: "dish", Name: "俄式红菜汤",
		Status: "analysis_pending", PriceType: "fixed", Price: &price,
	}
	repo := &fakeCatalogRepo{orphanCandidates: []domain.CatalogItem{item}, claimOrphan: true}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "replacement-task"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RepairCurrentAnalysisTasks(context.Background(), 100)

	require.NoError(t, err)
	require.Equal(t, 1, summary.OrphanRetried)
	require.Equal(t, "replacement-task", repo.linkedTaskID)
	require.Equal(t, "standard", *submitter.textInput.ExecutionMode)
}

func TestRepairCurrentAnalysisDefersOrphanUntilOtherPendingWorkDrains(t *testing.T) {
	item := domain.CatalogItem{ID: "orphan-item", Status: "analysis_pending"}
	repo := &fakeCatalogRepo{
		orphanCandidates: []domain.CatalogItem{item},
		analysisProgress: &domain.AnalysisProgress{StatusCounts: map[string]int64{"analysis_pending": 3}},
		claimOrphan:      true,
	}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "must-not-submit"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RepairCurrentAnalysisTasks(context.Background(), 100)

	require.NoError(t, err)
	require.Zero(t, summary.OrphanRetried)
	require.Empty(t, submitter.userID)
	require.True(t, repo.claimOrphan)
}

func TestRepairLegacyAnalysisPublishesCompletedPreciseResultWithoutRetry(t *testing.T) {
	item := domain.CatalogItem{ID: "precise-item", Status: "analysis_pending"}
	taskID := "legacy-aggregate-task"
	item.AnalysisTaskID = &taskID
	repo := &fakeCatalogRepo{legacyCandidates: []domain.LegacyAnalysisCandidate{{
		Item: item, TaskID: taskID, TaskType: "precision_aggregate", TaskStatus: "done",
		TaskResult: map[string]any{"items": []any{map[string]any{"name": "鸡蛋饼", "micronutrient_analysis": "ai_precise_v1"}}},
	}}}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "must-not-submit"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RepairLegacyAnalysisTasks(context.Background(), 20)

	require.NoError(t, err)
	require.Equal(t, 1, summary.Published)
	require.Equal(t, item.ID, repo.completedLegacyID)
	require.Empty(t, submitter.userID)
}

func TestRepairLegacyAnalysisDefersFailedRowsWhilePendingQueueExists(t *testing.T) {
	taskID := "legacy-failed-task"
	item := domain.CatalogItem{ID: "legacy-failed-item", Status: "analysis_failed", AnalysisTaskID: &taskID}
	repo := &fakeCatalogRepo{
		analysisProgress: &domain.AnalysisProgress{StatusCounts: map[string]int64{"analysis_pending": 2, "analysis_failed": 1}},
		legacyCandidates: []domain.LegacyAnalysisCandidate{{
			Item: item, TaskID: taskID, TaskType: "precision_plan", TaskStatus: "failed",
		}},
		claimLegacy: true,
	}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "must-not-submit"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RepairLegacyAnalysisTasks(context.Background(), 20)

	require.NoError(t, err)
	require.Equal(t, 1, summary.Skipped)
	require.Zero(t, summary.Retried)
	require.True(t, repo.claimLegacy)
	require.Empty(t, submitter.userID)
}

func TestRetryFailedAnalysisWaitsUntilPendingQueueDrains(t *testing.T) {
	taskID := "failed-task"
	repo := &fakeCatalogRepo{
		analysisProgress: &domain.AnalysisProgress{StatusCounts: map[string]int64{"analysis_pending": 3, "analysis_failed": 1}},
		failedCandidates: []domain.CatalogItem{{ID: "failed-item", Status: "analysis_failed", AnalysisTaskID: &taskID}},
		claimFailed:      true,
	}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "retry-task"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RetryFailedAnalysisTasks(context.Background(), 20)

	require.NoError(t, err)
	require.True(t, summary.Deferred)
	require.Zero(t, summary.Retried)
	require.Empty(t, repo.activatedFailedID)
	require.Empty(t, submitter.retriedTaskID)
}

func TestRetryFailedAnalysisUsesExistingRetryPathAfterQueueDrains(t *testing.T) {
	taskID := "failed-task"
	repo := &fakeCatalogRepo{
		analysisProgress: &domain.AnalysisProgress{StatusCounts: map[string]int64{"analysis_pending": 0, "analysis_failed": 1}},
		failedCandidates: []domain.CatalogItem{{ID: "failed-item", Status: "analysis_failed", AnalysisTaskID: &taskID}},
		claimFailed:      true,
	}
	submitter := &fakeCatalogAnalyzeSubmitter{taskID: "retry-task"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(submitter, fakeCatalogAnalysisUserResolver{userID: "system-user"})

	summary, err := svc.RetryFailedAnalysisTasks(context.Background(), 20)

	require.NoError(t, err)
	require.False(t, summary.Deferred)
	require.Equal(t, 1, summary.Retried)
	require.Equal(t, "failed-item", repo.activatedFailedID)
	require.Equal(t, "failed-task", submitter.retriedTaskID)
	require.Equal(t, "failed-item", submitter.retriedItemID)
	require.Equal(t, "retry-task", repo.linkedTaskID)
	require.Equal(t, "retry-task", submitter.enqueuedTaskID)
	require.Equal(t, "system-user", submitter.userID)
}

func stringPtr(value string) *string { return &value }

func windowLayoutLabel(value string) string {
	if value == "continuous_counter" {
		return "连续长档口"
	}
	return value
}
