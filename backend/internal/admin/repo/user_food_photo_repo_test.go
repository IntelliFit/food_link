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
			telephone text,
			public_records boolean DEFAULT true
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
			items jsonb NOT NULL DEFAULT '[]'::jsonb,
			description text,
			source_task_id text,
			record_time timestamptz,
			created_at timestamptz,
			hidden_from_feed boolean NOT NULL DEFAULT false,
			total_calories numeric DEFAULT 0,
			total_protein numeric DEFAULT 0,
			total_carbs numeric DEFAULT 0,
			total_fat numeric DEFAULT 0
		);
		CREATE TABLE public_food_library (
			id text PRIMARY KEY,
			user_id text,
			source_record_id text,
			image_path text,
			image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
			items jsonb NOT NULL DEFAULT '[]'::jsonb,
			total_calories numeric DEFAULT 0,
			total_protein numeric DEFAULT 0,
			total_carbs numeric DEFAULT 0,
			total_fat numeric DEFAULT 0,
			food_name text,
			description text,
			status text NOT NULL,
			created_at timestamptz,
			updated_at timestamptz
		);
		CREATE TABLE packaged_food_correction_submissions (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			status text NOT NULL,
			comment text,
			evidence_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
			created_at timestamptz,
			updated_at timestamptz,
			deleted_at timestamptz
		);
		CREATE TABLE user_recipes (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			recipe_name text NOT NULL,
			description text,
			image_path text,
			created_at timestamptz,
			updated_at timestamptz
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

func TestUserFoodPhotoRepoListIncludesEveryUserFoodPhotoSurface(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, repo.db.Exec(`INSERT INTO weapp_user (id, nickname) VALUES ('user-1', '全量用户')`).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, payload, created_at)
		VALUES
			('packaged-task', 'user-1', 'packaged_product_extract', 'done', 'packaged.jpg', '{}', ?),
			('expiry-task', 'user-1', 'expiry_recognize', 'done', 'expiry.jpg', '{}', ?)
	`, now, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO public_food_library (id, user_id, image_path, image_paths, food_name, status, created_at)
		VALUES ('public-1', 'user-1', 'public.jpg', '[]', '用户分享菜品', 'published', ?)
	`, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO packaged_food_correction_submissions (id, user_id, status, comment, evidence_image_urls, created_at)
		VALUES ('correction-1', 'user-1', 'pending', '包装营养标签', '["label.jpg"]', ?)
	`, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO user_recipes (id, user_id, recipe_name, image_path, created_at)
		VALUES ('recipe-1', 'user-1', '番茄炒蛋', 'recipe.jpg', ?)
	`, now).Error)

	result, err := repo.List(context.Background(), ListUserFoodPhotoInput{Limit: 40})

	require.NoError(t, err)
	assert.Equal(t, int64(5), result.Total)
	require.Len(t, result.Items, 5)
	byPath := map[string]UserFoodPhoto{}
	for _, item := range result.Items {
		byPath[item.ImagePath] = item
	}
	assert.Equal(t, "analysis_task", byPath["packaged.jpg"].SourceType)
	assert.Equal(t, "analysis_task", byPath["expiry.jpg"].SourceType)
	assert.Equal(t, "public_food", byPath["public.jpg"].SourceType)
	assert.Equal(t, "packaged_correction", byPath["label.jpg"].SourceType)
	assert.Equal(t, "user_recipe", byPath["recipe.jpg"].SourceType)
}

func TestUserFoodPhotoRepoListStillWorksWithoutPackagedCorrectionTable(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, repo.db.Exec(`DROP TABLE packaged_food_correction_submissions`).Error)
	require.NoError(t, repo.db.Exec(`INSERT INTO weapp_user (id, nickname) VALUES ('user-1', '兼容用户')`).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, payload, created_at)
		VALUES ('task-1', 'user-1', 'food', 'done', 'meal.jpg', '{}', ?)
	`, now).Error)

	result, err := repo.List(context.Background(), ListUserFoodPhotoInput{Limit: 40})

	require.NoError(t, err)
	assert.Equal(t, int64(1), result.Total)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "meal.jpg", result.Items[0].ImagePath)
}

func TestUserFoodPhotoRepoListClassifiesAndFiltersCircleVisibility(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, repo.db.Exec(`
		INSERT INTO weapp_user (id, nickname, public_records)
		VALUES ('user-public', '公开用户', true), ('user-private', '隐私用户', false)
	`).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, payload, created_at)
		VALUES
			('task-visible', 'user-public', 'food', 'done', 'visible.jpg', '{}', ?),
			('task-hidden', 'user-public', 'food', 'done', 'hidden.jpg', '{}', ?),
			('task-unsaved', 'user-public', 'food', 'done', 'unsaved.jpg', '{}', ?),
			('task-private-profile', 'user-private', 'food', 'done', 'private-profile.jpg', '{}', ?)
	`, now, now, now, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO user_food_records (id, user_id, image_path, source_task_id, created_at, hidden_from_feed)
		VALUES
			('record-visible', 'user-public', 'visible.jpg', 'task-visible', ?, false),
			('record-hidden', 'user-public', 'hidden.jpg', 'task-hidden', ?, true),
			('record-private-profile', 'user-private', 'private-profile.jpg', 'task-private-profile', ?, false)
	`, now, now, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO user_recipes (id, user_id, recipe_name, image_path, created_at)
		VALUES ('recipe-1', 'user-public', '私房菜', 'recipe.jpg', ?)
	`, now).Error)

	all, err := repo.List(context.Background(), ListUserFoodPhotoInput{Limit: 40})
	require.NoError(t, err)
	byPath := map[string]UserFoodPhoto{}
	for _, item := range all.Items {
		byPath[item.ImagePath] = item
	}
	assert.Equal(t, "visible", byPath["visible.jpg"].CircleVisibility)
	assert.Equal(t, "not_shared", byPath["hidden.jpg"].CircleVisibility)
	assert.Equal(t, "not_shared", byPath["unsaved.jpg"].CircleVisibility)
	assert.Equal(t, "not_shared", byPath["private-profile.jpg"].CircleVisibility)
	assert.Equal(t, "not_applicable", byPath["recipe.jpg"].CircleVisibility)

	visible, err := repo.List(context.Background(), ListUserFoodPhotoInput{CircleVisibility: "visible", Limit: 40})
	require.NoError(t, err)
	assert.Equal(t, int64(1), visible.Total)
	require.Len(t, visible.Items, 1)
	assert.Equal(t, "visible.jpg", visible.Items[0].ImagePath)

	notShared, err := repo.List(context.Background(), ListUserFoodPhotoInput{CircleVisibility: "not_shared", Limit: 40})
	require.NoError(t, err)
	assert.Equal(t, int64(3), notShared.Total)
}

func TestUserFoodPhotoRepoListCollectsNutritionFromRecordAndAnalysis(t *testing.T) {
	repo := setupUserFoodPhotoTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, repo.db.Exec(`INSERT INTO weapp_user (id, nickname) VALUES ('user-1', '营养用户')`).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, payload, result, created_at)
		VALUES
			('task-recorded', 'user-1', 'food', 'done', 'recorded.jpg', '{}', '{"items":[{"name":"旧分析","nutrients":{"calories":999,"protein":99}}]}', ?),
			('task-only', 'user-1', 'food', 'done', 'analysis.jpg', '{}', '{"items":[{"name":"鸡蛋","nutrients":{"calories":120,"protein":10,"carbs":2,"fat":8,"fiber":1.5,"sodiumMg":230,"vitaminCMg":6}},{"name":"牛奶","nutrients":{"calories":80,"protein":4,"carbs":9,"fat":3,"calcium_mg":180,"vitamin_b12_mcg":1.2}}]}', ?)
	`, now, now).Error)
	require.NoError(t, repo.db.Exec(`
		INSERT INTO user_food_records (id, user_id, image_path, source_task_id, items, total_calories, total_protein, total_carbs, total_fat, created_at)
		VALUES ('record-1', 'user-1', 'recorded.jpg', 'task-recorded', '[{"name":"用户修正餐","nutrients":{"calories":450,"protein":28,"carbs":40,"fat":18,"ironMg":3.2}}]', 500, 30, 45, 20, ?)
	`, now).Error)

	result, err := repo.List(context.Background(), ListUserFoodPhotoInput{Limit: 40})

	require.NoError(t, err)
	byPath := map[string]UserFoodPhoto{}
	for _, item := range result.Items {
		byPath[item.ImagePath] = item
	}
	recorded := byPath["recorded.jpg"].Nutrition
	require.NotNil(t, recorded)
	assert.Equal(t, "food_record", recorded.Source)
	assert.Equal(t, 500.0, recorded.Calories)
	assert.Equal(t, 30.0, recorded.Protein)
	assert.Equal(t, 3.2, recorded.IronMg)
	assert.Equal(t, []string{"用户修正餐"}, recorded.ItemNames)

	analysis := byPath["analysis.jpg"].Nutrition
	require.NotNil(t, analysis)
	assert.Equal(t, "analysis_result", analysis.Source)
	assert.Equal(t, 200.0, analysis.Calories)
	assert.Equal(t, 14.0, analysis.Protein)
	assert.Equal(t, 230.0, analysis.SodiumMg)
	assert.Equal(t, 180.0, analysis.CalciumMg)
	assert.Equal(t, 1.2, analysis.VitaminB12Mcg)
	assert.Equal(t, []string{"鸡蛋", "牛奶"}, analysis.ItemNames)
}
