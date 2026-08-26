package main

import (
	"context"
	"strings"

	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

type libraryImageCandidateRow struct {
	FoodID           string  `gorm:"column:food_id"`
	CanonicalName    string  `gorm:"column:canonical_name"`
	ObjectKey        string  `gorm:"column:object_key"`
	ImageSourceURL   string  `gorm:"column:image_source_url"`
	ImageSourceLabel string  `gorm:"column:image_source_label"`
	ImageLicense     string  `gorm:"column:image_license"`
	Score            float64 `gorm:"column:score"`
}

// searchLibraryImageCandidates reuses a visually equivalent image already in
// the standard library. It deliberately requires a strong name/base-food
// relationship before the vision model gets a chance to approve the image.
func searchLibraryImageCandidates(ctx context.Context, db *gorm.DB, storageClient *storage.Client, food foodRow, limit int) []imageCandidate {
	if db == nil || storageClient == nil {
		return nil
	}
	if limit <= 0 {
		limit = 12
	}
	var rows []libraryImageCandidateRow
	err := db.WithContext(ctx).Raw(`
WITH candidates AS (
  SELECT
    f.id::text AS food_id,
    f.canonical_name,
    COALESCE(
      NULLIF(BTRIM(COALESCE(f.image_path, '')), ''),
      (SELECT NULLIF(BTRIM(v), '')
       FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS v
       WHERE NULLIF(BTRIM(v), '') IS NOT NULL
       LIMIT 1)
    ) AS object_key,
    COALESCE(f.image_source_url, '') AS image_source_url,
    COALESCE(f.image_source_label, '') AS image_source_label,
    COALESCE(f.image_license, '') AS image_license,
    CASE
      WHEN ? <> '' AND f.base_food_key = ? THEN 100
      WHEN EXISTS (
        SELECT 1 FROM food_nutrition_aliases a
        WHERE a.food_id = f.id
          AND a.match_status = 'approved_exact'
          AND a.normalized_alias = ?
      ) THEN 95
      WHEN f.normalized_name = ? THEN 90
      WHEN (f.normalized_name LIKE '%' || ? || '%' OR ? LIKE '%' || f.normalized_name || '%')
           AND ABS(length(f.normalized_name) - length(?)) <= 4 THEN 80
      ELSE similarity(f.normalized_name, ?)*60
    END AS score
  FROM food_nutrition_library f
  WHERE f.id::text <> ?
    AND f.is_active = TRUE
    AND (
      NULLIF(BTRIM(COALESCE(f.image_path, '')), '') IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS v
        WHERE NULLIF(BTRIM(v), '') IS NOT NULL
      )
    )
    AND (
      (? <> '' AND f.base_food_key = ?)
      OR f.normalized_name = ?
      OR EXISTS (
        SELECT 1 FROM food_nutrition_aliases a
        WHERE a.food_id = f.id
          AND a.match_status = 'approved_exact'
          AND a.normalized_alias = ?
      )
      OR ((f.normalized_name LIKE '%' || ? || '%' OR ? LIKE '%' || f.normalized_name || '%')
          AND LEAST(length(f.normalized_name), length(?)) >= 2
          AND ABS(length(f.normalized_name) - length(?)) <= 4)
      OR similarity(f.normalized_name, ?) >= 0.45
    )
)
SELECT * FROM candidates
WHERE object_key IS NOT NULL
ORDER BY score DESC, canonical_name ASC, food_id ASC
LIMIT ?`,
		food.BaseFoodKey, food.BaseFoodKey, food.NormalizedName, food.NormalizedName,
		food.NormalizedName, food.NormalizedName, food.NormalizedName, food.NormalizedName,
		food.ID,
		food.BaseFoodKey, food.BaseFoodKey, food.NormalizedName, food.NormalizedName,
		food.NormalizedName, food.NormalizedName, food.NormalizedName, food.NormalizedName,
		food.NormalizedName, limit,
	).Scan(&rows).Error
	if err != nil {
		return nil
	}
	out := make([]imageCandidate, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		key := strings.TrimSpace(row.ObjectKey)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, imageCandidate{
			ImageURL:       storageClient.BuildAccessURL("food-images", key),
			PageURL:        strings.TrimSpace(row.ImageSourceURL),
			Query:          "library-reuse:" + row.CanonicalName,
			ReuseObjectKey: key,
			SourceLabel:    strings.TrimSpace(row.ImageSourceLabel),
			License:        strings.TrimSpace(row.ImageLicense),
			SourceFoodID:   row.FoodID,
			SourceFoodName: row.CanonicalName,
		})
	}
	return out
}
