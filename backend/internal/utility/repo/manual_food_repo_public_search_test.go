package repo

import (
	"context"
	"encoding/json"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomFoodPublicSearch(t *testing.T) {
	r := setupCustomCategoryRepo(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	ctx := context.Background()
	owner := customCategoryTestUserID
	other := "22222222-2222-4222-8222-222222222222"
	input := customSnackInput("snack")
	input.Title = "共享测试薯片"
	input.NutrientsPer100g = map[string]any{"calories": 500, "protein": 5, "carbs": 50, "fat": 30}
	input.ShareToPublic = true
	saved, err := r.SaveCustomFood(ctx, owner, input)
	require.NoError(t, err)
	assert.True(t, saved.CanEdit)
	itemJSON, err := json.Marshal([]map[string]any{{
		"name": input.Title, "manual_source": "custom", "manual_source_id": saved.ID,
		"weight": 75, "nutrients": map[string]any{"calories": 400},
	}})
	require.NoError(t, err)
	for _, viewer := range []string{owner, other} {
		require.NoError(t, r.db.Exec(`INSERT INTO user_food_records (id, user_id, items, record_time) VALUES (?, ?, ?::jsonb, CURRENT_TIMESTAMP)`, viewer, viewer, string(itemJSON)).Error)
	}

	// 未公开、待审核和下架的数据不能混入其他用户或游客的结果。
	for _, state := range []string{"private", "pending", "rejected"} {
		privateInput := input
		privateInput.Title = "共享测试" + state
		privateInput.ShareToPublic = false
		privateFood, saveErr := r.SaveCustomFood(ctx, owner, privateInput)
		require.NoError(t, saveErr)
		require.NoError(t, r.db.Model(&domain.UserCustomFood{}).Where("id = ?", privateFood.ID).Update("public_status", state).Error)
	}

	t.Run("other users and guests can search immediately", func(t *testing.T) {
		for _, viewer := range []string{other, ""} {
			items, searchErr := r.Search(ctx, viewer, "共享测试", 20)
			require.NoError(t, searchErr)
			require.Len(t, items, 1)
			assert.Equal(t, saved.ID, items[0].ID)
			assert.Equal(t, "custom", items[0].Source)
			assert.Equal(t, "用户贡献", items[0].SourceLabel)
			assert.False(t, items[0].CanEdit)
			require.NotNil(t, items[0].NutrientsPer100g)
			assert.Equal(t, 500.0, items[0].NutrientsPer100g.Calories)
		}
		mine, _, listErr := r.ListCustomFoods(ctx, other, 20, 0)
		require.NoError(t, listErr)
		assert.Empty(t, mine, "他人贡献不能变成自己的自定义食物")
		owned, searchErr := r.Search(ctx, owner, input.Title, 20)
		require.NoError(t, searchErr)
		require.Len(t, owned, 1)
		assert.True(t, owned[0].CanEdit, "自己的最近记录仍可编辑原食物")
	})

	t.Run("only creator may edit or delete", func(t *testing.T) {
		edit := input
		edit.ID = saved.ID
		edit.Title = "他人不应覆盖"
		_, editErr := r.SaveCustomFood(ctx, other, edit)
		assert.ErrorIs(t, editErr, commonerrors.ErrNotFound)
		assert.ErrorIs(t, r.DeleteCustomFood(ctx, other, saved.ID), commonerrors.ErrNotFound)
	})

	t.Run("publishing an existing food updates the same entry", func(t *testing.T) {
		privateInput := input
		privateInput.Title = "旧食物公开测试"
		privateInput.ShareToPublic = false
		privateFood, saveErr := r.SaveCustomFood(ctx, owner, privateInput)
		require.NoError(t, saveErr)
		privateInput.ID = privateFood.ID
		privateInput.ShareToPublic = true
		published, publishErr := r.SaveCustomFood(ctx, owner, privateInput)
		require.NoError(t, publishErr)
		assert.Equal(t, privateFood.ID, published.ID)
		items, searchErr := r.Search(ctx, other, privateInput.Title, 20)
		require.NoError(t, searchErr)
		require.Len(t, items, 1)
		assert.Equal(t, privateFood.ID, items[0].ID)
	})

	t.Run("edits are visible immediately and deleting removes search results", func(t *testing.T) {
		input.ID = saved.ID
		input.TotalCalories = 300
		edited, editErr := r.SaveCustomFood(ctx, owner, input)
		require.NoError(t, editErr)
		assert.Equal(t, saved.ID, edited.ID)
		items, searchErr := r.Search(ctx, other, "共享测试", 20)
		require.NoError(t, searchErr)
		require.Len(t, items, 1)
		assert.Equal(t, 300.0, items[0].TotalCalories)
		assert.False(t, items[0].CanEdit)
		require.NoError(t, r.DeleteCustomFood(ctx, owner, saved.ID))
		items, searchErr = r.Search(ctx, other, "共享测试", 20)
		require.NoError(t, searchErr)
		assert.Empty(t, items)
		items, searchErr = r.Search(ctx, "", "共享测试", 20)
		require.NoError(t, searchErr)
		assert.Empty(t, items, "游客也不能从历史录餐聚合中搜回已删除贡献")
	})
}
