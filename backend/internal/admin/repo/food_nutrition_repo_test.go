package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFoodNutritionRepoTest(t *testing.T) *FoodNutritionRepo {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE food_nutrition_library (
			id text PRIMARY KEY,
			canonical_name text NOT NULL,
			normalized_name text NOT NULL,
			image_path text,
			image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
			source text NOT NULL DEFAULT '',
			is_active boolean NOT NULL DEFAULT true,
			quality_tier text NOT NULL DEFAULT '',
			kcal_per_100g numeric NOT NULL DEFAULT 0,
			protein_per_100g numeric NOT NULL DEFAULT 0,
			carbs_per_100g numeric NOT NULL DEFAULT 0,
			fat_per_100g numeric NOT NULL DEFAULT 0,
			created_at timestamptz,
			updated_at timestamptz
		);
		CREATE TABLE food_nutrition_aliases (
			id text PRIMARY KEY,
			food_id text NOT NULL,
			alias_name text NOT NULL,
			normalized_alias text NOT NULL
		)
	`).Error)
	return NewFoodNutritionRepo(db)
}

func TestFoodNutritionRepoListPrioritizesFoodsWithImages(t *testing.T) {
	repository := setupFoodNutritionRepoTest(t)
	now := time.Now()
	require.NoError(t, repository.db.Exec(`
		INSERT INTO food_nutrition_library
			(id, canonical_name, normalized_name, image_path, image_paths, updated_at)
		VALUES
			('new-no-image', '新无图', '新无图', NULL, '[]', ?),
			('old-image-path', '旧单图', '旧单图', 'standard-food/old.jpg', '[]', ?),
			('old-image-paths', '旧多图', '旧多图', NULL, '["standard-food/old-2.jpg"]', ?)
	`, now, now.Add(-time.Hour), now.Add(-2*time.Hour)).Error)

	result, err := repository.List(context.Background(), ListFoodNutritionInput{Limit: 10})

	require.NoError(t, err)
	require.Len(t, result.Items, 3)
	assert.Equal(t, []string{"old-image-path", "old-image-paths", "new-no-image"}, []string{
		result.Items[0].ID, result.Items[1].ID, result.Items[2].ID,
	})
}

func TestFoodNutritionRepoSearchPrioritizesFoodsWithImages(t *testing.T) {
	repository := setupFoodNutritionRepoTest(t)
	require.NoError(t, repository.db.Exec(`
		INSERT INTO food_nutrition_library
			(id, canonical_name, normalized_name, image_path, image_paths)
		VALUES
			('exact-no-image', '酸菜', '酸菜', NULL, '[]'),
			('related-with-image', '酸菜鱼', '酸菜鱼', NULL, '["standard-food/pickled-fish.jpg"]')
	`).Error)

	result, err := repository.List(context.Background(), ListFoodNutritionInput{Query: "酸菜", Limit: 10})

	require.NoError(t, err)
	require.Len(t, result.Items, 2)
	assert.Equal(t, "related-with-image", result.Items[0].ID)
	assert.Equal(t, "exact-no-image", result.Items[1].ID)
}

func TestNormalizeFoodNutritionNameFoldsCulinaryVariant(t *testing.T) {
	assert.Equal(t, normalizeFoodNutritionName("酸菜汆白肉"), normalizeFoodNutritionName("酸菜氽白肉"))
}
