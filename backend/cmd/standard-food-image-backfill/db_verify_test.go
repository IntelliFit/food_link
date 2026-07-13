package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
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

func TestVerifyReviewedApplyReportCDN(t *testing.T) {
	reportPath := strings.TrimSpace(os.Getenv("VERIFY_REVIEWED_CDN_REPORT"))
	if reportPath == "" {
		t.Skip("VERIFY_REVIEWED_CDN_REPORT not set")
	}
	var report reviewedImageReport
	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	entries := make([]reviewedImageEntry, 0)
	for _, entry := range report.Entries {
		if entry.Status == "applied" {
			entries = append(entries, entry)
		}
	}
	jobs := make(chan reviewedImageEntry)
	errs := make(chan error, len(entries))
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for entry := range jobs {
				var lastErr error
				for attempt := 0; attempt < 4; attempt++ {
					req, reqErr := http.NewRequest(http.MethodGet, entry.AccessURL, nil)
					if reqErr != nil {
						lastErr = reqErr
						continue
					}
					req.Header.Set("Range", "bytes=0-1")
					resp, requestErr := imageDownloadHTTPClient.Do(req)
					if requestErr != nil {
						lastErr = requestErr
						continue
					}
					resp.Body.Close()
					if resp.StatusCode >= 400 {
						lastErr = fmt.Errorf("status %d", resp.StatusCode)
						continue
					}
					if contentType := strings.ToLower(resp.Header.Get("Content-Type")); !strings.HasPrefix(contentType, "image/") {
						lastErr = fmt.Errorf("content-type %q", contentType)
						continue
					}
					lastErr = nil
					break
				}
				if lastErr != nil {
					errs <- fmt.Errorf("id=%s url=%s: %w", entry.FoodID, entry.AccessURL, lastErr)
				}
			}
		}()
	}
	for _, entry := range entries {
		jobs <- entry
	}
	close(jobs)
	wg.Wait()
	close(errs)
	var failures []error
	for err := range errs {
		failures = append(failures, err)
	}
	if len(failures) > 0 {
		t.Fatalf("CDN postcheck failed count=%d first=%v", len(failures), failures[0])
	}
	t.Logf("verified CDN images=%d", len(entries))
}

func TestVerifyReviewedApplyReportRows(t *testing.T) {
	reportPath := strings.TrimSpace(os.Getenv("VERIFY_REVIEWED_REPORT"))
	if reportPath == "" {
		t.Skip("VERIFY_REVIEWED_REPORT not set")
	}
	var report reviewedImageReport
	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	cfgDir := strings.TrimSpace(os.Getenv("VERIFY_CONFIG_DIR"))
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
	if sqlDB, dbErr := db.DB(); dbErr == nil {
		defer sqlDB.Close()
	}
	ctx := context.Background()
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			t.Fatal(err)
		}
	}
	checked := 0
	for _, entry := range report.Entries {
		if entry.Status != "applied" {
			continue
		}
		var row imageDBSnapshot
		if err := db.WithContext(ctx).Raw(`
SELECT id::text AS id, COALESCE(image_path, '') AS image_path,
       COALESCE(image_paths, '[]'::jsonb)::text AS image_paths
FROM food_nutrition_library WHERE id::text = ?`, entry.FoodID).Scan(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.ImagePath != entry.ObjectKey || !snapshotContainsImage(row, entry.ObjectKey) {
			t.Fatalf("image postcheck mismatch id=%s want=%s got_path=%s got_paths=%s", entry.FoodID, entry.ObjectKey, row.ImagePath, row.ImagePaths)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("report has no applied entries")
	}
	t.Logf("verified applied rows=%d", checked)
}
