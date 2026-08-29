package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type foodRow struct {
	ID             string `json:"id"`
	CanonicalName  string `json:"canonical_name"`
	NormalizedName string `json:"normalized_name"`
	BaseFoodKey    string `json:"base_food_key,omitempty"`
	Aliases        string `json:"aliases,omitempty"`
	Uses           int64  `json:"uses,omitempty"`
}

type imageCandidate struct {
	ImageURL       string `json:"image_url"`
	PageURL        string `json:"page_url,omitempty"`
	Query          string `json:"query"`
	ReuseObjectKey string `json:"reuse_object_key,omitempty"`
	SourceLabel    string `json:"source_label,omitempty"`
	License        string `json:"license,omitempty"`
	SourceFoodID   string `json:"source_food_id,omitempty"`
	SourceFoodName string `json:"source_food_name,omitempty"`
}

type downloadedImage struct {
	URL            string
	PageURL        string
	Query          string
	Data           []byte
	ContentType    string
	Ext            string
	SHA256         string
	ReuseObjectKey string
	SourceLabel    string
	License        string
	SourceFoodID   string
	SourceFoodName string
}

var imageDownloadHTTPClient = func() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSHandshakeTimeout = 30 * time.Second
	return &http.Client{Transport: transport, Timeout: 60 * time.Second}
}()

type resultRow struct {
	FoodID         string         `json:"food_id"`
	FoodName       string         `json:"food_name"`
	Status         string         `json:"status"`
	Reason         string         `json:"reason,omitempty"`
	Candidate      string         `json:"candidate,omitempty"`
	CandidatePage  string         `json:"candidate_page,omitempty"`
	TriedURLs      []string       `json:"tried_urls,omitempty"`
	Query          string         `json:"query,omitempty"`
	SourceLabel    string         `json:"source_label,omitempty"`
	License        string         `json:"license,omitempty"`
	SourceFoodID   string         `json:"source_food_id,omitempty"`
	SourceFoodName string         `json:"source_food_name,omitempty"`
	Decision       *imageDecision `json:"decision,omitempty"`
	ObjectKey      string         `json:"object_key,omitempty"`
	AccessURL      string         `json:"access_url,omitempty"`
	Reused         bool           `json:"reused"`
	Uploaded       bool           `json:"uploaded"`
	DBUpdated      bool           `json:"db_updated"`
	ProcessedAt    time.Time      `json:"processed_at"`
}

type stateFile struct {
	Entries map[string]stateEntry `json:"entries"`
}

type stateEntry struct {
	Status       string         `json:"status"`
	Reason       string         `json:"reason,omitempty"`
	ObjectKey    string         `json:"object_key,omitempty"`
	AccessURL    string         `json:"access_url,omitempty"`
	UpdatedAt    time.Time      `json:"updated_at"`
	Attempts     int            `json:"attempts"`
	TriedURLs    []string       `json:"tried_urls,omitempty"`
	LastDecision *imageDecision `json:"last_decision,omitempty"`
}

type options struct {
	configDir               string
	outputDir               string
	statePath               string
	resultsPath             string
	failedPath              string
	visionAPIKeyPath        string
	dashscopeBaseURL        string
	limit                   int
	offset                  int
	maxCandidates           int
	foodID                  string
	keyPrefix               string
	model                   string
	threshold               float64
	apply                   bool
	dryRun                  bool
	failedOnly              bool
	demo                    bool
	testAPI                 bool
	demoImage               string
	demoFood                string
	localImage              string
	trustLocal              bool
	workers                 int
	imageSearch             string
	foodIDs                 string
	successJSON             string
	forceReprocess          bool
	timeout                 time.Duration
	sleep                   time.Duration
	searchQueryLimit        int
	searchPerQuery          int
	bingPageOffset          int
	timing                  bool
	statsOnly               bool
	statsOutput             string
	statsMissingLimit       int
	checkpointEvery         int
	auditExisting           bool
	auditOutput             string
	auditMinUses            int
	auditSearchReplacements bool
	reviewedApply           bool
	reviewedMissingReport   string
	reviewedExistingReport  string
	reviewedAllowlistReport string
	reviewedOutput          string
	reviewedMinConfidence   float64
	libraryReuseApply       bool
	libraryReuseReport      string
	libraryReuseAllowlist   string
	libraryReuseOutput      string
}

func main() {
	opts := parseFlags()
	if err := validateApplyMode(opts); err != nil {
		log.Fatalf("写入门禁校验失败: %v", err)
	}
	loadBackendEnv(opts.configDir)
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	if opts.statsOnly {
		if err := runStats(ctx, opts); err != nil {
			log.Fatalf("统计失败: %v", err)
		}
		return
	}
	if opts.libraryReuseApply {
		if err := runApprovedLibraryReuse(ctx, opts); err != nil {
			log.Fatalf("库内图片复用失败: %v", err)
		}
		return
	}
	if err := hydrateVisionRuntimeConfig(&opts); err != nil {
		log.Fatalf("加载视觉模型配置失败: %v", err)
	}
	if opts.testAPI {
		if err := runTestAPI(ctx, opts); err != nil {
			log.Fatalf("DashScope API 验证失败: %v", err)
		}
		return
	}
	if opts.demo {
		if err := runDemo(ctx, opts); err != nil {
			log.Fatalf("图片判定 demo 失败: %v", err)
		}
		return
	}
	if strings.TrimSpace(opts.localImage) != "" {
		if err := runLocalImageBackfill(ctx, opts); err != nil {
			log.Fatalf("本地图片回填失败: %v", err)
		}
		return
	}
	if opts.reviewedApply {
		if err := runReviewedImageApply(ctx, opts); err != nil {
			log.Fatalf("复核图片写入失败: %v", err)
		}
		return
	}
	if err := ensureVisionModel(ctx, &opts); err != nil {
		log.Fatalf("解析视觉模型失败: %v", err)
	}
	if opts.auditExisting {
		if err := runExistingImageAudit(ctx, opts); err != nil {
			log.Fatalf("已有图片审计失败: %v", err)
		}
		return
	}
	if err := runBackfill(ctx, opts); err != nil {
		log.Fatalf("标准食物图片回填失败: %v", err)
	}
}

func validateApplyMode(opts options) error {
	if !opts.apply {
		return nil
	}
	if opts.statsOnly || opts.libraryReuseApply || opts.testAPI || opts.demo {
		return nil
	}
	if strings.TrimSpace(opts.localImage) != "" {
		if opts.trustLocal {
			return nil
		}
		return errors.New("本地图片 --apply 必须显式使用 --trust-local-image")
	}
	if opts.reviewedApply {
		return validateReviewedApplyMode(opts)
	}
	if opts.auditExisting {
		return nil
	}
	return errors.New("通用 --apply 已禁用；网络候选必须使用 --reviewed-apply 的两轮复核与 allowlist，库内复用必须使用 --library-reuse-apply 的人工 allowlist 事务路径")
}

func validateReviewedApplyMode(opts options) error {
	if opts.apply && strings.TrimSpace(opts.reviewedAllowlistReport) == "" {
		return errors.New("--reviewed-apply --apply 必须提供 --reviewed-allowlist-report")
	}
	return nil
}

// hydrateVisionRuntimeConfig lets the offline backfill command reuse the same
// Apollo/file configuration as the backend service. Explicit process or local
// .env values still take precedence, and the credential remains process-local.
func hydrateVisionRuntimeConfig(opts *options) error {
	if opts == nil {
		return errors.New("options is nil")
	}
	keyConfigured := loadDashScopeAPIKey(opts.configDir, opts.visionAPIKeyPath) != ""
	baseConfigured := strings.TrimSpace(opts.dashscopeBaseURL) != "" || strings.TrimSpace(os.Getenv("DASHSCOPE_BASE_URL")) != ""
	if keyConfigured && baseConfigured {
		return nil
	}
	cfg, err := config.Load(opts.configDir)
	if err != nil {
		return err
	}
	return applyVisionRuntimeConfig(opts, cfg.External, keyConfigured, baseConfigured)
}

func applyVisionRuntimeConfig(opts *options, external config.ExternalConfig, keyConfigured, baseConfigured bool) error {
	if !keyConfigured && strings.TrimSpace(external.DashScopeAPIKey) != "" {
		if err := os.Setenv("FOOD_IMAGE_VISION_API_KEY", strings.TrimSpace(external.DashScopeAPIKey)); err != nil {
			return err
		}
	}
	if !baseConfigured && strings.TrimSpace(external.DashScopeBaseURL) != "" {
		opts.dashscopeBaseURL = strings.TrimRight(strings.TrimSpace(external.DashScopeBaseURL), "/")
	}
	return nil
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "backend config directory")
	flag.StringVar(&opts.outputDir, "output-dir", "tmp/standard-food-image-backfill", "state and result output directory")
	flag.StringVar(&opts.statePath, "state-file", "", "resume state json path")
	flag.StringVar(&opts.resultsPath, "results-file", "", "results jsonl path")
	flag.StringVar(&opts.failedPath, "failed-file", "", "failed jsonl path")
	flag.StringVar(&opts.visionAPIKeyPath, "dashscope-api-key-file", "", "optional DashScope API key file override (default: backend/.env DASHSCOPE_API_KEY)")
	flag.StringVar(&opts.dashscopeBaseURL, "dashscope-base-url", "", "DashScope OpenAI-compatible base URL (default: env DASHSCOPE_BASE_URL or Beijing endpoint)")
	flag.StringVar(&opts.dashscopeBaseURL, "vision-base-url", "", "generic vision API base URL; alias of --dashscope-base-url")
	flag.IntVar(&opts.limit, "limit", 0, "process at most N foods, 0 means all")
	flag.IntVar(&opts.offset, "offset", 0, "skip first N foods")
	flag.IntVar(&opts.maxCandidates, "max-candidates", 8, "max downloaded image candidates per food")
	flag.StringVar(&opts.foodID, "food-id", "", "process only one food id")
	flag.StringVar(&opts.keyPrefix, "key-prefix", "standard-food/backfill", "COS object key prefix")
	flag.StringVar(&opts.model, "vision-model", dashScopeModelHint, "DashScope vision model (empty=auto pick qwen3.5-flash from /models)")
	flag.Float64Var(&opts.threshold, "threshold", 0.72, "minimum vision model confidence to accept")
	flag.BoolVar(&opts.apply, "apply", false, "upload image and update database")
	flag.BoolVar(&opts.dryRun, "dry-run", true, "run without uploading or updating database")
	flag.BoolVar(&opts.failedOnly, "failed-only", false, "process only rows with failed status in state file")
	flag.BoolVar(&opts.demo, "demo", false, "run a single image matching demo (local file)")
	flag.BoolVar(&opts.testAPI, "test-api", false, "verify DashScope: list models, Bing fetch, vision classify")
	flag.StringVar(&opts.demoImage, "demo-image", "tmp/test.jpg", "demo image path")
	flag.StringVar(&opts.demoFood, "demo-food", "凉拌海带丝", "demo / test-api expected food name")
	flag.StringVar(&opts.localImage, "local-image", "", "use a local image file instead of Bing search; requires --food-id")
	flag.BoolVar(&opts.trustLocal, "trust-local-image", false, "with --local-image, skip vision model and accept the file (for upload path verification only)")
	flag.IntVar(&opts.workers, "workers", 1, "parallel worker count for batch processing")
	flag.StringVar(&opts.imageSearch, "image-search", "bing", "image search provider: library, commons, google or bing")
	flag.StringVar(&opts.foodIDs, "food-ids", "", "comma-separated food ids to process (overrides limit/offset)")
	flag.StringVar(&opts.successJSON, "success-json", "", "write matched successes to this JSON file")
	flag.BoolVar(&opts.forceReprocess, "force-reprocess", false, "ignore resume state and reprocess foods")
	flag.DurationVar(&opts.timeout, "timeout", 12*time.Hour, "overall timeout")
	flag.DurationVar(&opts.sleep, "sleep", 800*time.Millisecond, "delay between search requests")
	flag.IntVar(&opts.searchQueryLimit, "search-query-limit", 0, "max search queries per food (0 = all, 1 recommended for google+opencli)")
	flag.IntVar(&opts.searchPerQuery, "search-per-query", 12, "max image URLs to fetch per search query (Bing pages); use higher on retry")
	flag.IntVar(&opts.bingPageOffset, "bing-page-offset", 0, "extra Bing image search start page added before attempts-based paging (retry with 1+ to fetch next result pages)")
	flag.BoolVar(&opts.timing, "timing", false, "print per-stage durations to stdout")
	flag.BoolVar(&opts.statsOnly, "stats-only", false, "print backfill baseline stats and exit")
	flag.StringVar(&opts.statsOutput, "stats-output", "", "write --stats-only JSON to this file")
	flag.IntVar(&opts.statsMissingLimit, "stats-missing-limit", 0, "include the first N missing foods ordered by user references in --stats-only output")
	flag.IntVar(&opts.checkpointEvery, "checkpoint-every", 1, "save state.json every N processed foods (0=only at end)")
	flag.BoolVar(&opts.auditExisting, "audit-existing", false, "audit existing food images without changing COS or database")
	flag.StringVar(&opts.auditOutput, "audit-output", "tmp/food-image-audit/report.json", "resumable JSON report for --audit-existing")
	flag.IntVar(&opts.auditMinUses, "audit-min-uses", 0, "only audit foods referenced at least N times by manual records")
	flag.BoolVar(&opts.auditSearchReplacements, "audit-search-replacements", false, "search and classify a replacement candidate for confident mismatches (always dry-run)")
	flag.BoolVar(&opts.reviewedApply, "reviewed-apply", false, "revalidate high-confidence audit candidates and optionally apply with --apply")
	flag.StringVar(&opts.reviewedMissingReport, "reviewed-missing-report", "", "missing-image success JSON used by --reviewed-apply")
	flag.StringVar(&opts.reviewedExistingReport, "reviewed-existing-report", "", "existing-image audit JSON used by --reviewed-apply")
	flag.StringVar(&opts.reviewedAllowlistReport, "reviewed-allowlist-report", "", "optional prior reviewed report; only entries with status=verified are eligible")
	flag.StringVar(&opts.reviewedOutput, "reviewed-output", "tmp/food-image-audit/reviewed-apply-report.json", "atomic verification/apply manifest")
	flag.Float64Var(&opts.reviewedMinConfidence, "reviewed-min-confidence", 0.95, "minimum confidence required in both audit and fresh verification")
	flag.BoolVar(&opts.libraryReuseApply, "library-reuse-apply", false, "apply a manually approved library-image reuse allowlist without external AI calls")
	flag.StringVar(&opts.libraryReuseReport, "library-reuse-report", "", "dry-run library reuse success JSON used by --library-reuse-apply")
	flag.StringVar(&opts.libraryReuseAllowlist, "library-reuse-allowlist", "", "manual allowlist JSON used by --library-reuse-apply")
	flag.StringVar(&opts.libraryReuseOutput, "library-reuse-output", "tmp/standard-food-image-library-reuse-apply.json", "verification/apply report for --library-reuse-apply")
	flag.Parse()
	if opts.imageSearch != "library" && opts.imageSearch != "commons" && opts.imageSearch != "google" && opts.imageSearch != "bing" {
		log.Fatalf("不支持的 image-search: %s（仅 library、commons、google 或 bing）", opts.imageSearch)
	}
	if opts.apply {
		opts.dryRun = false
	}
	if opts.statePath == "" {
		opts.statePath = filepath.Join(opts.outputDir, "state.json")
	}
	if opts.resultsPath == "" {
		opts.resultsPath = filepath.Join(opts.outputDir, "results.jsonl")
	}
	if opts.failedPath == "" {
		opts.failedPath = filepath.Join(opts.outputDir, "failed.jsonl")
	}
	return opts
}

func runDemo(ctx context.Context, opts options) error {
	if err := ensureVisionModel(ctx, &opts); err != nil {
		return err
	}
	data, err := os.ReadFile(opts.demoImage)
	if err != nil {
		return err
	}
	contentType := http.DetectContentType(data)
	decision, err := classifyFoodImage(ctx, opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model, opts.demoFood, data, contentType)
	if err != nil {
		return err
	}
	encoded, _ := json.MarshalIndent(decision, "", "  ")
	fmt.Println(string(encoded))
	return nil
}

func runLocalImageBackfill(ctx context.Context, opts options) error {
	if strings.TrimSpace(opts.foodID) == "" {
		return errors.New("--local-image 需要同时指定 --food-id")
	}
	if err := os.MkdirAll(opts.outputDir, 0o755); err != nil {
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
	foods, err := queryMissingFoods(ctx, db, opts)
	if err != nil {
		return err
	}
	if len(foods) == 0 {
		return fmt.Errorf("未找到缺图食物 food_id=%s", opts.foodID)
	}
	food := foods[0]
	data, err := os.ReadFile(opts.localImage)
	if err != nil {
		return err
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") || contentType == "image/gif" {
		return fmt.Errorf("不支持的图片类型 %s", contentType)
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return fmt.Errorf("无法解码本地图片: %w", err)
	}
	sum := sha256.Sum256(data)
	img := downloadedImage{
		Data:        data,
		ContentType: contentType,
		Ext:         extensionForContentType(contentType),
		SHA256:      hex.EncodeToString(sum[:]),
		URL:         "file://" + filepath.ToSlash(opts.localImage),
		Query:       "local-image",
	}
	state := loadState(opts.statePath)
	storageClient := storage.New(cfg.Storage)
	result := resultRow{FoodID: food.ID, FoodName: food.CanonicalName, ProcessedAt: time.Now()}
	if opts.trustLocal {
		result.Decision = &imageDecision{FoodMatch: true, NoWatermark: true, Match: true, Confidence: 1, Reason: "trust-local-image"}
	} else {
		if err := ensureVisionModel(ctx, &opts); err != nil {
			return err
		}
		decision, err := classifyFoodImage(ctx, opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model, food.CanonicalName, img.Data, img.ContentType)
		if err != nil {
			result.Status = "vision_failed"
			result.Reason = err.Error()
			updateState(state, result)
			_ = saveState(opts.statePath, state)
			return err
		}
		result.Decision = decision
		if !decision.Match || decision.Confidence < opts.threshold {
			result.Status = "no_match"
			result.Reason = decision.Reason
			updateState(state, result)
			_ = saveState(opts.statePath, state)
			fmt.Printf("[%s] %s %s\n", result.Status, food.ID, food.CanonicalName)
			return nil
		}
	}
	key := buildObjectKey(opts.keyPrefix, food.ID, img.SHA256, img.Ext)
	result.ObjectKey = key
	result.Candidate = img.URL
	result.Query = img.Query
	result.AccessURL = storageClient.BuildAccessURL("food-images", key)
	if opts.dryRun {
		result.Status = "dry_run_match"
		result.Reason = "matched but dry-run"
	} else {
		uploadedURL, err := storageClient.UploadBytes("food-images", key, img.Data, img.ContentType)
		if err != nil {
			return err
		}
		result.Uploaded = true
		if uploadedURL != "" {
			result.AccessURL = uploadedURL
		}
		if err := updateFoodImage(ctx, db, food.ID, key); err != nil {
			return err
		}
		result.DBUpdated = true
		result.Status = "db_updated"
	}
	updateState(state, result)
	if err := saveState(opts.statePath, state); err != nil {
		return err
	}
	if err := appendJSONL(opts.resultsPath, result); err != nil {
		return err
	}
	fmt.Printf("[%s] %s %s\n", result.Status, food.ID, food.CanonicalName)
	return nil
}

func queryMissingFoods(ctx context.Context, db *gorm.DB, opts options) ([]foodRow, error) {
	args := []any{}
	where := `
WHERE f.is_active = TRUE
  AND COALESCE(f.kcal_per_100g, 0) > 0
  AND NULLIF(trim(COALESCE(f.image_path, '')), '') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(f.image_paths, '[]'::jsonb)) AS image_url
    WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )`
	if strings.TrimSpace(opts.foodID) != "" {
		where += " AND f.id::text = ?"
		args = append(args, strings.TrimSpace(opts.foodID))
	}
	sql := `
WITH refs AS (
  SELECT item->>'manual_source_id' AS food_id, COUNT(*)::bigint AS uses
  FROM user_food_records r
  CROSS JOIN LATERAL jsonb_array_elements(r.items) AS item
  WHERE item->>'manual_source' = 'nutrition_library'
    AND COALESCE(item->>'manual_source_id', '') <> ''
  GROUP BY item->>'manual_source_id'
)
SELECT
  f.id::text AS id,
  f.canonical_name,
  f.normalized_name,
	COALESCE(f.base_food_key, '') AS base_food_key,
  COALESCE(string_agg(a.alias_name, ' ' ORDER BY a.alias_name), '') AS aliases,
  COALESCE(refs.uses, 0)::bigint AS uses
FROM food_nutrition_library f
LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
LEFT JOIN refs ON refs.food_id = f.id::text
` + where + `
GROUP BY f.id, f.canonical_name, f.normalized_name, f.base_food_key, refs.uses
ORDER BY COALESCE(refs.uses, 0) DESC, (f.canonical_name ~ '[\u4e00-\u9fff]') DESC, f.updated_at ASC NULLS FIRST, f.canonical_name ASC`
	if opts.limit > 0 {
		sql += " LIMIT ?"
		args = append(args, opts.limit)
	}
	if opts.offset > 0 {
		sql += " OFFSET ?"
		args = append(args, opts.offset)
	}
	var rows []foodRow
	return rows, db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error
}

func printTiming(opts options, format string, args ...any) {
	if !opts.timing {
		return
	}
	fmt.Printf("[timing] "+format+"\n", args...)
}

func processFood(ctx context.Context, db *gorm.DB, storageClient *storage.Client, opts options, state stateFile, food foodRow) resultRow {
	foodStart := time.Now()
	result := resultRow{FoodID: food.ID, FoodName: food.CanonicalName, Status: "search_failed", ProcessedAt: time.Now()}
	entry := state.Entries[food.ID]
	tried := triedURLSet(entry.TriedURLs)
	bingStartPage := opts.bingPageOffset
	if len(tried) > 0 || entry.Attempts > 0 {
		bingStartPage += entry.Attempts % bingMaxSearchPages
	}
	searchStart := time.Now()
	var candidates []imageCandidate
	if opts.imageSearch == "library" {
		candidates = searchLibraryImageCandidates(ctx, db, storageClient, food, opts.searchPerQuery)
	} else {
		candidates = searchCandidates(ctx, food, opts.sleep, opts.imageSearch, opts.searchQueryLimit, opts.searchPerQuery, bingStartPage)
	}
	candidates = filterUntriedCandidates(candidates, tried)
	printTiming(opts, "image_search provider=%s duration=%s candidates=%d tried=%d bing_page=%d",
		opts.imageSearch, time.Since(searchStart).Round(time.Millisecond), len(candidates), len(tried), bingStartPage)
	if len(candidates) == 0 {
		result.Reason = "no image candidates"
		printTiming(opts, "food_total food=%s duration=%s status=%s", food.CanonicalName, time.Since(foodStart).Round(time.Millisecond), result.Status)
		return result
	}
	downloaded := 0
	var lastKimiErr string
	var lastNoMatchReason string
	visionOK := 0
	var downloadTotal, visionTotal time.Duration
	visionCalls := 0
	var triedThisRun []string
	for i, candidate := range candidates {
		if downloaded >= opts.maxCandidates {
			break
		}
		if tried[candidate.ImageURL] {
			continue
		}
		tried[candidate.ImageURL] = true
		triedThisRun = append(triedThisRun, candidate.ImageURL)
		dlStart := time.Now()
		img, err := downloadCandidateImage(ctx, candidate, opts.imageSearch)
		downloadTotal += time.Since(dlStart)
		if err != nil {
			printTiming(opts, "download_fail idx=%d duration=%s", i+1, time.Since(dlStart).Round(time.Millisecond))
			continue
		}
		downloaded++
		printTiming(opts, "download_ok idx=%d duration=%s bytes=%d", i+1, time.Since(dlStart).Round(time.Millisecond), len(img.Data))
		visionStart := time.Now()
		decision, err := classifyFoodImage(ctx, opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model, food.CanonicalName, img.Data, img.ContentType)
		visionDur := time.Since(visionStart)
		visionTotal += visionDur
		visionCalls++
		if err != nil {
			lastKimiErr = err.Error()
			printTiming(opts, "vision_fail idx=%d duration=%s err=%s", i+1, visionDur.Round(time.Millisecond), err.Error())
			continue
		}
		visionOK++
		printTiming(opts, "vision_ok idx=%d duration=%s food_match=%v no_watermark=%v match=%v confidence=%.2f", i+1, visionDur.Round(time.Millisecond), decision.FoodMatch, decision.NoWatermark, decision.Match, decision.Confidence)
		result.Candidate = img.URL
		result.CandidatePage = img.PageURL
		result.Query = img.Query
		result.SourceLabel = img.SourceLabel
		result.License = img.License
		result.SourceFoodID = img.SourceFoodID
		result.SourceFoodName = img.SourceFoodName
		result.Decision = decision
		if !decision.Match || decision.Confidence < opts.threshold {
			result.Status = "no_match"
			result.Reason = decision.Reason
			lastNoMatchReason = decision.Reason
			continue
		}
		key := img.ReuseObjectKey
		if key == "" {
			key = buildObjectKey(opts.keyPrefix, food.ID, img.SHA256, img.Ext)
		} else {
			result.Reused = true
		}
		result.ObjectKey = key
		result.AccessURL = storageClient.BuildAccessURL("food-images", key)
		if opts.dryRun {
			result.Status = "dry_run_match"
			result.Reason = "matched but dry-run"
			return result
		}
		if !result.Reused {
			uploadedURL, err := storageClient.UploadBytes("food-images", key, img.Data, img.ContentType)
			if err != nil {
				result.Status = "upload_failed"
				result.Reason = err.Error()
				return result
			}
			result.Uploaded = true
			if uploadedURL != "" {
				result.AccessURL = uploadedURL
			}
		}
		if err := updateFoodImageWithMetadata(ctx, db, food.ID, key, result.CandidatePage, result.SourceLabel, result.License); err != nil {
			result.Status = "db_update_failed"
			result.Reason = err.Error()
			return result
		}
		result.DBUpdated = true
		result.Status = "db_updated"
		return result
	}
	switch {
	case downloaded == 0:
		result.Status = "download_failed"
		result.Reason = "all candidates failed download"
	case visionOK == 0:
		result.Status = "vision_failed"
		result.Reason = lastKimiErr
	case lastNoMatchReason != "" && result.Status != "dry_run_match" && result.Status != "db_updated":
		result.Status = "no_match"
		result.Reason = lastNoMatchReason
	}
	printTiming(opts, "download_sum duration=%s vision_sum duration=%s vision_calls=%d", downloadTotal.Round(time.Millisecond), visionTotal.Round(time.Millisecond), visionCalls)
	printTiming(opts, "food_total food=%s duration=%s status=%s", food.CanonicalName, time.Since(foodStart).Round(time.Millisecond), result.Status)
	if len(triedThisRun) > 0 {
		result.TriedURLs = triedThisRun
	}
	return result
}

func updateFoodImage(ctx context.Context, db *gorm.DB, foodID, key string) error {
	return updateFoodImageWithMetadata(ctx, db, foodID, key, "", "", "")
}

func updateFoodImageWithMetadata(ctx context.Context, db *gorm.DB, foodID, key, sourceURL, sourceLabel, license string) error {
	paths := []string{key}
	pathsJSON, err := json.Marshal(paths)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"image_path":  key,
			"image_paths": datatypes.JSON(pathsJSON),
			"updated_at":  gorm.Expr("now()"),
		}
		if strings.TrimSpace(sourceURL) != "" {
			updates["image_source_url"] = strings.TrimSpace(sourceURL)
		}
		if strings.TrimSpace(sourceLabel) != "" {
			updates["image_source_label"] = strings.TrimSpace(sourceLabel)
		}
		if strings.TrimSpace(license) != "" {
			updates["image_license"] = strings.TrimSpace(license)
		}
		res := tx.Table("food_nutrition_library").
			Where("id::text = ?", foodID).
			Where("NULLIF(trim(COALESCE(image_path, '')), '') IS NULL").
			Where(`NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
    WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )`).
			Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("row missing or image already filled")
		}
		return nil
	})
}

func searchCandidates(ctx context.Context, food foodRow, sleep time.Duration, imageSearch string, searchQueryLimit, searchPerQuery, bingStartPage int) []imageCandidate {
	queries := candidateQueries(food)
	out := []imageCandidate{}
	seen := map[string]bool{}
	perQuery := searchPerQuery
	if perQuery <= 0 {
		perQuery = 12
	}
	for i, query := range queries {
		if searchQueryLimit > 0 && i >= searchQueryLimit {
			break
		}
		var batch []imageCandidate
		if imageSearch == "bing" {
			batch = searchBingImages(query, perQuery, bingStartPage)
		} else if imageSearch == "commons" {
			commons, err := searchCommonsImages(ctx, imageDownloadHTTPClient, query, perQuery)
			if err == nil {
				for _, candidate := range commons {
					label := strings.TrimSpace(candidate.Author)
					if label == "" {
						label = strings.TrimSpace(candidate.Credit)
					}
					batch = append(batch, imageCandidate{
						ImageURL: candidate.ImageURL, PageURL: candidate.PageURL,
						SourceLabel: label, License: formatCommonsLicense(candidate.LicenseName, candidate.LicenseURL),
					})
				}
			}
		} else {
			batch = searchGoogleImages(query, perQuery)
		}
		for _, candidate := range batch {
			if candidate.ImageURL == "" || seen[candidate.ImageURL] {
				continue
			}
			seen[candidate.ImageURL] = true
			candidate.Query = query
			out = append(out, candidate)
		}
		if sleep > 0 {
			time.Sleep(sleep)
		}
		if imageSearch == "google" && len(out) >= perQuery*2 {
			break
		}
	}
	// Bing 结果已在 HTML 中按展示顺序解析；勿重排，避免与用户看到的缩略图顺序不一致。
	if imageSearch != "bing" {
		sortCandidatesByURLPreference(out)
	}
	return out
}

func formatCommonsLicense(name, licenseURL string) string {
	name = strings.TrimSpace(name)
	licenseURL = strings.TrimSpace(licenseURL)
	if name == "" {
		return licenseURL
	}
	if licenseURL == "" {
		return name
	}
	return name + " | " + licenseURL
}

func triedURLSet(urls []string) map[string]bool {
	out := make(map[string]bool, len(urls))
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u != "" {
			out[u] = true
		}
	}
	return out
}

func filterUntriedCandidates(candidates []imageCandidate, tried map[string]bool) []imageCandidate {
	if len(tried) == 0 {
		return candidates
	}
	out := make([]imageCandidate, 0, len(candidates))
	for _, c := range candidates {
		if !tried[c.ImageURL] {
			out = append(out, c)
		}
	}
	return out
}

func mergeTriedURLs(entry *stateEntry, urls []string) {
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		dup := false
		for _, existing := range entry.TriedURLs {
			if existing == u {
				dup = true
				break
			}
		}
		if !dup {
			entry.TriedURLs = append(entry.TriedURLs, u)
		}
	}
}

func candidateQueries(food foodRow) []string {
	name := strings.TrimSpace(food.CanonicalName)
	// 与用户浏览器搜索一致：优先纯食物名，再尝试带后缀的查询。
	values := []string{
		name,
		name + " 高清 无水印 实拍",
		name + " 美食",
		name + " 实拍",
		name + " 食物 图片",
		name + " 实物图",
	}
	if !containsHan(name) {
		values = append(values, name+" 食材 图片")
	}
	for _, alias := range strings.Fields(food.Aliases) {
		values = append(values, alias+" 食物 图片")
	}
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.Join(strings.Fields(value), " ")
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func downloadCandidateImage(ctx context.Context, candidate imageCandidate, imageSearch string) (*downloadedImage, error) {
	if strings.HasPrefix(candidate.ImageURL, "data:image/") {
		img, err := decodeDataURLImage(candidate.ImageURL)
		if err != nil {
			return nil, err
		}
		img.Query = candidate.Query
		img.PageURL = candidate.PageURL
		img.ReuseObjectKey = candidate.ReuseObjectKey
		img.SourceLabel = candidate.SourceLabel
		img.License = candidate.License
		img.SourceFoodID = candidate.SourceFoodID
		img.SourceFoodName = candidate.SourceFoodName
		return img, nil
	}
	return downloadCandidateHTTP(ctx, candidate, imageSearch)
}

func downloadCandidateHTTP(ctx context.Context, candidate imageCandidate, imageSearch string) (*downloadedImage, error) {
	var resp *http.Response
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, candidate.ImageURL, nil)
		if reqErr != nil {
			return nil, reqErr
		}
		ua := browserUserAgent()
		if imageSearch == "bing" {
			ua = bingSearchUserAgent()
		}
		req.Header.Set("User-Agent", ua)
		referer := strings.TrimSpace(candidate.PageURL)
		if referer == "" {
			switch imageSearch {
			case "google":
				referer = "https://www.google.com/"
			case "bing":
				referer = "https://cn.bing.com/images/search"
			default:
				referer = "https://www.bing.com/"
			}
		}
		req.Header.Set("Referer", referer)
		resp, err = imageDownloadHTTPClient.Do(req)
		if err == nil {
			break
		}
		if attempt == 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(200 * time.Millisecond):
			}
		}
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil {
		return nil, err
	}
	minBytes := 4 * 1024
	if strings.Contains(candidate.ImageURL, "encrypted-tbn") {
		minBytes = 1024
	}
	if len(data) < minBytes || len(data) > 8*1024*1024 {
		return nil, fmt.Errorf("invalid image size %d", len(data))
	}
	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[:idx]
	}
	detected := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		contentType = detected
	}
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("not image content type %s", contentType)
	}
	if contentType == "image/gif" {
		return nil, fmt.Errorf("unsupported image type %s", contentType)
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, fmt.Errorf("invalid image bytes: %w", err)
	}
	sum := sha256.Sum256(data)
	ext := extensionForContentType(contentType)
	return &downloadedImage{
		URL:            candidate.ImageURL,
		PageURL:        candidate.PageURL,
		Query:          candidate.Query,
		Data:           data,
		ContentType:    contentType,
		Ext:            ext,
		SHA256:         hex.EncodeToString(sum[:]),
		ReuseObjectKey: candidate.ReuseObjectKey,
		SourceLabel:    candidate.SourceLabel,
		License:        candidate.License,
		SourceFoodID:   candidate.SourceFoodID,
		SourceFoodName: candidate.SourceFoodName,
	}, nil
}

func loadState(path string) stateFile {
	state := stateFile{Entries: map[string]stateEntry{}}
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &state)
	}
	if state.Entries == nil {
		state.Entries = map[string]stateEntry{}
	}
	return state
}

func saveState(path string, state stateFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func updateState(state stateFile, result resultRow) {
	entry := state.Entries[result.FoodID]
	entry.Status = result.Status
	entry.Reason = result.Reason
	entry.ObjectKey = result.ObjectKey
	entry.AccessURL = result.AccessURL
	entry.UpdatedAt = time.Now()
	entry.Attempts++
	entry.LastDecision = result.Decision
	mergeTriedURLs(&entry, result.TriedURLs)
	if result.Candidate != "" {
		mergeTriedURLs(&entry, []string{result.Candidate})
	}
	state.Entries[result.FoodID] = entry
}

func shouldSkip(foodID string, state stateFile, failedOnly bool) bool {
	entry, ok := state.Entries[foodID]
	if !ok {
		return failedOnly
	}
	if failedOnly {
		return !isFailureStatus(entry.Status)
	}
	switch entry.Status {
	case "db_updated", "dry_run_match":
		return true
	case "db_update_failed", "upload_failed", "vision_failed", "kimi_failed", "search_failed", "download_failed":
		return false
	case "no_match":
		return true
	default:
		return false
	}
}

func containsHan(value string) bool {
	for _, r := range value {
		if r >= '\u4e00' && r <= '\u9fff' {
			return true
		}
	}
	return false
}

func looksLikeImageURL(raw string) bool {
	lower := strings.ToLower(strings.Split(raw, "?")[0])
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".webp"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func sortCandidatesByURLPreference(candidates []imageCandidate) {
	preferred := make([]imageCandidate, 0, len(candidates))
	rest := make([]imageCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if looksLikeImageURL(candidate.ImageURL) {
			preferred = append(preferred, candidate)
		} else {
			rest = append(rest, candidate)
		}
	}
	copy(candidates, append(preferred, rest...))
}

func appendJSONL(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = file.Write(append(data, '\n'))
	return err
}

func buildObjectKey(prefix, foodID, hash, ext string) string {
	prefix = strings.Trim(strings.TrimSpace(prefix), "/")
	if len(hash) > 16 {
		hash = hash[:16]
	}
	if ext == "" {
		ext = ".jpg"
	}
	return fmt.Sprintf("%s/%s/%s%s", prefix, foodID, hash, ext)
}

func extensionForContentType(contentType string) string {
	if exts, err := mime.ExtensionsByType(contentType); err == nil && len(exts) > 0 {
		ext := strings.ToLower(exts[0])
		switch ext {
		case ".jpe", ".jfif":
			return ".jpg"
		}
		return ext
	}
	switch contentType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func cleanHTMLURL(value string) string {
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, `\/`, `/`)
	if decoded, err := url.QueryUnescape(value); err == nil {
		return decoded
	}
	return value
}

func extractJSONObject(value string) string {
	value = strings.TrimSpace(value)
	start := strings.Index(value, "{")
	end := strings.LastIndex(value, "}")
	if start >= 0 && end > start {
		return value[start : end+1]
	}
	return value
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func isFailureStatus(status string) bool {
	switch status {
	case "search_failed", "download_failed", "vision_failed", "kimi_failed", "upload_failed", "db_update_failed", "no_match":
		return true
	default:
		return false
	}
}

func browserUserAgent() string {
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}
