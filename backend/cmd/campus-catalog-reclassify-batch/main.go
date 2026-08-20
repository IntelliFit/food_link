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
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type itemSummary struct {
	ItemID       string `json:"item_id" gorm:"column:item_id"`
	Name         string `json:"name" gorm:"column:name"`
	CatalogState string `json:"catalog_status" gorm:"column:catalog_status"`
	PublicType   string `json:"public_type" gorm:"column:public_type"`
	CampusLabel  bool   `json:"is_campus_food" gorm:"column:is_campus_food"`
}

type reclassifyReport struct {
	GeneratedAt    time.Time     `json:"generated_at"`
	DatabaseTarget string        `json:"database_target"`
	BatchID        string        `json:"batch_id"`
	BatchName      string        `json:"batch_name"`
	VenueType      string        `json:"venue_type"`
	Apply          bool          `json:"apply"`
	CandidateCount int           `json:"candidate_count"`
	Candidates     []itemSummary `json:"candidates"`
	UpdatedCount   int64         `json:"updated_count"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	batchID := flag.String("batch-id", "", "collection batch id to reclassify")
	expectedVenue := flag.String("expected-venue", "office_park", "required venue type safety check")
	apply := flag.Bool("apply", false, "remove campus labels from the non-university batch public items")
	confirmDB := flag.String("confirm-db", "", "required for --apply; must equal host/database/schema")
	reportOutput := flag.String("report-output", "", "JSON report output path")
	timeout := flag.Duration("timeout", 10*time.Minute, "command timeout")
	flag.Parse()

	if strings.TrimSpace(*batchID) == "" {
		log.Fatal("--batch-id 不能为空")
	}
	if strings.TrimSpace(*expectedVenue) == "" || strings.TrimSpace(*expectedVenue) == "university" {
		log.Fatal("--expected-venue 必须是非高校场所类型")
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

	batch, candidates, err := auditBatch(ctx, db, strings.TrimSpace(*batchID), strings.TrimSpace(*expectedVenue))
	if err != nil {
		log.Fatalf("审计采集批次失败: %v", err)
	}
	report := reclassifyReport{
		GeneratedAt: time.Now(), DatabaseTarget: target, BatchID: batch.ID, BatchName: batch.BatchName,
		VenueType: batch.VenueType, Apply: *apply, CandidateCount: len(candidates), Candidates: candidates,
	}
	if *apply && len(candidates) > 0 {
		report.UpdatedCount, err = reclassifyBatch(ctx, db, candidates, time.Now())
		if err != nil {
			log.Fatalf("重分类采集批次失败: %v", err)
		}
	}
	if err := writeReport(*reportOutput, report); err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	log.Printf("非高校食堂批次重分类完成: target=%s batch=%s venue=%s apply=%t candidates=%d updated=%d",
		target, batch.ID, batch.VenueType, *apply, len(candidates), report.UpdatedCount)
}

func auditBatch(ctx context.Context, db *gorm.DB, batchID, expectedVenue string) (domain.CollectionBatch, []itemSummary, error) {
	var batch domain.CollectionBatch
	if err := db.WithContext(ctx).First(&batch, "id = ?", strings.TrimSpace(batchID)).Error; err != nil {
		return domain.CollectionBatch{}, nil, err
	}
	if strings.TrimSpace(batch.VenueType) != strings.TrimSpace(expectedVenue) {
		return domain.CollectionBatch{}, nil, fmt.Errorf("batch venue_type is %q, expected %q", batch.VenueType, expectedVenue)
	}
	var items []itemSummary
	err := db.WithContext(ctx).
		Table("campus_food_catalog_items AS i").
		Select("i.id AS item_id, i.name, i.status AS catalog_status, p.type AS public_type, p.is_campus_food").
		Joins("JOIN public_food_library AS p ON p.id = i.id AND p.status = ?", "published").
		Where("i.batch_id = ? AND i.status <> ?", batch.ID, "deleted").
		Where("COALESCE(p.type, '') = ? OR COALESCE(p.is_campus_food, false) = ?", "campus", true).
		Order("i.created_at ASC, i.id ASC").
		Scan(&items).Error
	return batch, items, err
}

func reclassifyBatch(ctx context.Context, db *gorm.DB, candidates []itemSummary, updatedAt time.Time) (int64, error) {
	ids := make([]string, 0, len(candidates))
	for _, item := range candidates {
		if id := strings.TrimSpace(item.ItemID); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result := db.WithContext(ctx).Table("public_food_library").
		Where("id IN ? AND status = ?", ids, "published").
		Updates(map[string]any{
			"type": "common", "is_campus_food": false,
			"school_id": nil, "campus_id": nil, "canteen_id": nil, "window_id": nil,
			"school_name": "", "campus_name": "", "canteen_name": "", "floor": "", "window_name": "",
			"campus_location_text": "", "updated_at": updatedAt,
		})
	return result.RowsAffected, result.Error
}

func writeReport(path string, report reclassifyReport) error {
	if strings.TrimSpace(path) == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("campus-catalog-reclassify-batch-%s.json", time.Now().Format("20060102-150405")))
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
