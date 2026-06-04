package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

type backfillBaseline struct {
	GeneratedAt time.Time `json:"generated_at"`
	Schema      string    `json:"schema,omitempty"`
	Eligible    baselineCounts `json:"eligible"`
	WithImage   baselineCounts `json:"with_image"`
	Missing     baselineCounts `json:"missing_backfill_queue"`
}

type baselineCounts struct {
	Total      int64 `json:"total"`
	HanNames   int64 `json:"han_canonical_names,omitempty"`
	NonHanNames int64 `json:"non_han_canonical_names,omitempty"`
}

func runStats(ctx context.Context, opts options) error {
	cfg, err := config.Load(opts.configDir)
	if err != nil {
		return err
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		return err
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			return err
		}
	}

	const eligibleWhere = `
f.is_active = TRUE AND COALESCE(f.kcal_per_100g, 0) > 0`

	const missingWhere = eligibleWhere + `
  AND NULLIF(trim(COALESCE(f.image_path, '')), '') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS image_url
    WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )`

	type row struct {
		Total   int64
		Han     int64
		NonHan  int64
	}
	scan := func(where string) (baselineCounts, error) {
		var r row
		q := `
SELECT
  COUNT(*)::bigint AS total,
  COUNT(*) FILTER (WHERE f.canonical_name ~ '[\u4e00-\u9fff]')::bigint AS han,
  COUNT(*) FILTER (WHERE f.canonical_name !~ '[\u4e00-\u9fff]')::bigint AS non_han
FROM food_nutrition_library f
WHERE ` + where
		if err := db.WithContext(ctx).Raw(q).Scan(&r).Error; err != nil {
			return baselineCounts{}, err
		}
		return baselineCounts{Total: r.Total, HanNames: r.Han, NonHanNames: r.NonHan}, nil
	}

	out := backfillBaseline{
		GeneratedAt: time.Now(),
		Schema:      cfg.Database.Schema,
	}
	var err2 error
	out.Eligible, err2 = scan(eligibleWhere)
	if err2 != nil {
		return err2
	}
	out.WithImage, err2 = scan(eligibleWhere + `
  AND (
    NULLIF(trim(COALESCE(f.image_path, '')), '') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS image_url
      WHERE NULLIF(trim(image_url), '') IS NOT NULL
    )
  )`)
	if err2 != nil {
		return err2
	}
	out.Missing, err2 = scan(missingWhere)
	if err2 != nil {
		return err2
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if path := strings.TrimSpace(opts.statsOutput); path != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return err
		}
		fmt.Printf("基线统计已写入 %s\n", path)
	}
	fmt.Println(string(data))
	return nil
}
