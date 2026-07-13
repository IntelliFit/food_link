package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/require"
)

type fakeCatalogRepo struct {
	existing      *domain.CollectionBatch
	existingItems []domain.CatalogItem
	createdBatch  *domain.CollectionBatch
	createdItems  []domain.CatalogItem
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

func windowLayoutLabel(value string) string {
	if value == "continuous_counter" {
		return "连续长档口"
	}
	return value
}
