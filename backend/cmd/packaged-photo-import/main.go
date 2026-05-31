package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
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
	Attempts      int                                             `json:"attempts,omitempty"`
	Retried       bool                                            `json:"retried,omitempty"`
	Transient     bool                                            `json:"transient,omitempty"`
	Extract       *foodrecordservice.PackagedProductExtractResult `json:"extract,omitempty"`
	AutoIngest    *foodrecordservice.PackagedAutoIngestResult     `json:"auto_ingest,omitempty"`
	Delta         *deltaDecision                                  `json:"delta,omitempty"`
	ResolveStatus string                                          `json:"resolve_status,omitempty"`
	Error         string                                          `json:"error,omitempty"`
}

type runSummary struct {
	StartedAt       time.Time      `json:"started_at"`
	FinishedAt      time.Time      `json:"finished_at"`
	InputDir        string         `json:"input_dir"`
	OutputDir       string         `json:"output_dir"`
	TotalGroups     int            `json:"total_groups"`
	ProcessedGroups int            `json:"processed_groups"`
	Ingested        int            `json:"ingested"`
	Ready           int            `json:"ready"`
	Blocked         int            `json:"blocked"`
	Review          int            `json:"review"`
	Errors          int            `json:"errors"`
	SkippedResume   int            `json:"skipped_resume"`
	VisionProvider  string         `json:"vision_provider"`
	VisionModel     string         `json:"vision_model"`
	ApplyPolicy     string         `json:"apply_policy"`
	Apply           bool           `json:"apply"`
	DryRun          bool           `json:"dry_run"`
	ForceApply      bool           `json:"force_apply"`
	DeltaBackfill   int            `json:"delta_backfill"`
	DeltaConflict   int            `json:"delta_conflict"`
	DeltaNew        int            `json:"delta_new"`
	DeltaNoChange   int            `json:"delta_no_change"`
	DeltaApplied    int            `json:"delta_applied"`
	DeltaActions    map[string]int `json:"delta_actions,omitempty"`
	ConflictFields  map[string]int `json:"conflict_fields,omitempty"`
	RetryAttempts   int            `json:"retry_attempts"`
	RetryDelayMs    int64          `json:"retry_delay_ms"`
	RetriedGroups   int            `json:"retried_groups"`
	TransientErrors int            `json:"transient_errors"`
	FailedOnly      bool           `json:"failed_only,omitempty"`
	RerunErrorsFrom string         `json:"rerun_errors_from,omitempty"`
}

const (
	applyPolicyAudit                 = "audit"
	applyPolicyBackfillMissing       = "backfill-missing"
	applyPolicyReplaceHighConfidence = "replace-high-confidence"
)

type deltaDecision struct {
	Status             string   `json:"status,omitempty"`
	ReviewStatus       string   `json:"review_status,omitempty"`
	Action             string   `json:"action,omitempty"`
	Reason             string   `json:"reason,omitempty"`
	MatchedFoodID      string   `json:"matched_food_id,omitempty"`
	MatchedFoodName    string   `json:"matched_food_name,omitempty"`
	MatchStatus        string   `json:"match_status,omitempty"`
	MatchScore         float64  `json:"match_score,omitempty"`
	CandidateCount     int      `json:"candidate_count,omitempty"`
	ChangedFields      []string `json:"changed_fields,omitempty"`
	ConflictFields     []string `json:"conflict_fields,omitempty"`
	Applied            bool     `json:"applied,omitempty"`
	CurrentNetWeightG  float64  `json:"current_net_weight_g,omitempty"`
	ExtractNetWeightG  float64  `json:"extract_net_weight_g,omitempty"`
	CurrentSpecText    string   `json:"current_spec_text,omitempty"`
	ExtractSpecText    string   `json:"extract_spec_text,omitempty"`
	CurrentFlavorText  string   `json:"current_flavor_text,omitempty"`
	ExtractFlavorText  string   `json:"extract_flavor_text,omitempty"`
	CurrentBarcode     string   `json:"current_barcode,omitempty"`
	ExtractBarcode     string   `json:"extract_barcode,omitempty"`
	TopCandidateNames  []string `json:"top_candidate_names,omitempty"`
	HighConfidenceNote string   `json:"high_confidence_note,omitempty"`
}

type existingMatch struct {
	Food       *foodrecorddomain.PackagedFood
	Status     string
	Score      float64
	Candidates []foodrecorddomain.PackagedFood
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
	visionProvider := flag.String("vision-provider", "doubao", "vision provider for packaged OCR: doubao or gemini")
	visionModel := flag.String("vision-model", "", "vision model name, e.g. gemini-3-flash-preview")
	applyPolicy := flag.String("apply-policy", applyPolicyAudit, "write policy: audit, backfill-missing, replace-high-confidence")
	failedOnly := flag.Bool("failed-only", false, "with --state-file, process only groups whose state status is error")
	rerunErrorsFrom := flag.String("rerun-errors-from", "", "previous results.jsonl; process only groups with error in that file")
	retryAttempts := flag.Int("retry-attempts", 2, "retry transient vision errors this many times after the first attempt")
	retryDelay := flag.Duration("retry-delay", 3*time.Second, "delay between transient vision retries")
	timeout := flag.Duration("timeout", 12*time.Hour, "overall command timeout")
	flag.Parse()

	if strings.TrimSpace(*inputDir) == "" && strings.TrimSpace(*manifestPath) == "" {
		log.Fatal("必须指定 --input-dir 或 --manifest")
	}
	normalizedApplyPolicy := normalizeApplyPolicy(*applyPolicy)
	if normalizedApplyPolicy == "" {
		log.Fatalf("--apply-policy 仅支持 %s / %s / %s", applyPolicyAudit, applyPolicyBackfillMissing, applyPolicyReplaceHighConfidence)
	}
	if *apply && *dryRun {
		log.Fatal("--apply 与 --dry-run 不能同时使用")
	}
	if normalizedApplyPolicy == applyPolicyAudit {
		*dryRun = true
		if *apply {
			log.Printf("--apply-policy=audit 会强制 dry-run，不写入数据库")
		}
		*apply = false
	} else if !*apply {
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
	failedGroupIDs := map[string]bool{}
	if path := strings.TrimSpace(*rerunErrorsFrom); path != "" {
		var loadErr error
		failedGroupIDs, loadErr = loadFailedGroupIDs(path)
		if loadErr != nil {
			log.Fatalf("读取失败组结果失败: %v", loadErr)
		}
	}
	selected := selectGroups(groups, state, *offset, *limit, *failedOnly, failedGroupIDs)
	summary := runSummary{
		StartedAt:       time.Now(),
		InputDir:        *inputDir,
		OutputDir:       outDir,
		TotalGroups:     len(groups),
		Apply:           *apply,
		DryRun:          *dryRun,
		ForceApply:      *forceApply,
		ApplyPolicy:     normalizedApplyPolicy,
		RetryAttempts:   maxInt(0, *retryAttempts),
		RetryDelayMs:    retryDelay.Milliseconds(),
		DeltaActions:    map[string]int{},
		ConflictFields:  map[string]int{},
		FailedOnly:      *failedOnly,
		RerunErrorsFrom: strings.TrimSpace(*rerunErrorsFrom),
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
	visionClient, resolvedProvider, resolvedModel, err := buildVisionClient(cfg, *visionProvider, *visionModel)
	if err != nil {
		log.Fatalf("初始化视觉模型失败: %v", err)
	}
	summary.VisionProvider = resolvedProvider
	summary.VisionModel = resolvedModel
	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	nutritionSvc := foodrecordservice.NewFoodNutritionService(nutritionRepo)
	nutritionSvc.ConfigureNutritionLabelVisionClient(visionClient)

	resultsPath := filepath.Join(outDir, "results.jsonl")
	resultsFile, err := os.Create(resultsPath)
	if err != nil {
		log.Fatalf("创建 results.jsonl 失败: %v", err)
	}
	defer resultsFile.Close()
	encoder := json.NewEncoder(resultsFile)

	reviewRows := [][]string{}
	reviewHeader := []string{
		"group_id", "status", "review_status", "reason", "product_name", "brand", "spec_text",
		"net_weight_g", "conversion_status", "extract_confidence", "files", "missing_fields", "needs_more_images",
	}
	deltaRows := [][]string{}
	deltaHeader := []string{
		"group_id", "status", "review_status", "action", "reason", "matched_food_id", "matched_food_name", "match_status", "match_score",
		"candidate_count", "changed_fields", "conflict_fields", "current_net_weight_g", "extract_net_weight_g",
		"current_spec_text", "extract_spec_text", "current_flavor_text", "extract_flavor_text", "current_barcode", "extract_barcode",
		"applied", "top_candidates", "files",
	}

	ingestOpts := foodrecordservice.PackagedImportIngestOptions{
		Source:       *source,
		IngestMethod: *ingestMethod,
		ForceApply:   *forceApply,
	}

	for _, group := range selected {
		summary.ProcessedGroups++
		result := processGroup(ctx, storageClient, nutritionSvc, nutritionRepo, group, ingestOpts, *dryRun, normalizedApplyPolicy, *verifyResolve, maxInt(0, *retryAttempts), *retryDelay)
		if err := encoder.Encode(result); err != nil {
			log.Printf("写入 results.jsonl 失败 group=%s err=%v", group.ID, err)
		}
		updateDeltaSummary(&summary, result.Delta)
		if result.Retried {
			summary.RetriedGroups++
		}
		if result.Transient {
			summary.TransientErrors++
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
		if result.Delta != nil {
			deltaRows = append(deltaRows, buildDeltaRow(group, result))
		}
		log.Printf("group=%s status=%s product=%s reason=%s", group.ID, entry.Status, entry.ProductName, entry.Reason)
	}

	if err := writeCSV(filepath.Join(outDir, "review.csv"), reviewHeader, reviewRows); err != nil {
		log.Fatalf("写入 review.csv 失败: %v", err)
	}
	if err := writeCSV(filepath.Join(outDir, "delta.csv"), deltaHeader, deltaRows); err != nil {
		log.Fatalf("写入 delta.csv 失败: %v", err)
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

func selectGroups(groups []foodrecordservice.PackagedPhotoGroup, state importState, offset, limit int, failedOnly bool, failedGroupIDs map[string]bool) []foodrecordservice.PackagedPhotoGroup {
	selected := make([]foodrecordservice.PackagedPhotoGroup, 0, len(groups))
	hasFailedGroupFilter := len(failedGroupIDs) > 0
	for _, group := range groups {
		if hasFailedGroupFilter && !failedGroupIDs[group.ID] {
			continue
		}
		if failedOnly && !hasFailedGroupFilter {
			entry, ok := state.Entries[group.ID]
			if !ok || entry.Status != "error" {
				continue
			}
		}
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

func loadFailedGroupIDs(path string) (map[string]bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	out := map[string]bool{}
	for {
		var result groupResult
		if err := decoder.Decode(&result); err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}
		if strings.TrimSpace(result.GroupID) != "" && strings.TrimSpace(result.Error) != "" {
			out[result.GroupID] = true
		}
	}
	return out, nil
}

func processGroup(
	ctx context.Context,
	storageClient *storage.Client,
	nutritionSvc *foodrecordservice.FoodNutritionService,
	nutritionRepo *foodrecordrepo.FoodNutritionRepo,
	group foodrecordservice.PackagedPhotoGroup,
	opts foodrecordservice.PackagedImportIngestOptions,
	dryRun bool,
	applyPolicy string,
	verifyResolve bool,
	retryAttempts int,
	retryDelay time.Duration,
) groupResult {
	result := groupResult{GroupID: group.ID, Files: group.Files}
	imageURLs, err := uploadGroupImages(ctx, storageClient, group)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.ImageURLs = imageURLs

	extract, attempts, retried, transient, err := extractPackagedProductWithRetry(ctx, nutritionSvc, imageURLs, retryAttempts, retryDelay)
	result.Attempts = attempts
	result.Retried = retried
	result.Transient = transient
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Extract = extract
	delta, err := buildDeltaDecision(ctx, nutritionRepo, extract)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Delta = delta

	if dryRun {
		auto := evaluateExtract(extract)
		result.AutoIngest = auto
		return result
	}

	auto, created, err := applyPackagedExtract(ctx, nutritionRepo, extract, delta, opts, applyPolicy)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.AutoIngest = auto
	if verifyResolve && created != nil {
		resolved, resolveErr := nutritionRepo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
			Name:            created.ProductName,
			Brand:           created.Brand,
			FlavorText:      derefString(created.FlavorText),
			SpecText:        derefString(created.SpecText),
			Barcode:         derefString(created.Barcode),
			NetWeightG:      created.NetWeightG,
			NetContentValue: created.NetContentValue,
			NetContentUnit:  derefString(created.NetContentUnit),
			UnitCount:       created.UnitCount,
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

func normalizeApplyPolicy(policy string) string {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "", applyPolicyAudit:
		return applyPolicyAudit
	case applyPolicyBackfillMissing:
		return applyPolicyBackfillMissing
	case applyPolicyReplaceHighConfidence:
		return applyPolicyReplaceHighConfidence
	default:
		return ""
	}
}

func reviewStatusForDeltaAction(action string) string {
	return foodrecordservice.PackagedReviewStatusForDeltaAction(action)
}

func buildVisionClient(cfg *config.Config, provider, model string) (foodrecordservice.NutritionLabelVisionClient, string, string, error) {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	model = strings.TrimSpace(model)
	switch normalizedProvider {
	case "", "doubao":
		client := analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, model, cfg.External.DoubaoBaseURL)
		if model == "" {
			model = "doubao-seed-2-0-lite-260428"
		}
		return client, "doubao", model, nil
	case "gemini", "ofox", "ofoxai", "ofox-gemini":
		if cfg.External.OfoxAIAPIKey == "" {
			return nil, "", "", fmt.Errorf("Gemini 3 Flash 需要配置 external.ofoxai_api_key")
		}
		if model == "" {
			model = "gemini-3-flash-preview"
		}
		client := analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, model, cfg.External.OfoxAIBaseURL)
		return client, "gemini", model, nil
	default:
		return nil, "", "", fmt.Errorf("未知 vision provider: %s", provider)
	}
}

func extractPackagedProductWithRetry(
	ctx context.Context,
	nutritionSvc *foodrecordservice.FoodNutritionService,
	imageURLs []string,
	retryAttempts int,
	retryDelay time.Duration,
) (*foodrecordservice.PackagedProductExtractResult, int, bool, bool, error) {
	attempts := 0
	retried := false
	lastTransient := false
	maxAttempts := 1 + maxInt(0, retryAttempts)
	if retryDelay < 0 {
		retryDelay = 0
	}
	for attempts < maxAttempts {
		attempts++
		extract, err := nutritionSvc.ExtractPackagedProduct(ctx, imageURLs, "")
		if err == nil {
			return extract, attempts, retried, lastTransient, nil
		}
		lastTransient = isTransientVisionError(err)
		if !lastTransient || attempts >= maxAttempts {
			return nil, attempts, retried, lastTransient, err
		}
		retried = true
		log.Printf("预包装商品识别遇到临时错误，准备重试 attempt=%d/%d err=%v", attempts+1, maxAttempts, err)
		if retryDelay <= 0 {
			continue
		}
		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, attempts, retried, true, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, attempts, retried, lastTransient, fmt.Errorf("识别预包装商品失败")
}

func isTransientVisionError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	transientMarkers := []string{
		"context deadline exceeded",
		"client.timeout",
		"timeout",
		"awaiting headers",
		"eof",
		"connection reset",
		"socket hang up",
		"temporary failure",
		"tls handshake timeout",
		"server closed idle connection",
		"503",
		"504",
		"502",
	}
	for _, marker := range transientMarkers {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

func buildDeltaDecision(ctx context.Context, nutritionRepo *foodrecordrepo.FoodNutritionRepo, extract *foodrecordservice.PackagedProductExtractResult) (*deltaDecision, error) {
	if extract == nil {
		return &deltaDecision{
			Status:       "review",
			ReviewStatus: reviewStatusForDeltaAction("empty_extract"),
			Action:       "empty_extract",
			Reason:       "模型未返回结构化结果",
		}, nil
	}
	match, err := findExistingPackagedFood(ctx, nutritionRepo, extract)
	if err != nil {
		return nil, err
	}
	delta := &deltaDecision{
		Status:            "review",
		ReviewStatus:      reviewStatusForDeltaAction("new_candidate"),
		Action:            "new_candidate",
		Reason:            "包装库未找到可安全匹配的已有商品",
		ExtractNetWeightG: extract.NetWeightG,
		ExtractSpecText:   extract.SpecText,
		ExtractFlavorText: extract.FlavorText,
		ExtractBarcode:    extract.Barcode,
		CandidateCount:    len(match.Candidates),
		TopCandidateNames: topCandidateNames(match.Candidates, 5),
	}
	if match.Food == nil {
		if len(match.Candidates) > 0 {
			delta.Action = "candidate_review"
			delta.ReviewStatus = reviewStatusForDeltaAction(delta.Action)
			delta.Reason = "存在包装库候选，但没有条码/product_key/高置信匹配，需人工确认"
		}
		return delta, nil
	}

	existing := match.Food
	delta.MatchedFoodID = existing.ID
	delta.MatchedFoodName = existing.ProductName
	delta.MatchStatus = match.Status
	delta.MatchScore = match.Score
	delta.CurrentNetWeightG = existing.NetWeightG
	delta.CurrentSpecText = derefString(existing.SpecText)
	delta.CurrentFlavorText = derefString(existing.FlavorText)
	delta.CurrentBarcode = derefString(existing.Barcode)

	changed, conflicts := compareExtractWithExisting(extract, existing)
	delta.ChangedFields = changed
	delta.ConflictFields = conflicts
	switch {
	case len(conflicts) > 0:
		delta.Status = "review"
		delta.Action = "conflict_review"
		delta.ReviewStatus = reviewStatusForDeltaAction(delta.Action)
		delta.Reason = "Gemini 结果与已有非空字段冲突，默认不覆盖"
		if canReplaceHighConfidence(extract, conflicts) {
			delta.HighConfidenceNote = "高置信且 OCR/规格含重量证据，可在 replace-high-confidence 策略下覆盖冲突字段"
		}
	case len(changed) > 0:
		delta.Status = "ready"
		delta.Action = "backfill_missing"
		delta.ReviewStatus = reviewStatusForDeltaAction(delta.Action)
		delta.Reason = "仅补齐已有记录缺失字段"
	default:
		delta.Status = "ok"
		delta.Action = "no_change"
		delta.ReviewStatus = reviewStatusForDeltaAction(delta.Action)
		delta.Reason = "包装库已有记录与 Gemini 结果基本一致"
	}
	return delta, nil
}

func findExistingPackagedFood(ctx context.Context, nutritionRepo *foodrecordrepo.FoodNutritionRepo, extract *foodrecordservice.PackagedProductExtractResult) (*existingMatch, error) {
	query := packagedExtractSearchQuery(extract)
	candidates, err := nutritionRepo.SearchPackagedFood(ctx, query, 5)
	if err != nil {
		return nil, err
	}
	resolved, err := nutritionRepo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
		Name:            extract.ProductName,
		Brand:           extract.Brand,
		FlavorText:      extract.FlavorText,
		SpecText:        extract.SpecText,
		Barcode:         extract.Barcode,
		NetWeightG:      extract.NetWeightG,
		NetContentValue: extract.NetContentValue,
		NetContentUnit:  extract.NetContentUnit,
		UnitCount:       extract.UnitCount,
	})
	if err != nil {
		return nil, err
	}
	match := &existingMatch{Candidates: candidates}
	if resolved == nil || resolved.Food == nil {
		return match, nil
	}
	if resolved.Status == "fuzzy" && resolved.Score < 0.55 {
		return match, nil
	}
	match.Food = resolved.Food
	match.Status = resolved.Status
	match.Score = resolved.Score
	return match, nil
}

func packagedExtractSearchQuery(extract *foodrecordservice.PackagedProductExtractResult) string {
	if extract == nil {
		return ""
	}
	parts := []string{extract.DisplayName, extract.Brand, extract.ProductName, extract.FlavorText, extract.SpecText, extract.Barcode}
	return strings.Join(normalizeStringParts(parts), " ")
}

func compareExtractWithExisting(extract *foodrecordservice.PackagedProductExtractResult, existing *foodrecorddomain.PackagedFood) ([]string, []string) {
	changed := []string{}
	conflicts := []string{}
	addChanged := func(field string) { changed = append(changed, field) }
	addConflict := func(field string) { conflicts = append(conflicts, field) }

	compareString := func(field, current, next string) {
		current = strings.TrimSpace(current)
		next = strings.TrimSpace(next)
		if next == "" {
			return
		}
		if current == "" {
			addChanged(field)
			return
		}
		if !strings.EqualFold(current, next) {
			addConflict(field)
		}
	}
	compareNumber := func(field string, current, next float64) {
		if next <= 0 {
			return
		}
		if current <= 0 {
			addChanged(field)
			return
		}
		tolerance := math.Max(2, current*0.05)
		if math.Abs(current-next) > tolerance {
			addConflict(field)
		}
	}

	compareString("brand", existing.Brand, extract.Brand)
	compareString("display_name", existing.DisplayName, extract.DisplayName)
	compareString("search_text", existing.SearchText, extract.SearchText)
	compareString("product_family_key", existing.ProductFamilyKey, extract.ProductFamilyKey)
	compareString("spec_text", derefString(existing.SpecText), extract.SpecText)
	compareString("barcode", derefString(existing.Barcode), extract.Barcode)
	compareString("flavor_text", derefString(existing.FlavorText), extract.FlavorText)
	compareString("package_category", derefString(existing.PackageCategory), extract.PackageCategory)
	compareString("ingredients_text", derefString(existing.IngredientsText), extract.IngredientsText)
	compareNumber("net_weight_g", existing.NetWeightG, extract.NetWeightG)
	compareNumber("net_content_value", existing.NetContentValue, extract.NetContentValue)
	compareString("net_content_unit", derefString(existing.NetContentUnit), extract.NetContentUnit)
	compareNumber("unit_count", existing.UnitCount, extract.UnitCount)
	compareNumber("unit_content_value", existing.UnitContentValue, extract.UnitContentValue)
	compareString("unit_content_unit", derefString(existing.UnitContentUnit), extract.UnitContentUnit)
	compareNumber("serving_weight_g", existing.ServingWeightG, extract.ServingWeightG)
	compareNumber("kcal_per_100g", existing.KcalPer100g, numberFromMap(extract.UnitNutritionPer100g, "calories"))
	compareNumber("protein_per_100g", existing.ProteinPer100g, numberFromMap(extract.UnitNutritionPer100g, "protein"))
	compareNumber("carbs_per_100g", existing.CarbsPer100g, numberFromMap(extract.UnitNutritionPer100g, "carbs"))
	compareNumber("fat_per_100g", existing.FatPer100g, numberFromMap(extract.UnitNutritionPer100g, "fat"))

	if len(existing.SourceImageURLs) == 0 && len(extract.SourceImageURLs) > 0 {
		addChanged("source_image_urls")
	}
	if derefString(existing.OCRRawText) == "" && strings.TrimSpace(extract.OCRRawText) != "" {
		addChanged("ocr_raw_text")
	}
	if len(existing.RawLabelPayload) == 0 && len(extract.RawLabelPayload) > 0 {
		addChanged("raw_label_payload")
	}
	if len(existing.FieldConfidence) == 0 && len(extract.FieldConfidence) > 0 {
		addChanged("field_confidence")
	}
	conflicts = uniqueStrings(conflicts)
	changed = removeConflictFields(uniqueStrings(changed), conflicts)
	return changed, conflicts
}

func removeConflictFields(changed, conflicts []string) []string {
	if len(changed) == 0 || len(conflicts) == 0 {
		return changed
	}
	conflictSet := map[string]bool{}
	for _, field := range conflicts {
		conflictSet[field] = true
	}
	out := make([]string, 0, len(changed))
	for _, field := range changed {
		if !conflictSet[field] {
			out = append(out, field)
		}
	}
	return out
}

func applyPackagedExtract(
	ctx context.Context,
	nutritionRepo *foodrecordrepo.FoodNutritionRepo,
	extract *foodrecordservice.PackagedProductExtractResult,
	delta *deltaDecision,
	opts foodrecordservice.PackagedImportIngestOptions,
	applyPolicy string,
) (*foodrecordservice.PackagedAutoIngestResult, *foodrecorddomain.PackagedFood, error) {
	if delta == nil || delta.MatchedFoodID == "" {
		return &foodrecordservice.PackagedAutoIngestResult{
			Status: "blocked",
			Reason: "new_candidate_review",
		}, nil, nil
	}
	if delta.Action == "conflict_review" && !(applyPolicy == applyPolicyReplaceHighConfidence && canReplaceHighConfidence(extract, delta.ConflictFields)) {
		return &foodrecordservice.PackagedAutoIngestResult{
			Status: "blocked",
			Reason: "conflict_review",
		}, nil, nil
	}
	patch := buildPatchValues(extract, delta, applyPolicy, opts)
	if len(patch) == 0 {
		status := "ready"
		reason := "no_safe_backfill_fields"
		if delta.Status == "review" {
			status = "blocked"
			reason = delta.Action
		}
		return &foodrecordservice.PackagedAutoIngestResult{
			Status: status,
			Reason: reason,
		}, nil, nil
	}
	updated, err := nutritionRepo.PatchPackagedFood(ctx, delta.MatchedFoodID, patch)
	if err != nil {
		return nil, nil, err
	}
	delta.Applied = true
	return &foodrecordservice.PackagedAutoIngestResult{
		Status:         "ingested",
		Reason:         "backfill_applied",
		UpsertAction:   "updated",
		PackagedFoodID: updated.ID,
	}, updated, nil
}

func buildPatchValues(extract *foodrecordservice.PackagedProductExtractResult, delta *deltaDecision, applyPolicy string, opts foodrecordservice.PackagedImportIngestOptions) map[string]any {
	values := map[string]any{}
	if extract == nil || delta == nil {
		return values
	}
	allowed := map[string]bool{}
	for _, field := range delta.ChangedFields {
		allowed[field] = true
	}
	if applyPolicy == applyPolicyReplaceHighConfidence && canReplaceHighConfidence(extract, delta.ConflictFields) {
		for _, field := range delta.ConflictFields {
			switch field {
			case "net_weight_g", "net_content_value", "net_content_unit", "unit_count", "unit_content_value", "unit_content_unit", "serving_weight_g", "spec_text", "flavor_text", "barcode":
				allowed[field] = true
			}
		}
	}
	setString := func(field, value string) {
		if allowed[field] && strings.TrimSpace(value) != "" {
			values[field] = strings.TrimSpace(value)
		}
	}
	setNumber := func(field string, value float64) {
		if allowed[field] && value > 0 {
			values[field] = value
		}
	}
	setString("brand", extract.Brand)
	setString("display_name", extract.DisplayName)
	setString("search_text", extract.SearchText)
	setString("product_family_key", extract.ProductFamilyKey)
	setString("spec_text", extract.SpecText)
	setString("barcode", extract.Barcode)
	setString("flavor_text", extract.FlavorText)
	setString("package_category", extract.PackageCategory)
	setString("ingredients_text", extract.IngredientsText)
	setString("ocr_raw_text", extract.OCRRawText)
	setString("nutrition_basis_unit", extract.NutritionBasisUnit)
	setString("energy_unit_raw", extract.EnergyUnitRaw)
	setString("conversion_status", extract.ConversionStatus)
	setString("ingest_method", opts.IngestMethod)
	setNumber("net_weight_g", extract.NetWeightG)
	setNumber("net_content_value", extract.NetContentValue)
	setString("net_content_unit", extract.NetContentUnit)
	setNumber("unit_count", extract.UnitCount)
	setNumber("unit_content_value", extract.UnitContentValue)
	setString("unit_content_unit", extract.UnitContentUnit)
	setNumber("serving_weight_g", extract.ServingWeightG)
	setNumber("kcal_per_100g", numberFromMap(extract.UnitNutritionPer100g, "calories"))
	setNumber("protein_per_100g", numberFromMap(extract.UnitNutritionPer100g, "protein"))
	setNumber("carbs_per_100g", numberFromMap(extract.UnitNutritionPer100g, "carbs"))
	setNumber("fat_per_100g", numberFromMap(extract.UnitNutritionPer100g, "fat"))
	if allowed["source_image_urls"] && len(extract.SourceImageURLs) > 0 {
		values["source_image_urls"] = extract.SourceImageURLs
	}
	if allowed["raw_label_payload"] && len(extract.RawLabelPayload) > 0 {
		values["raw_label_payload"] = extract.RawLabelPayload
	}
	if allowed["field_confidence"] && len(extract.FieldConfidence) > 0 {
		values["field_confidence"] = extract.FieldConfidence
	}
	if len(values) > 0 && strings.TrimSpace(opts.Source) != "" {
		values["source"] = strings.TrimSpace(opts.Source)
	}
	return values
}

func canReplaceHighConfidence(extract *foodrecordservice.PackagedProductExtractResult, conflicts []string) bool {
	if extract == nil || len(conflicts) == 0 {
		return false
	}
	if extract.ExtractConfidence < 0.88 {
		return false
	}
	if extract.NetWeightG <= 0 && extract.NetContentValue <= 0 {
		return false
	}
	if !hasWeightEvidence(extract) {
		return false
	}
	return fieldConfidence(extract, "spec_text", "net_weight_g", "net_content_value") >= 0.75
}

func hasWeightEvidence(extract *foodrecordservice.PackagedProductExtractResult) bool {
	text := strings.ToLower(strings.Join([]string{extract.SpecText, extract.OCRRawText}, " "))
	if text == "" {
		return false
	}
	weight := fmt.Sprintf("%.0f", extract.NetWeightG)
	if extract.NetContentValue > 0 {
		weight = fmt.Sprintf("%.0f", extract.NetContentValue)
	}
	return strings.Contains(text, weight+"g") ||
		strings.Contains(text, weight+"克") ||
		strings.Contains(text, "净含量") ||
		strings.Contains(text, "net weight")
}

func fieldConfidence(extract *foodrecordservice.PackagedProductExtractResult, keys ...string) float64 {
	best := 0.0
	for _, key := range keys {
		if score := numberFromAny(extract.FieldConfidence[key]); score > best {
			best = score
		}
	}
	return best
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
	if result.Delta != nil && result.Delta.Status == "review" {
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
	reviewStatus := ""
	if result.AutoIngest != nil {
		status = result.AutoIngest.Status
	}
	if result.Delta != nil {
		reviewStatus = result.Delta.ReviewStatus
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
		group.ID, status, reviewStatus, reason, productName, brand, specText, netWeight, conversion, confidence,
		strings.Join(group.Files, "|"), missing, needsMore,
	}
}

func buildDeltaRow(group foodrecordservice.PackagedPhotoGroup, result groupResult) []string {
	delta := result.Delta
	if delta == nil {
		return []string{group.ID}
	}
	return []string{
		group.ID,
		delta.Status,
		delta.ReviewStatus,
		delta.Action,
		delta.Reason,
		delta.MatchedFoodID,
		delta.MatchedFoodName,
		delta.MatchStatus,
		fmt.Sprintf("%.3f", delta.MatchScore),
		fmt.Sprintf("%d", delta.CandidateCount),
		strings.Join(delta.ChangedFields, "|"),
		strings.Join(delta.ConflictFields, "|"),
		fmt.Sprintf("%.2f", delta.CurrentNetWeightG),
		fmt.Sprintf("%.2f", delta.ExtractNetWeightG),
		delta.CurrentSpecText,
		delta.ExtractSpecText,
		delta.CurrentFlavorText,
		delta.ExtractFlavorText,
		delta.CurrentBarcode,
		delta.ExtractBarcode,
		fmt.Sprintf("%t", delta.Applied),
		strings.Join(delta.TopCandidateNames, "|"),
		strings.Join(group.Files, "|"),
	}
}

func updateDeltaSummary(summary *runSummary, delta *deltaDecision) {
	if summary == nil || delta == nil {
		return
	}
	if delta.Applied {
		summary.DeltaApplied++
	}
	if summary.DeltaActions == nil {
		summary.DeltaActions = map[string]int{}
	}
	if delta.Action != "" {
		summary.DeltaActions[delta.Action]++
	}
	if summary.ConflictFields == nil {
		summary.ConflictFields = map[string]int{}
	}
	for _, field := range delta.ConflictFields {
		if field != "" {
			summary.ConflictFields[field]++
		}
	}
	switch delta.Action {
	case "backfill_missing":
		summary.DeltaBackfill++
	case "conflict_review":
		summary.DeltaConflict++
	case "new_candidate", "candidate_review":
		summary.DeltaNew++
	case "no_change":
		summary.DeltaNoChange++
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

func writeCSV(path string, header []string, rows [][]string) error {
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

func normalizeStringParts(parts []string) []string {
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func topCandidateNames(candidates []foodrecorddomain.PackagedFood, limit int) []string {
	if limit <= 0 || limit > len(candidates) {
		limit = len(candidates)
	}
	out := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		candidate := candidates[i]
		label := strings.TrimSpace(candidate.DisplayName)
		if label == "" {
			label = candidate.ProductName
			if candidate.Brand != "" {
				label = candidate.Brand + " " + label
			}
			if candidate.NetContentValue > 0 && candidate.NetContentUnit != nil {
				label = fmt.Sprintf("%s %s%s", label, formatCompactNumber(candidate.NetContentValue), *candidate.NetContentUnit)
			} else if candidate.NetWeightG > 0 {
				label = fmt.Sprintf("%s %sg", label, formatCompactNumber(candidate.NetWeightG))
			}
		}
		out = append(out, strings.TrimSpace(label))
	}
	return out
}

func formatCompactNumber(value float64) string {
	if math.Abs(value-math.Round(value)) < 0.005 {
		return fmt.Sprintf("%.0f", math.Round(value))
	}
	return fmt.Sprintf("%.2f", value)
}

func numberFromMap(values map[string]any, key string) float64 {
	if values == nil {
		return 0
	}
	return numberFromAny(values[key])
}

func numberFromAny(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float32:
		return float64(typed)
	case float64:
		return typed
	case json.Number:
		n, _ := typed.Float64()
		return n
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0
		}
		var n float64
		if _, err := fmt.Sscanf(text, "%f", &n); err == nil {
			return n
		}
		return 0
	default:
		var n float64
		if _, err := fmt.Sscanf(fmt.Sprintf("%v", typed), "%f", &n); err == nil {
			return n
		}
	}
	return 0
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
