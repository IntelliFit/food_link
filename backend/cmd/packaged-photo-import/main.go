package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	foodrecordservice "food_link/backend/internal/foodrecord/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
)

type groupManifest struct {
	Groups []foodrecordservice.PackagedPhotoGroup `json:"groups"`
}

type importState struct {
	Entries map[string]stateEntry `json:"entries"`
}

type stateEntry struct {
	Status         string   `json:"status"`
	PackagedFoodID string   `json:"packaged_food_id,omitempty"`
	Reason         string   `json:"reason,omitempty"`
	ProductName    string   `json:"product_name,omitempty"`
	ImageURLs      []string `json:"image_urls,omitempty"`
}

type groupResult struct {
	GroupID       string                                          `json:"group_id"`
	Files         []string                                        `json:"files"`
	ImageURLs     []string                                        `json:"image_urls,omitempty"`
	Extract       *foodrecordservice.PackagedProductExtractResult `json:"extract,omitempty"`
	AutoIngest    *foodrecordservice.PackagedAutoIngestResult     `json:"auto_ingest,omitempty"`
	ResolveStatus string                                          `json:"resolve_status,omitempty"`
	Error         string                                          `json:"error,omitempty"`
}

type runSummary struct {
	StartedAt       time.Time `json:"started_at"`
	FinishedAt      time.Time `json:"finished_at"`
	InputDir        string    `json:"input_dir"`
	OutputDir       string    `json:"output_dir"`
	TotalGroups     int       `json:"total_groups"`
	ProcessedGroups int       `json:"processed_groups"`
	Ingested        int       `json:"ingested"`
	Ready           int       `json:"ready"`
	Blocked         int       `json:"blocked"`
	Review          int       `json:"review"`
	Errors          int       `json:"errors"`
	SkippedResume   int       `json:"skipped_resume"`
	Apply           bool      `json:"apply"`
	DryRun          bool      `json:"dry_run"`
	ForceApply      bool      `json:"force_apply"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	inputDir := flag.String("input-dir", "", "local folder containing snack photos")
	manifestPath := flag.String("manifest", "", "optional groups.json to load instead of auto grouping")
	groupingManifest := flag.String("grouping-manifest", "", "write auto-grouped manifest to this path and exit")
	sessionGapSec := flag.Int("session-gap-sec", 90, "split photo sessions when gap exceeds this many seconds")
	outputDir := flag.String("output-dir", "", "directory for groups/results/review outputs")
	stateFile := flag.String("state-file", "", "resume state json path")
	limit := flag.Int("limit", 0, "process at most N groups (0 = all)")
	offset := flag.Int("offset", 0, "skip first N groups after resume filtering")
	apply := flag.Bool("apply", false, "write passed items into packaged_food_library")
	forceApply := flag.Bool("force-apply", false, "force ingest when core fields are complete even if auto gate blocked")
	dryRun := flag.Bool("dry-run", false, "run OCR but do not write database")
	source := flag.String("source", foodrecordservice.PackagedSourceHumanPhotoBatch, "packaged_food_library.source value")
	ingestMethod := flag.String("ingest-method", foodrecordservice.PackagedIngestMethodHumanPhotoBatch, "packaged_food_library.ingest_method value")
	verifyResolve := flag.Bool("verify-resolve", false, "after ingest, verify ResolvePackagedFood can match each ingested item")
	timeout := flag.Duration("timeout", 12*time.Hour, "overall command timeout")
	flag.Parse()

	if strings.TrimSpace(*inputDir) == "" && strings.TrimSpace(*manifestPath) == "" {
		log.Fatal("必须指定 --input-dir 或 --manifest")
	}
	if *apply && *dryRun {
		log.Fatal("--apply 与 --dry-run 不能同时使用")
	}
	if !*apply {
		*dryRun = true
	}

	groups, err := loadGroups(*inputDir, *manifestPath, *sessionGapSec)
	if err != nil {
		log.Fatalf("加载分组失败: %v", err)
	}
	if strings.TrimSpace(*groupingManifest) != "" {
		if err := writeJSON(*groupingManifest, groupManifest{Groups: groups}); err != nil {
			log.Fatalf("写入 grouping manifest 失败: %v", err)
		}
		fmt.Printf("groups=%d manifest=%s\n", len(groups), *groupingManifest)
		if strings.TrimSpace(*inputDir) == "" || *apply || *limit > 0 {
			return
		}
	}

	outDir := strings.TrimSpace(*outputDir)
	if outDir == "" {
		outDir = filepath.Join("..", "tmp", fmt.Sprintf("packaged-photo-import-%s", time.Now().Format("20060102-150405")))
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		log.Fatalf("创建输出目录失败: %v", err)
	}
	if err := writeJSON(filepath.Join(outDir, "groups.json"), groupManifest{Groups: groups}); err != nil {
		log.Fatalf("写入 groups.json 失败: %v", err)
	}

	state := loadState(*stateFile)
	selected := selectGroups(groups, state, *offset, *limit)
	summary := runSummary{
		StartedAt:   time.Now(),
		InputDir:    *inputDir,
		OutputDir:   outDir,
		TotalGroups: len(groups),
		Apply:       *apply,
		DryRun:      *dryRun,
		ForceApply:  *forceApply,
	}
	summary.SkippedResume = len(groups) - len(selected) - *offset
	if summary.SkippedResume < 0 {
		summary.SkippedResume = 0
	}

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取 SQL 连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}

	storageClient := storage.New(cfg.Storage)
	doubaoClient := analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, "", cfg.External.DoubaoBaseURL)
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	nutritionSvc := foodrecordservice.NewFoodNutritionService(nutritionRepo)
	nutritionSvc.ConfigureNutritionLabelVisionClient(doubaoClient)

	resultsPath := filepath.Join(outDir, "results.jsonl")
	resultsFile, err := os.Create(resultsPath)
	if err != nil {
		log.Fatalf("创建 results.jsonl 失败: %v", err)
	}
	defer resultsFile.Close()
	encoder := json.NewEncoder(resultsFile)

	reviewRows := [][]string{}
	reviewHeader := []string{
		"group_id", "status", "reason", "product_name", "brand", "spec_text",
		"net_weight_g", "conversion_status", "extract_confidence", "files", "missing_fields", "needs_more_images",
	}

	ingestOpts := foodrecordservice.PackagedImportIngestOptions{
		Source:       *source,
		IngestMethod: *ingestMethod,
		ForceApply:   *forceApply,
	}

	for _, group := range selected {
		summary.ProcessedGroups++
		result := processGroup(ctx, storageClient, nutritionSvc, nutritionRepo, group, ingestOpts, *dryRun, *verifyResolve)
		if err := encoder.Encode(result); err != nil {
			log.Printf("写入 results.jsonl 失败 group=%s err=%v", group.ID, err)
		}
		switch {
		case result.Error != "":
			summary.Errors++
		case result.AutoIngest != nil && result.AutoIngest.Status == "ingested":
			summary.Ingested++
		case result.AutoIngest != nil && result.AutoIngest.Status == "ready":
			summary.Ready++
		case result.AutoIngest != nil && result.AutoIngest.Status == "blocked":
			summary.Blocked++
			summary.Review++
		default:
			summary.Review++
		}
		if state.Entries == nil {
			state.Entries = map[string]stateEntry{}
		}
		entry := stateEntry{
			Status:      resultStatus(result),
			Reason:      resultReason(result),
			ProductName: extractProductName(result),
			ImageURLs:   result.ImageURLs,
		}
		if result.AutoIngest != nil && result.AutoIngest.Status == "ingested" {
			entry.Status = "ingested"
			entry.PackagedFoodID = result.AutoIngest.PackagedFoodID
			entry.Reason = "ingested"
		} else if result.Error != "" {
			entry.Status = "error"
			entry.Reason = result.Error
		}
		state.Entries[group.ID] = entry
		if err := saveState(*stateFile, state); err != nil {
			log.Printf("保存 state 失败: %v", err)
		}

		if shouldReview(result) {
			reviewRows = append(reviewRows, buildReviewRow(group, result))
		}
		log.Printf("group=%s status=%s product=%s reason=%s", group.ID, entry.Status, entry.ProductName, entry.Reason)
	}

	if err := writeReviewCSV(filepath.Join(outDir, "review.csv"), reviewHeader, reviewRows); err != nil {
		log.Fatalf("写入 review.csv 失败: %v", err)
	}
	summary.FinishedAt = time.Now()
	if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
		log.Fatalf("写入 summary.json 失败: %v", err)
	}
	fmt.Printf("done processed=%d ingested=%d blocked=%d review=%d errors=%d output=%s\n",
		summary.ProcessedGroups, summary.Ingested, summary.Blocked, summary.Review, summary.Errors, outDir)
}

func loadGroups(inputDir, manifestPath string, sessionGapSec int) ([]foodrecordservice.PackagedPhotoGroup, error) {
	if strings.TrimSpace(manifestPath) != "" {
		var manifest groupManifest
		if err := readJSON(manifestPath, &manifest); err != nil {
			return nil, err
		}
		if len(manifest.Groups) == 0 {
			return nil, fmt.Errorf("manifest 中没有 groups")
		}
		return manifest.Groups, nil
	}
	return foodrecordservice.ScanPackagedPhotoGroups(inputDir, sessionGapSec)
}

func selectGroups(groups []foodrecordservice.PackagedPhotoGroup, state importState, offset, limit int) []foodrecordservice.PackagedPhotoGroup {
	selected := make([]foodrecordservice.PackagedPhotoGroup, 0, len(groups))
	for _, group := range groups {
		if entry, ok := state.Entries[group.ID]; ok && entry.Status == "ingested" {
			continue
		}
		selected = append(selected, group)
	}
	if offset > 0 {
		if offset >= len(selected) {
			return nil
		}
		selected = selected[offset:]
	}
	if limit > 0 && len(selected) > limit {
		selected = selected[:limit]
	}
	return selected
}

func processGroup(
	ctx context.Context,
	storageClient *storage.Client,
	nutritionSvc *foodrecordservice.FoodNutritionService,
	nutritionRepo *foodrecordrepo.FoodNutritionRepo,
	group foodrecordservice.PackagedPhotoGroup,
	opts foodrecordservice.PackagedImportIngestOptions,
	dryRun bool,
	verifyResolve bool,
) groupResult {
	result := groupResult{GroupID: group.ID, Files: group.Files}
	imageURLs, err := uploadGroupImages(ctx, storageClient, group)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.ImageURLs = imageURLs

	extract, err := nutritionSvc.ExtractPackagedProduct(ctx, imageURLs, "")
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Extract = extract

	if dryRun {
		auto := evaluateExtract(extract)
		result.AutoIngest = auto
		return result
	}

	auto, created, err := nutritionSvc.IngestPackagedProductExtract(ctx, extract, opts)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.AutoIngest = auto
	if verifyResolve && created != nil {
		resolved, resolveErr := nutritionRepo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
			Name:       created.ProductName,
			Brand:      created.Brand,
			SpecText:   derefString(created.SpecText),
			Barcode:    derefString(created.Barcode),
			NetWeightG: created.NetWeightG,
		})
		if resolveErr != nil {
			result.Error = resolveErr.Error()
			return result
		}
		if resolved != nil {
			result.ResolveStatus = resolved.Status
		}
	}
	return result
}

func uploadGroupImages(ctx context.Context, storageClient *storage.Client, group foodrecordservice.PackagedPhotoGroup) ([]string, error) {
	_ = ctx
	urls := make([]string, 0, len(group.Files))
	batchID := uuid.NewString()
	for _, filePath := range group.Files {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", filePath, err)
		}
		ext := strings.ToLower(filepath.Ext(filePath))
		if ext == "" {
			ext = ".jpg"
		}
		contentType := "image/jpeg"
		switch ext {
		case ".png":
			contentType = "image/png"
		case ".webp":
			contentType = "image/webp"
		}
		key := filepath.ToSlash(filepath.Join("batch-import", batchID, group.ID+"-"+filepath.Base(filePath)))
		url, err := storageClient.UploadBytes("food-images", key, data, contentType)
		if err != nil {
			return nil, fmt.Errorf("upload %s: %w", filePath, err)
		}
		urls = append(urls, url)
	}
	return urls, nil
}

func evaluateExtract(extract *foodrecordservice.PackagedProductExtractResult) *foodrecordservice.PackagedAutoIngestResult {
	if extract == nil {
		return &foodrecordservice.PackagedAutoIngestResult{Status: "blocked", Reason: "empty_result"}
	}
	return foodrecordservice.EvaluatePackagedProductExtract(extract)
}

func shouldReview(result groupResult) bool {
	if result.Error != "" {
		return true
	}
	if result.AutoIngest == nil {
		return true
	}
	return result.AutoIngest.Status == "blocked"
}

func buildReviewRow(group foodrecordservice.PackagedPhotoGroup, result groupResult) []string {
	productName := ""
	brand := ""
	specText := ""
	netWeight := ""
	conversion := ""
	confidence := ""
	missing := ""
	needsMore := ""
	reason := resultReason(result)
	status := "review"
	if result.AutoIngest != nil {
		status = result.AutoIngest.Status
	}
	if result.Extract != nil {
		productName = result.Extract.ProductName
		brand = result.Extract.Brand
		specText = result.Extract.SpecText
		netWeight = fmt.Sprintf("%.2f", result.Extract.NetWeightG)
		conversion = result.Extract.ConversionStatus
		confidence = fmt.Sprintf("%.3f", result.Extract.ExtractConfidence)
		missing = strings.Join(result.Extract.MissingFields, "|")
		needsMore = strings.Join(result.Extract.NeedsMoreImages, "|")
	}
	return []string{
		group.ID, status, reason, productName, brand, specText, netWeight, conversion, confidence,
		strings.Join(group.Files, "|"), missing, needsMore,
	}
}

func resultReason(result groupResult) string {
	if result.Error != "" {
		return result.Error
	}
	if result.AutoIngest != nil && result.AutoIngest.Reason != "" {
		return result.AutoIngest.Reason
	}
	return "review"
}

func resultStatus(result groupResult) string {
	if result.Error != "" {
		return "error"
	}
	if result.AutoIngest != nil && result.AutoIngest.Status != "" {
		return result.AutoIngest.Status
	}
	return "review"
}

func extractProductName(result groupResult) string {
	if result.Extract != nil {
		return result.Extract.ProductName
	}
	return ""
}

func loadState(path string) importState {
	path = strings.TrimSpace(path)
	if path == "" {
		return importState{Entries: map[string]stateEntry{}}
	}
	var state importState
	if err := readJSON(path, &state); err != nil {
		log.Printf("读取 state 失败，将使用空 state: %v", err)
	}
	if state.Entries == nil {
		state.Entries = map[string]stateEntry{}
	}
	return state
}

func saveState(path string, state importState) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	return writeJSON(path, state)
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func writeReviewCSV(path string, header []string, rows [][]string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	if err := writer.Write(header); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write(row); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
