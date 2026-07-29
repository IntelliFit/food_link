package migration

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

const (
	taiwanSausageCanonicalName = "台式烤香肠"
	taiwanSausageKcalPer100g   = 350.0
	taiwanSausageProtein100g   = 17.0
	taiwanSausageCarbs100g     = 6.0
	taiwanSausageFat100g       = 28.0
)

var taiwanSausageAliases = []string{
	"台式烤香肠",
	"台湾烤香肠",
	"台湾烤肠",
	"烤香肠",
}

// MigrateManualFoodSausage merges legacy Taiwanese grilled-sausage names into
// one nutrition row, recalculates matching historical items, and keeps record
// totals consistent with the rewritten item nutrients.
func MigrateManualFoodSausage(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set migration search path: %w", err)
		}

		foodID, err := upsertTaiwanSausageNutrition(tx)
		if err != nil {
			return err
		}
		if err := mergeTaiwanSausageAliases(tx, foodID); err != nil {
			return err
		}
		if err := backfillTaiwanSausageRecords(tx, foodID); err != nil {
			return err
		}
		return nil
	})
}

func upsertTaiwanSausageNutrition(tx *gorm.DB) (string, error) {
	var foodID string
	if err := tx.Raw(`
		INSERT INTO food_nutrition_library (
			canonical_name, normalized_name, kcal_per_100g,
			protein_per_100g, carbs_per_100g, fat_per_100g,
			is_active, source, quality_tier, quality_evidence,
			quality_reviewed_at, updated_at
		)
		VALUES (
			?, ?, ?, ?, ?, ?, TRUE, ?,
			'legacy_curated',
			jsonb_build_object('migration', 'manual_food_sausage_normalization'),
			now(), now()
		)
		ON CONFLICT (normalized_name) DO UPDATE SET
			canonical_name = EXCLUDED.canonical_name,
			kcal_per_100g = EXCLUDED.kcal_per_100g,
			protein_per_100g = EXCLUDED.protein_per_100g,
			carbs_per_100g = EXCLUDED.carbs_per_100g,
			fat_per_100g = EXCLUDED.fat_per_100g,
			is_active = TRUE,
			source = EXCLUDED.source,
			quality_tier = EXCLUDED.quality_tier,
			quality_evidence = COALESCE(food_nutrition_library.quality_evidence, '{}'::jsonb) ||
				EXCLUDED.quality_evidence,
			quality_reviewed_at = EXCLUDED.quality_reviewed_at,
			updated_at = now()
		RETURNING id
	`,
		taiwanSausageCanonicalName,
		taiwanSausageCanonicalName,
		taiwanSausageKcalPer100g,
		taiwanSausageProtein100g,
		taiwanSausageCarbs100g,
		taiwanSausageFat100g,
		"manual_food_sausage_normalization",
	).Scan(&foodID).Error; err != nil {
		return "", fmt.Errorf("upsert Taiwanese sausage nutrition row: %w", err)
	}
	if foodID == "" {
		return "", fmt.Errorf("upsert Taiwanese sausage nutrition row: empty food id")
	}
	return foodID, nil
}

func mergeTaiwanSausageAliases(tx *gorm.DB, foodID string) error {
	if err := tx.Exec(`
		UPDATE food_nutrition_aliases
		SET food_id = ?, updated_at = now()
		WHERE food_id IN (
			SELECT id
			FROM food_nutrition_library
			WHERE normalized_name IN ?
				AND id <> ?
		)
	`, foodID, taiwanSausageAliases, foodID).Error; err != nil {
		return fmt.Errorf("relink Taiwanese sausage legacy aliases: %w", err)
	}

	if err := tx.Exec(`
		UPDATE food_nutrition_library
		SET is_active = FALSE, updated_at = now()
		WHERE normalized_name IN ?
			AND id <> ?
	`, taiwanSausageAliases, foodID).Error; err != nil {
		return fmt.Errorf("deactivate Taiwanese sausage legacy nutrition rows: %w", err)
	}

	for _, alias := range taiwanSausageAliases {
		if err := tx.Exec(`
			INSERT INTO food_nutrition_aliases (
				food_id, alias_name, normalized_alias, match_status,
				approval_evidence, reviewed_at, updated_at
			)
			VALUES (
				?, ?, ?, 'approved_exact',
				jsonb_build_object('migration', 'manual_food_sausage_normalization'),
				now(), now()
			)
			ON CONFLICT (normalized_alias) DO UPDATE SET
				food_id = EXCLUDED.food_id,
				alias_name = EXCLUDED.alias_name,
				match_status = EXCLUDED.match_status,
				approval_evidence = COALESCE(food_nutrition_aliases.approval_evidence, '{}'::jsonb) ||
					EXCLUDED.approval_evidence,
				reviewed_at = EXCLUDED.reviewed_at,
				updated_at = now()
		`, foodID, alias, alias).Error; err != nil {
			return fmt.Errorf("upsert Taiwanese sausage alias %q: %w", alias, err)
		}
	}
	return nil
}

func backfillTaiwanSausageRecords(tx *gorm.DB, foodID string) error {
	if err := tx.Exec(`
		UPDATE user_food_records AS records
		SET items = (
			SELECT jsonb_agg(
				CASE
					WHEN trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) IN ?
					THEN item || jsonb_build_object(
						'name', CAST(? AS text),
						'manual_source', 'nutrition_library',
						'manual_source_id', CAST(? AS text),
						'manual_source_title', CAST(? AS text),
						'nutrients', COALESCE(item->'nutrients', '{}'::jsonb) ||
							CASE
								WHEN serving.serving_grams IS NULL THEN '{}'::jsonb
								ELSE jsonb_build_object(
									'calories', round(serving.serving_grams * CAST(? AS numeric) / 100, 2),
									'protein', round(serving.serving_grams * CAST(? AS numeric) / 100, 2),
									'carbs', round(serving.serving_grams * CAST(? AS numeric) / 100, 2),
									'fat', round(serving.serving_grams * CAST(? AS numeric) / 100, 2)
								)
							END
					)
					ELSE item
				END
				ORDER BY ordinality
			)
			FROM jsonb_array_elements(records.items) WITH ORDINALITY AS expanded(item, ordinality)
			CROSS JOIN LATERAL (
				SELECT CASE
					WHEN COALESCE(NULLIF(item->>'intake', ''), NULLIF(item->>'weight', '')) ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(NULLIF(item->>'intake', ''), NULLIF(item->>'weight', ''))::numeric
					ELSE NULL
				END AS serving_grams
			) AS serving
		)
		WHERE jsonb_typeof(records.items) = 'array'
			AND EXISTS (
				SELECT 1
				FROM jsonb_array_elements(records.items) AS candidate(item)
				WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) IN ?
			)
	`,
		taiwanSausageAliases,
		taiwanSausageCanonicalName,
		foodID,
		taiwanSausageCanonicalName,
		taiwanSausageKcalPer100g,
		taiwanSausageProtein100g,
		taiwanSausageCarbs100g,
		taiwanSausageFat100g,
		taiwanSausageAliases,
	).Error; err != nil {
		return fmt.Errorf("backfill Taiwanese sausage record items: %w", err)
	}

	if err := tx.Exec(`
		WITH
		recalculated_totals AS (
			SELECT
				records.id,
				COALESCE(SUM(CASE
					WHEN COALESCE(item->'nutrients'->>'calories', item->>'calories') ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(item->'nutrients'->>'calories', item->>'calories')::numeric
					ELSE 0
				END), 0) AS total_calories,
				COALESCE(SUM(CASE
					WHEN COALESCE(item->'nutrients'->>'protein', item->>'protein') ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(item->'nutrients'->>'protein', item->>'protein')::numeric
					ELSE 0
				END), 0) AS total_protein,
				COALESCE(SUM(CASE
					WHEN COALESCE(item->'nutrients'->>'carbs', item->'nutrients'->>'carbohydrate', item->'nutrients'->>'carbohydrates', item->>'carbs') ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(item->'nutrients'->>'carbs', item->'nutrients'->>'carbohydrate', item->'nutrients'->>'carbohydrates', item->>'carbs')::numeric
					ELSE 0
				END), 0) AS total_carbs,
				COALESCE(SUM(CASE
					WHEN COALESCE(item->'nutrients'->>'fat', item->>'fat') ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(item->'nutrients'->>'fat', item->>'fat')::numeric
					ELSE 0
				END), 0) AS total_fat,
				COALESCE(SUM(CASE
					WHEN COALESCE(NULLIF(item->>'intake', ''), NULLIF(item->>'weight', '')) ~ '^[0-9]+([.][0-9]+){0,1}$'
					THEN COALESCE(NULLIF(item->>'intake', ''), NULLIF(item->>'weight', ''))::numeric
					ELSE 0
				END), 0) AS total_weight_grams
			FROM user_food_records AS records
			CROSS JOIN LATERAL jsonb_array_elements(records.items) AS expanded(item)
			WHERE jsonb_typeof(records.items) = 'array'
				AND EXISTS (
					SELECT 1
					FROM jsonb_array_elements(records.items) AS candidate(candidate_item)
					WHERE trim(COALESCE(NULLIF(candidate_item->>'manual_source_title', ''), NULLIF(candidate_item->>'name', ''))) IN ?
				)
			GROUP BY records.id
		)
		UPDATE user_food_records AS records
		SET
			total_calories = round(totals.total_calories, 2),
			total_protein = round(totals.total_protein, 2),
			total_carbs = round(totals.total_carbs, 2),
			total_fat = round(totals.total_fat, 2),
			total_weight_grams = round(totals.total_weight_grams)::integer
		FROM recalculated_totals AS totals
		WHERE records.id = totals.id
	`, taiwanSausageAliases).Error; err != nil {
		return fmt.Errorf("recalculate Taiwanese sausage record totals: %w", err)
	}
	return nil
}
