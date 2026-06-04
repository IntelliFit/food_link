package main

import (
	"context"
	"os"
	"strings"
	"testing"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func TestVerifyFoodImageBackfillRows(t *testing.T) {
	rawIDs := strings.TrimSpace(os.Getenv("VERIFY_FOOD_IDS"))
	if rawIDs == "" {
		t.Skip("VERIFY_FOOD_IDS not set")
	}
	cfgDir := os.Getenv("VERIFY_CONFIG_DIR")
	if cfgDir == "" {
		cfgDir = "."
	}
	cfg, err := config.Load(cfgDir)
	if err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	ctx := context.Background()
	if err := database.Ping(ctx, db); err != nil {
		t.Fatal(err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			t.Fatal(err)
		}
	}

	ids := parseFoodIDs(rawIDs)
	for _, id := range ids {
		var row struct {
			ID            string `gorm:"column:id"`
			CanonicalName string `gorm:"column:canonical_name"`
			ImagePath     string `gorm:"column:image_path"`
			ImagePaths    string `gorm:"column:image_paths"`
		}
		err := db.WithContext(ctx).Raw(`
SELECT id::text, canonical_name, COALESCE(image_path, '') AS image_path, COALESCE(image_paths, '[]'::jsonb)::text AS image_paths
FROM food_nutrition_library
WHERE id::text = ?`, id).Scan(&row).Error
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("id=%s name=%s image_path=%s image_paths=%s", row.ID, row.CanonicalName, row.ImagePath, row.ImagePaths)
		if row.ImagePath == "" || row.ImagePaths == "[]" {
			t.Fatalf("missing image for id=%s", id)
		}
	}
}
