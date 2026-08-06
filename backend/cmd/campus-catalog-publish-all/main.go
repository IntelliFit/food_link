package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	catalogdomain "food_link/backend/internal/campuscatalog/domain"
	catalogrepo "food_link/backend/internal/campuscatalog/repo"
	catalogservice "food_link/backend/internal/campuscatalog/service"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type publishReport struct {
	GeneratedAt    time.Time        `json:"generated_at"`
	DatabaseTarget string           `json:"database_target"`
	Apply          bool             `json:"apply"`
	TotalItems     int              `json:"total_items"`
	StatusCounts   map[string]int   `json:"status_counts"`
	CandidateCount int              `json:"candidate_count"`
	BlockedCount   int              `json:"blocked_count"`
	BlockedReasons map[string]int   `json:"blocked_reasons"`
	SubmittedCount int              `json:"submitted_count"`
	FailedCount    int              `json:"failed_count"`
	Failures       []publishFailure `json:"failures,omitempty"`
}

type publishFailure struct {
	ItemID string `json:"item_id"`
	Name   string `json:"name"`
	Error  string `json:"error"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	apply := flag.Bool("apply", false, "submit all publishable catalog items to the existing precise AI analysis path")
	confirmDB := flag.String("confirm-db", "", "required for --apply; must equal host/database/schema")
	concurrency := flag.Int("concurrency", 3, "number of concurrent submissions")
	reportOutput := flag.String("report-output", "", "JSON report output path")
	timeout := flag.Duration("timeout", 30*time.Minute, "command timeout")
	flag.Parse()

	if *concurrency < 1 || *concurrency > 16 {
		log.Fatalf("concurrency 必须在 1 到 16 之间")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	schema := strings.TrimSpace(cfg.Database.Schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		log.Fatalf("数据库 schema 非法: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + schema).Error; err != nil {
		log.Fatalf("设置数据库 schema 失败: %v", err)
	}
	target := fmt.Sprintf("%s/%s/%s", cfg.Database.Host, cfg.Database.Name, schema)
	if *apply && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}

	var items []catalogdomain.CatalogItem
	if err := db.WithContext(ctx).
		Table("campus_food_catalog_items").
		Where("status <> ?", "deleted").
		Order("created_at ASC, id ASC").
		Find(&items).Error; err != nil {
		log.Fatalf("读取校园菜品失败: %v", err)
	}
	report, candidates := auditCandidates(items, target, *apply)
	if *apply && len(candidates) > 0 {
		runPublish(ctx, cfg, db, candidates, *concurrency, &report)
	}
	if err := writeReport(*reportOutput, report); err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	log.Printf("校园菜品批量提交完成: target=%s apply=%t total=%d candidates=%d submitted=%d failed=%d blocked=%d",
		target, *apply, report.TotalItems, report.CandidateCount, report.SubmittedCount, report.FailedCount, report.BlockedCount)
}

func auditCandidates(items []catalogdomain.CatalogItem, target string, apply bool) (publishReport, []catalogdomain.CatalogItem) {
	report := publishReport{
		GeneratedAt: time.Now(), DatabaseTarget: target, Apply: apply, TotalItems: len(items),
		StatusCounts: map[string]int{}, BlockedReasons: map[string]int{}, Failures: []publishFailure{},
	}
	candidates := make([]catalogdomain.CatalogItem, 0, len(items))
	for _, item := range items {
		report.StatusCounts[normalized(item.Status, "（空）")]++
		reasons := publishBlockingReasons(item)
		if len(reasons) == 0 {
			candidates = append(candidates, item)
			continue
		}
		if item.Status == "published" || item.Status == "analysis_pending" {
			continue
		}
		report.BlockedCount++
		for _, reason := range reasons {
			report.BlockedReasons[reason]++
		}
	}
	report.CandidateCount = len(candidates)
	return report, candidates
}

func publishBlockingReasons(item catalogdomain.CatalogItem) []string {
	if item.Status == "published" {
		return []string{"already_published"}
	}
	if item.Status == "analysis_pending" {
		return []string{"analysis_pending"}
	}
	reasons := map[string]struct{}{}
	for _, field := range item.MissingFields {
		field = strings.TrimSpace(field)
		if field != "" && field != "image" {
			reasons[field] = struct{}{}
		}
	}
	if strings.TrimSpace(item.Name) == "" {
		reasons["name"] = struct{}{}
	}
	hasPrice := item.Price != nil || item.PriceMin != nil || item.PriceMax != nil ||
		strings.TrimSpace(item.PriceText) != "" || len(item.PriceOptions) > 0
	if item.PriceType == "unknown" || !hasPrice {
		reasons["price"] = struct{}{}
	}
	out := make([]string, 0, len(reasons))
	for reason := range reasons {
		out = append(out, reason)
	}
	sort.Strings(out)
	return out
}

func runPublish(ctx context.Context, cfg *config.Config, db *gorm.DB, candidates []catalogdomain.CatalogItem, concurrency int, report *publishReport) {
	storageClient := storage.New(cfg.Storage)
	queue, err := taskqueue.New(cfg.TaskQueue)
	if err != nil {
		log.Fatalf("初始化分析任务队列失败: %v", err)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if closeErr := queue.Close(closeCtx); closeErr != nil {
			log.Printf("关闭分析任务队列失败: %v", closeErr)
		}
	}()

	userRepo := authrepo.NewUserRepo(db)
	taskSvc := analyzeservice.NewTaskService(
		analyzerepo.NewTaskRepo(db),
		analyzerepo.NewPrecisionRepo(db),
		userRepo,
		storageClient,
	)
	taskSvc.ConfigureTaskPublisher(queue)
	catalogSvc := catalogservice.NewCatalogService(catalogrepo.NewCatalogRepo(db), storageClient)
	catalogSvc.ConfigureAnalysis(taskSvc, catalogservice.NewInternalAnalysisUserResolver(userRepo))

	jobs := make(chan catalogdomain.CatalogItem)
	var submitted atomic.Int64
	var processed atomic.Int64
	var failureMu sync.Mutex
	var failures []publishFailure
	var workers sync.WaitGroup
	for range concurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for item := range jobs {
				_, publishErr := catalogSvc.PublishItem(ctx, "", item.ID)
				if publishErr != nil {
					failureMu.Lock()
					failures = append(failures, publishFailure{ItemID: item.ID, Name: item.Name, Error: publishErr.Error()})
					failureMu.Unlock()
				} else {
					submitted.Add(1)
				}
				done := processed.Add(1)
				if done%50 == 0 || done == int64(len(candidates)) {
					log.Printf("批量提交进度: %d/%d", done, len(candidates))
				}
			}
		}()
	}
sendLoop:
	for _, item := range candidates {
		select {
		case <-ctx.Done():
			break sendLoop
		case jobs <- item:
		}
	}
	close(jobs)
	workers.Wait()
	sort.Slice(failures, func(i, j int) bool { return failures[i].ItemID < failures[j].ItemID })
	report.SubmittedCount = int(submitted.Load())
	report.Failures = failures
	report.FailedCount = len(failures)
}

func writeReport(path string, report publishReport) error {
	if strings.TrimSpace(path) == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("campus-catalog-publish-all-%s.json", time.Now().Format("20060102-150405")))
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return err
	}
	log.Printf("报告已写入: %s", path)
	return nil
}

func normalized(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}
