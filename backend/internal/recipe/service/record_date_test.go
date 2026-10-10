package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/common/dateutil"
	"food_link/backend/internal/recipe/domain"
	"food_link/backend/internal/recipe/repo"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUseRecipePreservesBackfillDateAndLegacyToday(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.Recipe{}, &domain.FoodRecord{}))
	r := repo.NewRecipeRepo(db)
	svc := NewRecipeService(r)
	ctx := context.Background()
	recipe := &domain.Recipe{UserID: "date-user", RecipeName: "测试收藏", Items: []map[string]any{{"name": "米饭", "weight": 100.0}}}
	require.NoError(t, r.Create(ctx, recipe))
	now := time.Now().In(dateutil.ChinaLocation())
	yesterday := now.AddDate(0, 0, -1).Format(dateutil.ChinaDateLayout)
	meal := "lunch"

	recordID, err := svc.Use(ctx, recipe.UserID, recipe.ID, &meal, nil, yesterday)
	require.NoError(t, err)
	var record domain.FoodRecord
	require.NoError(t, db.First(&record, "id = ?", recordID).Error)
	require.NotNil(t, record.RecordTime)
	assert.Equal(t, yesterday, record.RecordTime.In(dateutil.ChinaLocation()).Format(dateutil.ChinaDateLayout))
	assert.Equal(t, meal, record.MealType)
	used, err := r.Get(ctx, recipe.ID, recipe.UserID)
	require.NoError(t, err)
	require.NotNil(t, used.LastUsedAt)
	assert.Equal(t, dateutil.TodayChina(), used.LastUsedAt.In(dateutil.ChinaLocation()).Format(dateutil.ChinaDateLayout))

	legacyID, err := svc.Use(ctx, recipe.UserID, recipe.ID, nil, nil)
	require.NoError(t, err)
	record = domain.FoodRecord{}
	require.NoError(t, db.First(&record, "id = ?", legacyID).Error)
	assert.Equal(t, dateutil.TodayChina(), record.RecordTime.In(dateutil.ChinaLocation()).Format(dateutil.ChinaDateLayout))

	for _, invalid := range []string{"invalid", now.AddDate(0, 0, -14).Format(dateutil.ChinaDateLayout), now.AddDate(0, 0, 1).Format(dateutil.ChinaDateLayout)} {
		_, err = svc.Use(ctx, recipe.UserID, recipe.ID, nil, nil, invalid)
		require.Error(t, err)
	}
	var count int64
	require.NoError(t, db.Model(&domain.FoodRecord{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}
