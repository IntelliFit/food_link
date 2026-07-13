package foodmedia

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLookupManualSourceImagePaths(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE public_food_library (
			id TEXT PRIMARY KEY,
			image_path TEXT,
			image_paths TEXT
		)
	`).Error)
	require.NoError(t, db.Exec(`
		CREATE TABLE food_nutrition_library (
			id TEXT PRIMARY KEY,
			canonical_name TEXT,
			image_path TEXT,
			image_paths TEXT
		)
	`).Error)
	require.NoError(t, db.Exec(`
		CREATE TABLE food_nutrition_aliases (
			alias_name TEXT,
			food_id TEXT
		)
	`).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO public_food_library (id, image_path, image_paths) VALUES (?, ?, ?)`,
		"pub-1", "public/thumb.jpg", `[]`,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO food_nutrition_library (id, canonical_name, image_path, image_paths) VALUES (?, ?, ?, ?)`,
		"nut-1", "米饭", "nutrition/rice.jpg", `[]`,
	).Error)

	require.NoError(t, db.Exec(
		`INSERT INTO food_nutrition_library (id, canonical_name, image_path, image_paths) VALUES (?, ?, ?, ?)`,
		"nut-rice", "白米饭", "nutrition/white-rice.jpg", `[]`,
	).Error)

	paths := LookupManualSourceImagePaths(context.Background(), db, []map[string]any{
		{"manual_source": "public_library", "manual_source_id": "pub-1"},
		{"manual_source": "nutrition_library", "manual_source_id": "nut-1"},
		{"manual_source": "nutrition_library", "manual_source_id": "catalog:白米饭"},
	})
	assert.Equal(t, []string{"public/thumb.jpg", "nutrition/rice.jpg", "nutrition/white-rice.jpg"}, paths)
}
