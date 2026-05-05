package service

import (
	"context"
	"testing"

	"food_link/backend/internal/utility/domain"
	"food_link/backend/internal/utility/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) (*gorm.DB, *repo.ManualFoodRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.ManualFood{}))
	return db, repo.NewManualFoodRepo(db)
}

func TestManualFoodService_Browse(t *testing.T) {
	db, foodRepo := setupTestDB(t)
	svc := NewManualFoodService(foodRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.ManualFood{ID: "f1", Name: "apple", Category: "fruit"}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f2", Name: "carrot", Category: "vegetable"}).Error)

	items, err := svc.Browse(ctx, "", 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)

	fruitItems, err := svc.Browse(ctx, "fruit", 0)
	require.NoError(t, err)
	assert.Len(t, fruitItems, 1)
	assert.Equal(t, "apple", fruitItems[0].Name)
}

func TestManualFoodService_Search(t *testing.T) {
	db, foodRepo := setupTestDB(t)
	svc := NewManualFoodService(foodRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.ManualFood{ID: "f1", Name: "green apple"}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f2", Name: "red apple"}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f3", Name: "banana"}).Error)

	items, err := svc.Search(ctx, "apple", 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)

	limited, err := svc.Search(ctx, "app", 1)
	require.NoError(t, err)
	assert.Len(t, limited, 1)
}

func TestQRCodeService_GenerateQRCode(t *testing.T) {
	svc := NewQRCodeService()
	ctx := context.Background()

	b64, err := svc.GenerateQRCode(ctx, "scene=123", "pages/index")
	require.NoError(t, err)
	assert.Contains(t, b64, "data:image/png;base64,")
}
