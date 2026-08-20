package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupUserFoodPhotoTestDB(t *testing.T) *UserFoodPhotoRepo {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE weapp_user (
			id text PRIMARY KEY,
			nickname text,
			avatar text,
			telephone text
		);
		CREATE TABLE analysis_tasks (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			task_type text NOT NULL,
			status text NOT NULL,
			image_url text,
			image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
			payload jsonb NOT NULL DEFAULT '{}'::jsonb,
			result jsonb,
			created_at timestamptz,
			updated_at timestamptz
		);
		CREATE TABLE user_food_records (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			image_path text,
			image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
			description text,
			source_task_id text,
			record_time timestamptz,
			created_at timestamptz
		)
	`).Error)
	return NewUserFoodPhotoRepo(db)
}

func TestUserFoodPhotoRepoListDeduplicatesAndExcludesInternalUploads(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	db := repo.db
	now := time.Now().UTC()
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, nickname, avatar, telephone) VALUES ('user-1', '测试用户', 'avatar.jpg', '13800000000')`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, image_paths, payload, result, created_at)
		VALUES
			('task-1', 'user-1', 'food', 'done', 'meal-a.jpg', '["meal-a.jpg", "meal-b.jpg"]', '{}', '{"description":"午餐"}', ?),
			('task-internal', 'user-1', 'food', 'done', 'internal.jpg', '[]', '{"internal_benchmark":true}', '{}', ?)
	`, now, now).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO user_food_records (id, user_id, image_path, image_paths, description, source_task_id, created_at)
		VALUES
			('record-1', 'user-1', 'meal-a.jpg', '["meal-a.jpg", "meal-b.jpg"]', '已保存午餐', 'task-1', ?),
			('record-2', 'user-1', 'manual.jpg', '[]', '手动补图', NULL, ?)
	`, now, now).Error)

	result, err := repo.List(context.Background(), ListUserFoodPhotoInput{Limit: 40})

	require.NoError(t, err)
	assert.Equal(t, int64(3), result.Total)
	require.Len(t, result.Items, 3)
	byPath := map[string]UserFoodPhoto{}
	for _, item := range result.Items {
		byPath[item.ImagePath] = item
	}
	assert.Equal(t, "analysis_task", byPath["meal-a.jpg"].SourceType)
	assert.Equal(t, "record-1", byPath["meal-a.jpg"].RecordID)
	assert.Equal(t, "analysis_task", byPath["meal-b.jpg"].SourceType)
	assert.Equal(t, "food_record", byPath["manual.jpg"].SourceType)
	assert.NotContains(t, byPath, "internal.jpg")
}

func TestUserFoodPhotoRepoListFiltersByUserAndStatus(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, repo.db.Exec(`INSERT INTO weapp_user (id, nickname) VALUES ('user-1', '小马')`).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, payload, created_at)
		VALUES ('task-1', 'user-1', 'food', 'failed', 'failed.jpg', '{}', ?)
	`, now).Error)

	result, err := repo.List(context.Background(), ListUserFoodPhotoInput{Query: "小马", Source: "analysis_task", Status: "failed", Limit: 20})

	require.NoError(t, err)
	assert.Equal(t, int64(1), result.Total)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "failed.jpg", result.Items[0].ImagePath)
}
