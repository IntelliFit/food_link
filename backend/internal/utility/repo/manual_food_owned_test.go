package repo

import (
	"context"
	"fmt"
	"testing"
	"time"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestOwnedManualFoodsIncludesAllImportSources(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	r := NewManualFoodRepo(db)
	ctx := context.Background()
	now := time.Now()
	for _, row := range []domain.UserCustomFood{
		{ID: "own", UserID: "owner", Title: "同名零食", Status: "active", CreatedAt: &now, DefaultWeightGrams: 100, TotalCalories: 500},
		{ID: "deleted", UserID: "owner", Title: "已删除食物", Status: "deleted", CreatedAt: &now},
		{ID: "other-custom", UserID: "other", Title: "别人的自定义", Status: "active", PublicStatus: "published", CreatedAt: &now},
	} {
		require.NoError(t, db.Create(&row).Error)
	}
	for _, id := range []string{"reward", "capture", "zero", "foreign", "hidden", "pending"} {
		status, active := "active", true
		if id == "hidden" {
			active = false
		}
		if id == "pending" {
			status = "pending_review"
		}
		calories := 500.0
		if id == "zero" {
			calories = 0
		}
		require.NoError(t, db.Create(&fooddomain.PackagedFood{ID: id, ProductName: "同名零食", KcalPer100g: calories, NetWeightG: 90, IsActive: active, ReviewStatus: status}).Error)
	}
	for index, row := range []struct{ user, food, status string }{
		{"owner", "reward", "succeeded"}, {"owner", "reward", "failed"}, // Dedupe repeated uploads.
		{"owner", "zero", "failed"}, // Reward cap/failure does not erase a valid import.
		{"owner", "hidden", "succeeded"}, {"owner", "pending", "succeeded"},
		{"other", "foreign", "succeeded"},
	} {
		require.NoError(t, db.Exec(`INSERT INTO reward_task_uploads (id,user_id,task_type,status,packaged_food_id,created_at) VALUES (?,?,'packaged_food_upload',?,?,?)`, fmt.Sprint(index), row.user, row.status, row.food, now).Error)
	}
	for index, row := range []struct{ user, kind, status, result string }{
		{"owner", "packaged_product_extract", "done", `{"packaged_product":{"packaged_food_id":"reward"}}`},
		{"owner", "packaged_product_extract", "done", `{"packaged_product":{"auto_ingest_result":{"packaged_food_id":"capture"}}}`},
		{"owner", "packaged_product_extract", "done", `{"nutrition":{"packaged_food_id":"zero"}}`},
		{"owner", "packaged_product_extract", "failed", `{"packaged_product":{"packaged_food_id":"foreign"}}`},
		{"owner", "food", "done", `{"packaged_product":{"packaged_food_id":"foreign"}}`},
		{"other", "packaged_product_extract", "done", `{"packaged_product":{"packaged_food_id":"foreign"}}`},
	} {
		require.NoError(t, db.Exec(`INSERT INTO analysis_tasks (id,user_id,task_type,status,result,created_at) VALUES (?,?,?,?,?::jsonb,?)`, fmt.Sprint(index), row.user, row.kind, row.status, row.result, now).Error)
	}

	legacy, _, err := r.ListCustomFoods(ctx, "owner", 20, 0)
	require.NoError(t, err)
	require.Len(t, legacy, 1, "old clients keep their custom-only list")
	first, hasMore, err := r.ListOwnedFoods(ctx, "owner", 2, 0)
	require.NoError(t, err)
	require.Len(t, first, 2)
	require.True(t, hasMore)
	second, hasMore, err := r.ListOwnedFoods(ctx, "owner", 2, 2)
	require.NoError(t, err)
	require.Len(t, second, 2)
	require.False(t, hasMore)
	items := append(first, second...)
	ids := []string{}
	for _, item := range items {
		ids = append(ids, item.ID)
		if item.Source == "packaged_food" {
			require.False(t, item.CanEdit, "importing a shared package must not grant ownership")
			require.Equal(t, "包装导入", item.SourceLabel)
		} else {
			require.True(t, item.CanEdit)
		}
	}
	require.ElementsMatch(t, []string{"own", "reward", "capture", "zero"}, ids)
	other, _, err := r.ListOwnedFoods(ctx, "other", 20, 0)
	require.NoError(t, err)
	require.Len(t, other, 2, "other users' public/custom rows must not enter the owner's list")
	empty, hasMore, err := r.ListOwnedFoods(ctx, "", 20, 0)
	require.NoError(t, err)
	require.Empty(t, empty)
	require.False(t, hasMore)
}
