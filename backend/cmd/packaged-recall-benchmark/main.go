package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

const defaultPackagedBenchmarkCSVRelPath = "data/packaged_recall_benchmark.csv"

type benchmarkRecord struct {
	Line                    int
	Query                   string
	ExpectedBehavior        string
	ExpectedBrand           string
	ExpectedProductContains string
	ExpectedNetWeightG      float64
	ExpectedNetContentValue float64
	ExpectedNetContentUnit  string
	InputBrand              string
	InputSpecText           string
	InputFlavorText         string
	InputBarcode            string
	Category                string
	Comment                 string
}

type packagedRef struct {
	ID               string  `json:"id"`
	Brand            string  `json:"brand,omitempty"`
	ProductName      string  `json:"product_name"`
	DisplayName      string  `json:"display_name,omitempty"`
	ProductFamilyKey string  `json:"product_family_key,omitempty"`
	SpecText         string  `json:"spec_text,omitempty"`
	FlavorText       string  `json:"flavor_text,omitempty"`
	Barcode          string  `json:"barcode,omitempty"`
	NetWeightG       float64 `json:"net_weight_g,omitempty"`
	NetContentValue  float64 `json:"net_content_value,omitempty"`
	NetContentUnit   string  `json:"net_content_unit,omitempty"`
	KcalPer100g      float64 `json:"kcal_per_100g,omitempty"`
	IsActive         bool    `json:"is_active"`
	ReviewStatus     string  `json:"review_status,omitempty"`
}

type resolveOutput struct {
	Food        *packagedRef `json:"food,omitempty"`
	Status      string       `json:"status"`
	MatchSource string       `json:"match_source,omitempty"`
	Score       float64      `json:"score"`
}

type benchmarkStore interface {
	FindExpectedFoods(ctx context.Context, record benchmarkRecord) ([]packagedRef, error)
	ResolvePackagedFood(ctx context.Context, record benchmarkRecord) (*resolveOutput, error)
	SearchPackagedFood(ctx context.Context, query string, limit int) ([]packagedRef, error)
}

type benchmarkReport struct {
	GeneratedAt string                      `json:"generated_at"`
	InputPath   string                      `json:"input_path"`
	TopK        int                         `json:"top_k"`
	Database    map[string]string           `json:"database,omitempty"`
	Summary     benchmarkSummary            `json:"summary"`
	Categories  map[string]benchmarkSummary `json:"categories"`
	Rows        []benchmarkRow              `json:"rows"`
}

type benchmarkSummary struct {
	Total                    int     `json:"total"`
	MatchGold                int     `json:"match_gold"`
	NoMatchGold              int     `json:"no_match_gold"`
	InvalidGold              int     `json:"invalid_gold"`
	Passed                   int     `json:"passed"`
	MatchPassed              int     `json:"match_passed"`
	TrueNoMatch              int     `json:"true_no_match"`
	BarcodeHit               int     `json:"barcode_hit"`
	ProductKeyHit            int     `json:"product_key_hit"`
	ExactAliasHit            int     `json:"exact_alias_hit"`
	ExactProductHit          int     `json:"exact_product_hit"`
	FuzzyTop1Hit             int     `json:"fuzzy_top1_hit"`
	Unresolved               int     `json:"unresolved"`
	WrongMatch               int     `json:"wrong_match"`
	FalsePositive            int     `json:"false_positive"`
	NearMiss                 int     `json:"near_miss"`
	SameProductWrongSpec     int     `json:"same_product_wrong_spec"`
	Top3Covered              int     `json:"top3_covered"`
	Top5Covered              int     `json:"top5_covered"`
	Top10Covered             int     `json:"top10_covered"`
	Top1Accuracy             float64 `json:"top1_accuracy"`
	Top3Recall               float64 `json:"top3_recall"`
	Top5Recall               float64 `json:"top5_recall"`
	Top10Recall              float64 `json:"top10_recall"`
	NoMatchPassRate          float64 `json:"no_match_pass_rate"`
	WrongMatchRate           float64 `json:"wrong_match_rate"`
	FalsePositiveRate        float64 `json:"false_positive_rate"`
	NearMissRate             float64 `json:"near_miss_rate"`
	SameProductWrongSpecRate float64 `json:"same_product_wrong_spec_rate"`
}

type benchmarkRow struct {
	Line                    int                  `json:"line"`
	Query                   string               `json:"query"`
	ExpectedBehavior        string               `json:"expected_behavior"`
	ExpectedBrand           string               `json:"expected_brand,omitempty"`
	ExpectedProductContains string               `json:"expected_product_contains,omitempty"`
	ExpectedNetWeightG      float64              `json:"expected_net_weight_g,omitempty"`
	ExpectedNetContentValue float64              `json:"expected_net_content_value,omitempty"`
	ExpectedNetContentUnit  string               `json:"expected_net_content_unit,omitempty"`
	ExpectedFoodID          string               `json:"expected_food_id,omitempty"`
	ExpectedDisplayName     string               `json:"expected_display_name,omitempty"`
	Category                string               `json:"category,omitempty"`
	Comment                 string               `json:"comment,omitempty"`
	ActualFoodID            string               `json:"actual_food_id,omitempty"`
	ActualDisplayName       string               `json:"actual_display_name,omitempty"`
	ActualBrand             string               `json:"actual_brand,omitempty"`
	ActualNetWeightG        float64              `json:"actual_net_weight_g,omitempty"`
	ActualNetContentValue   float64              `json:"actual_net_content_value,omitempty"`
	ActualNetContentUnit    string               `json:"actual_net_content_unit,omitempty"`
	ResolveStatus           string               `json:"resolve_status,omitempty"`
	MatchSource             string               `json:"match_source,omitempty"`
	Score                   float64              `json:"score,omitempty"`
	Pass                    bool                 `json:"pass"`
	ValidGold               bool                 `json:"valid_gold"`
	FailReason              string               `json:"fail_reason,omitempty"`
	ExpectedCandidateRank   int                  `json:"expected_candidate_rank,omitempty"`
	Top3Covered             bool                 `json:"top3_covered"`
	Top5Covered             bool                 `json:"top5_covered"`
	Top10Covered            bool                 `json:"top10_covered"`
	NearMiss                bool                 `json:"near_miss"`
	FalsePositive           bool                 `json:"false_positive"`
	SameProductWrongSpec    bool                 `json:"same_product_wrong_spec"`
	Candidates              []benchmarkCandidate `json:"candidates"`
}

type benchmarkCandidate struct {
	Rank            int     `json:"rank"`
	FoodID          string  `json:"food_id"`
	DisplayName     string  `json:"display_name"`
	Brand           string  `json:"brand,omitempty"`
	NetWeightG      float64 `json:"net_weight_g,omitempty"`
	NetContentValue float64 `json:"net_content_value,omitempty"`
	NetContentUnit  string  `json:"net_content_unit,omitempty"`
	IsExpected      bool    `json:"is_expected"`
}

type gormBenchmarkStore struct {
	db   *gorm.DB
	repo *foodrecordrepo.FoodNutritionRepo
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	inputPath := flag.String("input", resolveDefaultCSVPath(), "benchmark gold CSV path")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON, CSV, and Markdown reports")
	topK := flag.Int("top-k", 10, "candidate count for SearchPackagedFood")
	timeout := flag.Duration("timeout", 2*time.Minute, "command timeout")
	flag.Parse()

	if *topK <= 0 {
		log.Fatalf("--top-k must be positive")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()
	if err := setSearchPath(ctx, db, cfg.Database.Schema); err != nil {
		log.Fatalf("设置 search_path 失败: %v", err)
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}

	records, err := readBenchmarkCSV(*inputPath)
	if err != nil {
		log.Fatalf("读取 benchmark CSV 失败: %v", err)
	}
	store := gormBenchmarkStore{db: db, repo: foodrecordrepo.NewFoodNutritionRepo(db)}
	report, err := runBenchmark(ctx, store, records, *topK)
	if err != nil {
		log.Fatalf("运行 benchmark 失败: %v", err)
	}
	report.InputPath = *inputPath
	report.Database = map[string]string{
		"config_dir": resolvedDir,
		"host":       maskHost(cfg.Database.Host),
		"database":   cfg.Database.Name,
		"schema":     normalizeSchema(cfg.Database.Schema),
	}
	jsonPath, csvPath, mdPath, err := writeBenchmarkReports(*outputDir, report)
	if err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	fmt.Printf("packaged recall benchmark total=%d match_gold=%d no_match_gold=%d invalid_gold=%d top1_accuracy=%.4f top10_recall=%.4f no_match_pass_rate=%.4f wrong_match=%d false_positive=%d near_miss=%d same_product_wrong_spec=%d reports=%s,%s,%s\n",
		report.Summary.Total,
		report.Summary.MatchGold,
		report.Summary.NoMatchGold,
		report.Summary.InvalidGold,
		report.Summary.Top1Accuracy,
		report.Summary.Top10Recall,
		report.Summary.NoMatchPassRate,
		report.Summary.WrongMatch,
		report.Summary.FalsePositive,
		report.Summary.NearMiss,
		report.Summary.SameProductWrongSpec,
		jsonPath,
		csvPath,
		mdPath,
	)
}

func runBenchmark(ctx context.Context, store benchmarkStore, records []benchmarkRecord, topK int) (benchmarkReport, error) {
	report := benchmarkReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		TopK:        topK,
		Categories:  map[string]benchmarkSummary{},
		Rows:        make([]benchmarkRow, 0, len(records)),
	}
	for _, record := range records {
		row, err := evaluateRecord(ctx, store, record, topK)
		if err != nil {
			return report, err
		}
		report.Rows = append(report.Rows, row)
		addRowToSummary(&report.Summary, row)
		category := strings.TrimSpace(record.Category)
		if category == "" {
			category = "uncategorized"
		}
		summary := report.Categories[category]
		addRowToSummary(&summary, row)
		report.Categories[category] = summary
	}
	finalizeSummary(&report.Summary)
	for category, summary := range report.Categories {
		finalizeSummary(&summary)
		report.Categories[category] = summary
	}
	return report, nil
}

func evaluateRecord(ctx context.Context, store benchmarkStore, record benchmarkRecord, topK int) (benchmarkRow, error) {
	row := benchmarkRow{
		Line:                    record.Line,
		Query:                   strings.TrimSpace(record.Query),
		ExpectedBehavior:        normalizeExpectedBehavior(record.ExpectedBehavior),
		ExpectedBrand:           strings.TrimSpace(record.ExpectedBrand),
		ExpectedProductContains: strings.TrimSpace(record.ExpectedProductContains),
		ExpectedNetWeightG:      record.ExpectedNetWeightG,
		ExpectedNetContentValue: record.ExpectedNetContentValue,
		ExpectedNetContentUnit:  strings.TrimSpace(record.ExpectedNetContentUnit),
		Category:                strings.TrimSpace(record.Category),
		Comment:                 strings.TrimSpace(record.Comment),
	}
	if row.Query == "" {
		row.FailReason = "empty_query"
		return row, nil
	}
	var expected *packagedRef
	if row.ExpectedBehavior == "match" {
		expectedFoods, err := store.FindExpectedFoods(ctx, record)
		if err != nil {
			return row, err
		}
		activeExpected := make([]packagedRef, 0, len(expectedFoods))
		for _, food := range expectedFoods {
			if food.IsActive && normalizedReviewStatus(food.ReviewStatus) == "active" {
				activeExpected = append(activeExpected, food)
			}
		}
		if len(activeExpected) == 0 {
			row.FailReason = "invalid_gold_not_found_or_inactive"
			return row, nil
		}
		if len(activeExpected) > 1 {
			row.FailReason = "invalid_gold_ambiguous"
			row.Candidates = buildCandidateRows(activeExpected[:minInt(len(activeExpected), topK)], "")
			return row, nil
		}
		row.ValidGold = true
		expected = &activeExpected[0]
		row.ExpectedFoodID = expected.ID
		row.ExpectedDisplayName = packagedDisplayName(*expected)
	} else {
		row.ValidGold = true
	}

	resolved, err := store.ResolvePackagedFood(ctx, record)
	if err != nil {
		return row, err
	}
	if resolved != nil {
		row.ResolveStatus = resolved.Status
		row.MatchSource = resolved.MatchSource
		row.Score = round4(resolved.Score)
		if resolved.Food != nil {
			fillActual(&row, *resolved.Food)
		}
	}

	candidates, err := store.SearchPackagedFood(ctx, row.Query, topK)
	if err != nil {
		return row, err
	}
	expectedID := ""
	if expected != nil {
		expectedID = expected.ID
	}
	row.Candidates = buildCandidateRows(candidates, expectedID)
	row.ExpectedCandidateRank = expectedCandidateRank(row.Candidates)
	row.Top3Covered = topNCovered(row, 3)
	row.Top5Covered = topNCovered(row, 5)
	row.Top10Covered = topNCovered(row, 10)

	if row.ExpectedBehavior == "no_match" {
		row.Pass = row.ActualFoodID == ""
		if row.Pass {
			row.FailReason = "true_no_match"
		} else {
			row.FailReason = "false_positive"
			row.FalsePositive = true
		}
		return row, nil
	}

	row.Pass = expected != nil && row.ActualFoodID == expected.ID
	if row.Pass {
		row.FailReason = passReason(row.ResolveStatus)
		return row, nil
	}
	if row.ActualFoodID == "" {
		row.FailReason = "unresolved"
		return row, nil
	}
	row.FailReason = "wrong_match"
	if row.ExpectedCandidateRank > 0 {
		row.NearMiss = true
	}
	if expected != nil && samePackagedProductRef(*expected, packagedRef{
		ID:              row.ActualFoodID,
		Brand:           row.ActualBrand,
		DisplayName:     row.ActualDisplayName,
		NetWeightG:      row.ActualNetWeightG,
		NetContentValue: row.ActualNetContentValue,
		NetContentUnit:  row.ActualNetContentUnit,
	}) {
		row.SameProductWrongSpec = true
		row.FailReason = "same_product_wrong_spec"
	}
	return row, nil
}

func addRowToSummary(summary *benchmarkSummary, row benchmarkRow) {
	summary.Total++
	if !row.ValidGold {
		summary.InvalidGold++
		return
	}
	if row.ExpectedBehavior == "no_match" {
		summary.NoMatchGold++
		if row.Pass {
			summary.Passed++
			summary.TrueNoMatch++
		} else if row.FalsePositive {
			summary.FalsePositive++
		}
		return
	}
	summary.MatchGold++
	if row.Pass {
		summary.Passed++
		summary.MatchPassed++
		switch row.ResolveStatus {
		case "barcode":
			summary.BarcodeHit++
		case "product_key":
			summary.ProductKeyHit++
		case "exact_alias":
			summary.ExactAliasHit++
		case "exact_canonical":
			summary.ExactProductHit++
		case "fuzzy":
			summary.FuzzyTop1Hit++
		}
	} else if row.ActualFoodID == "" {
		summary.Unresolved++
	} else {
		summary.WrongMatch++
	}
	if row.NearMiss {
		summary.NearMiss++
	}
	if row.SameProductWrongSpec {
		summary.SameProductWrongSpec++
	}
	if row.Top3Covered {
		summary.Top3Covered++
	}
	if row.Top5Covered {
		summary.Top5Covered++
	}
	if row.Top10Covered {
		summary.Top10Covered++
	}
}

func finalizeSummary(summary *benchmarkSummary) {
	matchDenominator := float64(summary.MatchGold)
	if matchDenominator > 0 {
		summary.Top1Accuracy = round4(float64(summary.MatchPassed) / matchDenominator)
		summary.Top3Recall = round4(float64(summary.Top3Covered) / matchDenominator)
		summary.Top5Recall = round4(float64(summary.Top5Covered) / matchDenominator)
		summary.Top10Recall = round4(float64(summary.Top10Covered) / matchDenominator)
		summary.WrongMatchRate = round4(float64(summary.WrongMatch) / matchDenominator)
		summary.NearMissRate = round4(float64(summary.NearMiss) / matchDenominator)
		summary.SameProductWrongSpecRate = round4(float64(summary.SameProductWrongSpec) / matchDenominator)
	}
	if summary.NoMatchGold > 0 {
		summary.NoMatchPassRate = round4(float64(summary.TrueNoMatch) / float64(summary.NoMatchGold))
		summary.FalsePositiveRate = round4(float64(summary.FalsePositive) / float64(summary.NoMatchGold))
	}
}

func (s gormBenchmarkStore) FindExpectedFoods(ctx context.Context, record benchmarkRecord) ([]packagedRef, error) {
	query := s.db.WithContext(ctx).
		Where("is_active = ? AND COALESCE(NULLIF(review_status, ''), 'active') = ?", true, "active")
	if strings.TrimSpace(record.ExpectedBrand) != "" {
		query = query.Where("LOWER(COALESCE(brand, '')) LIKE ?", "%"+strings.ToLower(strings.TrimSpace(record.ExpectedBrand))+"%")
	}
	if strings.TrimSpace(record.ExpectedProductContains) != "" {
		pattern := "%" + strings.ToLower(strings.TrimSpace(record.ExpectedProductContains)) + "%"
		query = query.Where("(LOWER(product_name) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ? OR LOWER(COALESCE(search_text, '')) LIKE ? OR LOWER(COALESCE(ocr_raw_text, '')) LIKE ?)", pattern, pattern, pattern, pattern)
	}
	if record.ExpectedNetWeightG > 0 {
		query = query.Where("ABS(COALESCE(net_weight_g, 0) - ?) <= ?", record.ExpectedNetWeightG, 0.5)
	}
	if record.ExpectedNetContentValue > 0 {
		query = query.Where("ABS(COALESCE(net_content_value, 0) - ?) <= ?", record.ExpectedNetContentValue, 0.5)
	}
	if strings.TrimSpace(record.ExpectedNetContentUnit) != "" {
		query = query.Where("LOWER(COALESCE(net_content_unit, '')) = ?", strings.ToLower(strings.TrimSpace(record.ExpectedNetContentUnit)))
	}
	var foods []domain.PackagedFood
	if err := query.Order("updated_at DESC").Limit(20).Find(&foods).Error; err != nil {
		return nil, err
	}
	return packagedRefsFromDomain(foods), nil
}

func (s gormBenchmarkStore) ResolvePackagedFood(ctx context.Context, record benchmarkRecord) (*resolveOutput, error) {
	resolved, err := s.repo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
		Name:       strings.TrimSpace(record.Query),
		Brand:      strings.TrimSpace(record.InputBrand),
		SpecText:   strings.TrimSpace(record.InputSpecText),
		FlavorText: strings.TrimSpace(record.InputFlavorText),
		Barcode:    strings.TrimSpace(record.InputBarcode),
	})
	if err != nil {
		return nil, err
	}
	out := &resolveOutput{}
	if resolved != nil {
		out.Status = resolved.Status
		out.MatchSource = resolved.MatchSource
		out.Score = resolved.Score
		if resolved.Food != nil {
			food := packagedRefFromDomain(*resolved.Food)
			out.Food = &food
		}
	}
	return out, nil
}

func (s gormBenchmarkStore) SearchPackagedFood(ctx context.Context, query string, limit int) ([]packagedRef, error) {
	foods, err := s.repo.SearchPackagedFood(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	return packagedRefsFromDomain(foods), nil
}

func readBenchmarkCSV(path string) ([]benchmarkRecord, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errors.New("CSV is empty")
	}
	header := map[string]int{}
	for i, name := range rows[0] {
		header[strings.TrimSpace(name)] = i
	}
	required := []string{"query", "expected_behavior", "expected_brand", "expected_product_contains", "category", "comment"}
	for _, name := range required {
		if _, ok := header[name]; !ok {
			return nil, fmt.Errorf("CSV header must contain %s", name)
		}
	}
	records := make([]benchmarkRecord, 0, len(rows)-1)
	for i, row := range rows[1:] {
		if rowEmpty(row) {
			continue
		}
		record := benchmarkRecord{
			Line:                    i + 2,
			Query:                   csvValue(row, header["query"]),
			ExpectedBehavior:        csvValue(row, header["expected_behavior"]),
			ExpectedBrand:           csvValue(row, header["expected_brand"]),
			ExpectedProductContains: csvValue(row, header["expected_product_contains"]),
			ExpectedNetWeightG:      parseFloat(csvValueByName(row, header, "expected_net_weight_g")),
			ExpectedNetContentValue: parseFloat(csvValueByName(row, header, "expected_net_content_value")),
			ExpectedNetContentUnit:  csvValueByName(row, header, "expected_net_content_unit"),
			InputBrand:              csvValueByName(row, header, "input_brand"),
			InputSpecText:           csvValueByName(row, header, "input_spec_text"),
			InputFlavorText:         csvValueByName(row, header, "input_flavor_text"),
			InputBarcode:            csvValueByName(row, header, "input_barcode"),
			Category:                csvValue(row, header["category"]),
			Comment:                 csvValue(row, header["comment"]),
		}
		records = append(records, record)
	}
	return records, nil
}

func writeBenchmarkReports(outputDir string, report benchmarkReport) (string, string, string, error) {
	if strings.TrimSpace(outputDir) == "" {
		outputDir = resolveDefaultOutputDir()
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", "", "", err
	}
	timestamp := time.Now().Format("20060102_150405")
	jsonPath := filepath.Join(outputDir, "packaged_recall_benchmark_"+timestamp+".json")
	csvPath := filepath.Join(outputDir, "packaged_recall_benchmark_"+timestamp+".csv")
	mdPath := filepath.Join(outputDir, "packaged_recall_benchmark_"+timestamp+".md")
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(jsonPath, append(payload, '\n'), 0o644); err != nil {
		return "", "", "", err
	}
	if err := writeCSVReport(csvPath, report.Rows); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(mdPath, []byte(buildMarkdownReport(report)), 0o644); err != nil {
		return "", "", "", err
	}
	return jsonPath, csvPath, mdPath, nil
}

func buildMarkdownReport(report benchmarkReport) string {
	var b strings.Builder
	b.WriteString("# 包装食物库召回 Benchmark 报告\n\n")
	b.WriteString(fmt.Sprintf("- 生成时间：`%s`\n", report.GeneratedAt))
	b.WriteString(fmt.Sprintf("- 金标文件：`%s`\n", report.InputPath))
	b.WriteString(fmt.Sprintf("- 候选数量：`%d`\n", report.TopK))
	if len(report.Database) > 0 {
		b.WriteString(fmt.Sprintf("- 数据库：`%s/%s`，schema `%s`\n", report.Database["host"], report.Database["database"], report.Database["schema"]))
	}
	b.WriteString("\n")
	writeMarkdownSummary(&b, report.Summary)
	writeMarkdownCategoryTable(&b, report.Categories)
	writeMarkdownActionPlan(&b, report.Summary)
	writeMarkdownExamples(&b, "金标不存在或不唯一（invalid_gold）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return !row.ValidGold
	}), 20)
	writeMarkdownExamples(&b, "未召回（unresolved）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.ValidGold && row.ExpectedBehavior == "match" && !row.Pass && row.ActualFoodID == ""
	}), 20)
	writeMarkdownExamples(&b, "错误命中（wrong_match）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.ValidGold && row.ExpectedBehavior == "match" && !row.Pass && row.ActualFoodID != "" && !row.SameProductWrongSpec
	}), 20)
	writeMarkdownExamples(&b, "同商品错规格（same_product_wrong_spec）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.SameProductWrongSpec
	}), 20)
	writeMarkdownExamples(&b, "近失误（near_miss）：正确 SKU 在候选里但第一名错", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.NearMiss
	}), 20)
	writeMarkdownExamples(&b, "普通泛称/普通餐饮被包装库误确认（false_positive）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.FalsePositive
	}), 20)
	b.WriteString("\n## 代表性说明\n\n")
	b.WriteString("- 这份报告只测包装库 repo 层的 `ResolvePackagedFood` 和 `SearchPackagedFood`，不调用 LLM，不写库，也不跑完整拍照识别。\n")
	b.WriteString("- 真实拍照主链路还有一层触发判断：没有品牌、条码、OCR、规格等包装证据的普通食物，通常不会进入包装库 resolver。\n")
	b.WriteString("- 包装库优化不能只看 top1；还要看 false_positive、同商品错规格和 near_miss，因为包装食品的主要风险是错 SKU/错规格/错用整包重量。\n")
	return b.String()
}

func writeMarkdownSummary(b *strings.Builder, s benchmarkSummary) {
	b.WriteString("## 总览\n\n")
	b.WriteString("| 中文指标 | 原始字段 | 数值 | 怎么理解 |\n")
	b.WriteString("|---|---|---:|---|\n")
	b.WriteString(fmt.Sprintf("| 总样本数 | total | %d | CSV 里一共有多少条测试输入 |\n", s.Total))
	b.WriteString(fmt.Sprintf("| 有效匹配金标 | match_gold | %d | 预期应命中某个 active SKU 的样本数 |\n", s.MatchGold))
	b.WriteString(fmt.Sprintf("| 有效不匹配金标 | no_match_gold | %d | 预期不应由包装库直接确认 SKU 的样本数 |\n", s.NoMatchGold))
	b.WriteString(fmt.Sprintf("| 无效金标 | invalid_gold | %d | 金标条件在库里找不到 active SKU，或找到多个 SKU，需先修金标/库口径 |\n", s.InvalidGold))
	b.WriteString(fmt.Sprintf("| 匹配 top1 准确率 | top1_accuracy | %.4f | 应命中 SKU 的样本里，最终返回正确 SKU 的比例 |\n", s.Top1Accuracy))
	b.WriteString(fmt.Sprintf("| 前 10 覆盖率 | top10_recall | %.4f | 正确 SKU 在前 10 候选里，或已经 top1 命中 |\n", s.Top10Recall))
	b.WriteString(fmt.Sprintf("| 不匹配通过率 | no_match_pass_rate | %.4f | 普通泛称/普通餐饮没有被包装库强行确认的比例 |\n", s.NoMatchPassRate))
	b.WriteString(fmt.Sprintf("| 未召回 | unresolved | %d | 应命中 SKU，但 resolver 没有返回任何包装食品 |\n", s.Unresolved))
	b.WriteString(fmt.Sprintf("| 错误命中 | wrong_match | %d | 返回了包装食品，但不是金标 SKU |\n", s.WrongMatch))
	b.WriteString(fmt.Sprintf("| 误确认 | false_positive | %d | 预期不应匹配的输入被包装库确认成某个 SKU |\n", s.FalsePositive))
	b.WriteString(fmt.Sprintf("| 近失误 | near_miss | %d | 正确 SKU 在候选里但 top1 错，适合做 rerank |\n", s.NearMiss))
	b.WriteString(fmt.Sprintf("| 同商品错规格 | same_product_wrong_spec | %d | 商品大体对，但规格/容量错，包装库高风险项 |\n", s.SameProductWrongSpec))
	b.WriteString("\n")
}

func writeMarkdownCategoryTable(b *strings.Builder, categories map[string]benchmarkSummary) {
	b.WriteString("## 按类别\n\n")
	b.WriteString("| 类别 | 匹配金标 | 不匹配金标 | 准确率 | Top10 覆盖 | 不匹配通过率 | 未召回 | 错误命中 | 误确认 | 同商品错规格 |\n")
	b.WriteString("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	names := make([]string, 0, len(categories))
	for name := range categories {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		s := categories[name]
		b.WriteString(fmt.Sprintf("| %s | %d | %d | %.4f | %.4f | %.4f | %d | %d | %d | %d |\n",
			name, s.MatchGold, s.NoMatchGold, s.Top1Accuracy, s.Top10Recall, s.NoMatchPassRate, s.Unresolved, s.WrongMatch, s.FalsePositive, s.SameProductWrongSpec))
	}
	b.WriteString("\n")
}

func writeMarkdownActionPlan(b *strings.Builder, s benchmarkSummary) {
	b.WriteString("## 优化建议\n\n")
	step := 1
	writeStep := func(format string, args ...any) {
		b.WriteString(fmt.Sprintf("%d. ", step))
		b.WriteString(fmt.Sprintf(format, args...))
		b.WriteString("\n")
		step++
	}
	if s.InvalidGold > 0 {
		writeStep("先复核 `%d` 条 `invalid_gold`：这不是算法错，通常是样本里的品牌/商品关键词/规格和当前 active 包装库不一致。", s.InvalidGold)
	}
	if s.FalsePositive > 0 {
		writeStep("优先降低 `%d` 条 `false_positive`：包装库不能把 `面包/酸奶/咖啡/饮料` 这类泛称直接确认成某个 SKU。建议 repo 层对泛称设置更高阈值，主链路继续要求品牌/OCR/规格证据。", s.FalsePositive)
	}
	if s.SameProductWrongSpec > 0 {
		writeStep("处理 `%d` 条同商品错规格：这是包装食品最大风险之一。建议继续强化 `product_family_key + net_content/spec`，没有强证据时进入候选确认，不直接用 top1 重量。", s.SameProductWrongSpec)
	}
	if s.NearMiss > 0 {
		writeStep("对 `%d` 条 near_miss 做 rerank：正确 SKU 已在候选里，优先用规格/容量/口味/品牌字段加权，不急着上 embedding。", s.NearMiss)
	}
	if s.Unresolved > 0 {
		writeStep("对 `%d` 条 unresolved 扩召回：优先补品牌词、产品线词、口味词和 `search_text/product_family_key`，谨慎新增 exact alias。", s.Unresolved)
	}
	if s.InvalidGold == 0 && s.FalsePositive == 0 && s.SameProductWrongSpec == 0 && s.NearMiss == 0 && s.Unresolved == 0 {
		writeStep("当前样本没有明显失败桶，下一步应扩大真实 OCR/query 样本，而不是继续调当前规则。")
	}
	b.WriteString("\n")
}

func writeMarkdownExamples(b *strings.Builder, title string, rows []benchmarkRow, limit int) {
	b.WriteString("## " + title + "\n\n")
	if len(rows) == 0 {
		b.WriteString("_无样例。_\n\n")
		return
	}
	if len(rows) > limit {
		rows = rows[:limit]
	}
	b.WriteString("| 输入 | 预期 | 实际返回 | 状态 | 金标候选排名 | 前几个候选 |\n")
	b.WriteString("|---|---|---|---|---:|---|\n")
	for _, row := range rows {
		expected := row.ExpectedDisplayName
		if expected == "" {
			expected = row.ExpectedBehavior
		}
		actual := row.ActualDisplayName
		if actual == "" {
			actual = "(unresolved)"
		}
		b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %d | %s |\n",
			mdCell(row.Query),
			mdCell(expected),
			mdCell(actual),
			mdCell(row.FailReason),
			row.ExpectedCandidateRank,
			mdCell(shortCandidateListText(row.Candidates, 5)),
		))
	}
	b.WriteString("\n")
}

func writeCSVReport(path string, rows []benchmarkRow) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	defer writer.Flush()
	if err := writer.Write([]string{
		"line", "query", "expected_behavior", "expected_display_name", "expected_food_id", "category",
		"actual_display_name", "actual_food_id", "resolve_status", "match_source", "score", "pass", "valid_gold",
		"fail_reason", "expected_candidate_rank", "top3_covered", "top5_covered", "top10_covered",
		"near_miss", "false_positive", "same_product_wrong_spec", "candidates", "comment",
	}); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write([]string{
			strconv.Itoa(row.Line),
			row.Query,
			row.ExpectedBehavior,
			row.ExpectedDisplayName,
			row.ExpectedFoodID,
			row.Category,
			row.ActualDisplayName,
			row.ActualFoodID,
			row.ResolveStatus,
			row.MatchSource,
			formatFloat(row.Score),
			strconv.FormatBool(row.Pass),
			strconv.FormatBool(row.ValidGold),
			row.FailReason,
			strconv.Itoa(row.ExpectedCandidateRank),
			strconv.FormatBool(row.Top3Covered),
			strconv.FormatBool(row.Top5Covered),
			strconv.FormatBool(row.Top10Covered),
			strconv.FormatBool(row.NearMiss),
			strconv.FormatBool(row.FalsePositive),
			strconv.FormatBool(row.SameProductWrongSpec),
			candidateListText(row.Candidates),
			row.Comment,
		}); err != nil {
			return err
		}
	}
	return writer.Error()
}

func fillActual(row *benchmarkRow, food packagedRef) {
	row.ActualFoodID = food.ID
	row.ActualDisplayName = packagedDisplayName(food)
	row.ActualBrand = food.Brand
	row.ActualNetWeightG = food.NetWeightG
	row.ActualNetContentValue = food.NetContentValue
	row.ActualNetContentUnit = food.NetContentUnit
}

func buildCandidateRows(candidates []packagedRef, expectedFoodID string) []benchmarkCandidate {
	out := make([]benchmarkCandidate, 0, len(candidates))
	for i, candidate := range candidates {
		out = append(out, benchmarkCandidate{
			Rank:            i + 1,
			FoodID:          candidate.ID,
			DisplayName:     packagedDisplayName(candidate),
			Brand:           candidate.Brand,
			NetWeightG:      candidate.NetWeightG,
			NetContentValue: candidate.NetContentValue,
			NetContentUnit:  candidate.NetContentUnit,
			IsExpected:      expectedFoodID != "" && candidate.ID == expectedFoodID,
		})
	}
	return out
}

func expectedCandidateRank(candidates []benchmarkCandidate) int {
	for _, candidate := range candidates {
		if candidate.IsExpected {
			return candidate.Rank
		}
	}
	return 0
}

func topNCovered(row benchmarkRow, n int) bool {
	if row.Pass && row.ExpectedBehavior == "match" {
		return true
	}
	return row.ExpectedCandidateRank > 0 && row.ExpectedCandidateRank <= n
}

func passReason(status string) string {
	switch status {
	case "barcode":
		return "barcode_hit"
	case "product_key":
		return "product_key_hit"
	case "exact_alias":
		return "exact_alias_hit"
	case "exact_canonical":
		return "exact_product_hit"
	case "fuzzy":
		return "fuzzy_top1_hit"
	default:
		return "top1_hit"
	}
}

func packagedRefsFromDomain(foods []domain.PackagedFood) []packagedRef {
	out := make([]packagedRef, 0, len(foods))
	for _, food := range foods {
		out = append(out, packagedRefFromDomain(food))
	}
	return out
}

func packagedRefFromDomain(food domain.PackagedFood) packagedRef {
	return packagedRef{
		ID:               strings.TrimSpace(food.ID),
		Brand:            strings.TrimSpace(food.Brand),
		ProductName:      strings.TrimSpace(food.ProductName),
		DisplayName:      strings.TrimSpace(food.DisplayName),
		ProductFamilyKey: strings.TrimSpace(food.ProductFamilyKey),
		SpecText:         stringPtr(food.SpecText),
		FlavorText:       stringPtr(food.FlavorText),
		Barcode:          stringPtr(food.Barcode),
		NetWeightG:       food.NetWeightG,
		NetContentValue:  food.NetContentValue,
		NetContentUnit:   stringPtr(food.NetContentUnit),
		KcalPer100g:      food.KcalPer100g,
		IsActive:         food.IsActive,
		ReviewStatus:     strings.TrimSpace(food.ReviewStatus),
	}
}

func packagedDisplayName(food packagedRef) string {
	if strings.TrimSpace(food.DisplayName) != "" {
		return strings.TrimSpace(food.DisplayName)
	}
	parts := nonEmptyStrings(food.Brand, food.ProductName, food.FlavorText, food.SpecText)
	if food.NetWeightG > 0 {
		parts = append(parts, fmt.Sprintf("%.0fg", food.NetWeightG))
	} else if food.NetContentValue > 0 && food.NetContentUnit != "" {
		parts = append(parts, fmt.Sprintf("%.0f%s", food.NetContentValue, food.NetContentUnit))
	}
	return strings.Join(parts, " ")
}

func samePackagedProductRef(a, b packagedRef) bool {
	if a.ID != "" && a.ID == b.ID {
		return true
	}
	familyA := normalizeFoodName(a.ProductFamilyKey)
	familyB := normalizeFoodName(b.ProductFamilyKey)
	if familyA != "" && familyA == familyB {
		return true
	}
	brandA := normalizeFoodName(a.Brand)
	brandB := normalizeFoodName(b.Brand)
	productA := normalizeFoodName(firstNonEmpty(a.ProductName, a.DisplayName))
	productB := normalizeFoodName(firstNonEmpty(b.ProductName, b.DisplayName))
	return brandA != "" && brandA == brandB && productA != "" && productA == productB
}

func normalizeExpectedBehavior(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "match", "hit":
		return "match"
	case "no_match", "nomatch", "negative", "unresolved":
		return "no_match"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func normalizedReviewStatus(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "active"
	}
	return value
}

func shortCandidateListText(candidates []benchmarkCandidate, limit int) string {
	if len(candidates) == 0 {
		return ""
	}
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	parts := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		part := fmt.Sprintf("%d.%s", candidate.Rank, candidate.DisplayName)
		if candidate.IsExpected {
			part += " *"
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, "; ")
}

func candidateListText(candidates []benchmarkCandidate) string {
	parts := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		part := fmt.Sprintf("%d:%s:%s", candidate.Rank, candidate.FoodID, candidate.DisplayName)
		if candidate.IsExpected {
			part += ":expected"
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, " | ")
}

func filterRows(rows []benchmarkRow, keep func(benchmarkRow) bool) []benchmarkRow {
	out := make([]benchmarkRow, 0)
	for _, row := range rows {
		if keep(row) {
			out = append(out, row)
		}
	}
	return out
}

func mdCell(value string) string {
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "|", "\\|")
	return value
}

func csvValue(row []string, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func csvValueByName(row []string, header map[string]int, name string) string {
	idx, ok := header[name]
	if !ok {
		return ""
	}
	return csvValue(row, idx)
}

func rowEmpty(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func parseFloat(value string) float64 {
	if strings.TrimSpace(value) == "" {
		return 0
	}
	n, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return n
}

func round4(value float64) float64 {
	return float64(int(value*10000+0.5)) / 10000
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 4, 64)
}

func normalizeFoodName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func resolveDefaultCSVPath() string {
	if _, err := os.Stat(defaultPackagedBenchmarkCSVRelPath); err == nil {
		return defaultPackagedBenchmarkCSVRelPath
	}
	rootPath := filepath.Join("backend", defaultPackagedBenchmarkCSVRelPath)
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath
	}
	return defaultPackagedBenchmarkCSVRelPath
}

func resolveDefaultOutputDir() string {
	if base, err := os.Getwd(); err == nil && filepath.Base(base) == "backend" {
		return filepath.Join("..", "tmp")
	}
	return "tmp"
}

func setSearchPath(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if schema == "public" {
		return nil
	}
	if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`).MatchString(schema) {
		return fmt.Errorf("invalid schema: %s", schema)
	}
	return db.WithContext(ctx).Exec("SET search_path TO " + schema).Error
}

func normalizeSchema(schema string) string {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		return "public"
	}
	return schema
}

func maskHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if len(host) <= 6 {
		return host
	}
	return host[:3] + "***" + host[len(host)-3:]
}

func loadConfig(configDir string) (*config.Config, string, error) {
	candidates := []string{configDir}
	if configDir == "." {
		candidates = append(candidates, "backend", filepath.Join("food_link", "backend"), filepath.Join("..", ".."))
	}
	var firstErr error
	for _, dir := range candidates {
		cfg, err := config.Load(dir)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if hasConfigFile(dir) || hasDatabaseConfig(cfg) {
			return cfg, dir, nil
		}
	}
	if firstErr != nil {
		return nil, "", firstErr
	}
	return nil, "", fmt.Errorf("config file not found and database env vars are incomplete")
}

func hasConfigFile(dir string) bool {
	for _, name := range []string{"app-config.yaml", "config.yaml", ".env"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func hasDatabaseConfig(cfg *config.Config) bool {
	return cfg != nil && cfg.Database.Host != "" && cfg.Database.Name != "" && cfg.Database.User != ""
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
