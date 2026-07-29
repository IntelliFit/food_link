package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigrateManualFoodSausageIsIdempotentAndRecalculatesRecords(t *testing.T) {
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
			quality_tier text NOT NULL DEFAULT 'unreviewed',
			quality_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
			quality_reviewed_at timestamptz,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE food_nutrition_aliases (
			id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
			food_id text NOT NULL,
			alias_name text NOT NULL,
			normalized_alias text NOT NULL UNIQUE,
			match_status text NOT NULL DEFAULT 'candidate_only',
			approval_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
			reviewed_at timestamptz,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE user_food_records (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			items jsonb NOT NULL,
			total_calories numeric NOT NULL DEFAULT 0,
			total_protein numeric NOT NULL DEFAULT 0,
			total_carbs numeric NOT NULL DEFAULT 0,
			total_fat numeric NOT NULL DEFAULT 0,
			total_weight_grams integer NOT NULL DEFAULT 0
		);
		INSERT INTO food_nutrition_library (
			id, canonical_name, normalized_name, kcal_per_100g,
			protein_per_100g, carbs_per_100g, fat_per_100g, is_active
		) VALUES
			('generic-sausage', '香肠', '香肠', 300, 14, 10, 24, true),
			('taiwan-sausage', '台式烤香肠', '台式烤香肠', 0, 0, 0, 0, false),
			('legacy-taiwan-sausage', '台湾烤肠', '台湾烤肠', 280, 12, 10, 21, true);
		INSERT INTO food_nutrition_aliases (
			id, food_id, alias_name, normalized_alias
		) VALUES
			('grilled-alias', 'generic-sausage', '烤香肠', '烤香肠'),
			('legacy-extra-alias', 'legacy-taiwan-sausage', '台湾香肠', '台湾香肠');
		INSERT INTO user_food_records (
			id, user_id, items, total_calories, total_protein,
			total_carbs, total_fat, total_weight_grams
		) VALUES
			('r1', 'u1', '[
				{"name":"烤香肠","intake":60,"nutrients":{"calories":221,"protein":7,"carbs":8,"fat":18}},
				{"name":"鸡蛋","intake":50,"nutrients":{"calories":72,"protein":6,"carbs":0,"fat":5}}
			]', 999, 999, 999, 999, 999),
			('r2', 'u1', '[
				{"name":"台湾烤肠","manual_source_title":"台湾烤肠","intake":51,"nutrients":{"calories":140,"protein":6,"carbs":5,"fat":11}}
			]', 140, 6, 5, 11, 51),
			('r3', 'u1', '[
				{"name":"鸡蛋","intake":50,"nutrients":{"calories":72,"protein":6,"carbs":0,"fat":5}}
			]', 72, 6, 0, 5, 50);
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
		QualityTier    string  `gorm:"column:quality_tier"`
	}
	require.NoError(t, db.Raw(`
		SELECT canonical_name, kcal_per_100g, protein_per_100g,
			carbs_per_100g, fat_per_100g, is_active, quality_tier
		FROM food_nutrition_library
		WHERE id = 'taiwan-sausage'
	`).Scan(&nutrition).Error)
	assert.Equal(t, taiwanSausageCanonicalName, nutrition.CanonicalName)
	assert.InDelta(t, 350, nutrition.KcalPer100g, 0.01)
	assert.InDelta(t, 17, nutrition.ProteinPer100g, 0.01)
	assert.InDelta(t, 6, nutrition.CarbsPer100g, 0.01)
	assert.InDelta(t, 28, nutrition.FatPer100g, 0.01)
	assert.True(t, nutrition.IsActive)
	assert.Equal(t, "legacy_curated", nutrition.QualityTier)

	var aliasCount int64
	require.NoError(t, db.Raw(`
		SELECT COUNT(*)
		FROM food_nutrition_aliases
		WHERE food_id = 'taiwan-sausage'
			AND normalized_alias IN ('台式烤香肠', '台湾烤香肠', '台湾烤肠', '烤香肠')
			AND match_status = 'approved_exact'
	`).Scan(&aliasCount).Error)
	assert.EqualValues(t, 4, aliasCount)

	var legacyAliasFoodID string
	require.NoError(t, db.Raw(`
		SELECT food_id
		FROM food_nutrition_aliases
		WHERE normalized_alias = '台湾香肠'
	`).Scan(&legacyAliasFoodID).Error)
	assert.Equal(t, "taiwan-sausage", legacyAliasFoodID)

	var legacyActive bool
	require.NoError(t, db.Raw(`
		SELECT is_active
		FROM food_nutrition_library
		WHERE id = 'legacy-taiwan-sausage'
	`).Scan(&legacyActive).Error)
	assert.False(t, legacyActive)

	type migratedRecord struct {
		Items            []byte  `gorm:"column:items"`
		TotalCalories    float64 `gorm:"column:total_calories"`
		TotalProtein     float64 `gorm:"column:total_protein"`
		TotalCarbs       float64 `gorm:"column:total_carbs"`
		TotalFat         float64 `gorm:"column:total_fat"`
		TotalWeightGrams int     `gorm:"column:total_weight_grams"`
	}
	var first migratedRecord
	require.NoError(t, db.Raw(`
		SELECT items, total_calories, total_protein, total_carbs,
			total_fat, total_weight_grams
		FROM user_food_records
		WHERE id = 'r1'
	`).Scan(&first).Error)
	assert.JSONEq(t, `[
		{
			"name":"台式烤香肠",
			"intake":60,
			"manual_source":"nutrition_library",
			"manual_source_id":"taiwan-sausage",
			"manual_source_title":"台式烤香肠",
			"nutrients":{"calories":210,"protein":10.2,"carbs":3.6,"fat":16.8}
		},
		{"name":"鸡蛋","intake":50,"nutrients":{"calories":72,"protein":6,"carbs":0,"fat":5}}
	]`, string(first.Items))
	assert.InDelta(t, 282, first.TotalCalories, 0.01)
	assert.InDelta(t, 16.2, first.TotalProtein, 0.01)
	assert.InDelta(t, 3.6, first.TotalCarbs, 0.01)
	assert.InDelta(t, 21.8, first.TotalFat, 0.01)
	assert.Equal(t, 110, first.TotalWeightGrams)

	var second migratedRecord
	require.NoError(t, db.Raw(`
		SELECT items, total_calories, total_protein, total_carbs,
			total_fat, total_weight_grams
		FROM user_food_records
		WHERE id = 'r2'
	`).Scan(&second).Error)
	assert.InDelta(t, 178.5, second.TotalCalories, 0.01)
	assert.InDelta(t, 8.67, second.TotalProtein, 0.01)
	assert.InDelta(t, 3.06, second.TotalCarbs, 0.01)
	assert.InDelta(t, 14.28, second.TotalFat, 0.01)
	assert.Equal(t, 51, second.TotalWeightGrams)

	var untouched migratedRecord
	require.NoError(t, db.Raw(`
		SELECT items, total_calories, total_protein, total_carbs,
			total_fat, total_weight_grams
		FROM user_food_records
		WHERE id = 'r3'
	`).Scan(&untouched).Error)
	assert.JSONEq(t, `[{"name":"鸡蛋","intake":50,"nutrients":{"calories":72,"protein":6,"carbs":0,"fat":5}}]`, string(untouched.Items))
	assert.InDelta(t, 72, untouched.TotalCalories, 0.01)
	assert.InDelta(t, 6, untouched.TotalProtein, 0.01)
	assert.InDelta(t, 0, untouched.TotalCarbs, 0.01)
	assert.InDelta(t, 5, untouched.TotalFat, 0.01)
	assert.Equal(t, 50, untouched.TotalWeightGrams)
}
