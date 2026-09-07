package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	taiwanSausageCanonicalName = "台式烤香肠"
	taiwanSausagePackagedID    = "f1000000-0000-4000-8000-000000000038"
	taiwanSausageNetWeightG    = 38.0
	taiwanSausageServingG      = 38.0
	taiwanSausageUnitCount     = 1.0
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

// MigrateManualFoodSausage moves the legacy Taiwanese grilled-sausage entry to
// the packaged-food library. Each independent package is 38g; historical
// records keep their actual consumed gram amounts and are relinked to the SKU.
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
		packagedFoodID, err := upsertTaiwanSausagePackagedFood(tx, foodID)
		if err != nil {
			return err
		}
		if err := mergeTaiwanSausagePackagedAliases(tx, packagedFoodID, foodID); err != nil {
			return err
		}
		if err := deactivateTaiwanSausageNutrition(tx, packagedFoodID); err != nil {
			return err
		}
		if err := backfillTaiwanSausageRecords(tx, packagedFoodID); err != nil {
			return err
		}
		return nil
	})
}

func upsertTaiwanSausagePackagedFood(tx *gorm.DB, nutritionFoodID string) (string, error) {
	packagedFoodID := taiwanSausagePackagedID
	if err := tx.Raw(`
		SELECT id::text
		FROM packaged_food_library
		WHERE id::text = ?
			OR normalized_name = ?
			OR display_name = ?
		ORDER BY CASE WHEN id::text = ? THEN 0 ELSE 1 END, updated_at DESC NULLS LAST
		LIMIT 1
	`, taiwanSausagePackagedID, taiwanSausageCanonicalName, taiwanSausageCanonicalName, taiwanSausagePackagedID).
		Scan(&packagedFoodID).Error; err != nil {
		return "", fmt.Errorf("find Taiwanese sausage packaged row: %w", err)
	}
	if packagedFoodID == "" {
		packagedFoodID = taiwanSausagePackagedID
	}

	if err := tx.Exec(`
		INSERT INTO packaged_food_library (
			id, brand, product_name, normalized_name, product_key,
			display_name, search_text, product_family_key, spec_text,
			package_category, source_image_urls, nutrition_basis_unit,
			raw_label_payload, conversion_status, extract_confidence,
			field_confidence, ingest_method, net_content_value,
			net_content_unit, unit_count, unit_content_value,
			unit_content_unit, review_status, net_weight_g,
			serving_weight_g, kcal_per_100g, protein_per_100g,
			carbs_per_100g, fat_per_100g, source_url, source,
			is_active, updated_at
		)
		SELECT
			CAST(? AS uuid), '', CAST(? AS text), CAST(? AS text),
			'taiwan-grilled-sausage-38g', CAST(? AS text),
			CAST(? AS text), 'taiwan-grilled-sausage', '38g',
			'肉制品',
			COALESCE((
				SELECT jsonb_agg(image_url ORDER BY image_url)
				FROM (
					SELECT DISTINCT image_url
					FROM (
						SELECT jsonb_array_elements_text(
							CASE
								WHEN jsonb_typeof(COALESCE(to_jsonb(n)->'image_paths', '[]'::jsonb)) = 'array'
								THEN COALESCE(to_jsonb(n)->'image_paths', '[]'::jsonb)
								ELSE '[]'::jsonb
							END
						) AS image_url
						UNION ALL
						SELECT NULLIF(to_jsonb(n)->>'image_path', '') AS image_url
					) source_images
					WHERE image_url IS NOT NULL AND trim(image_url) <> ''
				) unique_images
			), '[]'::jsonb),
			'100g',
			jsonb_build_object(
				'migration', 'manual_food_sausage_packaged_correction',
				'package_count', 1,
				'unit_weight_g', CAST(? AS numeric),
				'unit_calories_kcal', CAST(? AS numeric)
			),
			'verified', 1,
			jsonb_build_object('serving_weight_g', 1, 'kcal_per_100g', 1),
			'curated_migration', CAST(? AS numeric), 'g', CAST(? AS numeric),
			CAST(? AS numeric), 'g', 'active', CAST(? AS numeric),
			CAST(? AS numeric), CAST(? AS numeric), CAST(? AS numeric),
			CAST(? AS numeric), CAST(? AS numeric),
			'migration:manual_food_sausage_packaged_correction',
			'manual_food_sausage_packaged_correction', TRUE, now()
		FROM food_nutrition_library AS n
		WHERE n.id::text = ?
		ON CONFLICT (id) DO UPDATE SET
			product_name = EXCLUDED.product_name,
			normalized_name = EXCLUDED.normalized_name,
			product_key = EXCLUDED.product_key,
			display_name = EXCLUDED.display_name,
			search_text = EXCLUDED.search_text,
			product_family_key = EXCLUDED.product_family_key,
			spec_text = EXCLUDED.spec_text,
			package_category = EXCLUDED.package_category,
			source_image_urls = (
				SELECT COALESCE(jsonb_agg(DISTINCT image_url), '[]'::jsonb)
				FROM jsonb_array_elements_text(
					COALESCE(packaged_food_library.source_image_urls, '[]'::jsonb) ||
					COALESCE(EXCLUDED.source_image_urls, '[]'::jsonb)
				) AS image_url
			),
			nutrition_basis_unit = EXCLUDED.nutrition_basis_unit,
			raw_label_payload = COALESCE(packaged_food_library.raw_label_payload, '{}'::jsonb) || EXCLUDED.raw_label_payload,
			conversion_status = EXCLUDED.conversion_status,
			extract_confidence = EXCLUDED.extract_confidence,
			field_confidence = COALESCE(packaged_food_library.field_confidence, '{}'::jsonb) || EXCLUDED.field_confidence,
			ingest_method = EXCLUDED.ingest_method,
			net_content_value = EXCLUDED.net_content_value,
			net_content_unit = EXCLUDED.net_content_unit,
			unit_count = EXCLUDED.unit_count,
			unit_content_value = EXCLUDED.unit_content_value,
			unit_content_unit = EXCLUDED.unit_content_unit,
			review_status = EXCLUDED.review_status,
			net_weight_g = EXCLUDED.net_weight_g,
			serving_weight_g = EXCLUDED.serving_weight_g,
			kcal_per_100g = EXCLUDED.kcal_per_100g,
			protein_per_100g = EXCLUDED.protein_per_100g,
			carbs_per_100g = EXCLUDED.carbs_per_100g,
			fat_per_100g = EXCLUDED.fat_per_100g,
			source_url = EXCLUDED.source_url,
			source = EXCLUDED.source,
			is_active = TRUE,
			updated_at = now()
	`,
		packagedFoodID,
		taiwanSausageCanonicalName,
		taiwanSausageCanonicalName,
		taiwanSausageCanonicalName,
		strings.Join(taiwanSausageAliases, " ")+" 独立包装 38g",
		taiwanSausageServingG,
		taiwanSausageServingG*taiwanSausageKcalPer100g/100,
		taiwanSausageNetWeightG,
		taiwanSausageUnitCount,
		taiwanSausageServingG,
		taiwanSausageNetWeightG,
		taiwanSausageServingG,
		taiwanSausageKcalPer100g,
		taiwanSausageProtein100g,
		taiwanSausageCarbs100g,
		taiwanSausageFat100g,
		nutritionFoodID,
	).Error; err != nil {
		return "", fmt.Errorf("upsert Taiwanese sausage packaged row: %w", err)
	}
	return packagedFoodID, nil
}

func mergeTaiwanSausagePackagedAliases(tx *gorm.DB, packagedFoodID string, nutritionFoodID string) error {
	for _, alias := range taiwanSausageAliases {
		if err := tx.Exec(`
			INSERT INTO packaged_food_aliases (food_id, alias_name, normalized_alias, updated_at)
			SELECT CAST(? AS uuid), ?, ?, now()
			WHERE NOT EXISTS (
				SELECT 1
				FROM packaged_food_aliases
				WHERE food_id::text = ? AND normalized_alias = ?
			)
		`, packagedFoodID, alias, alias, packagedFoodID, alias).Error; err != nil {
			return fmt.Errorf("upsert Taiwanese sausage packaged alias %q: %w", alias, err)
		}
	}
	if err := tx.Exec(`
		INSERT INTO packaged_food_aliases (food_id, alias_name, normalized_alias, updated_at)
		SELECT CAST(? AS uuid), alias_name, normalized_alias, now()
		FROM food_nutrition_aliases AS nutrition_alias
		WHERE nutrition_alias.food_id::text = ?
			AND NOT EXISTS (
				SELECT 1
				FROM packaged_food_aliases AS packaged_alias
				WHERE packaged_alias.food_id::text = ?
					AND packaged_alias.normalized_alias = nutrition_alias.normalized_alias
			)
	`, packagedFoodID, nutritionFoodID, packagedFoodID).Error; err != nil {
		return fmt.Errorf("copy Taiwanese sausage nutrition aliases to packaged row: %w", err)
	}
	return nil
}

func deactivateTaiwanSausageNutrition(tx *gorm.DB, packagedFoodID string) error {
	if err := tx.Exec(`
		UPDATE food_nutrition_library
		SET is_active = FALSE,
			source = 'migrated_to_packaged_food',
			quality_evidence = COALESCE(quality_evidence, '{}'::jsonb) ||
				jsonb_build_object(
					'migration', 'manual_food_sausage_packaged_correction',
					'packaged_food_id', CAST(? AS text)
				),
			updated_at = now()
		WHERE normalized_name IN ?
	`, packagedFoodID, taiwanSausageAliases).Error; err != nil {
		return fmt.Errorf("deactivate Taiwanese sausage nutrition rows: %w", err)
	}
	return nil
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

func backfillTaiwanSausageRecords(tx *gorm.DB, packagedFoodID string) error {
	if err := tx.Exec(`
		UPDATE user_food_records AS records
		SET items = (
			SELECT jsonb_agg(
				CASE
					WHEN trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) IN ?
					THEN item || jsonb_build_object(
						'name', CAST(? AS text),
						'manual_source', 'packaged_food',
						'manual_source_id', CAST(? AS text),
						'manual_source_title', CAST(? AS text),
						'manual_portion_label', '38g',
						'packaged_food_id', CAST(? AS text),
						'nutrition_source', 'packaged_food_library',
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
		packagedFoodID,
		taiwanSausageCanonicalName,
		packagedFoodID,
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
