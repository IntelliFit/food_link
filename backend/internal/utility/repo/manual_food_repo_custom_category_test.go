package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/utility/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const customCategoryTestUserID = "11111111-1111-4111-8111-111111111111"

func customSnackInput(category string) CustomFoodInput {
	return CustomFoodInput{
		Title:              "乐事薯片",
		Category:           category,
		DefaultWeightGrams: 75,
		TotalCalories:      400,
		TotalProtein:       5,
		TotalCarbs:         40,
		TotalFat:           25,
	}
}

// setupCustomCategoryRepo 补上线上表的唯一索引，同名保存走的是 ON CONFLICT。
func setupCustomCategoryRepo(t *testing.T) *ManualFoodRepo {
	t.Helper()
	db := setupTestDB(t)
	require.NoError(t, db.Exec(`CREATE UNIQUE INDEX idx_user_custom_foods_user_title ON user_custom_foods (user_id, normalized_title)`).Error)
	return NewManualFoodRepo(db)
}

func storedCustomCategory(t *testing.T, r *ManualFoodRepo, id string) string {
	t.Helper()
	var row domain.UserCustomFood
	require.NoError(t, r.db.Where("id = ?", id).First(&row).Error)
	return row.Category
}

func TestSaveCustomFood_StoresSnackCategory(t *testing.T) {
	r := setupCustomCategoryRepo(t)

	saved, err := r.SaveCustomFood(context.Background(), customCategoryTestUserID, customSnackInput("snack"))

	require.NoError(t, err)
	assert.Equal(t, "snack", saved.Category)
	assert.Equal(t, "custom", saved.Source)
	assert.Equal(t, "snack", storedCustomCategory(t, r, saved.ID))
}

func TestSaveCustomFood_DefaultsAndUnknownCategoriesStayCustom(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	ctx := context.Background()

	plain, err := r.SaveCustomFood(ctx, customCategoryTestUserID, customSnackInput(""))
	require.NoError(t, err)
	assert.Equal(t, "custom", plain.Category)

	input := customSnackInput("campus")
	input.Title = "家里卤牛肉"
	unknown, err := r.SaveCustomFood(ctx, customCategoryTestUserID, input)
	require.NoError(t, err)
	assert.Equal(t, "custom", unknown.Category)
}

// 线上旧版小程序和 App 保存时不带 category，同名覆盖不能把已归入零食的商品打回去。
func TestSaveCustomFood_ClientWithoutCategoryKeepsExistingOnUpsert(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	ctx := context.Background()
	first, err := r.SaveCustomFood(ctx, customCategoryTestUserID, customSnackInput("snack"))
	require.NoError(t, err)

	again, err := r.SaveCustomFood(ctx, customCategoryTestUserID, customSnackInput(""))

	require.NoError(t, err)
	assert.Equal(t, first.ID, again.ID)
	assert.Equal(t, "snack", again.Category)
	assert.Equal(t, "snack", storedCustomCategory(t, r, first.ID))
}

func TestSaveCustomFood_EditUpdatesOrKeepsCategory(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	ctx := context.Background()
	first, err := r.SaveCustomFood(ctx, customCategoryTestUserID, customSnackInput("snack"))
	require.NoError(t, err)

	keep := customSnackInput("")
	keep.ID = first.ID
	kept, err := r.SaveCustomFood(ctx, customCategoryTestUserID, keep)
	require.NoError(t, err)
	assert.Equal(t, "snack", kept.Category)
	assert.Equal(t, "snack", storedCustomCategory(t, r, first.ID))

	move := customSnackInput("custom")
	move.ID = first.ID
	moved, err := r.SaveCustomFood(ctx, customCategoryTestUserID, move)
	require.NoError(t, err)
	assert.Equal(t, "custom", moved.Category)
	assert.Equal(t, "custom", storedCustomCategory(t, r, first.ID))
}

func TestListCustomFoods_ReturnsStoredCategory(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	ctx := context.Background()
	_, err := r.SaveCustomFood(ctx, customCategoryTestUserID, customSnackInput("snack"))
	require.NoError(t, err)

	items, _, err := r.ListCustomFoods(ctx, customCategoryTestUserID, 10, 0)

	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "snack", items[0].Category)
}
