package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

type existingImageAuditFood struct {
	ID             string `json:"id"`
	CanonicalName  string `json:"canonical_name"`
	NormalizedName string `json:"normalized_name"`
	Aliases        string `json:"aliases,omitempty"`
	ImagePath      string `json:"image_path"`
	Uses           int64  `json:"uses"`
}

type existingImageAuditEntry struct {
	FoodID      string         `json:"food_id"`
	FoodName    string         `json:"food_name"`
	Uses        int64          `json:"uses"`
	ImagePath   string         `json:"image_path"`
	AccessURL   string         `json:"access_url"`
	Status      string         `json:"status"`
	Reason      string         `json:"reason,omitempty"`
	Decision    *imageDecision `json:"decision,omitempty"`
	Replacement *resultRow     `json:"replacement,omitempty"`
	AuditedAt   time.Time      `json:"audited_at"`
}

type existingImageAuditReport struct {
	GeneratedAt time.Time                          `json:"generated_at"`
	Model       string                             `json:"model"`
	ReadOnly    bool                               `json:"read_only"`
	Entries     map[string]existingImageAuditEntry `json:"entries"`
}

func runExistingImageAudit(ctx context.Context, opts options) error {
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

	foods, err := queryExistingImageFoods(ctx, db, opts)
	if err != nil {
		return err
	}
	if len(foods) == 0 {
		return fmt.Errorf("没有符合条件的已有图片记录")
	}
	report := loadExistingImageAuditReport(opts.auditOutput)
	report.GeneratedAt = time.Now()
	report.Model = opts.model
	report.ReadOnly = true
	storageClient := storage.New(cfg.Storage)
	client, err := newVisionClient(opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model)
	if err != nil {
		return err
	}

	pending := make([]existingImageAuditFood, 0, len(foods))
	for _, food := range foods {
		if previous, exists := report.Entries[food.ID]; exists && !opts.forceReprocess && shouldSkipExistingImageAudit(previous) {
			continue
		}
		pending = append(pending, food)
	}
	workerCount := max(1, opts.workers)
	if workerCount > len(pending) && len(pending) > 0 {
		workerCount = len(pending)
	}
	fmt.Printf("[audit-start] total=%d pending=%d workers=%d model=%s\n", len(foods), len(pending), workerCount, opts.model)

	jobs := make(chan existingImageAuditFood)
	var wg sync.WaitGroup
	var reportMu sync.Mutex
	var processed int64
	var saveErr error
	processOne := func(food existingImageAuditFood) {
		entry := auditExistingImage(ctx, client, storageClient, food)
		if entry.Status == "mismatch" && opts.auditSearchReplacements {
			dryOpts := opts
			dryOpts.apply = false
			dryOpts.dryRun = true
			dryOpts.maxCandidates = max(3, opts.maxCandidates)
			replacement := processFood(ctx, db, storageClient, dryOpts, stateFile{Entries: map[string]stateEntry{}}, food.asFoodRow())
			entry.Replacement = &replacement
		}
		current := atomic.AddInt64(&processed, 1)
		reportMu.Lock()
		report.Entries[food.ID] = entry
		checkpoint := opts.checkpointEvery > 0 && current%int64(opts.checkpointEvery) == 0
		if checkpoint && saveErr == nil {
			saveErr = saveExistingImageAuditReport(opts.auditOutput, report)
		}
		reportMu.Unlock()
		fmt.Printf("[audit:%s] %d/%d uses=%d %s %s\n", entry.Status, current, len(pending), food.Uses, food.ID, food.CanonicalName)
		if opts.sleep > 0 {
			time.Sleep(opts.sleep)
		}
	}
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for food := range jobs {
				processOne(food)
			}
		}()
	}
	for _, food := range pending {
		jobs <- food
	}
	close(jobs)
	wg.Wait()
	if saveErr != nil {
		return saveErr
	}
	if err := saveExistingImageAuditReport(opts.auditOutput, report); err != nil {
		return err
	}
	fmt.Printf("已有图片审计完成：本次 %d 条，报告 %s（只读，未更新 COS/数据库）\n", processed, opts.auditOutput)
	return nil
}

func shouldSkipExistingImageAudit(entry existingImageAuditEntry) bool {
	return entry.Status == "match" || entry.Status == "mismatch"
}

func (food existingImageAuditFood) asFoodRow() foodRow {
	return foodRow{
		ID: food.ID, CanonicalName: food.CanonicalName,
		NormalizedName: food.NormalizedName, Aliases: food.Aliases,
	}
}

func queryExistingImageFoods(ctx context.Context, db *gorm.DB, opts options) ([]existingImageAuditFood, error) {
	args := []any{opts.auditMinUses}
	query := `
WITH refs AS (
  SELECT item->>'manual_source_id' AS food_id, COUNT(*)::bigint AS uses
  FROM user_food_records r
  CROSS JOIN LATERAL jsonb_array_elements(r.items) AS item
  WHERE item->>'manual_source' = 'nutrition_library'
    AND COALESCE(item->>'manual_source_id', '') <> ''
  GROUP BY item->>'manual_source_id'
), scoped AS (
  SELECT
    f.id::text AS id,
    f.canonical_name,
    f.normalized_name,
    COALESCE(string_agg(a.alias_name, ' ' ORDER BY a.alias_name), '') AS aliases,
    COALESCE(
      NULLIF(trim(f.image_path), ''),
      (SELECT NULLIF(trim(v), '')
       FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS v
       WHERE NULLIF(trim(v), '') IS NOT NULL
       LIMIT 1)
    ) AS image_path,
    COALESCE(refs.uses, 0)::bigint AS uses,
    f.updated_at
  FROM food_nutrition_library f
  LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
  LEFT JOIN refs ON refs.food_id = f.id::text
  WHERE f.is_active = TRUE
    AND COALESCE(f.kcal_per_100g, 0) > 0
    AND (
      NULLIF(trim(COALESCE(f.image_path, '')), '') IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS image_url
        WHERE NULLIF(trim(image_url), '') IS NOT NULL
      )
    )
  GROUP BY f.id, refs.uses
)
SELECT id, canonical_name, normalized_name, aliases, image_path, uses
FROM scoped
WHERE uses >= ?`
	if id := strings.TrimSpace(opts.foodID); id != "" {
		query += " AND id = ?"
		args = append(args, id)
	}
	query += " ORDER BY uses DESC, (canonical_name ~ '[\\u4e00-\\u9fff]') DESC, updated_at DESC NULLS LAST, canonical_name ASC"
	if opts.limit > 0 {
		query += " LIMIT ?"
		args = append(args, opts.limit)
	}
	if opts.offset > 0 {
		query += " OFFSET ?"
		args = append(args, opts.offset)
	}
	var rows []existingImageAuditFood
	return rows, db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error
}

func auditExistingImage(ctx context.Context, client *visionClient, storageClient *storage.Client, food existingImageAuditFood) existingImageAuditEntry {
	accessURL := strings.TrimSpace(food.ImagePath)
	if !strings.HasPrefix(accessURL, "http://") && !strings.HasPrefix(accessURL, "https://") {
		accessURL = storageClient.BuildAccessURL("food-images", accessURL)
	}
	entry := existingImageAuditEntry{
		FoodID: food.ID, FoodName: food.CanonicalName, Uses: food.Uses,
		ImagePath: food.ImagePath, AccessURL: accessURL, AuditedAt: time.Now(),
	}
	img, err := downloadCandidateHTTP(ctx, imageCandidate{ImageURL: accessURL}, "")
	if err != nil {
		entry.Status = "download_failed"
		entry.Reason = err.Error()
		return entry
	}
	var decision *imageDecision
	for attempt := 0; attempt < 2; attempt++ {
		decision, err = client.classifyExistingImage(ctx, food.CanonicalName, img.Data, img.ContentType)
		if err == nil {
			break
		}
		if attempt == 0 {
			select {
			case <-ctx.Done():
				entry.Status = "vision_failed"
				entry.Reason = ctx.Err().Error()
				return entry
			case <-time.After(300 * time.Millisecond):
			}
		}
	}
	if err != nil {
		entry.Status = "vision_failed"
		entry.Reason = err.Error()
		return entry
	}
	entry.Decision = decision
	entry.Reason = decision.Reason
	entry.Status = existingImageAuditStatus(decision)
	return entry
}

func existingImageAuditStatus(decision *imageDecision) string {
	if decision == nil {
		return "vision_failed"
	}
	if !decision.FoodMatch && decision.Confidence >= 0.85 {
		return "mismatch"
	}
	if decision.FoodMatch && decision.Confidence >= 0.72 {
		return "match"
	}
	return "uncertain"
}

func loadExistingImageAuditReport(path string) existingImageAuditReport {
	report := existingImageAuditReport{Entries: map[string]existingImageAuditEntry{}, ReadOnly: true}
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &report)
	}
	if report.Entries == nil {
		report.Entries = map[string]existingImageAuditEntry{}
	}
	return report
}

func saveExistingImageAuditReport(path string, report existingImageAuditReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
