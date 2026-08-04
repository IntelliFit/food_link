package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	publicfooddomain "food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublishItemCreatesPublicCampusFoodAndMarksCatalogPublished(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.CatalogItem{}, &publishedCatalogItem{}))

	price := 12.0
	item := &domain.CatalogItem{
		ID: uuid.NewString(), BatchID: uuid.NewString(), EntryType: "dish", Name: "番茄炒饭",
		Description: "现炒", OrganizationName: "清华大学", AreaName: "紫荆园", CanteenName: "紫荆园",
		Floor: "2F", WindowName: "炒饭档口", PriceType: "fixed", Price: &price, PriceUnit: "元/份",
		ImagePaths: []string{"campus-food/rice.jpg"}, CompletenessStatus: "complete", Status: "draft",
	}
	require.NoError(t, db.Create(item).Error)
	repo := NewCatalogRepo(db)
	publishedAt := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)

	require.NoError(t, repo.PublishItem(context.Background(), item, "admin-1", publishedAt))

	var saved publishedCatalogItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Nil(t, saved.UserID)
	require.Equal(t, "published", saved.Status)
	require.Equal(t, "campus", saved.Type)
	require.True(t, saved.IsCampusFood)
	require.Equal(t, "番茄炒饭", saved.FoodName)
	require.Equal(t, []string{"campus-food/rice.jpg"}, saved.ImagePaths)
	require.Equal(t, "清华大学 · 紫荆园 · 2F · 炒饭档口", saved.CampusLocationText)

	var catalog domain.CatalogItem
	require.NoError(t, db.First(&catalog, "id = ?", item.ID).Error)
	require.Equal(t, "published", catalog.Status)
	require.NotNil(t, catalog.PublishedAt)
	require.Equal(t, "admin-1", *catalog.PublishedByAdminID)

	var publicView publicfooddomain.PublicFoodItem
	require.NoError(t, db.Table("public_food_library").First(&publicView, "id = ?", item.ID).Error)
	require.Empty(t, publicView.UserID)
}

func TestPublicPriceTypeMapsCatalogEnums(t *testing.T) {
	require.Equal(t, "fixed", publicPriceType("fixed"))
	require.Equal(t, "weight", publicPriceType("by_weight"))
	require.Equal(t, "unknown", publicPriceType("freeform"))
}
