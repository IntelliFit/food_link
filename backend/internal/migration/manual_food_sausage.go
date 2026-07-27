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

// MigrateManualFoodSausage unifies the two legacy names used for Taiwanese
// grilled sausage and attaches historical record items to one nutrition row.
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

		var foodID string
		if err := tx.Raw(`
			INSERT INTO food_nutrition_library (
				canonical_name, normalized_name, kcal_per_100g,
				protein_per_100g, carbs_per_100g, fat_per_100g,
				is_active, source, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, now())
			ON CONFLICT (normalized_name) DO UPDATE SET
				canonical_name = EXCLUDED.canonical_name,
				kcal_per_100g = EXCLUDED.kcal_per_100g,
				protein_per_100g = EXCLUDED.protein_per_100g,
				carbs_per_100g = EXCLUDED.carbs_per_100g,
				fat_per_100g = EXCLUDED.fat_per_100g,
				is_active = TRUE,
				source = EXCLUDED.source,
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
			return fmt.Errorf("upsert Taiwanese sausage nutrition row: %w", err)
		}
		if foodID == "" {
			return fmt.Errorf("upsert Taiwanese sausage nutrition row: empty food id")
		}

		for _, alias := range []string{"台式烤香肠", "烤香肠"} {
			if err := tx.Exec(`
				INSERT INTO food_nutrition_aliases (
					food_id, alias_name, normalized_alias, updated_at
				)
				VALUES (?, ?, ?, now())
				ON CONFLICT (normalized_alias) DO UPDATE SET
					food_id = EXCLUDED.food_id,
					alias_name = EXCLUDED.alias_name,
					updated_at = now()
			`, foodID, alias, alias).Error; err != nil {
				return fmt.Errorf("upsert Taiwanese sausage alias %q: %w", alias, err)
			}
		}

		if err := tx.Exec(`
			UPDATE user_food_records AS records
			SET items = (
				SELECT jsonb_agg(
					CASE
						WHEN trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', '')))
							IN ('烤香肠', '台式烤香肠')
						THEN jsonb_set(
							jsonb_set(
								jsonb_set(
									jsonb_set(item, '{name}', to_jsonb(CAST(? AS text)), true),
									'{manual_source}', to_jsonb(CAST('nutrition_library' AS text)), true
								),
								'{manual_source_id}', to_jsonb(CAST(? AS text)), true
							),
							'{manual_source_title}', to_jsonb(CAST(? AS text)), true
						)
						ELSE item
					END
					ORDER BY ordinality
				)
				FROM jsonb_array_elements(records.items) WITH ORDINALITY AS expanded(item, ordinality)
			)
			WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements(records.items) AS candidate(item)
				WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', '')))
					IN ('烤香肠', '台式烤香肠')
			)
		`, taiwanSausageCanonicalName, foodID, taiwanSausageCanonicalName).Error; err != nil {
			return fmt.Errorf("backfill Taiwanese sausage record items: %w", err)
		}

		return nil
	})
}
