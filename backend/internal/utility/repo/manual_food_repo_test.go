package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/utility/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.ManualFood{}))
	return db
}

func TestManualFoodRepo_List(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.ManualFood{ID: "f1", Name: "apple", Category: "fruit", Calories: 52}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f2", Name: "banana", Category: "fruit", Calories: 89}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f3", Name: "carrot", Category: "vegetable", Calories: 41}).Error)

	items, err := r.List(ctx, "", 0)
	require.NoError(t, err)
	assert.Len(t, items, 3)

	fruitItems, err := r.List(ctx, "fruit", 0)
	require.NoError(t, err)
	assert.Len(t, fruitItems, 2)
}

func TestManualFoodRepo_Search(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.ManualFood{ID: "f1", Name: "apple", Category: "fruit", Calories: 52}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f2", Name: "pineapple", Category: "fruit", Calories: 50}).Error)
	require.NoError(t, db.Create(&domain.ManualFood{ID: "f3", Name: "carrot", Category: "vegetable", Calories: 41}).Error)

	items, err := r.Search(ctx, "apple", 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)

	limited, err := r.Search(ctx, "app", 1)
	require.NoError(t, err)
	assert.Len(t, limited, 1)
}
