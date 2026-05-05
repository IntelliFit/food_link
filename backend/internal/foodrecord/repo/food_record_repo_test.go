package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.FoodRecord{}, &domain.CriticalSample{}))
	return db
}

func TestFoodRecordRepo_CRUD(t *testing.T) {
	db := setupTestDB(t)
	r := NewFoodRecordRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	desc := "test description"
	record := &domain.FoodRecord{
		UserID:        "user-1",
		MealType:      "lunch",
		Description:   &desc,
		TotalCalories: 500,
		TotalProtein:  20,
		TotalCarbs:    60,
		TotalFat:      15,
		RecordTime:    &now,
	}

	// Create
	err := r.Create(ctx, record)
	require.NoError(t, err)
	assert.NotEmpty(t, record.ID)

	// GetByID
	found, err := r.GetByID(ctx, record.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "lunch", found.MealType)
	assert.Equal(t, 500.0, found.TotalCalories)

	// ListByUser without date
	list, err := r.ListByUser(ctx, "user-1", "", 10)
	require.NoError(t, err)
	assert.Len(t, list, 1)

	// Update
	updates := map[string]any{"total_calories": 600}
	updated, err := r.Update(ctx, "user-1", record.ID, updates)
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, 600.0, updated.TotalCalories)

	// Delete
	err = r.Delete(ctx, "user-1", record.ID)
	require.NoError(t, err)

	// Get after delete
	found, err = r.GetByID(ctx, record.ID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestFoodRecordRepo_ListByUser_WithDate(t *testing.T) {
	db := setupTestDB(t)
	r := NewFoodRecordRepo(db)
	ctx := context.Background()

	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	t1 := time.Date(2024, 6, 15, 12, 0, 0, 0, chinaTZ).UTC()
	t2 := time.Date(2024, 6, 16, 12, 0, 0, 0, chinaTZ).UTC()

	err := r.Create(ctx, &domain.FoodRecord{UserID: "u1", MealType: "lunch", RecordTime: &t1})
	require.NoError(t, err)
	err = r.Create(ctx, &domain.FoodRecord{UserID: "u1", MealType: "dinner", RecordTime: &t2})
	require.NoError(t, err)

	list, err := r.ListByUser(ctx, "u1", "2024-06-15", 10)
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, "lunch", list[0].MealType)
}

func TestFoodRecordRepo_InsertCriticalSamples(t *testing.T) {
	db := setupTestDB(t)
	r := NewFoodRecordRepo(db)
	ctx := context.Background()

	items := []domain.CriticalSample{
		{FoodName: "apple", AIWeight: 100, UserWeight: 120, DeviationPercent: 20},
	}
	err := r.InsertCriticalSamples(ctx, "u1", items)
	require.NoError(t, err)

	var count int64
	db.Model(&domain.CriticalSample{}).Count(&count)
	assert.Equal(t, int64(1), count)
}
