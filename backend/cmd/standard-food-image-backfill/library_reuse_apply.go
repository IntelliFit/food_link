package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type approvedLibraryReuse struct {
	FoodID         string `json:"food_id"`
	FoodName       string `json:"food_name"`
	SourceFoodID   string `json:"source_food_id"`
	SourceFoodName string `json:"source_food_name"`
	ObjectKey      string `json:"object_key"`
}

type libraryReuseAllowlist struct {
	ReviewedAt string                 `json:"reviewed_at"`
	ReviewedBy string                 `json:"reviewed_by"`
	Entries    []approvedLibraryReuse `json:"entries"`
}

type libraryReuseApplyEntry struct {
	approvedLibraryReuse
	Status      string    `json:"status"`
	Reason      string    `json:"reason,omitempty"`
	DBUpdated   bool      `json:"db_updated"`
	ProcessedAt time.Time `json:"processed_at"`
}

type libraryReuseApplyReport struct {
	GeneratedAt  time.Time                `json:"generated_at"`
	Applied      bool                     `json:"applied"`
	ReviewedAt   string                   `json:"reviewed_at"`
	ReviewedBy   string                   `json:"reviewed_by"`
	Total        int                      `json:"total"`
	StatusCounts map[string]int           `json:"status_counts"`
	Entries      []libraryReuseApplyEntry `json:"entries"`
}

type libraryReuseSnapshot struct {
	TargetID         string  `gorm:"column:target_id"`
	TargetName       string  `gorm:"column:target_name"`
	TargetImagePath  string  `gorm:"column:target_image_path"`
	TargetImagePaths string  `gorm:"column:target_image_paths"`
	TargetActive     bool    `gorm:"column:target_active"`
	TargetKcal       float64 `gorm:"column:target_kcal"`
	SourceID         string  `gorm:"column:source_id"`
	SourceName       string  `gorm:"column:source_name"`
	SourceImagePath  string  `gorm:"column:source_image_path"`
	SourceImagePaths string  `gorm:"column:source_image_paths"`
	SourceURL        string  `gorm:"column:source_url"`
	SourceLabel      string  `gorm:"column:source_label"`
	SourceLicense    string  `gorm:"column:source_license"`
}

func runApprovedLibraryReuse(ctx context.Context, opts options) error {
	if strings.TrimSpace(opts.libraryReuseReport) == "" || strings.TrimSpace(opts.libraryReuseAllowlist) == "" {
		return errors.New("--library-reuse-apply 需要 --library-reuse-report 和 --library-reuse-allowlist")
	}
	approved, reviewedAt, reviewedBy, err := loadApprovedLibraryReuse(opts.libraryReuseReport, opts.libraryReuseAllowlist)
	if err != nil {
		return err
	}
	cfg, err := config.Load(opts.configDir)
	if err != nil {
		return err
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		return err
	}
	if sqlDB, dbErr := db.DB(); dbErr == nil {
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

	report := libraryReuseApplyReport{
		GeneratedAt: time.Now(), Applied: opts.apply, ReviewedAt: reviewedAt, ReviewedBy: reviewedBy,
		Total: len(approved), StatusCounts: map[string]int{}, Entries: make([]libraryReuseApplyEntry, 0, len(approved)),
	}
	applyOne := func(tx *gorm.DB, item approvedLibraryReuse) libraryReuseApplyEntry {
		entry := libraryReuseApplyEntry{approvedLibraryReuse: item, Status: "verified", ProcessedAt: time.Now()}
		snapshot, snapshotErr := loadLibraryReuseSnapshot(ctx, tx, item)
		if snapshotErr != nil {
			entry.Status, entry.Reason = "preflight_failed", snapshotErr.Error()
			return entry
		}
		if err := validateLibraryReuseSnapshot(item, snapshot); err != nil {
			entry.Status, entry.Reason = "preflight_failed", err.Error()
			return entry
		}
		if !opts.apply {
			entry.Reason = "manual allowlist and database snapshot verified; dry-run"
			return entry
		}
		if err := applyLibraryReuse(ctx, tx, item, snapshot, reviewedAt, reviewedBy); err != nil {
			entry.Status, entry.Reason = "db_update_failed", err.Error()
			return entry
		}
		entry.Status, entry.Reason, entry.DBUpdated = "applied", "reused existing COS object with conditional database update", true
		return entry
	}

	if opts.apply {
		err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			for _, item := range approved {
				entry := applyOne(tx, item)
				report.Entries = append(report.Entries, entry)
				if entry.Status != "applied" {
					return fmt.Errorf("food_id=%s status=%s: %s", item.FoodID, entry.Status, entry.Reason)
				}
			}
			return nil
		})
		if err != nil {
			for i := range report.Entries {
				if report.Entries[i].Status == "applied" {
					report.Entries[i].Status = "rolled_back"
					report.Entries[i].Reason = "transaction rolled back because another allowlisted entry failed"
					report.Entries[i].DBUpdated = false
				}
			}
		}
	} else {
		for _, item := range approved {
			report.Entries = append(report.Entries, applyOne(db, item))
		}
	}
	for _, entry := range report.Entries {
		report.StatusCounts[entry.Status]++
	}
	if writeErr := writeLibraryReuseApplyReport(opts.libraryReuseOutput, report); writeErr != nil {
		return writeErr
	}
	if err != nil {
		return err
	}
	fmt.Printf("库内图片复用完成：total=%d apply=%v counts=%v report=%s\n", report.Total, report.Applied, report.StatusCounts, opts.libraryReuseOutput)
	return nil
}

func loadApprovedLibraryReuse(reportPath, allowlistPath string) ([]approvedLibraryReuse, string, string, error) {
	var source successSummary
	if err := readJSONFile(reportPath, &source); err != nil {
		return nil, "", "", fmt.Errorf("读取库内复用报告: %w", err)
	}
	var allowlist libraryReuseAllowlist
	if err := readJSONFile(allowlistPath, &allowlist); err != nil {
		return nil, "", "", fmt.Errorf("读取人工 allowlist: %w", err)
	}
	if strings.TrimSpace(allowlist.ReviewedAt) == "" || strings.TrimSpace(allowlist.ReviewedBy) == "" {
		return nil, "", "", errors.New("人工 allowlist 缺少 reviewed_at/reviewed_by")
	}
	if len(allowlist.Entries) == 0 {
		return nil, "", "", errors.New("人工 allowlist 不能为空")
	}
	byID := make(map[string]successRecord, len(source.Successes))
	for _, item := range source.Successes {
		byID[item.FoodID] = item
	}
	seen := map[string]bool{}
	out := make([]approvedLibraryReuse, 0, len(allowlist.Entries))
	for _, approved := range allowlist.Entries {
		if approved.FoodID == "" || approved.SourceFoodID == "" || approved.ObjectKey == "" || seen[approved.FoodID] {
			return nil, "", "", fmt.Errorf("人工 allowlist 存在空字段或重复 food_id=%s", approved.FoodID)
		}
		seen[approved.FoodID] = true
		item, ok := byID[approved.FoodID]
		if !ok || !item.Reused || item.Decision == nil || !item.Decision.Match || item.Decision.Confidence < 0.95 {
			return nil, "", "", fmt.Errorf("food_id=%s 不在合格库内复用报告中", approved.FoodID)
		}
		if item.FoodName != approved.FoodName || item.SourceFoodID != approved.SourceFoodID || item.SourceFoodName != approved.SourceFoodName || item.ObjectKey != approved.ObjectKey {
			return nil, "", "", fmt.Errorf("food_id=%s 人工 allowlist 与审计报告不一致", approved.FoodID)
		}
		out = append(out, approved)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].FoodID < out[j].FoodID })
	return out, allowlist.ReviewedAt, allowlist.ReviewedBy, nil
}

func loadLibraryReuseSnapshot(ctx context.Context, db *gorm.DB, item approvedLibraryReuse) (libraryReuseSnapshot, error) {
	var row libraryReuseSnapshot
	err := db.WithContext(ctx).Raw(`
SELECT
  t.id::text AS target_id, t.canonical_name AS target_name,
  COALESCE(t.image_path, '') AS target_image_path,
  COALESCE(t.image_paths, '[]'::jsonb)::text AS target_image_paths,
  t.is_active AS target_active, COALESCE(t.kcal_per_100g, 0) AS target_kcal,
  s.id::text AS source_id, s.canonical_name AS source_name,
  COALESCE(s.image_path, '') AS source_image_path,
  COALESCE(s.image_paths, '[]'::jsonb)::text AS source_image_paths,
  COALESCE(s.image_source_url, '') AS source_url,
  COALESCE(s.image_source_label, '') AS source_label,
  COALESCE(s.image_license, '') AS source_license
FROM food_nutrition_library t
JOIN food_nutrition_library s ON s.id::text = ?
WHERE t.id::text = ?`, item.SourceFoodID, item.FoodID).Scan(&row).Error
	if err != nil {
		return row, err
	}
	if row.TargetID == "" || row.SourceID == "" {
		return row, errors.New("target or source row not found")
	}
	return row, nil
}

func validateLibraryReuseSnapshot(item approvedLibraryReuse, snapshot libraryReuseSnapshot) error {
	if snapshot.TargetName != item.FoodName || snapshot.SourceName != item.SourceFoodName {
		return errors.New("target or source canonical name changed")
	}
	if !snapshot.TargetActive || snapshot.TargetKcal <= 0 {
		return errors.New("target is no longer an eligible active food")
	}
	if snapshotHasImage(imageDBSnapshot{ImagePath: snapshot.TargetImagePath, ImagePaths: snapshot.TargetImagePaths}) {
		return errors.New("target image was filled after review")
	}
	if !snapshotContainsImage(imageDBSnapshot{ImagePath: snapshot.SourceImagePath, ImagePaths: snapshot.SourceImagePaths}, item.ObjectKey) {
		return errors.New("source image changed after review")
	}
	return nil
}

func applyLibraryReuse(ctx context.Context, db *gorm.DB, item approvedLibraryReuse, snapshot libraryReuseSnapshot, reviewedAt, reviewedBy string) error {
	pathsJSON, err := json.Marshal([]string{item.ObjectKey})
	if err != nil {
		return err
	}
	evidenceJSON, err := json.Marshal(map[string]any{"image_reuse": map[string]any{
		"source_food_id": item.SourceFoodID, "source_canonical_name": item.SourceFoodName,
		"reviewed_at": reviewedAt, "reviewed_by": reviewedBy, "method": "local_manual_visual_review",
	}})
	if err != nil {
		return err
	}
	updates := map[string]any{
		"image_path": item.ObjectKey, "image_paths": datatypes.JSON(pathsJSON),
		"quality_evidence": gorm.Expr("COALESCE(quality_evidence, '{}'::jsonb) || ?::jsonb", string(evidenceJSON)),
		"updated_at":       time.Now(),
	}
	if snapshot.SourceURL != "" {
		updates["image_source_url"] = snapshot.SourceURL
	}
	if snapshot.SourceLabel != "" {
		updates["image_source_label"] = snapshot.SourceLabel
	}
	if snapshot.SourceLicense != "" {
		updates["image_license"] = snapshot.SourceLicense
	}
	res := db.WithContext(ctx).Table("food_nutrition_library").
		Where("id::text = ?", item.FoodID).
		Where("NULLIF(BTRIM(COALESCE(image_path, '')), '') IS NULL").
		Where(`NOT EXISTS (
SELECT 1 FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS v
WHERE NULLIF(BTRIM(v), '') IS NOT NULL)`).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return errors.New("target changed after preflight; conditional update skipped")
	}
	return nil
}

func writeLibraryReuseApplyReport(path string, report libraryReuseApplyReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
