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
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	catalogrepo "food_link/backend/internal/campuscatalog/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type cleanupItem struct {
	ItemID    string `json:"item_id"`
	Name      string `json:"name"`
	EntryType string `json:"entry_type"`
	Status    string `json:"status"`
}

type cleanupFailure struct {
	ItemID string `json:"item_id"`
	Name   string `json:"name"`
	Error  string `json:"error"`
}

type cleanupReport struct {
	GeneratedAt    time.Time        `json:"generated_at"`
	DatabaseTarget string           `json:"database_target"`
	Apply          bool             `json:"apply"`
	CandidateCount int              `json:"candidate_count"`
	Candidates     []cleanupItem    `json:"candidates"`
	DeletedCount   int              `json:"deleted_count"`
	FailedCount    int              `json:"failed_count"`
	Failures       []cleanupFailure `json:"failures"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	apply := flag.Bool("apply", false, "soft-delete all matched zero-nutrition water drinks")
	confirmDB := flag.String("confirm-db", "", "required for --apply; must equal host/database/schema")
	reportOutput := flag.String("report-output", "", "JSON report output path")
	timeout := flag.Duration("timeout", 10*time.Minute, "command timeout")
	flag.Parse()

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
	if sqlDB, dbErr := db.DB(); dbErr == nil {
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

	var items []domain.CatalogItem
	if err := db.WithContext(ctx).
		Where("status <> ?", "deleted").
		Order("created_at ASC, id ASC").
		Find(&items).Error; err != nil {
		log.Fatalf("读取校园菜品失败: %v", err)
	}
	report := cleanupReport{
		GeneratedAt: time.Now(), DatabaseTarget: target, Apply: *apply,
		Candidates: []cleanupItem{}, Failures: []cleanupFailure{},
	}
	for _, item := range items {
		if !isZeroNutritionWaterName(item.Name) {
			continue
		}
		report.Candidates = append(report.Candidates, cleanupItem{
			ItemID: item.ID, Name: item.Name, EntryType: item.EntryType, Status: item.Status,
		})
	}
	report.CandidateCount = len(report.Candidates)
	if *apply {
		repo := catalogrepo.NewCatalogRepo(db)
		for _, item := range report.Candidates {
			if err := repo.SoftDeleteItem(ctx, item.ItemID); err != nil {
				report.Failures = append(report.Failures, cleanupFailure{ItemID: item.ItemID, Name: item.Name, Error: err.Error()})
				continue
			}
			report.DeletedCount++
		}
	}
	sort.Slice(report.Failures, func(i, j int) bool { return report.Failures[i].ItemID < report.Failures[j].ItemID })
	report.FailedCount = len(report.Failures)
	if err := writeReport(*reportOutput, report); err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	log.Printf("零营养饮用水清理完成: target=%s apply=%t candidates=%d deleted=%d failed=%d",
		target, *apply, report.CandidateCount, report.DeletedCount, report.FailedCount)
}

func isZeroNutritionWaterName(value string) bool {
	name := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), ""))
	if name == "" {
		return false
	}
	for _, marker := range []string{"矿泉水", "纯净水", "饮用水", "饮用天然水", "天然矿泉水"} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	switch name {
	case "水", "白开水", "百岁山", "怡宝", "景田", "恒大冰泉", "农夫山泉", "三得利":
		return true
	default:
		return false
	}
}

func writeReport(path string, report cleanupReport) error {
	if strings.TrimSpace(path) == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("campus-catalog-delete-water-%s.json", time.Now().Format("20060102-150405")))
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
