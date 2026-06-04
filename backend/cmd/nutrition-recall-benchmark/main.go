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

const defaultBenchmarkCSVRelPath = "data/nutrition_recall_benchmark.csv"

type benchmarkRecord struct {
	Line                  int    `json:"line"`
	Query                 string `json:"query"`
	ExpectedCanonicalName string `json:"expected_canonical_name"`
	Category              string `json:"category,omitempty"`
	Comment               string `json:"comment,omitempty"`
}

type foodRef struct {
	ID            string  `json:"id"`
	CanonicalName string  `json:"canonical_name"`
	KcalPer100g   float64 `json:"kcal_per_100g,omitempty"`
	IsActive      bool    `json:"is_active"`
}

type resolveOutput struct {
	Food        *foodRef `json:"food,omitempty"`
	Status      string   `json:"status"`
	MatchSource string   `json:"match_source,omitempty"`
	Score       float64  `json:"score"`
}

type candidateOutput struct {
	Food        foodRef `json:"food"`
	MatchSource string  `json:"match_source"`
	Score       float64 `json:"score"`
}

type benchmarkStore interface {
	FindExpectedFoods(ctx context.Context, canonical string) ([]foodRef, error)
	ResolveFood(ctx context.Context, query string) (*resolveOutput, error)
	SearchCandidates(ctx context.Context, query string, limit int) ([]candidateOutput, error)
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
	Total                 int     `json:"total"`
	ValidGold             int     `json:"valid_gold"`
	InvalidGold           int     `json:"invalid_gold"`
	Passed                int     `json:"passed"`
	ExactCanonicalHit     int     `json:"exact_canonical_hit"`
	ExactAliasHit         int     `json:"exact_alias_hit"`
	FuzzyTop1Hit          int     `json:"fuzzy_top1_hit"`
	Unresolved            int     `json:"unresolved"`
	WrongMatch            int     `json:"wrong_match"`
	WrongExactAlias       int     `json:"wrong_exact_alias"`
	ProcessedMismatch     int     `json:"processed_mismatch"`
	NearMiss              int     `json:"near_miss"`
	Top3Covered           int     `json:"top3_covered"`
	Top5Covered           int     `json:"top5_covered"`
	Top10Covered          int     `json:"top10_covered"`
	Top1Accuracy          float64 `json:"top1_accuracy"`
	Top3Recall            float64 `json:"top3_recall"`
	Top5Recall            float64 `json:"top5_recall"`
	Top10Recall           float64 `json:"top10_recall"`
	WrongMatchRate        float64 `json:"wrong_match_rate"`
	WrongExactAliasRate   float64 `json:"wrong_exact_alias_rate"`
	NearMissRate          float64 `json:"near_miss_rate"`
	ProcessedMismatchRate float64 `json:"processed_mismatch_rate"`
}

type benchmarkRow struct {
	Line                  int                  `json:"line"`
	Query                 string               `json:"query"`
	ExpectedCanonicalName string               `json:"expected_canonical_name"`
	ExpectedFoodID        string               `json:"expected_food_id,omitempty"`
	Category              string               `json:"category,omitempty"`
	Comment               string               `json:"comment,omitempty"`
	ActualCanonicalName   string               `json:"actual_canonical_name,omitempty"`
	ActualFoodID          string               `json:"actual_food_id,omitempty"`
	ResolveStatus         string               `json:"resolve_status,omitempty"`
	MatchSource           string               `json:"match_source,omitempty"`
	Score                 float64              `json:"score,omitempty"`
	Pass                  bool                 `json:"pass"`
	ValidGold             bool                 `json:"valid_gold"`
	FailReason            string               `json:"fail_reason,omitempty"`
	ExpectedCandidateRank int                  `json:"expected_candidate_rank,omitempty"`
	Top3Covered           bool                 `json:"top3_covered"`
	Top5Covered           bool                 `json:"top5_covered"`
	Top10Covered          bool                 `json:"top10_covered"`
	NearMiss              bool                 `json:"near_miss"`
	WrongExactAlias       bool                 `json:"wrong_exact_alias"`
	ProcessedMismatch     bool                 `json:"processed_mismatch"`
	Candidates            []benchmarkCandidate `json:"candidates"`
}

type benchmarkCandidate struct {
	Rank          int     `json:"rank"`
	FoodID        string  `json:"food_id"`
	CanonicalName string  `json:"canonical_name"`
	MatchSource   string  `json:"match_source"`
	Score         float64 `json:"score"`
	IsExpected    bool    `json:"is_expected"`
}

type gormBenchmarkStore struct {
	db   *gorm.DB
	repo *foodrecordrepo.FoodNutritionRepo
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	inputPath := flag.String("input", resolveDefaultCSVPath(), "benchmark gold CSV path")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON and CSV reports")
	topK := flag.Int("top-k", 10, "candidate count for SearchCandidates")
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
	fmt.Printf("nutrition recall benchmark total=%d valid_gold=%d invalid_gold=%d top1_accuracy=%.4f top3_recall=%.4f top5_recall=%.4f top10_recall=%.4f wrong_match=%d near_miss=%d wrong_exact_alias=%d reports=%s,%s,%s\n",
		report.Summary.Total,
		report.Summary.ValidGold,
		report.Summary.InvalidGold,
		report.Summary.Top1Accuracy,
		report.Summary.Top3Recall,
		report.Summary.Top5Recall,
		report.Summary.Top10Recall,
		report.Summary.WrongMatch,
		report.Summary.NearMiss,
		report.Summary.WrongExactAlias,
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
		Line:                  record.Line,
		Query:                 strings.TrimSpace(record.Query),
		ExpectedCanonicalName: strings.TrimSpace(record.ExpectedCanonicalName),
		Category:              strings.TrimSpace(record.Category),
		Comment:               strings.TrimSpace(record.Comment),
	}
	if row.Query == "" {
		row.FailReason = "empty_query"
		return row, nil
	}
	if row.ExpectedCanonicalName == "" {
		row.FailReason = "empty_expected_canonical"
		return row, nil
	}

	expectedFoods, err := store.FindExpectedFoods(ctx, row.ExpectedCanonicalName)
	if err != nil {
		return row, err
	}
	validExpected := make([]foodRef, 0, len(expectedFoods))
	for _, food := range expectedFoods {
		if food.IsActive && food.KcalPer100g > 0 {
			validExpected = append(validExpected, food)
		}
	}
	if len(validExpected) == 0 {
		row.FailReason = "invalid_gold_not_found_or_inactive"
		return row, nil
	}
	if len(validExpected) > 1 {
		row.FailReason = "invalid_gold_ambiguous"
		return row, nil
	}
	expected := validExpected[0]
	row.ValidGold = true
	row.ExpectedFoodID = expected.ID

	resolve, err := store.ResolveFood(ctx, row.Query)
	if err != nil {
		return row, err
	}
	if resolve != nil {
		row.ResolveStatus = resolve.Status
		row.MatchSource = resolve.MatchSource
		row.Score = round4(resolve.Score)
		if resolve.Food != nil {
			row.ActualFoodID = resolve.Food.ID
			row.ActualCanonicalName = resolve.Food.CanonicalName
		}
	}

	candidates, err := store.SearchCandidates(ctx, row.Query, topK)
	if err != nil {
		return row, err
	}
	row.Candidates = buildCandidateRows(candidates, expected.ID)
	row.ExpectedCandidateRank = expectedCandidateRank(row.Candidates)
	row.Pass = row.ActualFoodID == expected.ID
	row.Top3Covered = topNCovered(row, 3)
	row.Top5Covered = topNCovered(row, 5)
	row.Top10Covered = topNCovered(row, 10)

	row.ProcessedMismatch = isProcessedFoodMismatch(row.Query, row.ActualCanonicalName)
	if row.Pass {
		row.FailReason = passReason(row.ResolveStatus)
		return row, nil
	}
	if row.ActualFoodID == "" {
		row.FailReason = "unresolved"
		return row, nil
	}
	if row.ResolveStatus == "exact_alias" {
		row.WrongExactAlias = true
		row.FailReason = "wrong_exact_alias"
	} else {
		row.FailReason = "wrong_match"
	}
	if row.ExpectedCandidateRank > 0 {
		row.NearMiss = true
	}
	if row.ProcessedMismatch && row.FailReason == "wrong_match" {
		row.FailReason = "processed_food_mismatch"
	}
	return row, nil
}

func buildCandidateRows(candidates []candidateOutput, expectedFoodID string) []benchmarkCandidate {
	out := make([]benchmarkCandidate, 0, len(candidates))
	for i, candidate := range candidates {
		out = append(out, benchmarkCandidate{
			Rank:          i + 1,
			FoodID:        candidate.Food.ID,
			CanonicalName: candidate.Food.CanonicalName,
			MatchSource:   candidate.MatchSource,
			Score:         round4(candidate.Score),
			IsExpected:    expectedFoodID != "" && candidate.Food.ID == expectedFoodID,
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
	if row.Pass {
		return true
	}
	return row.ExpectedCandidateRank > 0 && row.ExpectedCandidateRank <= n
}

func passReason(status string) string {
	switch status {
	case "exact_canonical":
		return "exact_canonical_hit"
	case "exact_alias":
		return "exact_alias_hit"
	case "fuzzy":
		return "fuzzy_top1_hit"
	case "semantic_rerank":
		return "semantic_rerank_hit"
	default:
		return "top1_hit"
	}
}

func addRowToSummary(summary *benchmarkSummary, row benchmarkRow) {
	summary.Total++
	if !row.ValidGold {
		summary.InvalidGold++
		return
	}
	summary.ValidGold++
	if row.Pass {
		summary.Passed++
		switch row.ResolveStatus {
		case "exact_canonical":
			summary.ExactCanonicalHit++
		case "exact_alias":
			summary.ExactAliasHit++
		case "fuzzy":
			summary.FuzzyTop1Hit++
		}
	} else if row.ActualFoodID == "" {
		summary.Unresolved++
	} else {
		summary.WrongMatch++
	}
	if row.WrongExactAlias {
		summary.WrongExactAlias++
	}
	if row.ProcessedMismatch {
		summary.ProcessedMismatch++
	}
	if row.NearMiss {
		summary.NearMiss++
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
	denominator := float64(summary.ValidGold)
	if denominator <= 0 {
		return
	}
	summary.Top1Accuracy = round4(float64(summary.Passed) / denominator)
	summary.Top3Recall = round4(float64(summary.Top3Covered) / denominator)
	summary.Top5Recall = round4(float64(summary.Top5Covered) / denominator)
	summary.Top10Recall = round4(float64(summary.Top10Covered) / denominator)
	summary.WrongMatchRate = round4(float64(summary.WrongMatch) / denominator)
	summary.WrongExactAliasRate = round4(float64(summary.WrongExactAlias) / denominator)
	summary.NearMissRate = round4(float64(summary.NearMiss) / denominator)
	summary.ProcessedMismatchRate = round4(float64(summary.ProcessedMismatch) / denominator)
}

func (s gormBenchmarkStore) FindExpectedFoods(ctx context.Context, canonical string) ([]foodRef, error) {
	var foods []domain.FoodNutrition
	if err := s.db.WithContext(ctx).
		Where("LOWER(canonical_name) = LOWER(?)", strings.TrimSpace(canonical)).
		Find(&foods).Error; err != nil {
		return nil, err
	}
	out := make([]foodRef, 0, len(foods))
	for _, food := range foods {
		out = append(out, foodRefFromDomain(food))
	}
	return out, nil
}

func (s gormBenchmarkStore) ResolveFood(ctx context.Context, query string) (*resolveOutput, error) {
	resolved, err := s.repo.ResolveFood(ctx, query)
	if err != nil {
		return nil, err
	}
	out := &resolveOutput{}
	if resolved != nil {
		out.Status = resolved.Status
		out.MatchSource = resolved.MatchSource
		out.Score = resolved.Score
		if resolved.Food != nil {
			food := foodRefFromDomain(*resolved.Food)
			out.Food = &food
		}
	}
	return out, nil
}

func (s gormBenchmarkStore) SearchCandidates(ctx context.Context, query string, limit int) ([]candidateOutput, error) {
	candidates, err := s.repo.SearchCandidates(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]candidateOutput, 0, len(candidates))
	for _, candidate := range candidates {
		out = append(out, candidateOutput{
			Food:        foodRefFromDomain(candidate.Food),
			MatchSource: candidate.MatchSource,
			Score:       candidate.Score,
		})
	}
	return out, nil
}

func foodRefFromDomain(food domain.FoodNutrition) foodRef {
	return foodRef{
		ID:            strings.TrimSpace(food.ID),
		CanonicalName: strings.TrimSpace(food.CanonicalName),
		KcalPer100g:   food.KcalPer100g,
		IsActive:      food.IsActive,
	}
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
	queryCol, okQuery := header["query"]
	expectedCol, okExpected := header["expected_canonical_name"]
	categoryCol, okCategory := header["category"]
	commentCol, okComment := header["comment"]
	if !okQuery || !okExpected {
		return nil, fmt.Errorf("CSV header must contain query,expected_canonical_name,category,comment")
	}
	records := make([]benchmarkRecord, 0, len(rows)-1)
	for i, row := range rows[1:] {
		if rowEmpty(row) {
			continue
		}
		record := benchmarkRecord{
			Line:                  i + 2,
			Query:                 csvValue(row, queryCol),
			ExpectedCanonicalName: csvValue(row, expectedCol),
		}
		if okCategory {
			record.Category = csvValue(row, categoryCol)
		}
		if okComment {
			record.Comment = csvValue(row, commentCol)
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
	jsonPath := filepath.Join(outputDir, "nutrition_recall_benchmark_"+timestamp+".json")
	csvPath := filepath.Join(outputDir, "nutrition_recall_benchmark_"+timestamp+".csv")
	mdPath := filepath.Join(outputDir, "nutrition_recall_benchmark_"+timestamp+".md")
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(jsonPath, append(payload, '\n'), 0o644); err != nil {
		return "", "", "", err
	}
	if err := writeBenchmarkCSVReport(csvPath, report.Rows); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(mdPath, []byte(buildBenchmarkMarkdownReport(report)), 0o644); err != nil {
		return "", "", "", err
	}
	return jsonPath, csvPath, mdPath, nil
}

func buildBenchmarkMarkdownReport(report benchmarkReport) string {
	var b strings.Builder
	writeMarkdownHeader(&b, report)
	writeMarkdownSummary(&b, report.Summary)
	writeMarkdownCategoryTable(&b, report.Categories)
	writeMarkdownActionPlan(&b, report)
	writeMarkdownExamples(&b, "金标目标不存在或不可用（invalid_gold）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return !row.ValidGold
	}), 20)
	writeMarkdownExamples(&b, "高风险：强别名错配（wrong_exact_alias）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.WrongExactAlias
	}), 15)
	writeMarkdownExamples(&b, "未召回（unresolved）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.ValidGold && !row.Pass && row.ActualFoodID == ""
	}), 15)
	writeMarkdownExamples(&b, "近失误（near_miss）：正确答案在候选里但第一名错", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.NearMiss
	}), 15)
	writeMarkdownExamples(&b, "普通食材误命中加工食品", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.ProcessedMismatch
	}), 15)
	writeMarkdownExamples(&b, "其它召回错（wrong_match）", filterRows(report.Rows, func(row benchmarkRow) bool {
		return row.ValidGold && !row.Pass && row.ActualFoodID != "" && !row.WrongExactAlias && !row.ProcessedMismatch
	}), 15)
	b.WriteString("\n## 代表性说明\n\n")
	b.WriteString("- 这份 benchmark 是人工金标集，适合做策略改动前后的回归比较，但还不能单独代表真实线上分布。\n")
	b.WriteString("- 当前样本偏常见普通食物、口语别名、计量短语和高风险误召回；真实代表性需要继续加入脱敏后的真实 query 抽样，并人工标注 expected canonical。\n")
	b.WriteString("- 后续评估不要只看 top1 accuracy；如果 top1 上升但 wrong_exact_alias 或 processed mismatch 上升，仍应视为风险变大。\n")
	return b.String()
}

func writeMarkdownHeader(b *strings.Builder, report benchmarkReport) {
	b.WriteString("# 标准营养库召回 Benchmark 报告\n\n")
	b.WriteString(fmt.Sprintf("- 生成时间：`%s`\n", report.GeneratedAt))
	b.WriteString(fmt.Sprintf("- 金标文件：`%s`\n", report.InputPath))
	b.WriteString(fmt.Sprintf("- 候选数量：`%d`\n", report.TopK))
	if len(report.Database) > 0 {
		b.WriteString(fmt.Sprintf("- 数据库：`%s/%s`，schema `%s`\n", report.Database["host"], report.Database["database"], report.Database["schema"]))
	}
	b.WriteString("\n")
}

func writeMarkdownSummary(b *strings.Builder, summary benchmarkSummary) {
	b.WriteString("## 总览\n\n")
	b.WriteString("| 中文指标 | 原始字段 | 数值 | 怎么理解 |\n")
	b.WriteString("|---|---|---:|---|\n")
	b.WriteString(fmt.Sprintf("| 总样本数 | total | %d | CSV 里一共有多少条测试输入 |\n", summary.Total))
	b.WriteString(fmt.Sprintf("| 有效金标数 | valid_gold | %d | 金标目标在库内存在且 active、热量有效；这不是命中正确数 |\n", summary.ValidGold))
	b.WriteString(fmt.Sprintf("| 命中正确数 | passed | %d | 当前策略最终返回的第一个食物就是金标目标 |\n", summary.Passed))
	b.WriteString(fmt.Sprintf("| 第一名准确率 | top1_accuracy | %.4f | 当前策略直接返回正确食物的比例 |\n", summary.Top1Accuracy))
	b.WriteString(fmt.Sprintf("| 前 3 覆盖率 | top3_recall | %.4f | 正确答案在前 3 个候选里，或已经第一名命中 |\n", summary.Top3Recall))
	b.WriteString(fmt.Sprintf("| 前 5 覆盖率 | top5_recall | %.4f | 正确答案在前 5 个候选里，或已经第一名命中 |\n", summary.Top5Recall))
	b.WriteString(fmt.Sprintf("| 前 10 覆盖率 | top10_recall | %.4f | 正确答案在前 10 个候选里，或已经第一名命中 |\n", summary.Top10Recall))
	b.WriteString(fmt.Sprintf("| 没召回 | unresolved | %d | 系统没有稳定返回任何食物 |\n", summary.Unresolved))
	b.WriteString(fmt.Sprintf("| 召回错 | wrong_match | %d | 系统返回了食物，但不是金标目标 |\n", summary.WrongMatch))
	b.WriteString(fmt.Sprintf("| 强别名错配 | wrong_exact_alias | %d | exact alias 直接指错目标，风险最高 |\n", summary.WrongExactAlias))
	b.WriteString(fmt.Sprintf("| 近失误 | near_miss | %d | 正确答案在候选里，但第一名错了，适合观察 rerank/LLM/embedding 是否有用 |\n", summary.NearMiss))
	b.WriteString(fmt.Sprintf("| 加工食品误命中 | processed_mismatch | %d | 普通食材误命中肠、火腿、热狗等加工食品 |\n", summary.ProcessedMismatch))
	b.WriteString("\n")
}

func writeMarkdownCategoryTable(b *strings.Builder, categories map[string]benchmarkSummary) {
	b.WriteString("## 按类别\n\n")
	b.WriteString("| 类别 | 有效金标 | 命中正确 | 第一名准确率 | 前 10 覆盖率 | 没召回 | 召回错 | 强别名错配 | 近失误 |\n")
	b.WriteString("|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	names := make([]string, 0, len(categories))
	for name := range categories {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		s := categories[name]
		b.WriteString(fmt.Sprintf("| %s | %d | %d | %.4f | %.4f | %d | %d | %d | %d |\n",
			name, s.ValidGold, s.Passed, s.Top1Accuracy, s.Top10Recall, s.Unresolved, s.WrongMatch, s.WrongExactAlias, s.NearMiss))
	}
	b.WriteString("\n")
}

func writeMarkdownActionPlan(b *strings.Builder, report benchmarkReport) {
	s := report.Summary
	b.WriteString("## 优先修复建议\n\n")
	if s.InvalidGold > 0 {
		b.WriteString(fmt.Sprintf("1. 先复核 `%d` 条 `invalid_gold`。这些样本的金标目标不在当前标准库，代表库覆盖缺口或 canonical 命名口径不一致，不能计入准确率。\n", s.InvalidGold))
	}
	if s.WrongExactAlias > 0 {
		b.WriteString(fmt.Sprintf("2. 处理 `%d` 条 `wrong_exact_alias`。这类错配会在 DB-first 第二步直接返回，风险最高，优先级高于扩大模糊召回。\n", s.WrongExactAlias))
	}
	if s.Unresolved > 0 {
		b.WriteString(fmt.Sprintf("3. 处理 `%d` 条 `unresolved`。优先做 query 归一化：去数量词、单位、份量词、标点和口语前后缀，而不是直接把这些长短语写成 alias。\n", s.Unresolved))
	}
	if s.NearMiss > 0 {
		b.WriteString(fmt.Sprintf("4. 对 `%d` 条 `near_miss` 做 rerank 实验。因为正确答案已经在 topK，适合用轻量规则、embedding 或 fast LLM rerank 提升 top1。\n", s.NearMiss))
	}
	if s.ProcessedMismatch > 0 {
		b.WriteString(fmt.Sprintf("5. 立即加固加工食品安全阀，当前仍有 `%d` 条普通食材误命中加工食品。\n", s.ProcessedMismatch))
	}
	if s.InvalidGold == 0 && s.WrongExactAlias == 0 && s.Unresolved == 0 && s.NearMiss == 0 && s.ProcessedMismatch == 0 {
		b.WriteString("1. 当前没有明显失败桶，下一步应扩大真实样本覆盖，而不是继续调策略。\n")
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
	b.WriteString("| 输入 | 金标目标 | 实际返回 | 判定 | 金标候选排名 | 前几个候选 |\n")
	b.WriteString("|---|---|---|---|---:|---|\n")
	for _, row := range rows {
		actual := row.ActualCanonicalName
		if actual == "" {
			actual = "(unresolved)"
		}
		b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %d | %s |\n",
			mdCell(row.Query),
			mdCell(row.ExpectedCanonicalName),
			mdCell(actual),
			mdCell(row.FailReason),
			row.ExpectedCandidateRank,
			mdCell(shortCandidateListText(row.Candidates, 5)),
		))
	}
	b.WriteString("\n")
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

func shortCandidateListText(candidates []benchmarkCandidate, limit int) string {
	if len(candidates) == 0 {
		return ""
	}
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	parts := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		part := fmt.Sprintf("%d.%s", candidate.Rank, candidate.CanonicalName)
		if candidate.IsExpected {
			part += " *"
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, "; ")
}

func mdCell(value string) string {
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "|", "\\|")
	return value
}

func writeBenchmarkCSVReport(path string, rows []benchmarkRow) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	defer writer.Flush()
	if err := writer.Write([]string{
		"line",
		"query",
		"expected_canonical_name",
		"expected_food_id",
		"category",
		"actual_canonical_name",
		"actual_food_id",
		"resolve_status",
		"match_source",
		"score",
		"pass",
		"valid_gold",
		"fail_reason",
		"expected_candidate_rank",
		"top3_covered",
		"top5_covered",
		"top10_covered",
		"near_miss",
		"wrong_exact_alias",
		"processed_mismatch",
		"candidates",
		"comment",
	}); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write([]string{
			strconv.Itoa(row.Line),
			row.Query,
			row.ExpectedCanonicalName,
			row.ExpectedFoodID,
			row.Category,
			row.ActualCanonicalName,
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
			strconv.FormatBool(row.WrongExactAlias),
			strconv.FormatBool(row.ProcessedMismatch),
			candidateListText(row.Candidates),
			row.Comment,
		}); err != nil {
			return err
		}
	}
	return writer.Error()
}

func candidateListText(candidates []benchmarkCandidate) string {
	parts := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		prefix := fmt.Sprintf("%d:%s:%.4f:%s", candidate.Rank, candidate.CanonicalName, candidate.Score, candidate.MatchSource)
		if candidate.IsExpected {
			prefix += ":expected"
		}
		parts = append(parts, prefix)
	}
	return strings.Join(parts, " | ")
}

func csvValue(row []string, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func rowEmpty(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func isProcessedFoodMismatch(query, canonical string) bool {
	if strings.TrimSpace(query) == "" || strings.TrimSpace(canonical) == "" {
		return false
	}
	processedTokens := []string{"肠", "香肠", "火腿", "热狗", "肉肠", "鱼肠", "鸡肉肠", "玉米肠"}
	queryNorm := normalizeFoodName(query)
	canonicalNorm := normalizeFoodName(canonical)
	return containsAnyToken(canonicalNorm, processedTokens) && !containsAnyToken(queryNorm, processedTokens)
}

func containsAnyToken(text string, tokens []string) bool {
	for _, token := range tokens {
		if token != "" && strings.Contains(text, token) {
			return true
		}
	}
	return false
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

func round4(value float64) float64 {
	return float64(int(value*10000+0.5)) / 10000
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 4, 64)
}

func resolveDefaultCSVPath() string {
	if _, err := os.Stat(defaultBenchmarkCSVRelPath); err == nil {
		return defaultBenchmarkCSVRelPath
	}
	rootPath := filepath.Join("backend", defaultBenchmarkCSVRelPath)
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath
	}
	return defaultBenchmarkCSVRelPath
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
