package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
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
	"os/exec"
	"runtime"
	"sync"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

const (
	kimiClientID  = "17e5f671-d194-4dfb-9706-5516cb48c098"
	kimiAuthBase  = "https://auth.kimi.com"
	kimiAPIBase   = "https://api.kimi.com/coding/v1"
	kimiUserAgent = "KimiCLI/1.0.0"
)

var tokenFileMu sync.Mutex

type foodRow struct {
	ID             string `json:"id"`
	CanonicalName  string `json:"canonical_name"`
	NormalizedName string `json:"normalized_name"`
	Aliases        string `json:"aliases,omitempty"`
}

type imageCandidate struct {
	ImageURL string `json:"image_url"`
	PageURL  string `json:"page_url,omitempty"`
	Query    string `json:"query"`
}

type downloadedImage struct {
	URL         string
	PageURL     string
	Query       string
	Data        []byte
	ContentType string
	Ext         string
	SHA256      string
}

type kimiDecision struct {
	FoodMatch    bool    `json:"food_match"`
	NoWatermark  bool    `json:"no_watermark"`
	Match        bool    `json:"match"`
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
}

type resultRow struct {
	FoodID      string        `json:"food_id"`
	FoodName    string        `json:"food_name"`
	Status      string        `json:"status"`
	Reason      string        `json:"reason,omitempty"`
	Candidate   string        `json:"candidate,omitempty"`
	Query       string        `json:"query,omitempty"`
	Decision    *kimiDecision `json:"decision,omitempty"`
	ObjectKey   string        `json:"object_key,omitempty"`
	AccessURL   string        `json:"access_url,omitempty"`
	Uploaded    bool          `json:"uploaded"`
	DBUpdated   bool          `json:"db_updated"`
	ProcessedAt time.Time     `json:"processed_at"`
}

type stateFile struct {
	Entries map[string]stateEntry `json:"entries"`
}

type stateEntry struct {
	Status      string    `json:"status"`
	Reason      string    `json:"reason,omitempty"`
	ObjectKey   string    `json:"object_key,omitempty"`
	AccessURL   string    `json:"access_url,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
	Attempts    int       `json:"attempts"`
	LastDecision *kimiDecision `json:"last_decision,omitempty"`
}

type kimiToken struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int       `json:"expires_in"`
	ObtainedAt   time.Time `json:"obtained_at"`
}

type options struct {
	configDir      string
	outputDir      string
	statePath      string
	resultsPath    string
	failedPath     string
	tokenPath       string
	kimiAPIKeyPath  string
	limit          int
	offset         int
	maxCandidates  int
	foodID         string
	keyPrefix      string
	model          string
	threshold      float64
	apply          bool
	dryRun         bool
	failedOnly     bool
	demo           bool
	authOnly       bool
	demoImage      string
	demoFood       string
	localImage     string
	trustLocal      bool
	workers         int
	imageSearch     string
	foodIDs         string
	successJSON     string
	forceReprocess  bool
	timeout         time.Duration
	sleep             time.Duration
	searchQueryLimit  int
	timing            bool
	statsOnly         bool
	statsOutput       string
	checkpointEvery   int
}

func main() {
	opts := parseFlags()
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	if opts.authOnly {
		if err := runAuthOnly(ctx, opts); err != nil {
			log.Fatalf("Kimi OAuth 登录失败: %v", err)
		}
		return
	}
	if opts.demo {
		if err := runDemo(ctx, opts); err != nil {
			log.Fatalf("Kimi 图片判断 demo 失败: %v", err)
		}
		return
	}
	if strings.TrimSpace(opts.localImage) != "" {
		if err := runLocalImageBackfill(ctx, opts); err != nil {
			log.Fatalf("本地图片回填失败: %v", err)
		}
		return
	}
	if opts.statsOnly {
		if err := runStats(ctx, opts); err != nil {
			log.Fatalf("统计失败: %v", err)
		}
		return
	}
	if err := runBackfill(ctx, opts); err != nil {
		log.Fatalf("标准食物图片回填失败: %v", err)
	}
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "backend config directory")
	flag.StringVar(&opts.outputDir, "output-dir", "tmp/standard-food-image-backfill", "state and result output directory")
	flag.StringVar(&opts.statePath, "state-file", "", "resume state json path")
	flag.StringVar(&opts.resultsPath, "results-file", "", "results jsonl path")
	flag.StringVar(&opts.failedPath, "failed-file", "", "failed jsonl path")
	flag.StringVar(&opts.tokenPath, "token-file", "tmp/kimi-code-oauth-token.json", "Kimi OAuth token cache path")
	flag.StringVar(&opts.kimiAPIKeyPath, "kimi-api-key-file", "tmp/kimi-api-key.local", "local Kimi API key file (see backend/kimi-api-key.local.example)")
	flag.IntVar(&opts.limit, "limit", 0, "process at most N foods, 0 means all")
	flag.IntVar(&opts.offset, "offset", 0, "skip first N foods")
	flag.IntVar(&opts.maxCandidates, "max-candidates", 8, "max downloaded image candidates per food")
	flag.StringVar(&opts.foodID, "food-id", "", "process only one food id")
	flag.StringVar(&opts.keyPrefix, "key-prefix", "standard-food/backfill", "COS object key prefix")
	flag.StringVar(&opts.model, "kimi-model", "kimi-for-coding", "Kimi model name")
	flag.Float64Var(&opts.threshold, "threshold", 0.72, "minimum Kimi confidence to accept")
	flag.BoolVar(&opts.apply, "apply", false, "upload image and update database")
	flag.BoolVar(&opts.dryRun, "dry-run", true, "run without uploading or updating database")
	flag.BoolVar(&opts.failedOnly, "failed-only", false, "process only rows with failed status in state file")
	flag.BoolVar(&opts.demo, "demo", false, "run a single Kimi image matching demo")
	flag.BoolVar(&opts.authOnly, "auth-only", false, "run Kimi device OAuth and save token only")
	flag.StringVar(&opts.demoImage, "demo-image", "tmp/test.jpg", "demo image path")
	flag.StringVar(&opts.demoFood, "demo-food", "食物", "demo expected food name")
	flag.StringVar(&opts.localImage, "local-image", "", "use a local image file instead of Bing search; requires --food-id")
	flag.BoolVar(&opts.trustLocal, "trust-local-image", false, "with --local-image, skip Kimi and accept the file (for upload path verification only)")
	flag.IntVar(&opts.workers, "workers", 1, "parallel worker count for batch processing")
	flag.StringVar(&opts.imageSearch, "image-search", "bing", "image search provider: google or bing")
	flag.StringVar(&opts.foodIDs, "food-ids", "", "comma-separated food ids to process (overrides limit/offset)")
	flag.StringVar(&opts.successJSON, "success-json", "", "write matched successes to this JSON file")
	flag.BoolVar(&opts.forceReprocess, "force-reprocess", false, "ignore resume state and reprocess foods")
	flag.DurationVar(&opts.timeout, "timeout", 12*time.Hour, "overall timeout")
	flag.DurationVar(&opts.sleep, "sleep", 800*time.Millisecond, "delay between search requests")
	flag.IntVar(&opts.searchQueryLimit, "search-query-limit", 0, "max search queries per food (0 = all, 1 recommended for google+opencli)")
	flag.BoolVar(&opts.timing, "timing", false, "print per-stage durations to stdout")
	flag.BoolVar(&opts.statsOnly, "stats-only", false, "print backfill baseline stats and exit")
	flag.StringVar(&opts.statsOutput, "stats-output", "", "write --stats-only JSON to this file")
	flag.IntVar(&opts.checkpointEvery, "checkpoint-every", 1, "save state.json every N processed foods (0=only at end)")
	flag.Parse()
	if opts.imageSearch != "google" && opts.imageSearch != "bing" {
		log.Fatalf("不支持的 image-search: %s（仅 google 或 bing）", opts.imageSearch)
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

func runAuthOnly(ctx context.Context, opts options) error {
	token, err := runDeviceFlow(ctx)
	if err != nil {
		return err
	}
	if err := saveToken(opts.tokenPath, token); err != nil {
		return err
	}
	fmt.Printf("Kimi token 已保存到 %s\n", opts.tokenPath)
	return nil
}

func runDemo(ctx context.Context, opts options) error {
	data, err := os.ReadFile(opts.demoImage)
	if err != nil {
		return err
	}
	contentType := http.DetectContentType(data)
	decision, err := classifyImageWithAuth(ctx, opts.tokenPath, opts.kimiAPIKeyPath, opts.model, opts.demoFood, data, contentType)
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
		result.Decision = &kimiDecision{FoodMatch: true, NoWatermark: true, Match: true, Confidence: 1, Reason: "trust-local-image"}
	} else {
		decision, err := classifyImageWithAuth(ctx, opts.tokenPath, opts.kimiAPIKeyPath, opts.model, food.CanonicalName, img.Data, img.ContentType)
		if err != nil {
			result.Status = "kimi_failed"
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
SELECT
  f.id::text AS id,
  f.canonical_name,
  f.normalized_name,
  COALESCE(string_agg(a.alias_name, ' ' ORDER BY a.alias_name), '') AS aliases
FROM food_nutrition_library f
LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
` + where + `
GROUP BY f.id, f.canonical_name, f.normalized_name
ORDER BY (f.canonical_name ~ '[\u4e00-\u9fff]') DESC, f.updated_at ASC NULLS FIRST, f.canonical_name ASC`
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

func processFood(ctx context.Context, db *gorm.DB, storageClient *storage.Client, opts options, food foodRow) resultRow {
	foodStart := time.Now()
	result := resultRow{FoodID: food.ID, FoodName: food.CanonicalName, Status: "search_failed", ProcessedAt: time.Now()}
	searchStart := time.Now()
	candidates := searchCandidates(food, opts.sleep, opts.imageSearch, opts.searchQueryLimit)
	printTiming(opts, "image_search provider=%s duration=%s candidates=%d", opts.imageSearch, time.Since(searchStart).Round(time.Millisecond), len(candidates))
	if len(candidates) == 0 {
		result.Reason = "no image candidates"
		printTiming(opts, "food_total food=%s duration=%s status=%s", food.CanonicalName, time.Since(foodStart).Round(time.Millisecond), result.Status)
		return result
	}
	downloaded := 0
	var lastKimiErr string
	var lastNoMatchReason string
	kimiOK := 0
	var downloadTotal, kimiTotal time.Duration
	kimiCalls := 0
	for i, candidate := range candidates {
		if downloaded >= opts.maxCandidates {
			break
		}
		dlStart := time.Now()
		img, err := downloadCandidateImage(ctx, candidate, opts.imageSearch)
		downloadTotal += time.Since(dlStart)
		if err != nil {
			printTiming(opts, "download_fail idx=%d duration=%s", i+1, time.Since(dlStart).Round(time.Millisecond))
			continue
		}
		downloaded++
		printTiming(opts, "download_ok idx=%d duration=%s bytes=%d", i+1, time.Since(dlStart).Round(time.Millisecond), len(img.Data))
		kimiStart := time.Now()
		decision, err := classifyImageWithAuth(ctx, opts.tokenPath, opts.kimiAPIKeyPath, opts.model, food.CanonicalName, img.Data, img.ContentType)
		kimiDur := time.Since(kimiStart)
		kimiTotal += kimiDur
		kimiCalls++
		if err != nil {
			lastKimiErr = err.Error()
			printTiming(opts, "kimi_fail idx=%d duration=%s err=%s", i+1, kimiDur.Round(time.Millisecond), err.Error())
			continue
		}
		kimiOK++
		printTiming(opts, "kimi_ok idx=%d duration=%s food_match=%v no_watermark=%v match=%v confidence=%.2f", i+1, kimiDur.Round(time.Millisecond), decision.FoodMatch, decision.NoWatermark, decision.Match, decision.Confidence)
		result.Candidate = img.URL
		result.Query = img.Query
		result.Decision = decision
		if !decision.Match || decision.Confidence < opts.threshold {
			result.Status = "no_match"
			result.Reason = decision.Reason
			lastNoMatchReason = decision.Reason
			continue
		}
		key := buildObjectKey(opts.keyPrefix, food.ID, img.SHA256, img.Ext)
		result.ObjectKey = key
		result.AccessURL = storageClient.BuildAccessURL("food-images", key)
		if opts.dryRun {
			result.Status = "dry_run_match"
			result.Reason = "matched but dry-run"
			return result
		}
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
		if err := updateFoodImage(ctx, db, food.ID, key); err != nil {
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
	case kimiOK == 0:
		result.Status = "kimi_failed"
		result.Reason = lastKimiErr
	case lastNoMatchReason != "" && result.Status != "dry_run_match" && result.Status != "db_updated":
		result.Status = "no_match"
		result.Reason = lastNoMatchReason
	}
	printTiming(opts, "download_sum duration=%s kimi_sum duration=%s kimi_calls=%d", downloadTotal.Round(time.Millisecond), kimiTotal.Round(time.Millisecond), kimiCalls)
	printTiming(opts, "food_total food=%s duration=%s status=%s", food.CanonicalName, time.Since(foodStart).Round(time.Millisecond), result.Status)
	return result
}

func updateFoodImage(ctx context.Context, db *gorm.DB, foodID, key string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec(`
UPDATE food_nutrition_library
SET image_path = ?,
    image_paths = jsonb_build_array(?),
    updated_at = now()
WHERE id::text = ?
  AND NULLIF(trim(COALESCE(image_path, '')), '') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
    WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )`, key, key, foodID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("row missing or image already filled")
		}
		return nil
	})
}

func searchCandidates(food foodRow, sleep time.Duration, imageSearch string, searchQueryLimit int) []imageCandidate {
	queries := candidateQueries(food)
	out := []imageCandidate{}
	seen := map[string]bool{}
	searchFn := searchBingImages
	if imageSearch == "google" {
		searchFn = searchGoogleImages
	}
	for i, query := range queries {
		if searchQueryLimit > 0 && i >= searchQueryLimit {
			break
		}
		for _, candidate := range searchFn(query, 12) {
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
		if imageSearch == "google" && len(out) >= 8 {
			break
		}
	}
	// Bing 结果已在 HTML 中按展示顺序解析；勿重排，避免与用户看到的缩略图顺序不一致。
	if imageSearch != "bing" {
		sortCandidatesByURLPreference(out)
	}
	return out
}

func candidateQueries(food foodRow) []string {
	name := strings.TrimSpace(food.CanonicalName)
	// 与用户浏览器搜索一致：优先纯食物名，再尝试带后缀的查询。
	values := []string{
		name,
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
		return img, nil
	}
	return downloadCandidateHTTP(ctx, candidate, imageSearch)
}

func downloadCandidateHTTP(ctx context.Context, candidate imageCandidate, imageSearch string) (*downloadedImage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, candidate.ImageURL, nil)
	if err != nil {
		return nil, err
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
	resp, err := http.DefaultClient.Do(req)
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
		URL:         candidate.ImageURL,
		PageURL:     candidate.PageURL,
		Query:       candidate.Query,
		Data:        data,
		ContentType: contentType,
		Ext:         ext,
		SHA256:      hex.EncodeToString(sum[:]),
	}, nil
}

func classifyImage(ctx context.Context, token, model, foodName string, data []byte, contentType string) (*kimiDecision, error) {
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	prompt := fmt.Sprintf(
		"请判断图片是否适合作为“%s”的标准展示图。该图来自 Bing 图片搜索「%s」。只返回 JSON，不要 Markdown。格式必须为 {\"food_match\":true/false,\"no_watermark\":true/false,\"confidence\":0到1,\"reason\":\"中文简短原因\"}。food_match：主体应是搜索词所指的食物或常见同类菜品实拍；若搜索凉拌海带丝，深绿/褐绿条状海带凉菜、碗装凉拌海带丝应判 true；仅当明显是无关食物（如皮蛋黄瓜、地图、包装无关商品）才 false。no_watermark：无平台/店铺/版权/大面积水印；少量配料文字可 true。",
		foodName, foodName,
	)
	payload := map[string]any{
		"model":       model,
		"temperature": 0,
		"max_tokens":  512,
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": prompt},
				{"type": "image_url", "image_url": map[string]any{"url": "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)}},
			},
		}},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, kimiAPIBase+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimPrefix(token, "Bearer "))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", kimiUserAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("kimi status %d: %s", resp.StatusCode, string(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, errors.New("kimi returned no choices")
	}
	return parseKimiDecision(parsed.Choices[0].Message.Content)
}

func classifyImageWithAuth(ctx context.Context, tokenPath, kimiAPIKeyPath, model, foodName string, data []byte, contentType string) (*kimiDecision, error) {
	token, err := getKimiAccessToken(ctx, tokenPath, kimiAPIKeyPath)
	if err != nil {
		return nil, err
	}
	decision, err := classifyImage(ctx, token, model, foodName, data, contentType)
	if err == nil {
		return decision, nil
	}
	if strings.Contains(err.Error(), "parse kimi decision") {
		if retry, retryErr := classifyImage(ctx, token, model, foodName, data, contentType); retryErr == nil {
			return retry, nil
		}
	}
	if !strings.Contains(err.Error(), "401") && !strings.Contains(err.Error(), "invalid_authentication") {
		return nil, err
	}
	tok := loadToken(tokenPath)
	if tok.RefreshToken == "" {
		return nil, err
	}
	refreshed, refreshErr := refreshKimiToken(ctx, tok.RefreshToken)
	if refreshErr != nil {
		return nil, err
	}
	_ = saveToken(tokenPath, refreshed)
	return classifyImage(ctx, refreshed.AccessToken, model, foodName, data, contentType)
}

func loadKimiAPIKey(apiKeyPath string) string {
	if manual := strings.TrimSpace(os.Getenv("KIMI_API_KEY")); manual != "" {
		return strings.TrimPrefix(manual, "Bearer ")
	}
	path := strings.TrimSpace(apiKeyPath)
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if key, ok := strings.CutPrefix(line, "KIMI_API_KEY="); ok {
			key = strings.TrimSpace(key)
			return strings.Trim(key, `"'`)
		}
		return strings.Trim(line, `"'`)
	}
	return ""
}

func getKimiAccessToken(ctx context.Context, tokenPath, kimiAPIKeyPath string) (string, error) {
	tokenFileMu.Lock()
	defer tokenFileMu.Unlock()
	if key := loadKimiAPIKey(kimiAPIKeyPath); key != "" {
		return key, nil
	}
	token := loadToken(tokenPath)
	if token.AccessToken != "" && time.Since(token.ObtainedAt) < time.Duration(token.ExpiresIn-60)*time.Second {
		return token.AccessToken, nil
	}
	if token.RefreshToken != "" {
		refreshed, err := refreshKimiToken(ctx, token.RefreshToken)
		if err == nil {
			_ = saveToken(tokenPath, refreshed)
			return refreshed.AccessToken, nil
		}
	}
	fresh, err := runDeviceFlow(ctx)
	if err != nil {
		return "", err
	}
	_ = saveToken(tokenPath, fresh)
	return fresh.AccessToken, nil
}

func runDeviceFlow(ctx context.Context) (kimiToken, error) {
	values := url.Values{"client_id": {kimiClientID}}
	var auth struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		Interval                int    `json:"interval"`
		ExpiresIn               int    `json:"expires_in"`
	}
	if err := postFormJSON(ctx, kimiAuthBase+"/api/oauth/device_authorization", values, &auth); err != nil {
		return kimiToken{}, err
	}
	if auth.Interval <= 0 {
		auth.Interval = 5
	}
	authURL := auth.VerificationURIComplete
	if authURL == "" {
		authURL = auth.VerificationURI
	}
	fmt.Println("请在浏览器打开以下链接完成 Kimi 授权：")
	fmt.Println(authURL)
	if auth.UserCode != "" {
		fmt.Printf("用户码: %s\n", auth.UserCode)
	}
	tryOpenBrowser(authURL)
	deadline := time.Now().Add(time.Duration(auth.ExpiresIn) * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(auth.Interval) * time.Second)
		var tok kimiToken
		values := url.Values{
			"client_id":   {kimiClientID},
			"device_code": {auth.DeviceCode},
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		}
		err := postFormJSON(ctx, kimiAuthBase+"/api/oauth/token", values, &tok)
		if err == nil && tok.AccessToken != "" {
			tok.ObtainedAt = time.Now()
			return tok, nil
		}
		if err != nil && strings.Contains(err.Error(), "slow_down") {
			auth.Interval += 5
		} else if err != nil && !strings.Contains(err.Error(), "authorization_pending") {
			return kimiToken{}, err
		}
	}
	return kimiToken{}, errors.New("kimi device authorization expired")
}

func refreshKimiToken(ctx context.Context, refreshToken string) (kimiToken, error) {
	values := url.Values{
		"client_id":     {kimiClientID},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
	}
	var tok kimiToken
	if err := postFormJSON(ctx, kimiAuthBase+"/api/oauth/token", values, &tok); err != nil {
		return kimiToken{}, err
	}
	tok.ObtainedAt = time.Now()
	return tok, nil
}

func postFormJSON(ctx context.Context, endpoint string, values url.Values, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", kimiUserAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if resp.StatusCode >= 400 {
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &errBody)
		if errBody.Error != "" {
			return errors.New(errBody.Error)
		}
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return json.Unmarshal(body, target)
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
	case "db_updated", "dry_run_match", "no_match", "kimi_failed", "search_failed", "download_failed", "upload_failed", "db_update_failed":
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

func loadToken(path string) kimiToken {
	var tok kimiToken
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &tok)
	}
	return tok
}

func saveToken(path string, tok kimiToken) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(tok, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
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

var (
	reKimiFoodMatch    = regexp.MustCompile(`"food_match"\s*:\s*(true|false)`)
	reKimiNoWatermark  = regexp.MustCompile(`"no_watermark"\s*:\s*(true|false)`)
	reKimiMatch        = regexp.MustCompile(`"match"\s*:\s*(true|false)`)
	reKimiConfidence   = regexp.MustCompile(`"confidence"\s*:\s*([0-9.]+)`)
	reKimiReason       = regexp.MustCompile(`"reason"\s*:\s*"((?:\\.|[^"\\])*)"`)
)

func parseKimiDecision(raw string) (*kimiDecision, error) {
	content := extractJSONObject(raw)
	var decision kimiDecision
	if jsonErr := json.Unmarshal([]byte(content), &decision); jsonErr == nil {
		normalizeKimiDecision(&decision)
		return &decision, nil
	}
	if parts := reKimiFoodMatch.FindStringSubmatch(content); len(parts) == 2 {
		decision.FoodMatch = parts[1] == "true"
	}
	if parts := reKimiNoWatermark.FindStringSubmatch(content); len(parts) == 2 {
		decision.NoWatermark = parts[1] == "true"
	}
	if parts := reKimiMatch.FindStringSubmatch(content); len(parts) == 2 {
		decision.Match = parts[1] == "true"
	}
	if !decision.FoodMatch && !decision.NoWatermark && !decision.Match {
		return nil, fmt.Errorf("parse kimi decision %q: invalid json", raw)
	}
	if confParts := reKimiConfidence.FindStringSubmatch(content); len(confParts) == 2 {
		fmt.Sscanf(confParts[1], "%f", &decision.Confidence)
	}
	if reasonParts := reKimiReason.FindStringSubmatch(content); len(reasonParts) == 2 {
		decision.Reason = strings.ReplaceAll(reasonParts[1], `\"`, `"`)
	}
	if decision.Reason == "" {
		decision.Reason = "模型返回不完整，按不匹配处理"
	}
	normalizeKimiDecision(&decision)
	return &decision, nil
}

func normalizeKimiDecision(decision *kimiDecision) {
	clampKimiDecision(decision)
	if decision.FoodMatch || decision.NoWatermark {
		decision.Match = decision.FoodMatch && decision.NoWatermark
		return
	}
	decision.FoodMatch = decision.Match
	decision.NoWatermark = decision.Match
}

func clampKimiDecision(decision *kimiDecision) {
	if decision.Confidence < 0 {
		decision.Confidence = 0
	}
	if decision.Confidence > 1 {
		decision.Confidence = 1
	}
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func isFailureStatus(status string) bool {
	switch status {
	case "search_failed", "download_failed", "kimi_failed", "upload_failed", "db_update_failed", "no_match":
		return true
	default:
		return false
	}
}

func browserUserAgent() string {
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}

func tryOpenBrowser(url string) {
	if strings.TrimSpace(url) == "" {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
