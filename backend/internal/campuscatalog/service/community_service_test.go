package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	commonerrors "food_link/backend/internal/common/errors"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type fakeCommunityRepo struct {
	*fakeCatalogRepo
	appliedItem           *domain.CatalogItem
	appliedRevision       *domain.Revision
	applyErr              error
	directoryRef          *domain.DirectoryRef
	collectorAllowed      bool
	linkedVersion         int64
	linkedTaskID          string
	communityBatch        *domain.CollectionBatch
	communityItems        []domain.CatalogItem
	communityRevisions    []domain.Revision
	collectorApplication  *domain.CollectorApplication
	collectorFindStatuses []string
	collectorScopes       []domain.CollectorScope
}

func (f *fakeCommunityRepo) ApplyRevision(_ context.Context, item *domain.CatalogItem, revision *domain.Revision) error {
	if f.applyErr != nil {
		return f.applyErr
	}
	itemCopy, revisionCopy := cloneCatalogItem(*item), *revision
	f.appliedItem, f.appliedRevision = &itemCopy, &revisionCopy
	f.existingItem = &itemCopy
	return nil
}

func (f *fakeCommunityRepo) ListRevisions(context.Context, string, int, int) ([]domain.Revision, int64, error) {
	if f.appliedRevision == nil {
		return nil, 0, nil
	}
	return []domain.Revision{*f.appliedRevision}, 1, nil
}

func (f *fakeCommunityRepo) FindRevisionByID(context.Context, string, string) (*domain.Revision, error) {
	return f.appliedRevision, nil
}

func (f *fakeCommunityRepo) GetCampusDirectoryRef(context.Context, string, string, string, string) (*domain.DirectoryRef, error) {
	return f.directoryRef, nil
}

func (f *fakeCommunityRepo) HasActiveCollectorScope(context.Context, string, string, string, string, time.Time) (bool, error) {
	return f.collectorAllowed, nil
}

func (f *fakeCommunityRepo) LinkCommunityAnalysisTask(_ context.Context, _ string, targetVersion int64, taskID string, _ time.Time) (bool, error) {
	f.linkedVersion, f.linkedTaskID = targetVersion, taskID
	return true, nil
}

func (f *fakeCommunityRepo) MarkCommunityAnalysisFailed(context.Context, string, int64, string, time.Time) error {
	return nil
}

func (f *fakeCommunityRepo) CreateCommunityBatchWithItems(_ context.Context, batch *domain.CollectionBatch, items []domain.CatalogItem, revisions []domain.Revision) error {
	batchCopy := *batch
	f.communityBatch = &batchCopy
	f.communityItems = append([]domain.CatalogItem{}, items...)
	f.communityRevisions = append([]domain.Revision{}, revisions...)
	return nil
}

func (f *fakeCommunityRepo) FindCollectorApplication(_ context.Context, _, _, _, _ string, statuses []string) (*domain.CollectorApplication, error) {
	f.collectorFindStatuses = append([]string{}, statuses...)
	if f.collectorApplication == nil {
		return nil, nil
	}
	for _, status := range statuses {
		if f.collectorApplication.Status == status {
			return f.collectorApplication, nil
		}
	}
	return nil, nil
}

func (f *fakeCommunityRepo) CreateCollectorApplication(_ context.Context, application *domain.CollectorApplication) error {
	copy := *application
	f.collectorApplication = &copy
	return nil
}

func (f *fakeCommunityRepo) ListCollectorApplications(context.Context, string, string, int, int) ([]domain.CollectorApplication, int64, error) {
	if f.collectorApplication == nil {
		return nil, 0, nil
	}
	return []domain.CollectorApplication{*f.collectorApplication}, 1, nil
}

func (f *fakeCommunityRepo) ListCollectorScopes(context.Context, string, bool) ([]domain.CollectorScope, error) {
	return append([]domain.CollectorScope{}, f.collectorScopes...), nil
}

func (f *fakeCommunityRepo) ReviewCollectorApplication(context.Context, string, string, string, string, *time.Time, time.Time) (*domain.CollectorApplication, *domain.CollectorScope, error) {
	return nil, nil, domain.ErrCollectorApplicationAbsent
}

func newPublishedCommunityItem() *domain.CatalogItem {
	now := time.Now()
	schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	price := 12.0
	return &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "番茄炒蛋",
		SchoolID: &schoolID, CampusID: &campusID, CanteenID: &canteenID,
		OrganizationName: "示例大学", AreaName: "主校区", CanteenName: "第一食堂",
		PriceType: "fixed", Price: &price, PriceUnit: "元/份", ImagePaths: []string{"campus-food/a.jpg"},
		CompletenessStatus: "complete", Status: "published", PublishedAt: &now,
		Version: 3, SourceChannel: "user_single", NutritionVersion: 3, NutritionStatus: "current", AvailabilityStatus: "available",
	}
}

func TestApplyUserCorrectionAdvancesVersionAndKeepsNutritionForMetadata(t *testing.T) {
	current := newPublishedCommunityItem()
	repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{existingItem: current}}
	svc := NewCatalogService(repo, nil)

	result, err := svc.ApplyUserCorrection(context.Background(), uuid.NewString(), current.ID, CorrectionInput{
		BaseVersion: 3,
		Patch:       map[string]any{"price": 13.5, "floor": "二层"},
		Reason:      "窗口价格更新",
	})

	require.NoError(t, err)
	require.Equal(t, int64(4), result.Item.Version)
	require.Equal(t, int64(3), result.Item.NutritionVersion)
	require.Equal(t, "current", result.Item.NutritionStatus)
	require.False(t, result.ReanalysisQueued)
	require.Equal(t, int64(3), result.Revision.BaseVersion)
	require.Equal(t, int64(4), result.Revision.ResultVersion)
	require.Equal(t, []string{"floor", "price"}, result.Revision.ChangedFields)
	require.Equal(t, 12.0, result.Revision.BeforeSnapshot["price"])
	require.Equal(t, 13.5, result.Revision.AfterSnapshot["price"])
}

func TestApplyUserCorrectionQueuesNutritionForTargetContentVersion(t *testing.T) {
	current := newPublishedCommunityItem()
	repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{existingItem: current}}
	tasks := &fakeCatalogAnalyzeSubmitter{taskID: "task-v4"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(tasks, fakeCatalogAnalysisUserResolver{userID: uuid.NewString()})

	result, err := svc.ApplyUserCorrection(context.Background(), uuid.NewString(), current.ID, CorrectionInput{
		BaseVersion: 3,
		Patch:       map[string]any{"name": "西红柿炒鸡蛋"},
	})

	require.NoError(t, err)
	require.True(t, result.ReanalysisQueued)
	require.Equal(t, "stale", result.Item.NutritionStatus)
	require.Equal(t, int64(4), repo.linkedVersion)
	require.Equal(t, "task-v4", repo.linkedTaskID)
	require.EqualValues(t, 4, tasks.input.ExtraPayload["campus_content_version"])
}

func TestApplyUserCorrectionDoesNotReanalyzeUnchangedSensitiveFields(t *testing.T) {
	current := newPublishedCommunityItem()
	repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{existingItem: current}}
	tasks := &fakeCatalogAnalyzeSubmitter{taskID: "must-not-submit"}
	svc := NewCatalogService(repo, nil)
	svc.ConfigureAnalysis(tasks, fakeCatalogAnalysisUserResolver{userID: uuid.NewString()})

	result, err := svc.ApplyUserCorrection(context.Background(), uuid.NewString(), current.ID, CorrectionInput{
		BaseVersion: current.Version,
		Patch: map[string]any{
			"name": current.Name, "image_paths": current.ImagePaths,
			"portion_description": current.PortionDescription, "price": 13.5,
		},
	})

	require.NoError(t, err)
	require.False(t, result.ReanalysisQueued)
	require.Equal(t, "current", result.Item.NutritionStatus)
	require.Empty(t, repo.linkedTaskID)
	require.Equal(t, []string{"price"}, result.Revision.ChangedFields)
}

func TestApplyUserCorrectionReturnsConflictForStaleForm(t *testing.T) {
	current := newPublishedCommunityItem()
	repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{existingItem: current}}
	svc := NewCatalogService(repo, nil)

	_, err := svc.ApplyUserCorrection(context.Background(), uuid.NewString(), current.ID, CorrectionInput{
		BaseVersion: 2,
		Patch:       map[string]any{"floor": "三层"},
	})

	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 409, appErr.HTTPStatus)
}

func TestApplyUserCorrectionMapsRepositoryRaceToConflict(t *testing.T) {
	current := newPublishedCommunityItem()
	repo := &fakeCommunityRepo{fakeCatalogRepo: &fakeCatalogRepo{existingItem: current}, applyErr: domain.ErrVersionConflict}
	svc := NewCatalogService(repo, nil)
	_, err := svc.ApplyUserCorrection(context.Background(), uuid.NewString(), current.ID, CorrectionInput{
		BaseVersion: 3, Patch: map[string]any{"floor": "三层"},
	})
	require.Error(t, err)
	require.False(t, errors.Is(err, domain.ErrVersionConflict))
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 409, appErr.HTTPStatus)
}

func TestCreateUserSingleCreatesPublishedVersionAndInitialRevision(t *testing.T) {
	schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	repo := &fakeCommunityRepo{
		fakeCatalogRepo: &fakeCatalogRepo{},
		directoryRef: &domain.DirectoryRef{
			SchoolID: schoolID, SchoolName: "示例大学", CampusID: campusID, CampusName: "主校区", CanteenID: canteenID, CanteenName: "第一食堂",
		},
	}
	svc := NewCatalogService(repo, nil)
	result, err := svc.CreateUserSingle(context.Background(), uuid.NewString(), CreateBatchInput{
		ClientBatchKey: "single-test", VenueType: "university", SchoolID: &schoolID, CampusID: &campusID, CanteenID: &canteenID,
		OrganizationName: "会被目录覆盖", CanteenName: "会被目录覆盖",
		Entries: []CreateCatalogItemInput{{EntryType: "dish", Name: "宫保鸡丁", ImagePaths: []string{"campus-food/dish.jpg"}, PriceType: "unknown"}},
	})

	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	require.Equal(t, "published", result.Items[0].Status)
	require.Equal(t, int64(1), result.Items[0].Version)
	require.Equal(t, "user_single", result.Items[0].SourceChannel)
	require.Len(t, repo.communityRevisions, 1)
	require.Equal(t, "create", repo.communityRevisions[0].ActionType)
	require.NotEmpty(t, repo.communityRevisions[0].ChangedFields)
}

func TestCreateCollectorBatchRequiresAuthorizedScope(t *testing.T) {
	schoolID, campusID, canteenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	repo := &fakeCommunityRepo{
		fakeCatalogRepo:  &fakeCatalogRepo{},
		directoryRef:     &domain.DirectoryRef{SchoolID: schoolID, SchoolName: "示例大学", CampusID: campusID, CampusName: "主校区", CanteenID: canteenID, CanteenName: "第一食堂"},
		collectorAllowed: false,
	}
	svc := NewCatalogService(repo, nil)
	_, err := svc.CreateCollectorBatch(context.Background(), uuid.NewString(), CreateBatchInput{
		ClientBatchKey: "collector-test", VenueType: "university", SchoolID: &schoolID, CampusID: &campusID, CanteenID: &canteenID,
		OrganizationName: "示例大学", CanteenName: "第一食堂",
		Entries: []CreateCatalogItemInput{{Name: "红烧肉", ImagePaths: []string{"campus-food/meat.jpg"}}},
	})
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 403, appErr.HTTPStatus)
}

func TestRollbackRevisionUsesOnlyCommunityEditableSnapshotFields(t *testing.T) {
	current := newPublishedCommunityItem()
	current.Floor = "三层"
	targetID := uuid.NewString()
	repo := &fakeCommunityRepo{
		fakeCatalogRepo: &fakeCatalogRepo{existingItem: current},
		appliedRevision: &domain.Revision{
			ID: targetID, CatalogItemID: current.ID, BaseVersion: 1, ResultVersion: 2,
			BeforeSnapshot: map[string]any{
				"name": current.Name, "floor": "一层", "entry_type": "dish",
				"price_text": "历史管理员原始文本", "source_filename": "old.jpg",
			},
		},
	}
	svc := NewCatalogService(repo, nil)

	result, err := svc.RollbackRevision(context.Background(), uuid.NewString(), current.ID, targetID, RollbackInput{
		BaseVersion: current.Version,
	})

	require.NoError(t, err)
	require.Equal(t, "一层", result.Item.Floor)
	require.Equal(t, int64(4), result.Item.Version)
	require.Equal(t, "rollback", result.Revision.ActionType)
	require.NotNil(t, result.Revision.RevertsRevisionID)
	require.Equal(t, targetID, *result.Revision.RevertsRevisionID)
	require.Equal(t, map[string]any{"floor": "一层", "name": current.Name}, result.Revision.ProposedPatch)
}

func TestApplyCollectorAllowsFreshApplicationAfterPriorApprovalExpired(t *testing.T) {
	schoolID := uuid.NewString()
	userID := uuid.NewString()
	repo := &fakeCommunityRepo{
		fakeCatalogRepo: &fakeCatalogRepo{},
		directoryRef:    &domain.DirectoryRef{SchoolID: schoolID, SchoolName: "示例大学"},
		collectorApplication: &domain.CollectorApplication{
			ID: uuid.NewString(), UserID: userID, SchoolID: schoolID, Status: "approved",
		},
	}
	svc := NewCatalogService(repo, nil)

	application, err := svc.ApplyCollector(context.Background(), userID, CollectorApplicationInput{SchoolID: schoolID})

	require.NoError(t, err)
	require.Equal(t, []string{"pending"}, repo.collectorFindStatuses)
	require.Equal(t, "pending", application.Status)
	require.NotEqual(t, "", application.ID)
}
