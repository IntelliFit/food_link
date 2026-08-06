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
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type auditReport struct {
	GeneratedAt           time.Time          `json:"generated_at"`
	DatabaseTarget        string             `json:"database_target"`
	Apply                 bool               `json:"apply"`
	TotalItems            int                `json:"total_items"`
	CandidateItems        int                `json:"candidate_items"`
	CandidateRate         float64            `json:"candidate_rate"`
	AppliedItems          int                `json:"applied_items"`
	StatusCounts          map[string]int     `json:"status_counts"`
	CompletenessCounts    map[string]int     `json:"completeness_counts"`
	PriceTypeCounts       map[string]int     `json:"price_type_counts"`
	PriceEvidenceCounts   map[string]int     `json:"price_evidence_counts"`
	PriceUnitCounts       map[string]int     `json:"price_unit_counts"`
	MissingFieldCounts    map[string]int     `json:"missing_field_counts"`
	CandidateStatusCounts map[string]int     `json:"candidate_status_counts"`
	ReasonCounts          map[string]int     `json:"reason_counts"`
	NormalizedUnitCounts  map[string]int     `json:"normalized_unit_counts"`
	AuditIssueCounts      map[string]int     `json:"audit_issue_counts"`
	AuditIssueItems       []priceIssueItem   `json:"audit_issue_items"`
	NutritionIssueCounts  map[string]int     `json:"nutrition_issue_counts"`
	NutritionIssueItems   []nutritionIssue   `json:"nutrition_issue_items"`
	Candidates            []cleanupCandidate `json:"candidates"`
}

type priceIssueItem struct {
	ItemID  string       `json:"item_id"`
	BatchID string       `json:"batch_id"`
	Name    string       `json:"name"`
	School  string       `json:"school"`
	Canteen string       `json:"canteen"`
	Issues  []string     `json:"issues"`
	Item    itemSnapshot `json:"item"`
}

type nutritionAuditRow struct {
	ItemID         string   `gorm:"column:item_id"`
	Name           string   `gorm:"column:name"`
	School         string   `gorm:"column:school"`
	Canteen        string   `gorm:"column:canteen"`
	PublicStatus   *string  `gorm:"column:public_status"`
	AnalysisTaskID *string  `gorm:"column:analysis_task_id"`
	TotalCalories  *float64 `gorm:"column:total_calories"`
	TotalProtein   *float64 `gorm:"column:total_protein"`
	TotalCarbs     *float64 `gorm:"column:total_carbs"`
	TotalFat       *float64 `gorm:"column:total_fat"`
}

type nutritionIssue struct {
	ItemID         string   `json:"item_id"`
	Name           string   `json:"name"`
	School         string   `json:"school"`
	Canteen        string   `json:"canteen"`
	Issues         []string `json:"issues"`
	PublicStatus   *string  `json:"public_status,omitempty"`
	AnalysisTaskID *string  `json:"analysis_task_id,omitempty"`
	TotalCalories  *float64 `json:"total_calories,omitempty"`
	TotalProtein   *float64 `json:"total_protein,omitempty"`
	TotalCarbs     *float64 `json:"total_carbs,omitempty"`
	TotalFat       *float64 `json:"total_fat,omitempty"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	apply := flag.Bool("apply", false, "apply safe deterministic cleanup patches")
	confirmDB := flag.String("confirm-db", "", "required for --apply; must equal host/database/schema")
	reportOutput := flag.String("report-output", "", "JSON audit report path")
	timeout := flag.Duration("timeout", 2*time.Minute, "audit and cleanup timeout")
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
	target := targetName(cfg.Database.Host, cfg.Database.Name, schema)
	if *apply && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}

	var items []domain.CatalogItem
	if err := db.WithContext(ctx).Where("status <> ?", "deleted").Order("created_at ASC, id ASC").Find(&items).Error; err != nil {
		log.Fatalf("读取校园菜品失败: %v", err)
	}
	report := auditReport{
		GeneratedAt: time.Now(), DatabaseTarget: target, Apply: *apply, TotalItems: len(items),
		StatusCounts: map[string]int{}, CompletenessCounts: map[string]int{}, PriceTypeCounts: map[string]int{},
		PriceEvidenceCounts: map[string]int{}, PriceUnitCounts: map[string]int{}, MissingFieldCounts: map[string]int{},
		CandidateStatusCounts: map[string]int{}, ReasonCounts: map[string]int{}, NormalizedUnitCounts: map[string]int{},
		AuditIssueCounts: map[string]int{}, AuditIssueItems: make([]priceIssueItem, 0),
		NutritionIssueCounts: map[string]int{}, NutritionIssueItems: make([]nutritionIssue, 0), Candidates: make([]cleanupCandidate, 0),
	}
	updates := make([]domain.CatalogItem, 0)
	for _, item := range items {
		report.StatusCounts[item.Status]++
		report.CompletenessCounts[item.CompletenessStatus]++
		report.PriceTypeCounts[item.PriceType]++
		report.PriceEvidenceCounts[priceEvidenceKind(item)]++
		report.PriceUnitCounts[normalizedCountKey(item.PriceUnit, "（空）")]++
		for _, missing := range item.MissingFields {
			report.MissingFieldCounts[normalizedCountKey(missing, "（空）")]++
		}
		if issues := auditPriceIssues(item); len(issues) > 0 {
			for _, issue := range issues {
				report.AuditIssueCounts[issue]++
			}
			report.AuditIssueItems = append(report.AuditIssueItems, priceIssueItem{
				ItemID: item.ID, BatchID: item.BatchID, Name: item.Name, School: item.OrganizationName,
				Canteen: item.CanteenName, Issues: issues, Item: snapshot(item),
			})
		}
		updated, candidate, ok := cleanCatalogPrice(item)
		if !ok {
			continue
		}
		updates = append(updates, updated)
		report.Candidates = append(report.Candidates, candidate)
		report.CandidateStatusCounts[item.Status]++
		for _, reason := range strings.Split(candidate.Reason, "；") {
			report.ReasonCounts[reason]++
		}
		if strings.Contains(candidate.Reason, "价格单位缺少货币标记") {
			report.NormalizedUnitCounts[candidate.NormalizedUnit]++
		}
	}
	report.CandidateItems = len(updates)
	if len(items) > 0 {
		report.CandidateRate = float64(len(updates)) / float64(len(items))
	}
	if err := auditPublishedNutrition(ctx, db, &report); err != nil {
		log.Fatalf("审计已上线校园菜品营养结果失败: %v", err)
	}

	if *apply && len(updates) > 0 {
		if err := applyUpdates(ctx, db, updates); err != nil {
			log.Fatalf("应用清理失败: %v", err)
		}
		report.AppliedItems = len(updates)
	}
	sort.Slice(report.Candidates, func(i, j int) bool {
		if report.Candidates[i].School != report.Candidates[j].School {
			return report.Candidates[i].School < report.Candidates[j].School
		}
		if report.Candidates[i].Canteen != report.Candidates[j].Canteen {
			return report.Candidates[i].Canteen < report.Candidates[j].Canteen
		}
		return report.Candidates[i].Name < report.Candidates[j].Name
	})
	sort.Slice(report.AuditIssueItems, func(i, j int) bool {
		if report.AuditIssueItems[i].School != report.AuditIssueItems[j].School {
			return report.AuditIssueItems[i].School < report.AuditIssueItems[j].School
		}
		if report.AuditIssueItems[i].Canteen != report.AuditIssueItems[j].Canteen {
			return report.AuditIssueItems[i].Canteen < report.AuditIssueItems[j].Canteen
		}
		return report.AuditIssueItems[i].Name < report.AuditIssueItems[j].Name
	})
	sort.Slice(report.NutritionIssueItems, func(i, j int) bool {
		if report.NutritionIssueItems[i].School != report.NutritionIssueItems[j].School {
			return report.NutritionIssueItems[i].School < report.NutritionIssueItems[j].School
		}
		if report.NutritionIssueItems[i].Canteen != report.NutritionIssueItems[j].Canteen {
			return report.NutritionIssueItems[i].Canteen < report.NutritionIssueItems[j].Canteen
		}
		return report.NutritionIssueItems[i].Name < report.NutritionIssueItems[j].Name
	})
	path := strings.TrimSpace(*reportOutput)
	if path == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("campus-catalog-price-cleanup-%s.json", time.Now().Format("20060102-150405")))
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		log.Fatalf("生成审计报告失败: %v", err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		log.Fatalf("写入审计报告失败: %v", err)
	}
	log.Printf("校园菜品价格/分量审计完成：总数=%d 单位规范化候选=%d 价格异常=%d 营养异常=%d 已应用=%d 报告=%s", report.TotalItems, report.CandidateItems, len(report.AuditIssueItems), len(report.NutritionIssueItems), report.AppliedItems, path)
	if !*apply {
		log.Printf("当前为只读预检；确认报告后使用 --apply --confirm-db=%q 执行", target)
	}
}

func auditPublishedNutrition(ctx context.Context, db *gorm.DB, report *auditReport) error {
	var rows []nutritionAuditRow
	if err := db.WithContext(ctx).Raw(`
		SELECT c.id AS item_id, c.name, c.organization_name AS school, c.canteen_name AS canteen,
		       p.status AS public_status, p.analysis_task_id, p.total_calories,
		       p.total_protein, p.total_carbs, p.total_fat
		FROM campus_food_catalog_items c
		LEFT JOIN public_food_library p ON p.id = c.id
		WHERE c.status = 'published'
		ORDER BY c.created_at ASC, c.id ASC
	`).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		issues := make([]string, 0, 3)
		if row.PublicStatus == nil || strings.TrimSpace(*row.PublicStatus) != "published" {
			issues = append(issues, "已上线目录缺少客户端发布记录")
		}
		if row.AnalysisTaskID == nil || strings.TrimSpace(*row.AnalysisTaskID) == "" {
			issues = append(issues, "已上线菜品缺少AI分析任务")
		}
		if row.TotalCalories == nil || *row.TotalCalories <= 0 {
			issues = append(issues, "已上线菜品缺少有效热量")
		}
		if len(issues) == 0 {
			continue
		}
		for _, issue := range issues {
			report.NutritionIssueCounts[issue]++
		}
		report.NutritionIssueItems = append(report.NutritionIssueItems, nutritionIssue{
			ItemID: row.ItemID, Name: row.Name, School: row.School, Canteen: row.Canteen,
			Issues: issues, PublicStatus: row.PublicStatus, AnalysisTaskID: row.AnalysisTaskID,
			TotalCalories: row.TotalCalories, TotalProtein: row.TotalProtein, TotalCarbs: row.TotalCarbs, TotalFat: row.TotalFat,
		})
	}
	return nil
}

func applyUpdates(ctx context.Context, db *gorm.DB, updates []domain.CatalogItem) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for index := range updates {
			item := &updates[index]
			now := time.Now()
			item.UpdatedAt = &now
			if err := tx.Model(&domain.CatalogItem{}).
				Where("id = ? AND status <> ?", item.ID, "deleted").
				Select("price_type", "price", "price_min", "price_max", "price_unit", "price_text", "portion_description", "missing_fields", "completeness_status", "status", "updated_at").
				Updates(item).Error; err != nil {
				return fmt.Errorf("更新条目 %s: %w", item.ID, err)
			}
		}
		return nil
	})
}

func priceEvidenceKind(item domain.CatalogItem) string {
	kinds := make([]string, 0, 3)
	if item.Price != nil || item.PriceMin != nil || item.PriceMax != nil {
		kinds = append(kinds, "numeric")
	}
	if strings.TrimSpace(item.PriceText) != "" {
		kinds = append(kinds, "text")
	}
	if len(item.PriceOptions) > 0 {
		kinds = append(kinds, "options")
	}
	if len(kinds) == 0 {
		return "none"
	}
	return strings.Join(kinds, "+")
}

func normalizedCountKey(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
