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
	"sync"
	"sync/atomic"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	reviewedKindMissing  = "missing"
	reviewedKindExisting = "existing"
)

type reviewedImageEntry struct {
	Kind                  string         `json:"kind"`
	FoodID                string         `json:"food_id"`
	FoodName              string         `json:"food_name"`
	Uses                  int64          `json:"uses,omitempty"`
	CandidateURL          string         `json:"candidate_url"`
	CandidatePage         string         `json:"candidate_page,omitempty"`
	ReuseObjectKey        string         `json:"reuse_object_key,omitempty"`
	SourceLabel           string         `json:"source_label,omitempty"`
	ImageLicense          string         `json:"image_license,omitempty"`
	SourceFoodID          string         `json:"source_food_id,omitempty"`
	SourceFoodName        string         `json:"source_food_name,omitempty"`
	AuditedImagePath      string         `json:"audited_image_path,omitempty"`
	OldImagePath          string         `json:"old_image_path,omitempty"`
	OldImagePaths         string         `json:"old_image_paths"`
	AuditDecision         *imageDecision `json:"audit_decision,omitempty"`
	AuditOldImageDecision *imageDecision `json:"audit_old_image_decision,omitempty"`
	FreshDecision         *imageDecision `json:"fresh_decision,omitempty"`
	FreshOldImageDecision *imageDecision `json:"fresh_old_image_decision,omitempty"`
	Status                string         `json:"status"`
	Reason                string         `json:"reason,omitempty"`
	ObjectKey             string         `json:"object_key,omitempty"`
	AccessURL             string         `json:"access_url,omitempty"`
	Uploaded              bool           `json:"uploaded"`
	Reused                bool           `json:"reused"`
	DBUpdated             bool           `json:"db_updated"`
	ProcessedAt           time.Time      `json:"processed_at,omitempty"`
}

type reviewedImageReport struct {
	GeneratedAt   time.Time                     `json:"generated_at"`
	Applied       bool                          `json:"applied"`
	Model         string                        `json:"model"`
	MinConfidence float64                       `json:"min_confidence"`
	MissingInput  string                        `json:"missing_input,omitempty"`
	ExistingInput string                        `json:"existing_input,omitempty"`
	Selected      int                           `json:"selected"`
	StatusCounts  map[string]int                `json:"status_counts"`
	Entries       map[string]reviewedImageEntry `json:"entries"`
}

type reviewedCandidate struct {
	Kind                  string
	FoodID                string
	FoodName              string
	Uses                  int64
	CandidateURL          string
	CandidatePage         string
	ReuseObjectKey        string
	SourceLabel           string
	ImageLicense          string
	SourceFoodID          string
	SourceFoodName        string
	ExpectedOldImagePath  string
	AuditDecision         *imageDecision
	AuditOldImageDecision *imageDecision
}

type imageDBSnapshot struct {
	ID         string `gorm:"column:id"`
	ImagePath  string `gorm:"column:image_path"`
	ImagePaths string `gorm:"column:image_paths"`
}

func runReviewedImageApply(ctx context.Context, opts options) error {
	if err := validateReviewedApplyMode(opts); err != nil {
		return err
	}
	if strings.TrimSpace(opts.reviewedMissingReport) == "" && strings.TrimSpace(opts.reviewedExistingReport) == "" {
		return errors.New("--reviewed-apply 至少需要一个审计报告")
	}
	if opts.reviewedMinConfidence < 0.85 || opts.reviewedMinConfidence > 1 {
		return fmt.Errorf("reviewed-min-confidence 必须在 0.85 到 1 之间")
	}
	candidates, err := loadReviewedCandidates(opts)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		return errors.New("审计报告中没有符合高置信门槛的候选")
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
	snapshots, err := loadImageSnapshots(ctx, db, candidates)
	if err != nil {
		return err
	}

	report := reviewedImageReport{
		GeneratedAt: time.Now(), Applied: opts.apply, Model: opts.model,
		MinConfidence: opts.reviewedMinConfidence,
		MissingInput:  opts.reviewedMissingReport, ExistingInput: opts.reviewedExistingReport,
		Selected: len(candidates), StatusCounts: map[string]int{},
		Entries: map[string]reviewedImageEntry{},
	}
	for _, candidate := range candidates {
		snapshot, ok := snapshots[candidate.FoodID]
		entry := reviewedImageEntry{
			Kind: candidate.Kind, FoodID: candidate.FoodID, FoodName: candidate.FoodName,
			Uses: candidate.Uses, CandidateURL: candidate.CandidateURL,
			CandidatePage: candidate.CandidatePage, ReuseObjectKey: candidate.ReuseObjectKey,
			SourceLabel: candidate.SourceLabel, ImageLicense: candidate.ImageLicense,
			SourceFoodID: candidate.SourceFoodID, SourceFoodName: candidate.SourceFoodName,
			AuditedImagePath: candidate.ExpectedOldImagePath,
			AuditDecision:    candidate.AuditDecision, AuditOldImageDecision: candidate.AuditOldImageDecision,
			Status: "planned",
		}
		if !ok {
			entry.Status = "db_row_missing"
			entry.Reason = "database row not found"
		} else {
			entry.OldImagePath = snapshot.ImagePath
			entry.OldImagePaths = snapshot.ImagePaths
			if candidate.Kind == reviewedKindMissing && snapshotHasImage(snapshot) {
				entry.Status = "db_changed"
				entry.Reason = "image was filled after the audit"
			}
			if candidate.Kind == reviewedKindExisting && !snapshotContainsImage(snapshot, candidate.ExpectedOldImagePath) {
				entry.Status = "db_changed"
				entry.Reason = "current image no longer matches the audited image"
			}
		}
		report.Entries[reviewedEntryKey(candidate.Kind, candidate.FoodID)] = entry
	}
	recomputeReviewedCounts(&report)
	if err := saveReviewedImageReport(opts.reviewedOutput, report); err != nil {
		return err
	}

	client, err := newVisionClient(opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model)
	if err != nil {
		return err
	}
	storageClient := storage.New(cfg.Storage)
	workerCount := max(1, opts.workers)
	if workerCount > len(candidates) {
		workerCount = len(candidates)
	}
	jobs := make(chan reviewedCandidate)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var processed int64
	var saveErr error

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for candidate := range jobs {
				key := reviewedEntryKey(candidate.Kind, candidate.FoodID)
				mu.Lock()
				entry := report.Entries[key]
				mu.Unlock()
				if entry.Status == "planned" {
					entry = verifyAndApplyReviewedImage(ctx, db, storageClient, client, opts, entry)
				}
				current := atomic.AddInt64(&processed, 1)
				mu.Lock()
				report.Entries[key] = entry
				recomputeReviewedCounts(&report)
				if saveErr == nil && (current%int64(max(1, opts.checkpointEvery)) == 0 || current == int64(len(candidates))) {
					saveErr = saveReviewedImageReport(opts.reviewedOutput, report)
				}
				mu.Unlock()
				if current%10 == 0 || current == int64(len(candidates)) {
					fmt.Printf("[reviewed-progress] %d/%d status=%s food=%s\n", current, len(candidates), entry.Status, entry.FoodName)
				}
			}
		}()
	}
	for _, candidate := range candidates {
		jobs <- candidate
	}
	close(jobs)
	wg.Wait()
	if saveErr != nil {
		return saveErr
	}
	report.GeneratedAt = time.Now()
	recomputeReviewedCounts(&report)
	if err := saveReviewedImageReport(opts.reviewedOutput, report); err != nil {
		return err
	}
	fmt.Printf("高置信图片复核完成：selected=%d apply=%v report=%s counts=%v\n", len(candidates), opts.apply, opts.reviewedOutput, report.StatusCounts)
	return nil
}

func loadReviewedCandidates(opts options) ([]reviewedCandidate, error) {
	out := make([]reviewedCandidate, 0)
	if path := strings.TrimSpace(opts.reviewedMissingReport); path != "" {
		var summary successSummary
		if err := readJSONFile(path, &summary); err != nil {
			return nil, fmt.Errorf("读取缺图报告: %w", err)
		}
		for _, item := range summary.Successes {
			decision := item.Decision
			if decision == nil || item.CandidateURL == "" || !decision.Match || !decision.FoodMatch || !decision.NoWatermark || decision.Confidence < opts.reviewedMinConfidence {
				continue
			}
			reuseObjectKey := ""
			if item.Reused {
				reuseObjectKey = item.ObjectKey
			}
			out = append(out, reviewedCandidate{
				Kind: reviewedKindMissing, FoodID: item.FoodID, FoodName: item.FoodName,
				CandidateURL: item.CandidateURL, CandidatePage: item.CandidatePage,
				ReuseObjectKey: reuseObjectKey, SourceLabel: item.SourceLabel,
				ImageLicense: item.License, SourceFoodID: item.SourceFoodID,
				SourceFoodName: item.SourceFoodName, AuditDecision: decision,
			})
		}
	}
	if path := strings.TrimSpace(opts.reviewedExistingReport); path != "" {
		var report existingImageAuditReport
		if err := readJSONFile(path, &report); err != nil {
			return nil, fmt.Errorf("读取已有图报告: %w", err)
		}
		for _, item := range report.Entries {
			if item.Status != "mismatch" || item.Decision == nil || item.Decision.FoodMatch || item.Decision.Confidence < opts.reviewedMinConfidence || item.Replacement == nil {
				continue
			}
			replacement := item.Replacement
			decision := replacement.Decision
			if replacement.Status != "dry_run_match" || replacement.Candidate == "" || decision == nil || !decision.Match || !decision.FoodMatch || !decision.NoWatermark || decision.Confidence < opts.reviewedMinConfidence {
				continue
			}
			out = append(out, reviewedCandidate{
				Kind: reviewedKindExisting, FoodID: item.FoodID, FoodName: item.FoodName,
				Uses: item.Uses, CandidateURL: replacement.Candidate,
				ExpectedOldImagePath: item.ImagePath, AuditDecision: decision,
				AuditOldImageDecision: item.Decision,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Uses != out[j].Uses {
			return out[i].Uses > out[j].Uses
		}
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].FoodID < out[j].FoodID
	})
	urlCounts := make(map[string]int, len(out))
	for _, candidate := range out {
		urlCounts[strings.TrimSpace(candidate.CandidateURL)]++
	}
	filtered := make([]reviewedCandidate, 0, len(out))
	for _, candidate := range out {
		// A single search result reused for multiple foods is too ambiguous for
		// automatic production writes, even when the foods look similar.
		if urlCounts[strings.TrimSpace(candidate.CandidateURL)] != 1 {
			continue
		}
		filtered = append(filtered, candidate)
	}
	if excluded := len(out) - len(filtered); excluded > 0 {
		fmt.Printf("[reviewed-preflight] excluded_ambiguous_candidate_urls=%d\n", excluded)
	}
	if path := strings.TrimSpace(opts.reviewedAllowlistReport); path != "" {
		var allowlist reviewedImageReport
		if err := readJSONFile(path, &allowlist); err != nil {
			return nil, fmt.Errorf("读取复核白名单: %w", err)
		}
		allowed := make(map[string]reviewedImageEntry, len(allowlist.Entries))
		for key, entry := range allowlist.Entries {
			if entry.Status == "verified" {
				allowed[key] = entry
			}
		}
		allowlisted := make([]reviewedCandidate, 0, len(filtered))
		changed := 0
		for _, candidate := range filtered {
			entry, ok := allowed[reviewedEntryKey(candidate.Kind, candidate.FoodID)]
			if ok && reviewedCandidateMatchesAllowlist(candidate, entry) {
				allowlisted = append(allowlisted, candidate)
			} else if ok {
				changed++
			}
		}
		fmt.Printf("[reviewed-preflight] allowlisted=%d changed_since_review=%d source=%s\n", len(allowlisted), changed, path)
		filtered = allowlisted
	}
	return filtered, nil
}

func reviewedCandidateMatchesAllowlist(candidate reviewedCandidate, entry reviewedImageEntry) bool {
	return candidate.Kind == entry.Kind &&
		candidate.FoodID == entry.FoodID &&
		strings.TrimSpace(candidate.CandidateURL) == strings.TrimSpace(entry.CandidateURL) &&
		strings.TrimSpace(candidate.CandidatePage) == strings.TrimSpace(entry.CandidatePage) &&
		strings.TrimSpace(candidate.ReuseObjectKey) == strings.TrimSpace(entry.ReuseObjectKey) &&
		strings.TrimSpace(candidate.SourceLabel) == strings.TrimSpace(entry.SourceLabel) &&
		strings.TrimSpace(candidate.ImageLicense) == strings.TrimSpace(entry.ImageLicense) &&
		strings.TrimSpace(candidate.SourceFoodID) == strings.TrimSpace(entry.SourceFoodID) &&
		strings.TrimSpace(candidate.SourceFoodName) == strings.TrimSpace(entry.SourceFoodName) &&
		strings.TrimSpace(candidate.ExpectedOldImagePath) == strings.TrimSpace(entry.AuditedImagePath)
}

func verifyAndApplyReviewedImage(ctx context.Context, db *gorm.DB, storageClient *storage.Client, client *visionClient, opts options, entry reviewedImageEntry) reviewedImageEntry {
	entry.ProcessedAt = time.Now()
	// Web-search candidates need browser headers during the fresh pass. Library
	// reuse candidates use our own CDN and keep their existing COS object key.
	imageSearch := ""
	if entry.Kind == reviewedKindMissing && entry.ReuseObjectKey == "" {
		imageSearch = "bing"
	}
	img, err := downloadCandidateHTTP(ctx, imageCandidate{ImageURL: entry.CandidateURL, PageURL: entry.CandidatePage}, imageSearch)
	if err != nil {
		entry.Status, entry.Reason = "candidate_download_failed", err.Error()
		return entry
	}
	decision, err := classifyReviewedWithRetry(ctx, client, entry.FoodName, img, false)
	entry.FreshDecision = decision
	if err != nil {
		entry.Status, entry.Reason = "candidate_vision_failed", err.Error()
		return entry
	}
	if !decision.Match || !decision.FoodMatch || !decision.NoWatermark || decision.Confidence < opts.reviewedMinConfidence {
		entry.Status, entry.Reason = "candidate_rejected", decision.Reason
		return entry
	}
	if entry.Kind == reviewedKindExisting {
		oldURL := strings.TrimSpace(entry.AuditedImagePath)
		if !strings.HasPrefix(oldURL, "http://") && !strings.HasPrefix(oldURL, "https://") {
			oldURL = storageClient.BuildAccessURL("food-images", oldURL)
		}
		oldImg, downloadErr := downloadCandidateHTTP(ctx, imageCandidate{ImageURL: oldURL}, "")
		if downloadErr != nil {
			entry.Status, entry.Reason = "old_image_download_failed", downloadErr.Error()
			return entry
		}
		oldDecision, classifyErr := classifyReviewedWithRetry(ctx, client, entry.FoodName, oldImg, true)
		entry.FreshOldImageDecision = oldDecision
		if classifyErr != nil {
			entry.Status, entry.Reason = "old_image_vision_failed", classifyErr.Error()
			return entry
		}
		if oldDecision.FoodMatch || oldDecision.Confidence < opts.reviewedMinConfidence {
			entry.Status, entry.Reason = "old_image_not_confirmed_mismatch", oldDecision.Reason
			return entry
		}
	}

	entry.ObjectKey = strings.TrimSpace(entry.ReuseObjectKey)
	if entry.ObjectKey == "" {
		entry.ObjectKey = buildObjectKey(opts.keyPrefix, entry.FoodID, img.SHA256, img.Ext)
	} else {
		entry.Reused = true
	}
	entry.AccessURL = storageClient.BuildAccessURL("food-images", entry.ObjectKey)
	if !opts.apply {
		entry.Status = "verified"
		entry.Reason = "fresh verification passed; dry-run"
		return entry
	}
	if !entry.Reused {
		uploadedURL, err := storageClient.UploadBytes("food-images", entry.ObjectKey, img.Data, img.ContentType)
		if err != nil {
			entry.Status, entry.Reason = "upload_failed", err.Error()
			return entry
		}
		entry.Uploaded = true
		if uploadedURL != "" {
			entry.AccessURL = uploadedURL
		}
	}
	if err := conditionallyUpdateReviewedImage(ctx, db, entry); err != nil {
		entry.Status, entry.Reason = "db_update_failed", err.Error()
		return entry
	}
	entry.DBUpdated = true
	entry.Status = "applied"
	if entry.Reused {
		entry.Reason = "reused existing COS object and conditionally updated database"
	} else {
		entry.Reason = "uploaded to COS and conditionally updated database"
	}
	return entry
}

func classifyReviewedWithRetry(ctx context.Context, client *visionClient, foodName string, img *downloadedImage, existing bool) (*imageDecision, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		var decision *imageDecision
		if existing {
			decision, lastErr = client.classifyExistingImage(ctx, foodName, img.Data, img.ContentType)
		} else {
			decision, lastErr = client.classifyImage(ctx, foodName, img.Data, img.ContentType)
		}
		if lastErr == nil {
			return decision, nil
		}
	}
	return nil, lastErr
}

func loadImageSnapshots(ctx context.Context, db *gorm.DB, candidates []reviewedCandidate) (map[string]imageDBSnapshot, error) {
	ids := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if !seen[candidate.FoodID] {
			seen[candidate.FoodID] = true
			ids = append(ids, candidate.FoodID)
		}
	}
	var rows []imageDBSnapshot
	err := db.WithContext(ctx).Raw(`
SELECT id::text AS id,
       COALESCE(image_path, '') AS image_path,
       COALESCE(image_paths, '[]'::jsonb)::text AS image_paths
FROM food_nutrition_library
WHERE id::text IN ?`, ids).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]imageDBSnapshot, len(rows))
	for _, row := range rows {
		out[row.ID] = row
	}
	return out, nil
}

func conditionallyUpdateReviewedImage(ctx context.Context, db *gorm.DB, entry reviewedImageEntry) error {
	pathsJSON, err := json.Marshal([]string{entry.ObjectKey})
	if err != nil {
		return err
	}
	query := db.WithContext(ctx).Table("food_nutrition_library").
		Where("id::text = ?", entry.FoodID).
		Where("COALESCE(image_path, '') = ?", entry.OldImagePath).
		Where("COALESCE(image_paths, '[]'::jsonb)::text = ?", entry.OldImagePaths)
	if entry.Kind == reviewedKindMissing {
		query = query.Where("NULLIF(trim(COALESCE(image_path, '')), '') IS NULL").Where(`NOT EXISTS (
SELECT 1 FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
WHERE NULLIF(trim(image_url), '') IS NOT NULL)`)
	}
	updates := map[string]any{
		"image_path": entry.ObjectKey, "image_paths": datatypes.JSON(pathsJSON), "updated_at": gorm.Expr("now()"),
	}
	if strings.TrimSpace(entry.CandidatePage) != "" {
		updates["image_source_url"] = strings.TrimSpace(entry.CandidatePage)
	}
	if strings.TrimSpace(entry.SourceLabel) != "" {
		updates["image_source_label"] = strings.TrimSpace(entry.SourceLabel)
	}
	if strings.TrimSpace(entry.ImageLicense) != "" {
		updates["image_license"] = strings.TrimSpace(entry.ImageLicense)
	}
	res := query.Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return errors.New("row changed after preflight; conditional update skipped")
	}
	return nil
}

func snapshotHasImage(snapshot imageDBSnapshot) bool {
	if strings.TrimSpace(snapshot.ImagePath) != "" {
		return true
	}
	var paths []string
	_ = json.Unmarshal([]byte(snapshot.ImagePaths), &paths)
	for _, path := range paths {
		if strings.TrimSpace(path) != "" {
			return true
		}
	}
	return false
}

func snapshotContainsImage(snapshot imageDBSnapshot, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return false
	}
	if strings.TrimSpace(snapshot.ImagePath) == expected {
		return true
	}
	var paths []string
	_ = json.Unmarshal([]byte(snapshot.ImagePaths), &paths)
	for _, path := range paths {
		if strings.TrimSpace(path) == expected {
			return true
		}
	}
	return false
}

func reviewedEntryKey(kind, foodID string) string { return kind + ":" + foodID }

func recomputeReviewedCounts(report *reviewedImageReport) {
	counts := map[string]int{}
	for _, entry := range report.Entries {
		counts[entry.Status]++
	}
	report.StatusCounts = counts
}

func readJSONFile(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func saveReviewedImageReport(path string, report reviewedImageReport) error {
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
