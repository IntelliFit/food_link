package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

type schoolRow struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Province *string `json:"province,omitempty"`
	City     *string `json:"city,omitempty"`
}

type imageCandidate struct {
	ImageURL string `json:"image_url"`
	PageURL  string `json:"page_url,omitempty"`
	Query    string `json:"query"`
}

type downloadedImage struct {
	URL         string
	PageURL     string
	Data        []byte
	ContentType string
	Ext         string
	SHA256      string
}

type resultRow struct {
	SchoolID    string          `json:"school_id"`
	SchoolName  string          `json:"school_name"`
	Status      string          `json:"status"`
	Reason      string          `json:"reason,omitempty"`
	Candidate   string          `json:"candidate,omitempty"`
	Decision    *badgeDecision  `json:"decision,omitempty"`
	ObjectKey   string          `json:"object_key,omitempty"`
	AccessURL   string          `json:"access_url,omitempty"`
	Uploaded    bool            `json:"uploaded"`
	DBUpdated   bool            `json:"db_updated"`
	ProcessedAt time.Time       `json:"processed_at"`
}

type stateFile struct {
	Entries map[string]stateEntry `json:"entries"`
}

type stateEntry struct {
	Status    string         `json:"status"`
	Reason    string         `json:"reason,omitempty"`
	ObjectKey string         `json:"object_key,omitempty"`
	AccessURL string         `json:"access_url,omitempty"`
	UpdatedAt time.Time      `json:"updated_at"`
	Attempts  int            `json:"attempts"`
	TriedURLs []string       `json:"tried_urls,omitempty"`
}

type options struct {
	configDir       string
	outputDir       string
	statePath       string
	resultsPath     string
	failedPath      string
	dashscopeBaseURL string
	model           string
	threshold       float64
	apply           bool
	dryRun          bool
	workers         int
	limit           int
	offset          int
	schoolID        string
	forceReprocess  bool
	timeout         time.Duration
	sleep           time.Duration
	maxCandidates   int
	checkpointEvery int
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "backend config directory")
	flag.StringVar(&opts.outputDir, "output-dir", "tmp/school-badge-backfill", "state and result output directory")
	flag.StringVar(&opts.statePath, "state-file", "", "resume state json path")
	flag.StringVar(&opts.resultsPath, "results-file", "", "results jsonl path")
	flag.StringVar(&opts.failedPath, "failed-file", "", "failed jsonl path")
	flag.StringVar(&opts.dashscopeBaseURL, "dashscope-base-url", "", "DashScope base URL")
	flag.StringVar(&opts.model, "vision-model", dashScopeModelHint, "vision model")
	flag.Float64Var(&opts.threshold, "threshold", 0.75, "minimum confidence to accept badge")
	flag.BoolVar(&opts.apply, "apply", false, "upload image and update database")
	flag.BoolVar(&opts.dryRun, "dry-run", true, "run without uploading or updating")
	flag.IntVar(&opts.workers, "workers", 3, "parallel worker count")
	flag.IntVar(&opts.limit, "limit", 0, "process at most N schools, 0 means all")
	flag.IntVar(&opts.offset, "offset", 0, "skip first N schools")
	flag.StringVar(&opts.schoolID, "school-id", "", "process only one school id")
	flag.BoolVar(&opts.forceReprocess, "force-reprocess", false, "ignore resume state")
	flag.DurationVar(&opts.timeout, "timeout", 12*time.Hour, "overall timeout")
	flag.DurationVar(&opts.sleep, "sleep", 800*time.Millisecond, "delay between search requests")
	flag.IntVar(&opts.maxCandidates, "max-candidates", 8, "max downloaded image candidates per school")
	flag.IntVar(&opts.checkpointEvery, "checkpoint-every", 10, "save state every N processed schools")
	flag.Parse()

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

func main() {
	opts := parseFlags()
	loadBackendEnv(opts.configDir)
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	if err := runBackfill(ctx, opts); err != nil {
		log.Fatalf("校徽回填失败: %v", err)
	}
}

func runBackfill(ctx context.Context, opts options) error {
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

	storageClient := storage.New(cfg.Storage)
	if cfg.External.DashScopeAPIKey != "" {
		_ = os.Setenv("DASHSCOPE_API_KEY", cfg.External.DashScopeAPIKey)
	}
	state := loadState(opts.statePath)

	schools, err := queryMissingSchools(ctx, db, opts)
	if err != nil {
		return err
	}
	if len(schools) == 0 {
		fmt.Println("没有需要处理的学校")
		return nil
	}
	fmt.Printf("待处理学校: %d (dryRun=%v workers=%d)\n", len(schools), opts.dryRun, opts.workers)

	var wg sync.WaitGroup
	schoolCh := make(chan schoolRow, len(schools))
	resultCh := make(chan resultRow, len(schools))

	for _, s := range schools {
		schoolCh <- s
	}
	close(schoolCh)

	// Result collector
	go func() {
		for result := range resultCh {
			updateState(state, result)
			if result.Status == "db_updated" || result.Status == "dry_run_match" {
				_ = appendJSONL(opts.resultsPath, result)
			} else if isFailureStatus(result.Status) {
				_ = appendJSONL(opts.failedPath, result)
			}
		}
	}()

	// Workers
	var processed int
	var mu sync.Mutex
	for i := 0; i < opts.workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for school := range schoolCh {
				if ctx.Err() != nil {
					return
				}
				result := processSchool(ctx, db, storageClient, opts, state, school)
				resultCh <- result

				mu.Lock()
				processed++
				p := processed
				mu.Unlock()

				fmt.Printf("[%s] %s %s (worker=%d progress=%d/%d)\n", result.Status, school.ID, school.Name, workerID, p, len(schools))

				if opts.checkpointEvery > 0 && p%opts.checkpointEvery == 0 {
					_ = saveState(opts.statePath, state)
				}
				if opts.sleep > 0 {
					time.Sleep(opts.sleep)
				}
			}
		}(i)
	}

	wg.Wait()
	close(resultCh)
	// Wait for collector to finish
	time.Sleep(100 * time.Millisecond)

	if err := saveState(opts.statePath, state); err != nil {
		return fmt.Errorf("保存状态失败: %w", err)
	}

	// Print summary
	var success, failed, skipped int
	for _, s := range schools {
		entry := state.Entries[s.ID]
		switch entry.Status {
		case "db_updated", "dry_run_match":
			success++
		case "search_failed", "download_failed", "vision_failed", "no_match", "upload_failed", "db_update_failed":
			failed++
		default:
			if shouldSkip(s.ID, state) {
				skipped++
			}
		}
	}
	fmt.Printf("\n=== 处理完成 ===\n")
	fmt.Printf("总计: %d | 成功: %d | 失败: %d | 跳过: %d\n", len(schools), success, failed, skipped)
	fmt.Printf("状态文件: %s\n", opts.statePath)
	fmt.Printf("结果文件: %s\n", opts.resultsPath)
	fmt.Printf("失败文件: %s\n", opts.failedPath)
	return nil
}

func queryMissingSchools(ctx context.Context, db *gorm.DB, opts options) ([]schoolRow, error) {
	args := []any{}
	where := "WHERE status = 'active' AND logo_url IS NULL"
	if strings.TrimSpace(opts.schoolID) != "" {
		ids := strings.Split(strings.TrimSpace(opts.schoolID), ",")
		placeholders := make([]string, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args = append(args, strings.TrimSpace(id))
		}
		where += " AND id::text IN (" + strings.Join(placeholders, ",") + ")"
	}
	sql := "SELECT id::text AS id, name, province, city FROM schools " + where + " ORDER BY is_985 DESC, is_211 DESC, name ASC"
	if opts.limit > 0 {
		sql += " LIMIT ?"
		args = append(args, opts.limit)
	}
	if opts.offset > 0 {
		sql += " OFFSET ?"
		args = append(args, opts.offset)
	}
	var rows []schoolRow
	if err := db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}

	if !opts.forceReprocess {
		filtered := make([]schoolRow, 0, len(rows))
		for _, r := range rows {
			if !shouldSkip(r.ID, loadState(opts.statePath)) {
				filtered = append(filtered, r)
			}
		}
		return filtered, nil
	}
	return rows, nil
}

var independentCollegeParents = map[string]string{
	"兰州交通大学博文学院":         "兰州交通大学",
	"兰州理工大学技术工程学院":       "兰州理工大学",
	"安徽师范大学皖江学院":          "安徽师范大学",
	"安徽建筑大学城市建设学院":       "安徽建筑大学",
	"山东师范大学历山学院":          "山东师范大学",
	"沈阳航空航天大学北方科技学院":     "沈阳航空航天大学",
	"浙江中医药大学滨江学院":         "浙江中医药大学",
	"西安电子科技大学长安学院":       "西安电子科技大学",
	"贵州大学明德学院":             "贵州大学",
}

func processSchool(ctx context.Context, db *gorm.DB, storageClient *storage.Client, opts options, state stateFile, school schoolRow) resultRow {
	result := resultRow{SchoolID: school.ID, SchoolName: school.Name, Status: "search_failed", ProcessedAt: time.Now()}

	// Build search queries
	queries := []string{
		school.Name + " 校徽",
		school.Name + " logo",
		school.Name + " 校徽 高清",
		school.Name + " 校徽 官网",
		school.Name + " 标志",
	}
	// Fallback: for independent colleges, also search parent university badge
	if parent, ok := independentCollegeParents[school.Name]; ok {
		queries = append(queries, parent+" 校徽", parent+" logo", parent+" 校徽 高清")
	}
	seen := map[string]bool{}
	var candidates []imageCandidate
	for _, query := range queries {
		if seen[query] {
			continue
		}
		seen[query] = true
		batch := searchBingImages(query, opts.maxCandidates, 0)
		for _, c := range batch {
			if c.ImageURL == "" {
				continue
			}
			// Avoid duplicates
			dup := false
			for _, existing := range candidates {
				if existing.ImageURL == c.ImageURL {
					dup = true
					break
				}
			}
			if !dup {
				candidates = append(candidates, c)
			}
		}
		if opts.sleep > 0 {
			time.Sleep(opts.sleep)
		}
	}

	if len(candidates) == 0 {
		result.Reason = "no image candidates"
		return result
	}

	// Try candidates: prefer square-ish images
	type scoredCandidate struct {
		candidate imageCandidate
		img       *downloadedImage
		score     float64 // higher is better
	}
	var scored []scoredCandidate

	for _, candidate := range candidates {
		if ctx.Err() != nil {
			return result
		}
		if isKnownBlankImageURL(candidate.ImageURL) {
			continue
		}
		img, err := downloadImage(ctx, candidate.ImageURL, candidate.PageURL)
		if err != nil {
			continue
		}
		if isBlankImage(img.Data) {
			continue
		}
		_, _, ratio, err := imageAspectRatio(img.Data)
		if err != nil {
			continue
		}
		// Score: closer to 1.0 aspect ratio is better
		score := 1.0 - math.Abs(ratio-1.0)
		scored = append(scored, scoredCandidate{candidate: candidate, img: img, score: score})
	}

	if len(scored) == 0 {
		result.Status = "download_failed"
		result.Reason = "all candidates failed download or invalid image"
		return result
	}

	// Sort by score descending (square-ish first)
	for i := 0; i < len(scored)-1; i++ {
		for j := i + 1; j < len(scored); j++ {
			if scored[j].score > scored[i].score {
				scored[i], scored[j] = scored[j], scored[i]
			}
		}
	}

	// Try top candidates with LLM verification
	altName := independentCollegeParents[school.Name]
	for _, sc := range scored {
		if ctx.Err() != nil {
			return result
		}
		decision, err := classifyBadgeImageWithAlt(ctx, opts.configDir, opts.dashscopeBaseURL, opts.model, school.Name, altName, sc.img.Data, sc.img.ContentType)
		if err != nil {
			result.Status = "vision_failed"
			result.Reason = err.Error()
			continue
		}
		result.Candidate = sc.candidate.ImageURL
		result.Decision = decision
		if !decision.IsBadge || decision.Confidence < opts.threshold {
			result.Status = "no_match"
			result.Reason = fmt.Sprintf("confidence=%.2f reason=%s", decision.Confidence, decision.Reason)
			continue
		}

		// 图片后处理：统一为正方形 256×256 PNG
		processedData, err := processBadgeImage(sc.img.Data)
		if err != nil {
			result.Status = "process_failed"
			result.Reason = fmt.Sprintf("image process: %v", err)
			continue
		}
		sc.img.Data = processedData
		sc.img.ContentType = "image/png"
		sc.img.Ext = ".png"
		sc.img.SHA256 = fmt.Sprintf("%x", sha256.Sum256(processedData))

		key := buildObjectKey("school-badges", school.ID, sc.img.SHA256, sc.img.Ext)
		result.ObjectKey = key
		result.AccessURL = storageClient.BuildAccessURL("icon", key)

		if opts.dryRun {
			result.Status = "dry_run_match"
			result.Reason = fmt.Sprintf("matched (confidence=%.2f) but dry-run", decision.Confidence)
			return result
		}

		uploadedURL, err := storageClient.UploadBytes("icon", key, sc.img.Data, sc.img.ContentType)
		if err != nil {
			result.Status = "upload_failed"
			result.Reason = err.Error()
			return result
		}
		result.Uploaded = true
		if uploadedURL != "" {
			result.AccessURL = uploadedURL
		}
		if err := updateSchoolLogo(ctx, db, school.ID, key); err != nil {
			result.Status = "db_update_failed"
			result.Reason = err.Error()
			return result
		}
		result.DBUpdated = true
		result.Status = "db_updated"
		return result
	}

	return result
}

func updateSchoolLogo(ctx context.Context, db *gorm.DB, schoolID, key string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Table("schools").
			Where("id::text = ?", schoolID).
			Where("logo_url IS NULL").
			Updates(map[string]interface{}{
				"logo_url": key,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("row missing or logo_url already filled")
		}
		return nil
	})
}
