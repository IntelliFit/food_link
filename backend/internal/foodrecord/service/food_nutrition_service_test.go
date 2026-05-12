package service

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupFoodNutritionTestDB(t *testing.T) (*gorm.DB, *repo.FoodNutritionRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.FoodNutrition{}, &domain.FoodNutritionAlias{}, &domain.FoodUnresolvedLog{}))
	return db, repo.NewFoodNutritionRepo(db)
}

func TestFoodNutritionService_Search(t *testing.T) {
	db, nutritionRepo := setupFoodNutritionTestDB(t)
	svc := NewFoodNutritionService(nutritionRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{ID: "f1", CanonicalName: "Apple", KcalPer100g: 52, IsActive: true}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{ID: "f2", CanonicalName: "Banana", KcalPer100g: 89, IsActive: true}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{ID: "f3", CanonicalName: "Pineapple", KcalPer100g: 50, IsActive: true}).Error)

	items, err := svc.Search(ctx, "apple", 10)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	assert.Equal(t, "Apple", items[0]["canonical_name"])
	assert.Equal(t, "canonical", items[0]["match_source"])
}

func TestFoodNutritionService_Search_EmptyQuery(t *testing.T) {
	_, nutritionRepo := setupFoodNutritionTestDB(t)
	svc := NewFoodNutritionService(nutritionRepo)
	ctx := context.Background()

	_, err := svc.Search(ctx, "", 10)
	assert.Error(t, err)
}

func TestFoodNutritionService_Search_Alias(t *testing.T) {
	db, nutritionRepo := setupFoodNutritionTestDB(t)
	svc := NewFoodNutritionService(nutritionRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{ID: "f1", CanonicalName: "Apple", KcalPer100g: 52, IsActive: true}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{ID: "a1", FoodID: "f1", AliasName: "红富士"}).Error)

	items, err := svc.Search(ctx, "红富士", 10)
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "alias", items[0]["match_source"])
}

func TestFoodNutritionService_Search_NoResults(t *testing.T) {
	db, nutritionRepo := setupFoodNutritionTestDB(t)
	svc := NewFoodNutritionService(nutritionRepo)
	ctx := context.Background()

	items, err := svc.Search(ctx, "nonexistent", 10)
	require.NoError(t, err)
	assert.Len(t, items, 0)

	// Verify log was created
	var logs []domain.FoodUnresolvedLog
	db.Find(&logs)
	assert.Len(t, logs, 1)
	assert.Equal(t, "nonexistent", logs[0].RawName)
}

func TestFoodNutritionService_GetUnresolvedTop(t *testing.T) {
	db, nutritionRepo := setupFoodNutritionTestDB(t)
	svc := NewFoodNutritionService(nutritionRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodUnresolvedLog{ID: "l1", RawName: "a", HitCount: 5}).Error)
	require.NoError(t, db.Create(&domain.FoodUnresolvedLog{ID: "l2", RawName: "b", HitCount: 10}).Error)

	items, err := svc.GetUnresolvedTop(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	assert.Equal(t, "b", items[0].RawName)
}
