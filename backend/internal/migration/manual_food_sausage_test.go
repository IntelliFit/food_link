package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigrateManualFoodSausageIsIdempotent(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE food_nutrition_library (
			id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
			canonical_name text NOT NULL,
			normalized_name text NOT NULL UNIQUE,
			kcal_per_100g numeric NOT NULL DEFAULT 0,
			protein_per_100g numeric NOT NULL DEFAULT 0,
			carbs_per_100g numeric NOT NULL DEFAULT 0,
			fat_per_100g numeric NOT NULL DEFAULT 0,
			is_active boolean NOT NULL DEFAULT true,
			source text,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE food_nutrition_aliases (
			id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
			food_id text NOT NULL,
			alias_name text NOT NULL,
			normalized_alias text NOT NULL UNIQUE,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE user_food_records (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			items jsonb NOT NULL
		);
		INSERT INTO food_nutrition_library (
			id, canonical_name, normalized_name, kcal_per_100g,
			protein_per_100g, carbs_per_100g, fat_per_100g, is_active
		) VALUES
			('generic-sausage', '香肠', '香肠', 300, 14, 10, 24, true),
			('taiwan-sausage', '台式烤香肠', '台式烤香肠', 0, 0, 0, 0, false);
		INSERT INTO food_nutrition_aliases (
			id, food_id, alias_name, normalized_alias
		) VALUES ('grilled-alias', 'generic-sausage', '烤香肠', '烤香肠');
		INSERT INTO user_food_records (id, user_id, items) VALUES
			('r1', 'u1', '[
				{"name":"烤香肠","intake":60,"nutrients":{"calories":221}},
				{"name":"鸡蛋","intake":50,"nutrients":{"calories":72}}
			]'),
			('r2', 'u1', '[
				{"name":"台式烤香肠","manual_source_title":"台式烤香肠","intake":51,"nutrients":{"calories":177}}
			]')
	`).Error)

	require.NoError(t, MigrateManualFoodSausage(context.Background(), db, "public"))
	require.NoError(t, MigrateManualFoodSausage(context.Background(), db, "public"))

	var nutrition struct {
		CanonicalName  string  `gorm:"column:canonical_name"`
		KcalPer100g    float64 `gorm:"column:kcal_per_100g"`
		ProteinPer100g float64 `gorm:"column:protein_per_100g"`
		CarbsPer100g   float64 `gorm:"column:carbs_per_100g"`
		FatPer100g     float64 `gorm:"column:fat_per_100g"`
		IsActive       bool    `gorm:"column:is_active"`
	}
	require.NoError(t, db.Raw(`
		SELECT canonical_name, kcal_per_100g, protein_per_100g,
			carbs_per_100g, fat_per_100g, is_active
		FROM food_nutrition_library
		WHERE id = 'taiwan-sausage'
	`).Scan(&nutrition).Error)
	assert.Equal(t, "台式烤香肠", nutrition.CanonicalName)
	assert.InDelta(t, 350, nutrition.KcalPer100g, 0.01)
	assert.InDelta(t, 17, nutrition.ProteinPer100g, 0.01)
	assert.InDelta(t, 6, nutrition.CarbsPer100g, 0.01)
	assert.InDelta(t, 28, nutrition.FatPer100g, 0.01)
	assert.True(t, nutrition.IsActive)

	var aliasCount int64
	require.NoError(t, db.Raw(`
		SELECT COUNT(*)
		FROM food_nutrition_aliases
		WHERE food_id = 'taiwan-sausage'
			AND normalized_alias IN ('烤香肠', '台式烤香肠')
	`).Scan(&aliasCount).Error)
	assert.EqualValues(t, 2, aliasCount)

	var updatedItems int64
	require.NoError(t, db.Raw(`
		SELECT COUNT(*)
		FROM user_food_records
		CROSS JOIN LATERAL jsonb_array_elements(items) AS expanded(item)
		WHERE item->>'name' = '台式烤香肠'
			AND item->>'manual_source' = 'nutrition_library'
			AND item->>'manual_source_id' = 'taiwan-sausage'
			AND item->>'manual_source_title' = '台式烤香肠'
	`).Scan(&updatedItems).Error)
	assert.EqualValues(t, 2, updatedItems)

	var unrelatedItems int64
	require.NoError(t, db.Raw(`
		SELECT COUNT(*)
		FROM user_food_records
		CROSS JOIN LATERAL jsonb_array_elements(items) AS expanded(item)
		WHERE item->>'name' = '鸡蛋'
	`).Scan(&unrelatedItems).Error)
	assert.EqualValues(t, 1, unrelatedItems)
}
