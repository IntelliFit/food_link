package main

import (
	"bufio"
	"compress/gzip"
	"container/heap"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

const (
	openFoodFactsBaseURL = "https://world.openfoodfacts.org"
	openFoodFactsSource  = "open_food_facts_odbl_20260731"
	openFoodFactsIngest  = "open_food_facts_strict_bulk"
	openFoodFactsLicense = "ODbL 1.0; product images CC BY-SA"
	qwenModel            = "qwen3.6-flash"
)

var requestedFields = strings.Join([]string{
	"code", "product_name", "product_name_zh", "brands", "quantity", "serving_size",
	"categories", "categories_tags", "countries_tags", "ingredients_text", "nutriments",
	"nutrition_data", "nutrition_data_per", "nutrition_data_prepared_per",
	"image_front_url", "image_nutrition_url", "completeness", "data_quality_errors_tags",
	"data_quality_warnings_tags", "product_quantity", "product_quantity_unit", "last_modified_t",
}, ",")

type options struct {
	configDir        string
	outputDir        string
	manifestPath     string
	csvDump          string
	target           int
	maxPages         int
	requestInterval  time.Duration
	minCompleteness  float64
	apply            bool
	reviewStatus     string
	qwenTranslate    bool
	qwenVisualSample int
	qwenBatchSize    int
	qwenConcurrency  int
	visualProvider   string
	visualModel      string
	visualMaxNew     int
	visualEvidence   string
	budgetCNY        float64
	inputCNYPerM     float64
	outputCNYPerM    float64
	timeout          time.Duration
}

type offSearchResponse struct {
	Count    int64        `json:"count"`
	Page     int          `json:"page"`
	PageSize int          `json:"page_size"`
	Products []offProduct `json:"products"`
}

type offProduct struct {
	Code                    string         `json:"code"`
	ProductName             string         `json:"product_name"`
	ProductNameZH           string         `json:"product_name_zh"`
	Brands                  string         `json:"brands"`
	Quantity                string         `json:"quantity"`
	ServingSize             string         `json:"serving_size"`
	Categories              string         `json:"categories"`
	CategoriesTags          []string       `json:"categories_tags"`
	CountriesTags           []string       `json:"countries_tags"`
	IngredientsText         string         `json:"ingredients_text"`
	Nutriments              map[string]any `json:"nutriments"`
	NutritionData           string         `json:"nutrition_data"`
	NutritionDataPer        string         `json:"nutrition_data_per"`
	NutritionDataPrepared   string         `json:"nutrition_data_prepared_per"`
	ImageFrontURL           string         `json:"image_front_url"`
	ImageNutritionURL       string         `json:"image_nutrition_url"`
	Completeness            float64        `json:"completeness"`
	DataQualityErrors       []string       `json:"data_quality_errors_tags"`
	DataQualityWarnings     []string       `json:"data_quality_warnings_tags"`
	ProductQuantity         any            `json:"product_quantity"`
	ProductQuantityUnit     string         `json:"product_quantity_unit"`
	LastModifiedUnixSeconds int64          `json:"last_modified_t"`
	UniqueScans             int            `json:"unique_scans_n"`
}

type candidate struct {
	Product            offProduct      `json:"product"`
	Priority           string          `json:"priority"`
	QualityScore       float64         `json:"quality_score"`
	QualityReasons     []string        `json:"quality_reasons"`
	ChineseSearchTerms []string        `json:"chinese_search_terms,omitempty"`
	ChineseCategory    string          `json:"chinese_category,omitempty"`
	QwenVisual         *visualDecision `json:"qwen_visual,omitempty"`
}

type candidateHeap []candidate

func (h candidateHeap) Len() int           { return len(h) }
func (h candidateHeap) Less(i, j int) bool { return candidateRank(h[i]) < candidateRank(h[j]) }
func (h candidateHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *candidateHeap) Push(value any)    { *h = append(*h, value.(candidate)) }
func (h *candidateHeap) Pop() any {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

type manifest struct {
	GeneratedAt        time.Time   `json:"generated_at"`
	Source             string      `json:"source"`
	License            string      `json:"license"`
	Target             int         `json:"target"`
	MinCompleteness    float64     `json:"min_completeness"`
	ChinaPagesScanned  int         `json:"china_pages_scanned"`
	GlobalPagesScanned int         `json:"global_pages_scanned"`
	Rejected           int         `json:"rejected"`
	Candidates         []candidate `json:"candidates"`
}

type visualDecision struct {
	Provider      string  `json:"provider,omitempty"`
	Model         string  `json:"model,omitempty"`
	FoodPackage   bool    `json:"food_package"`
	IdentityMatch bool    `json:"identity_match"`
	UsableImage   bool    `json:"usable_image"`
	Confidence    float64 `json:"confidence"`
	Reason        string  `json:"reason"`
}

type externalVisualEvidence struct {
	Provider string                       `json:"provider"`
	Model    string                       `json:"model"`
	Items    []externalVisualEvidenceItem `json:"items"`
}

type externalVisualEvidenceItem struct {
	Position int            `json:"position"`
	Index    int            `json:"index"`
	Barcode  string         `json:"barcode"`
	Decision visualDecision `json:"decision"`
}

type usageBudget struct {
	InputTokens   int64   `json:"input_tokens"`
	OutputTokens  int64   `json:"output_tokens"`
	Calls         int     `json:"calls"`
	EstimatedCNY  float64 `json:"estimated_cny"`
	LimitCNY      float64 `json:"limit_cny"`
	InputCNYPerM  float64 `json:"input_cny_per_million"`
	OutputCNYPerM float64 `json:"output_cny_per_million"`
}

type runSummary struct {
	StartedAt        time.Time   `json:"started_at"`
	FinishedAt       time.Time   `json:"finished_at"`
	ManifestPath     string      `json:"manifest_path"`
	Candidates       int         `json:"candidates"`
	ExistingSkipped  int         `json:"existing_skipped"`
	QwenTranslated   int         `json:"qwen_translated"`
	QwenVisualPassed int         `json:"qwen_visual_passed"`
	QwenVisualFailed int         `json:"qwen_visual_failed"`
	Created          int         `json:"created"`
	Updated          int         `json:"updated"`
	Errors           int         `json:"errors"`
	Applied          bool        `json:"applied"`
	ReviewStatus     string      `json:"review_status"`
	Budget           usageBudget `json:"budget"`
}

func main() {
	debug.SetMemoryLimit(1 << 30)
	opts := parseFlags()
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	if err := os.MkdirAll(opts.outputDir, 0o755); err != nil {
		log.Fatalf("创建输出目录失败: %v", err)
	}

	cfg, err := config.Load(opts.configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	if sqlDB, sqlErr := db.DB(); sqlErr == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接检查失败: %v", err)
	}

	manifestPath := strings.TrimSpace(opts.manifestPath)
	budgetPath := filepath.Join(opts.outputDir, "budget.json")
	var data manifest
	if manifestPath != "" {
		if err := readJSON(manifestPath, &data); err != nil {
			log.Fatalf("读取候选清单失败: %v", err)
		}
	} else {
		manifestPath = filepath.Join(opts.outputDir, "manifest.json")
		if strings.TrimSpace(opts.csvDump) != "" {
			data, err = fetchManifestFromCSV(ctx, opts, db, manifestPath)
		} else {
			data, err = fetchManifest(ctx, opts, db, manifestPath)
		}
		if err != nil {
			log.Fatalf("采集 Open Food Facts 候选失败: %v", err)
		}
	}
	if len(data.Candidates) < opts.target {
		log.Fatalf("严格质量门禁后候选不足: got=%d target=%d；未执行写库", len(data.Candidates), opts.target)
	}
	data.Candidates = data.Candidates[:opts.target]
	if strings.TrimSpace(opts.visualEvidence) != "" {
		applied, evidenceErr := applyExternalVisualEvidence(&data, opts.qwenVisualSample, opts.visualEvidence)
		if evidenceErr != nil {
			log.Fatalf("合并外部视觉证据失败: %v", evidenceErr)
		}
		if err := writeJSON(manifestPath, data); err != nil {
			log.Fatalf("保存外部视觉证据失败: %v", err)
		}
		fmt.Printf("外部视觉证据已合并 applied=%d\n", applied)
	}

	summary := runSummary{
		StartedAt: time.Now(), ManifestPath: manifestPath, Candidates: len(data.Candidates),
		Applied: opts.apply, ReviewStatus: opts.reviewStatus,
		Budget: usageBudget{LimitCNY: opts.budgetCNY, InputCNYPerM: opts.inputCNYPerM, OutputCNYPerM: opts.outputCNYPerM},
	}
	if _, statErr := os.Stat(budgetPath); statErr == nil {
		if err := readJSON(budgetPath, &summary.Budget); err != nil {
			log.Fatalf("恢复千问预算检查点失败: %v", err)
		}
		summary.Budget.LimitCNY = opts.budgetCNY
		summary.Budget.InputCNYPerM = opts.inputCNYPerM
		summary.Budget.OutputCNYPerM = opts.outputCNYPerM
		recalculateBudget(&summary.Budget)
		if err := ensureBudget(summary.Budget); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("恢复千问预算检查点 calls=%d estimated_cny=%.4f\n", summary.Budget.Calls, summary.Budget.EstimatedCNY)
	}
	checkpoint := func(includeManifest bool) error {
		if includeManifest {
			if err := writeJSON(manifestPath, data); err != nil {
				return err
			}
		}
		if err := writeJSON(budgetPath, summary.Budget); err != nil {
			return err
		}
		return nil
	}

	qwenClient, err := buildQwenClient(cfg)
	if err != nil && opts.qwenTranslate {
		log.Fatalf("初始化千问 3.6 Flash 失败: %v", err)
	}
	if opts.qwenTranslate {
		summary.QwenTranslated, err = translateCandidates(ctx, qwenClient, data.Candidates, opts.qwenBatchSize, &summary.Budget, checkpoint)
		if err != nil {
			log.Fatalf("千问批量生成中文检索词失败: %v", err)
		}
	}
	if opts.qwenVisualSample > 0 {
		visualClient, visualProvider, visualModel, visualErr := buildCatalogVisionClient(cfg, opts.visualProvider, opts.visualModel)
		if visualErr != nil {
			log.Fatalf("初始化多模态抽检模型失败: %v", visualErr)
		}
		fmt.Printf("多模态抽检模型 provider=%s model=%s concurrency=%d\n", visualProvider, visualModel, opts.qwenConcurrency)
		passed, failed, auditErr := auditCandidateSample(ctx, visualClient, visualProvider, visualModel, data.Candidates, opts.qwenVisualSample, opts.visualMaxNew, opts.qwenConcurrency, &summary.Budget, checkpoint)
		summary.QwenVisualPassed, summary.QwenVisualFailed = passed, failed
		if auditErr != nil {
			log.Fatalf("多模态抽检失败: %v", auditErr)
		}
		if err := writeJSON(manifestPath, data); err != nil {
			log.Fatalf("保存多模态抽检证据失败: %v", err)
		}
		minimumPass := int(math.Ceil(float64(minInt(opts.qwenVisualSample, len(data.Candidates))) * 0.95))
		if passed < minimumPass {
			log.Fatalf("多模态抽检通过率不足 95%%: passed=%d failed=%d；未执行写库", passed, failed)
		}
	}
	if err := writeJSON(manifestPath, data); err != nil {
		log.Fatalf("保存增强后的候选清单失败: %v", err)
	}

	if opts.apply {
		releaseLock, lockErr := acquireCatalogImportLock(ctx, db)
		if lockErr != nil {
			log.Fatalf("获取 Open Food Facts 导入锁失败: %v", lockErr)
		}
		defer releaseLock()
		summary.Created, summary.Updated, summary.ExistingSkipped, summary.Errors = applyCandidates(ctx, db, data.Candidates, opts.reviewStatus)
	}
	summary.FinishedAt = time.Now()
	if err := writeJSON(filepath.Join(opts.outputDir, "summary.json"), summary); err != nil {
		log.Fatalf("保存执行摘要失败: %v", err)
	}
	fmt.Printf("完成 candidates=%d created=%d updated=%d existing_skipped=%d errors=%d qwen_calls=%d estimated_cny=%.4f applied=%v output=%s\n",
		summary.Candidates, summary.Created, summary.Updated, summary.ExistingSkipped, summary.Errors,
		summary.Budget.Calls, summary.Budget.EstimatedCNY, summary.Applied, opts.outputDir)
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "后端配置目录")
	flag.StringVar(&opts.outputDir, "output-dir", "tmp/openfoodfacts-import", "候选清单和报告目录")
	flag.StringVar(&opts.manifestPath, "manifest", "", "复用已有 manifest.json，跳过网络采集")
	flag.StringVar(&opts.csvDump, "csv-dump", "", "Open Food Facts 官方 products.csv.gz 路径；设置后本地扫描，不调用搜索 API")
	flag.IntVar(&opts.target, "target", 10000, "严格质量候选目标数量")
	flag.IntVar(&opts.maxPages, "max-pages", 500, "全球高热度商品最多扫描页数（每页 100）")
	flag.DurationVar(&opts.requestInterval, "request-interval", 8*time.Second, "Open Food Facts 搜索请求间隔")
	flag.Float64Var(&opts.minCompleteness, "min-completeness", 0.75, "最低数据完整度")
	flag.BoolVar(&opts.apply, "apply", false, "写入 packaged_food_library；默认只生成审计清单")
	flag.StringVar(&opts.reviewStatus, "review-status", "pending", "写库审核状态：pending 或 active")
	flag.BoolVar(&opts.qwenTranslate, "qwen-translate", true, "用千问 3.6 Flash 批量生成中文检索词")
	flag.IntVar(&opts.qwenVisualSample, "qwen-visual-sample", 100, "千问多模态图片抽检数量")
	flag.IntVar(&opts.qwenBatchSize, "qwen-batch-size", 20, "单次中文检索词批处理数量")
	flag.IntVar(&opts.qwenConcurrency, "qwen-concurrency", 4, "千问多模态并发数（1-4）")
	flag.StringVar(&opts.visualProvider, "visual-provider", "qwen", "图片抽检模型提供方：qwen 或 doubao")
	flag.StringVar(&opts.visualModel, "visual-model", "", "图片抽检模型名；留空使用提供方低成本默认模型")
	flag.IntVar(&opts.visualMaxNew, "visual-max-new", 0, "本次最多新增图片审核数；0 表示不限，仅用于模型冒烟")
	flag.StringVar(&opts.visualEvidence, "visual-evidence", "", "逗号分隔的外部视觉审核 JSON 文件；按 position/index/barcode 严格合并")
	flag.Float64Var(&opts.budgetCNY, "budget-cny", 500, "千问预计成本硬上限（人民币）")
	flag.Float64Var(&opts.inputCNYPerM, "input-cny-per-million", 20, "保守输入计价估值，元/百万 token")
	flag.Float64Var(&opts.outputCNYPerM, "output-cny-per-million", 80, "保守输出计价估值，元/百万 token")
	flag.DurationVar(&opts.timeout, "timeout", 4*time.Hour, "整次任务超时")
	flag.Parse()

	opts.outputDir = filepath.Clean(opts.outputDir)
	if opts.target <= 0 || opts.maxPages <= 0 || opts.qwenBatchSize <= 0 {
		log.Fatal("target、max-pages 和 qwen-batch-size 必须大于 0")
	}
	if opts.qwenConcurrency < 1 || opts.qwenConcurrency > 4 {
		log.Fatal("qwen-concurrency 必须在 1 到 4 之间")
	}
	if opts.visualMaxNew < 0 {
		log.Fatal("visual-max-new 不得小于 0")
	}
	if opts.reviewStatus != "pending" && opts.reviewStatus != "active" {
		log.Fatal("review-status 仅支持 pending 或 active")
	}
	if opts.budgetCNY <= 0 || opts.budgetCNY > 500 {
		log.Fatal("budget-cny 必须大于 0 且不得超过用户授权的 500 元")
	}
	if opts.requestInterval < 6*time.Second {
		log.Fatal("request-interval 不得低于 6 秒，以遵守 Open Food Facts 搜索限流")
	}
	return opts
}

func fetchManifestFromCSV(ctx context.Context, opts options, db *gorm.DB, manifestPath string) (manifest, error) {
	known, err := loadKnownBarcodes(ctx, db)
	if err != nil {
		return manifest{}, err
	}
	file, err := os.Open(filepath.Clean(opts.csvDump))
	if err != nil {
		return manifest{}, fmt.Errorf("打开 Open Food Facts CSV 导出失败: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(bufio.NewReaderSize(file, 1<<20))
	if err != nil {
		return manifest{}, fmt.Errorf("解压 Open Food Facts CSV 导出失败: %w", err)
	}
	defer gzipReader.Close()
	reader := csv.NewReader(bufio.NewReaderSize(gzipReader, 4<<20))
	reader.Comma = '\t'
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.ReuseRecord = true
	header, err := reader.Read()
	if err != nil {
		return manifest{}, fmt.Errorf("读取 Open Food Facts CSV 表头失败: %w", err)
	}
	columns := make(map[string]int, len(header))
	for index, name := range header {
		columns[strings.TrimSpace(name)] = index
	}
	required := []string{"code", "product_name", "brands", "countries_tags", "image_url", "completeness", "energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"}
	for _, name := range required {
		if _, ok := columns[name]; !ok {
			return manifest{}, fmt.Errorf("Open Food Facts CSV 缺少必要列 %s", name)
		}
	}

	data := manifest{GeneratedAt: time.Now(), Source: openFoodFactsSource, License: openFoodFactsLicense, Target: opts.target, MinCompleteness: opts.minCompleteness}
	best := &candidateHeap{}
	heap.Init(best)
	rows := 0
	for {
		if rows%10000 == 0 {
			select {
			case <-ctx.Done():
				return data, ctx.Err()
			default:
			}
		}
		record, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return data, fmt.Errorf("读取 Open Food Facts CSV 第 %d 行失败: %w", rows+2, readErr)
		}
		rows++
		code := csvValue(record, columns, "code")
		if known[code] {
			continue
		}
		if !csvRowPassesCoreGate(record, columns, opts.minCompleteness) {
			data.Rejected++
			continue
		}
		priority, rawRank := csvCandidatePriorityAndRank(record, columns, opts.minCompleteness)
		if best.Len() >= opts.target && rawRank <= candidateRank((*best)[0]) {
			continue
		}
		product := productFromCSV(record, columns)
		quality, reasons, ok := evaluateProduct(product, opts.minCompleteness)
		if !ok {
			data.Rejected++
			continue
		}
		item := candidate{Product: product, Priority: priority, QualityScore: quality, QualityReasons: reasons}
		if best.Len() < opts.target {
			heap.Push(best, item)
		} else if candidateRank(item) > candidateRank((*best)[0]) {
			heap.Pop(best)
			heap.Push(best, item)
		}
		if rows%250000 == 0 {
			fmt.Printf("本地导出扫描进度 rows=%d eligible_top=%d rejected=%d\n", rows, best.Len(), data.Rejected)
		}
	}
	data.Candidates = make([]candidate, best.Len())
	for index := len(data.Candidates) - 1; index >= 0; index-- {
		data.Candidates[index] = heap.Pop(best).(candidate)
	}
	sort.SliceStable(data.Candidates, func(i, j int) bool { return candidateRank(data.Candidates[i]) > candidateRank(data.Candidates[j]) })
	data.GeneratedAt = time.Now()
	if err := writeJSON(manifestPath, data); err != nil {
		return data, err
	}
	fmt.Printf("本地导出扫描完成 rows=%d candidates=%d rejected=%d\n", rows, len(data.Candidates), data.Rejected)
	return data, nil
}

var csvNutrientFields = []string{
	"energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g", "sugars_100g",
	"saturated-fat_100g", "cholesterol_100g", "sodium_100g", "potassium_100g", "calcium_100g", "iron_100g",
	"magnesium_100g", "zinc_100g", "vitamin-a_100g", "vitamin-c_100g", "vitamin-d_100g", "vitamin-e_100g",
	"vitamin-b1_100g", "vitamin-b2_100g", "vitamin-pp_100g", "vitamin-b6_100g", "vitamin-b9_100g", "vitamin-b12_100g",
}

func productFromCSV(record []string, columns map[string]int) offProduct {
	value := func(name string) string {
		return strings.Clone(csvValue(record, columns, name))
	}
	nutriments := make(map[string]any, len(csvNutrientFields))
	for _, name := range csvNutrientFields {
		if raw := value(name); raw != "" {
			nutriments[name] = raw
		}
	}
	productQuantity, _ := strconv.ParseFloat(value("product_quantity"), 64)
	completeness, _ := strconv.ParseFloat(value("completeness"), 64)
	lastModified, _ := strconv.ParseInt(value("last_modified_t"), 10, 64)
	uniqueScans, _ := strconv.Atoi(value("unique_scans_n"))
	quantityUnit := inferQuantityUnit(value("quantity"))
	return offProduct{
		Code: value("code"), ProductName: value("product_name"), Brands: value("brands"), Quantity: value("quantity"),
		ServingSize: value("serving_size"), Categories: value("categories"), CategoriesTags: splitTags(value("categories_tags")),
		CountriesTags: splitTags(value("countries_tags")), IngredientsText: value("ingredients_text"), Nutriments: nutriments,
		NutritionData: "on", ImageFrontURL: value("image_url"), ImageNutritionURL: value("image_nutrition_url"),
		Completeness: completeness, DataQualityErrors: splitTags(value("data_quality_errors_tags")),
		ProductQuantity: productQuantity, ProductQuantityUnit: quantityUnit, LastModifiedUnixSeconds: lastModified, UniqueScans: uniqueScans,
	}
}

func csvValue(record []string, columns map[string]int, name string) string {
	index, ok := columns[name]
	if !ok || index < 0 || index >= len(record) {
		return ""
	}
	return strings.TrimSpace(record[index])
}

func csvRowPassesCoreGate(record []string, columns map[string]int, minCompleteness float64) bool {
	code := csvValue(record, columns, "code")
	name := csvValue(record, columns, "product_name")
	if !validGTIN(code) || len([]rune(name)) < 2 || len([]rune(name)) > 180 {
		return false
	}
	completeness, completenessOK := parseFiniteFloat(csvValue(record, columns, "completeness"))
	if !completenessOK || completeness < minCompleteness || csvValue(record, columns, "data_quality_errors_tags") != "" {
		return false
	}
	if !validOFFImageURL(csvValue(record, columns, "image_url")) {
		return false
	}
	kcal, kcalOK := parseFiniteFloat(csvValue(record, columns, "energy-kcal_100g"))
	protein, proteinOK := parseFiniteFloat(csvValue(record, columns, "proteins_100g"))
	carbs, carbsOK := parseFiniteFloat(csvValue(record, columns, "carbohydrates_100g"))
	fat, fatOK := parseFiniteFloat(csvValue(record, columns, "fat_100g"))
	if !kcalOK || !proteinOK || !carbsOK || !fatOK || kcal < 0 || kcal > 900 || protein < 0 || protein > 100 || carbs < 0 || carbs > 100 || fat < 0 || fat > 100 || protein+carbs+fat > 108 {
		return false
	}
	if kcal == 0 && protein+carbs+fat == 0 {
		return false
	}
	predicted := protein*4 + carbs*4 + fat*9
	if math.Abs(kcal-predicted) > math.Max(90, kcal*0.38) {
		return false
	}
	if sugar, ok := parseFiniteFloat(csvValue(record, columns, "sugars_100g")); ok && (sugar < 0 || sugar > carbs+2) {
		return false
	}
	if saturated, ok := parseFiniteFloat(csvValue(record, columns, "saturated-fat_100g")); ok && (saturated < 0 || saturated > fat+2) {
		return false
	}
	if sodium, ok := parseFiniteFloat(csvValue(record, columns, "sodium_100g")); ok && (sodium < 0 || sodium > 20) {
		return false
	}
	return true
}

func csvCandidatePriorityAndRank(record []string, columns map[string]int, minCompleteness float64) (string, float64) {
	completeness, _ := parseFiniteFloat(csvValue(record, columns, "completeness"))
	quality := 0.72 + math.Min(0.2, (completeness-minCompleteness)*0.8)
	if csvValue(record, columns, "image_nutrition_url") != "" {
		quality += 0.04
	}
	if csvValue(record, columns, "ingredients_text") != "" {
		quality += 0.03
	}
	priority := "global_popular"
	if strings.Contains(csvValue(record, columns, "countries_tags"), "en:china") {
		priority = "china"
		quality += 0.01
	}
	quality = math.Min(0.99, quality)
	uniqueScans, _ := strconv.Atoi(csvValue(record, columns, "unique_scans_n"))
	return priority, candidateRank(candidate{Priority: priority, QualityScore: quality, Product: offProduct{UniqueScans: uniqueScans}})
}

func parseFiniteFloat(raw string) (float64, bool) {
	if strings.TrimSpace(raw) == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value, err == nil && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func candidateRank(item candidate) float64 {
	marketBonus := 0.0
	if item.Priority == "china" {
		marketBonus = 1_000_000_000
	}
	return marketBonus + item.QualityScore*1_000_000 + math.Log1p(float64(maxInt(item.Product.UniqueScans, 0)))*10_000
}

func splitTags(raw string) []string {
	return uniqueNonEmpty(strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' }))
}

func inferQuantityUnit(raw string) string {
	lower := strings.ToLower(strings.TrimSpace(raw))
	for _, unit := range []string{"kg", "ml", "cl", "dl", "mg", "g", "l"} {
		matched, _ := regexp.MatchString(`(?i)(^|[0-9.,]\s*)`+unit+`(\b|$)`, lower)
		if matched {
			return unit
		}
	}
	return ""
}

func fetchManifest(ctx context.Context, opts options, db *gorm.DB, manifestPath string) (manifest, error) {
	known, err := loadKnownBarcodes(ctx, db)
	if err != nil {
		return manifest{}, err
	}
	data := manifest{
		GeneratedAt: time.Now(), Source: openFoodFactsSource, License: openFoodFactsLicense,
		Target: opts.target, MinCompleteness: opts.minCompleteness,
	}
	if _, statErr := os.Stat(manifestPath); statErr == nil {
		if readErr := readJSON(manifestPath, &data); readErr != nil {
			return manifest{}, fmt.Errorf("恢复采集检查点失败: %w", readErr)
		}
		if data.MinCompleteness != 0 && math.Abs(data.MinCompleteness-opts.minCompleteness) > 0.000001 {
			return manifest{}, fmt.Errorf("检查点 min_completeness=%.3f 与本次 %.3f 不一致", data.MinCompleteness, opts.minCompleteness)
		}
		data.Target = opts.target
		data.MinCompleteness = opts.minCompleteness
		fmt.Printf("恢复采集检查点 china_pages=%d global_pages=%d candidates=%d\n", data.ChinaPagesScanned, data.GlobalPagesScanned, len(data.Candidates))
	}
	seen := map[string]bool{}
	for barcode := range known {
		seen[barcode] = true
	}
	for _, item := range data.Candidates {
		seen[strings.TrimSpace(item.Product.Code)] = true
	}
	client := &http.Client{Timeout: 90 * time.Second}
	lastRequest := time.Time{}
	fetchPage := func(country string, page int) (offSearchResponse, error) {
		if wait := opts.requestInterval - time.Since(lastRequest); !lastRequest.IsZero() && wait > 0 {
			select {
			case <-ctx.Done():
				return offSearchResponse{}, ctx.Err()
			case <-time.After(wait):
			}
		}
		response, requestErr := requestOFFPage(ctx, client, country, page)
		lastRequest = time.Now()
		return response, requestErr
	}
	consume := func(products []offProduct, priority string) {
		for _, product := range products {
			code := strings.TrimSpace(product.Code)
			if seen[code] {
				continue
			}
			quality, reasons, ok := evaluateProduct(product, opts.minCompleteness)
			if !ok {
				data.Rejected++
				continue
			}
			seen[code] = true
			data.Candidates = append(data.Candidates, candidate{Product: product, Priority: priority, QualityScore: quality, QualityReasons: reasons})
		}
	}

	chinaStartPage := data.ChinaPagesScanned + 1
	if chinaStartPage < 1 {
		chinaStartPage = 1
	}
	for page := chinaStartPage; page <= 30 && len(data.Candidates) < opts.target; page++ {
		response, requestErr := fetchPage("china", page)
		if requestErr != nil {
			return data, requestErr
		}
		data.ChinaPagesScanned = page
		consume(response.Products, "china")
		if len(response.Products) == 0 || int64(page*100) >= response.Count {
			break
		}
	}
	globalStartPage := data.GlobalPagesScanned + 1
	if globalStartPage < 1 {
		globalStartPage = 1
	}
	for page := globalStartPage; page <= opts.maxPages && len(data.Candidates) < opts.target; page++ {
		response, requestErr := fetchPage("", page)
		if requestErr != nil {
			return data, requestErr
		}
		data.GlobalPagesScanned = page
		consume(response.Products, "global_popular")
		if page%5 == 0 || len(data.Candidates) >= opts.target {
			if err := writeJSON(manifestPath, data); err != nil {
				return data, err
			}
			fmt.Printf("采集进度 china_pages=%d global_pages=%d candidates=%d rejected=%d\n", data.ChinaPagesScanned, data.GlobalPagesScanned, len(data.Candidates), data.Rejected)
		}
		if len(response.Products) == 0 {
			break
		}
	}
	sort.SliceStable(data.Candidates, func(i, j int) bool {
		if data.Candidates[i].Priority != data.Candidates[j].Priority {
			return data.Candidates[i].Priority == "china"
		}
		return data.Candidates[i].QualityScore > data.Candidates[j].QualityScore
	})
	data.GeneratedAt = time.Now()
	return data, writeJSON(manifestPath, data)
}

func requestOFFPage(ctx context.Context, client *http.Client, country string, page int) (offSearchResponse, error) {
	params := url.Values{}
	params.Set("fields", requestedFields)
	params.Set("sort_by", "unique_scans_n")
	params.Set("page_size", "100")
	params.Set("page", strconv.Itoa(page))
	params.Set("lc", "zh")
	if strings.TrimSpace(country) != "" {
		params.Set("countries_tags_en", strings.Title(country)) //nolint:staticcheck // API expects display tag value.
	}
	endpoint := openFoodFactsBaseURL + "/api/v2/search?" + params.Encode()
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return offSearchResponse{}, err
		}
		req.Header.Set("User-Agent", "food_link/1.0 (food database quality import)")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
		} else {
			body, readErr := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
			resp.Body.Close()
			if readErr == nil && resp.StatusCode == http.StatusOK {
				var parsed offSearchResponse
				if err := json.Unmarshal(body, &parsed); err == nil {
					return parsed, nil
				} else {
					lastErr = err
				}
			} else if readErr != nil {
				lastErr = readErr
			} else {
				lastErr = fmt.Errorf("Open Food Facts 返回 HTTP %d", resp.StatusCode)
				if resp.StatusCode < 429 && resp.StatusCode < 500 {
					break
				}
			}
		}
		delay := 10 * time.Second * time.Duration(1<<minInt(attempt, 3))
		if delay > 2*time.Minute {
			delay = 2 * time.Minute
		}
		select {
		case <-ctx.Done():
			return offSearchResponse{}, ctx.Err()
		case <-time.After(delay):
		}
	}
	return offSearchResponse{}, fmt.Errorf("请求 Open Food Facts 失败: %w", lastErr)
}

func evaluateProduct(product offProduct, minCompleteness float64) (float64, []string, bool) {
	reasons := []string{}
	name := preferredName(product)
	if len([]rune(name)) < 2 || len([]rune(name)) > 180 {
		return 0, []string{"商品名缺失或长度异常"}, false
	}
	if !validGTIN(product.Code) {
		return 0, []string{"条码校验失败"}, false
	}
	if product.Completeness < minCompleteness {
		return 0, []string{"完整度不足"}, false
	}
	if len(product.DataQualityErrors) > 0 {
		return 0, []string{"存在数据质量错误"}, false
	}
	if !validOFFImageURL(product.ImageFrontURL) {
		return 0, []string{"缺少 Open Food Facts 正面实物图"}, false
	}
	if strings.ToLower(strings.TrimSpace(product.NutritionData)) != "on" {
		return 0, []string{"没有标签营养数据"}, false
	}
	kcal, kcalOK := nutrient(product.Nutriments, "energy-kcal_100g")
	protein, proteinOK := nutrient(product.Nutriments, "proteins_100g")
	carbs, carbsOK := nutrient(product.Nutriments, "carbohydrates_100g")
	fat, fatOK := nutrient(product.Nutriments, "fat_100g")
	if !kcalOK || !proteinOK || !carbsOK || !fatOK {
		return 0, []string{"每100g热量或三大营养素不完整"}, false
	}
	if kcal < 0 || kcal > 900 || protein < 0 || protein > 100 || carbs < 0 || carbs > 100 || fat < 0 || fat > 100 || protein+carbs+fat > 108 {
		return 0, []string{"营养字段超出物理范围"}, false
	}
	if kcal == 0 && protein+carbs+fat == 0 {
		return 0, []string{"纯零营养商品不纳入首批高含金量数据"}, false
	}
	predicted := protein*4 + carbs*4 + fat*9
	if math.Abs(kcal-predicted) > math.Max(90, kcal*0.38) {
		return 0, []string{"热量与三大营养素明显不闭合"}, false
	}
	if sugar, ok := nutrient(product.Nutriments, "sugars_100g"); ok && (sugar < 0 || sugar > carbs+2) {
		return 0, []string{"糖高于总碳水"}, false
	}
	if saturated, ok := nutrient(product.Nutriments, "saturated-fat_100g"); ok && (saturated < 0 || saturated > fat+2) {
		return 0, []string{"饱和脂肪高于总脂肪"}, false
	}
	if sodium, ok := nutrient(product.Nutriments, "sodium_100g"); ok && (sodium < 0 || sodium > 20) {
		return 0, []string{"钠含量异常"}, false
	}
	quality := 0.72 + math.Min(0.2, (product.Completeness-minCompleteness)*0.8)
	if strings.TrimSpace(product.ImageNutritionURL) != "" {
		quality += 0.04
		reasons = append(reasons, "含营养标签图片")
	}
	if strings.TrimSpace(product.IngredientsText) != "" {
		quality += 0.03
		reasons = append(reasons, "含配料表")
	}
	if contains(product.CountriesTags, "en:china") {
		quality += 0.01
		reasons = append(reasons, "中国市场标签")
	}
	quality = math.Min(0.99, quality)
	reasons = append(reasons, "有效GTIN", "正面实物图", "每100g标签营养", "无严重质量错误", "能量一致性通过")
	return quality, reasons, true
}

func buildQwenClient(cfg *config.Config) (*analyzeservice.OfoxAIClient, error) {
	apiKey := strings.TrimSpace(cfg.External.DashScopeAPIKey)
	baseURL := strings.TrimSpace(cfg.External.DashScopeBaseURL)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.External.OfoxAIAPIKey)
	}
	if baseURL == "" {
		baseURL = strings.TrimSpace(cfg.External.OfoxAIBaseURL)
	}
	if apiKey == "" || baseURL == "" {
		return nil, errors.New("Apollo 缺少可用的千问 API Key 或 Base URL")
	}
	return analyzeservice.NewOfoxAIClient(apiKey, qwenModel, baseURL), nil
}

type catalogVisionClient interface {
	AnalyzeWithImagesWithoutThinkingMeta(context.Context, string, []string) (map[string]any, map[string]any, error)
}

func buildCatalogVisionClient(cfg *config.Config, provider, model string) (catalogVisionClient, string, string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	model = strings.TrimSpace(model)
	switch provider {
	case "", "qwen":
		client, err := buildQwenClient(cfg)
		if err != nil {
			return nil, "", "", err
		}
		if model == "" {
			model = qwenModel
		}
		if model != qwenModel {
			client = analyzeservice.NewOfoxAIClient(client.APIKey, model, client.BaseURL)
		}
		return client, "qwen", model, nil
	case "doubao":
		if strings.TrimSpace(cfg.External.DoubaoAPIKey) == "" {
			return nil, "", "", errors.New("Apollo 缺少 external.doubao_api_key")
		}
		if model == "" {
			model = "doubao-seed-2-0-lite"
		}
		return analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, model, cfg.External.DoubaoBaseURL), "doubao", model, nil
	default:
		return nil, "", "", fmt.Errorf("不支持的图片抽检 provider %q", provider)
	}
}

func translateCandidates(ctx context.Context, client *analyzeservice.OfoxAIClient, candidates []candidate, batchSize int, budget *usageBudget, checkpoint func(bool) error) (int, error) {
	translated := 0
	for start := 0; start < len(candidates); start += batchSize {
		if err := ensureBudget(*budget); err != nil {
			return translated, err
		}
		end := minInt(start+batchSize, len(candidates))
		complete := true
		for i := start; i < end; i++ {
			if len(candidates[i].ChineseSearchTerms) == 0 && strings.TrimSpace(candidates[i].ChineseCategory) == "" {
				complete = false
				break
			}
		}
		if complete {
			translated += end - start
			continue
		}
		input := make([]map[string]any, 0, end-start)
		for i := start; i < end; i++ {
			input = append(input, map[string]any{
				"code": candidates[i].Product.Code, "name": preferredName(candidates[i].Product),
				"brand": candidates[i].Product.Brands, "categories": candidates[i].Product.CategoriesTags,
			})
		}
		payload, _ := json.Marshal(input)
		prompt := "你正在为中文食物记录应用整理真实包装商品。根据输入商品名、品牌和分类生成中文检索词，不得编造品牌、口味、规格或营养。返回严格 JSON：{\"items\":[{\"code\":\"原条码\",\"search_terms_zh\":[\"2到5个简短中文检索词\"],\"category_zh\":\"简短中文类别\"}]}。无法可靠翻译的专有名词保留原文。输入：" + string(payload)
		result, meta, err := callQwenWithRetry(ctx, client, prompt, nil)
		if err != nil {
			return translated, err
		}
		addUsage(budget, meta)
		if checkpoint != nil {
			if err := checkpoint(false); err != nil {
				return translated, fmt.Errorf("保存预算检查点失败: %w", err)
			}
		}
		if err := ensureBudget(*budget); err != nil {
			return translated, err
		}
		byCode := map[string]int{}
		for i := start; i < end; i++ {
			byCode[candidates[i].Product.Code] = i
		}
		for _, item := range anySlice(result["items"]) {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			idx, ok := byCode[stringValue(row["code"])]
			if !ok {
				continue
			}
			candidates[idx].ChineseSearchTerms = cleanTerms(row["search_terms_zh"])
			candidates[idx].ChineseCategory = strings.TrimSpace(stringValue(row["category_zh"]))
			if len(candidates[idx].ChineseSearchTerms) > 0 || candidates[idx].ChineseCategory != "" {
				translated++
			}
		}
		if checkpoint != nil && (end%200 == 0 || end == len(candidates)) {
			if err := checkpoint(true); err != nil {
				return translated, fmt.Errorf("保存翻译检查点失败: %w", err)
			}
		}
		fmt.Printf("千问检索词进度 translated=%d processed=%d/%d estimated_cny=%.4f\n", translated, end, len(candidates), budget.EstimatedCNY)
	}
	return translated, nil
}

type visualAuditJob struct {
	position int
	index    int
	barcode  string
	prompt   string
	imageURL string
}

type visualAuditResult struct {
	job    visualAuditJob
	result map[string]any
	meta   map[string]any
	err    error
}

func auditCandidateSample(ctx context.Context, client catalogVisionClient, provider, model string, candidates []candidate, sampleSize, maxNew, concurrency int, budget *usageBudget, checkpoint func(bool) error) (int, int, error) {
	sampleSize = minInt(sampleSize, len(candidates))
	indices := evenlySpacedIndices(len(candidates), sampleSize)
	passed, failed, audited := 0, 0, 0
	jobs := make([]visualAuditJob, 0, sampleSize)
	for position, idx := range indices {
		if existing := candidates[idx].QwenVisual; existing != nil {
			audited++
			if visualDecisionPassed(*existing) {
				passed++
			} else {
				failed++
			}
			continue
		}
		product := candidates[idx].Product
		jobs = append(jobs, visualAuditJob{
			position: position, index: idx, barcode: product.Code, imageURL: product.ImageFrontURL,
			prompt: fmt.Sprintf("审核这张 Open Food Facts 商品正面图。元数据：商品名=%q，品牌=%q，规格=%q。判断图片是否展示食品包装、商品身份是否与元数据语义一致、图片是否清晰可用于商品检索配图。品牌和商品名是两个不同字段，不要求二者文字相同；不同语言的等价名称应判一致。允许真实拍照、棚拍去背景、扫描/裁剪图和忠实展示实际包装的商品图，不因背景干净或光线完美就拒绝；仅拒绝明显AI虚构/文字畸变、占位图、非食品或品牌/品类/口味/规格明显冲突。只返回 JSON：{\"food_package\":true/false,\"identity_match\":true/false,\"usable_image\":true/false,\"confidence\":0到1,\"reason\":\"中文简短原因\"}。", preferredName(product), product.Brands, product.Quantity),
		})
	}
	if maxNew > 0 && len(jobs) > maxNew {
		jobs = jobs[:maxNew]
	}
	if len(jobs) == 0 {
		return passed, failed, ensureBudget(*budget)
	}
	concurrency = minInt(concurrency, len(jobs))
	// Reserve a deliberately conservative amount for all in-flight calls. The
	// run also keeps a separate 50 CNY safety margin below the user's 500 CNY cap.
	if budget.EstimatedCNY+float64(concurrency) >= budget.LimitCNY {
		return passed, failed, fmt.Errorf("千问并发预留后将达到预算上限: actual=%.2f in_flight=%d limit=%.2f", budget.EstimatedCNY, concurrency, budget.LimitCNY)
	}

	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobCh := make(chan visualAuditJob)
	resultCh := make(chan visualAuditResult, concurrency)
	var workers sync.WaitGroup
	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobCh {
				result, meta, err := callQwenWithRetry(workerCtx, client, job.prompt, []string{job.imageURL})
				select {
				case resultCh <- visualAuditResult{job: job, result: result, meta: meta, err: err}:
				case <-workerCtx.Done():
					return
				}
				if err != nil {
					return
				}
			}
		}()
	}
	go func() {
		defer close(jobCh)
		for _, job := range jobs {
			select {
			case jobCh <- job:
			case <-workerCtx.Done():
				return
			}
		}
	}()
	go func() {
		workers.Wait()
		close(resultCh)
	}()

	var firstErr error
	completedSinceCheckpoint := 0
	maximumFailures := sampleSize - int(math.Ceil(float64(sampleSize)*0.95))
	for response := range resultCh {
		if response.err != nil {
			if firstErr == nil {
				firstErr = response.err
				cancel()
			}
			continue
		}
		addUsage(budget, response.meta)
		decision := visualDecision{
			Provider: provider, Model: model,
			FoodPackage: boolValue(response.result["food_package"]), IdentityMatch: boolValue(response.result["identity_match"]),
			UsableImage: boolValue(response.result["usable_image"]), Confidence: numberValue(response.result["confidence"]),
			Reason: strings.TrimSpace(stringValue(response.result["reason"])),
		}
		candidates[response.job.index].QwenVisual = &decision
		audited++
		completedSinceCheckpoint++
		if visualDecisionPassed(decision) {
			passed++
		} else {
			failed++
		}
		includeManifest := completedSinceCheckpoint >= concurrency || audited == sampleSize
		if checkpoint != nil {
			if err := checkpoint(includeManifest); err != nil {
				if firstErr == nil {
					firstErr = fmt.Errorf("保存图片抽检检查点失败: %w", err)
					cancel()
				}
			}
		}
		if includeManifest {
			completedSinceCheckpoint = 0
		}
		fmt.Printf("千问图片抽检 progress=%d/%d barcode=%s passed=%d failed=%d confidence=%.3f reason=%s estimated_cny=%.4f\n",
			audited, sampleSize, response.job.barcode, passed, failed, decision.Confidence, decision.Reason, budget.EstimatedCNY)
		if failed > maximumFailures && firstErr == nil {
			firstErr = fmt.Errorf("千问多模态抽检已超过允许失败数: passed=%d failed=%d audited=%d", passed, failed, audited)
			cancel()
		}
	}
	if checkpoint != nil && completedSinceCheckpoint > 0 {
		if err := checkpoint(true); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("保存最终图片抽检检查点失败: %w", err)
		}
	}
	if firstErr != nil {
		return passed, failed, firstErr
	}
	if audited != sampleSize {
		return passed, failed, fmt.Errorf("千问多模态抽检不完整: audited=%d expected=%d", audited, sampleSize)
	}
	return passed, failed, ensureBudget(*budget)
}

func visualDecisionPassed(decision visualDecision) bool {
	return decision.FoodPackage && decision.IdentityMatch && decision.UsableImage && decision.Confidence >= 0.9
}

func applyExternalVisualEvidence(data *manifest, sampleSize int, pathsCSV string) (int, error) {
	if data == nil {
		return 0, errors.New("manifest 不能为空")
	}
	indices := evenlySpacedIndices(len(data.Candidates), minInt(sampleSize, len(data.Candidates)))
	applied := 0
	seen := map[string]bool{}
	for _, rawPath := range strings.Split(pathsCSV, ",") {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		var evidence externalVisualEvidence
		if err := readJSON(filepath.Clean(path), &evidence); err != nil {
			return applied, fmt.Errorf("读取 %s 失败: %w", path, err)
		}
		provider := strings.TrimSpace(evidence.Provider)
		if provider == "" {
			return applied, fmt.Errorf("%s 缺少 provider", path)
		}
		for _, item := range evidence.Items {
			if item.Position < 1 || item.Position > len(indices) {
				return applied, fmt.Errorf("%s position=%d 越界", path, item.Position)
			}
			expectedIndex := indices[item.Position-1]
			if item.Index != expectedIndex || item.Index < 0 || item.Index >= len(data.Candidates) {
				return applied, fmt.Errorf("%s position=%d index=%d 应为 %d", path, item.Position, item.Index, expectedIndex)
			}
			expectedBarcode := strings.TrimSpace(data.Candidates[item.Index].Product.Code)
			if strings.TrimSpace(item.Barcode) != expectedBarcode {
				return applied, fmt.Errorf("%s position=%d 条码不匹配", path, item.Position)
			}
			key := strconv.Itoa(item.Position) + ":" + expectedBarcode
			if seen[key] {
				return applied, fmt.Errorf("外部视觉证据重复 position=%d barcode=%s", item.Position, expectedBarcode)
			}
			seen[key] = true
			if data.Candidates[item.Index].QwenVisual != nil {
				continue
			}
			decision := item.Decision
			decision.Provider = provider
			decision.Model = firstNonEmpty(strings.TrimSpace(decision.Model), strings.TrimSpace(evidence.Model), "multimodal-agent")
			if strings.TrimSpace(decision.Reason) == "" || decision.Confidence < 0 || decision.Confidence > 1 {
				return applied, fmt.Errorf("%s position=%d 视觉结论无效", path, item.Position)
			}
			data.Candidates[item.Index].QwenVisual = &decision
			applied++
		}
	}
	return applied, nil
}

func applyCandidates(ctx context.Context, db *gorm.DB, candidates []candidate, reviewStatus string) (created, updated, skipped, failed int) {
	known, err := loadKnownBarcodes(ctx, db)
	if err != nil {
		log.Printf("加载现有条码失败: %v", err)
		return 0, 0, 0, len(candidates)
	}
	repo := foodrecordrepo.NewFoodNutritionRepo(db)
	for index := range candidates {
		item := candidates[index]
		if known[item.Product.Code] {
			skipped++
			continue
		}
		input := packagedInput(item, reviewStatus)
		_, action, upsertErr := repo.UpsertPackagedFoodWithAction(ctx, input)
		if upsertErr != nil {
			failed++
			log.Printf("写入包装商品失败 barcode=%s name=%s error=%v", item.Product.Code, preferredName(item.Product), upsertErr)
			continue
		}
		known[item.Product.Code] = true
		switch action {
		case "created":
			created++
		case "updated":
			updated++
		}
		if (index+1)%100 == 0 {
			fmt.Printf("写库进度 processed=%d/%d created=%d updated=%d skipped=%d failed=%d\n", index+1, len(candidates), created, updated, skipped, failed)
		}
	}
	return created, updated, skipped, failed
}

func acquireCatalogImportLock(ctx context.Context, db *gorm.DB) (func(), error) {
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	var acquired bool
	if err := conn.QueryRowContext(ctx,
		`SELECT pg_try_advisory_lock(hashtext($1::text)::bigint)`, openFoodFactsSource,
	).Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, fmt.Errorf("同一数据源已有导入任务正在写库")
	}
	return func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released bool
		if err := conn.QueryRowContext(unlockCtx,
			`SELECT pg_advisory_unlock(hashtext($1::text)::bigint)`, openFoodFactsSource,
		).Scan(&released); err != nil {
			log.Printf("释放 Open Food Facts 导入锁失败: %v", err)
		} else if !released {
			log.Printf("Open Food Facts 导入锁未处于当前数据库连接")
		}
		_ = conn.Close()
	}, nil
}

func packagedInput(item candidate, reviewStatus string) foodrecordrepo.PackagedFoodInput {
	p := item.Product
	name := preferredName(p)
	images := []string{p.ImageFrontURL}
	if validOFFImageURL(p.ImageNutritionURL) && p.ImageNutritionURL != p.ImageFrontURL {
		images = append(images, p.ImageNutritionURL)
	}
	searchParts := []string{name, p.ProductName, p.ProductNameZH, p.Brands, p.Quantity, item.ChineseCategory}
	searchParts = append(searchParts, item.ChineseSearchTerms...)
	kcal, _ := nutrient(p.Nutriments, "energy-kcal_100g")
	protein, _ := nutrient(p.Nutriments, "proteins_100g")
	carbs, _ := nutrient(p.Nutriments, "carbohydrates_100g")
	fat, _ := nutrient(p.Nutriments, "fat_100g")
	fieldConfidence := map[string]any{
		"identity": item.QualityScore, "image": item.QualityScore, "nutrition": item.QualityScore,
		"source": "Open Food Facts label data", "visual_sampled": item.QwenVisual != nil,
	}
	raw := map[string]any{
		"source": openFoodFactsSource, "source_license": openFoodFactsLicense,
		"database_license": "ODbL 1.0", "image_license": "CC BY-SA",
		"attribution": "Open Food Facts contributors", "barcode": p.Code,
		"completeness": p.Completeness, "quality_score": item.QualityScore,
		"quality_reasons": item.QualityReasons, "quality_warnings": p.DataQualityWarnings,
		"last_modified_t": p.LastModifiedUnixSeconds, "countries_tags": p.CountriesTags,
		"categories_tags": p.CategoriesTags, "chinese_search_terms": item.ChineseSearchTerms,
		"translation_model": qwenModel, "visual_decision": item.QwenVisual,
	}
	netValue, netUnit := normalizedQuantity(numberValue(p.ProductQuantity), p.ProductQuantityUnit)
	return foodrecordrepo.PackagedFoodInput{
		Brand: p.Brands, ProductName: name, DisplayName: strings.TrimSpace(strings.Join([]string{p.Brands, name}, " ")),
		SearchText: strings.Join(uniqueNonEmpty(searchParts), " "), SpecText: p.Quantity, Barcode: p.Code,
		PackageCategory: firstNonEmpty(item.ChineseCategory, p.Categories), IngredientsText: p.IngredientsText,
		SourceImageURLs: images, NutritionBasisUnit: "100g", EnergyUnitRaw: "kcal/100g",
		RawLabelPayload: raw, ConversionStatus: "source_per_100g", ExtractConfidence: item.QualityScore,
		FieldConfidence: fieldConfidence, IngestMethod: openFoodFactsIngest,
		NetContentValue: netValue, NetContentUnit: netUnit, NetWeightG: weightInGrams(netValue, netUnit),
		ServingWeightG: parseServingGrams(p.ServingSize), ReviewStatus: reviewStatus,
		KcalPer100g: kcal, ProteinPer100g: protein, CarbsPer100g: carbs, FatPer100g: fat,
		FiberPer100g: nutrientOrZero(p.Nutriments, "fiber_100g"), SugarPer100g: nutrientOrZero(p.Nutriments, "sugars_100g"),
		SaturatedFatPer100g:   nutrientOrZero(p.Nutriments, "saturated-fat_100g"),
		CholesterolMgPer100g:  nutrientOrZero(p.Nutriments, "cholesterol_100g") * 1000,
		SodiumMgPer100g:       nutrientOrZero(p.Nutriments, "sodium_100g") * 1000,
		PotassiumMgPer100g:    nutrientOrZero(p.Nutriments, "potassium_100g") * 1000,
		CalciumMgPer100g:      nutrientOrZero(p.Nutriments, "calcium_100g") * 1000,
		IronMgPer100g:         nutrientOrZero(p.Nutriments, "iron_100g") * 1000,
		MagnesiumMgPer100g:    nutrientOrZero(p.Nutriments, "magnesium_100g") * 1000,
		ZincMgPer100g:         nutrientOrZero(p.Nutriments, "zinc_100g") * 1000,
		VitaminARaeMcgPer100g: nutrientOrZero(p.Nutriments, "vitamin-a_100g") * 1_000_000,
		VitaminCMgPer100g:     nutrientOrZero(p.Nutriments, "vitamin-c_100g") * 1000,
		VitaminDMcgPer100g:    nutrientOrZero(p.Nutriments, "vitamin-d_100g") * 1_000_000,
		VitaminEMgPer100g:     nutrientOrZero(p.Nutriments, "vitamin-e_100g") * 1000,
		ThiaminMgPer100g:      nutrientOrZero(p.Nutriments, "vitamin-b1_100g") * 1000,
		RiboflavinMgPer100g:   nutrientOrZero(p.Nutriments, "vitamin-b2_100g") * 1000,
		NiacinMgPer100g:       nutrientOrZero(p.Nutriments, "vitamin-pp_100g") * 1000,
		VitaminB6MgPer100g:    nutrientOrZero(p.Nutriments, "vitamin-b6_100g") * 1000,
		FolateMcgPer100g:      nutrientOrZero(p.Nutriments, "vitamin-b9_100g") * 1_000_000,
		VitaminB12McgPer100g:  nutrientOrZero(p.Nutriments, "vitamin-b12_100g") * 1_000_000,
		SourceURL:             openFoodFactsBaseURL + "/product/" + url.PathEscape(p.Code), Source: openFoodFactsSource,
	}
}

func loadKnownBarcodes(ctx context.Context, db *gorm.DB) (map[string]bool, error) {
	var rows []string
	err := db.WithContext(ctx).Table("packaged_food_library").Where("barcode IS NOT NULL AND barcode <> ''").Pluck("barcode", &rows).Error
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		out[strings.TrimSpace(row)] = true
	}
	return out, err
}

func preferredName(product offProduct) string {
	return firstNonEmpty(product.ProductNameZH, product.ProductName)
}

func nutrient(values map[string]any, key string) (float64, bool) {
	value, ok := values[key]
	if !ok || value == nil {
		return 0, false
	}
	n := numberValue(value)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

func nutrientOrZero(values map[string]any, key string) float64 {
	value, _ := nutrient(values, key)
	return math.Max(0, value)
}

func validOFFImageURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Scheme == "https" && (parsed.Host == "images.openfoodfacts.org" || parsed.Host == "openfoodfacts-images.s3.eu-west-3.amazonaws.com")
}

func validGTIN(raw string) bool {
	code := strings.TrimSpace(raw)
	if len(code) < 8 || len(code) > 14 {
		return false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return false
		}
	}
	sum := 0
	weightThree := true
	for i := len(code) - 2; i >= 0; i-- {
		digit := int(code[i] - '0')
		if weightThree {
			digit *= 3
		}
		sum += digit
		weightThree = !weightThree
	}
	check := (10 - sum%10) % 10
	return check == int(code[len(code)-1]-'0')
}

var servingWeightPattern = regexp.MustCompile(`(?i)([0-9]+(?:\.[0-9]+)?)\s*(g\b|克)`)

func parseServingGrams(raw string) float64 {
	match := servingWeightPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if len(match) != 3 {
		return 0
	}
	value, _ := strconv.ParseFloat(match[1], 64)
	if value <= 0 || value > 10000 {
		return 0
	}
	return value
}

func normalizedQuantity(value float64, unit string) (float64, string) {
	unit = strings.ToLower(strings.TrimSpace(unit))
	if value <= 0 {
		return 0, ""
	}
	switch unit {
	case "g", "gram", "grams":
		return value, "g"
	case "kg":
		return value * 1000, "g"
	case "ml":
		return value, "ml"
	case "l", "liter", "litre":
		return value * 1000, "ml"
	default:
		return value, unit
	}
}

func weightInGrams(value float64, unit string) float64 {
	if unit == "g" {
		return value
	}
	return 0
}

func addUsage(budget *usageBudget, meta map[string]any) {
	input := int64(numberValue(firstAny(meta["input_tokens"], meta["prompt_tokens"])))
	output := int64(numberValue(firstAny(meta["output_tokens"], meta["completion_tokens"])))
	budget.InputTokens += input
	budget.OutputTokens += output
	budget.Calls++
	recalculateBudget(budget)
}

func recalculateBudget(budget *usageBudget) {
	budget.EstimatedCNY = float64(budget.InputTokens)/1_000_000*budget.InputCNYPerM + float64(budget.OutputTokens)/1_000_000*budget.OutputCNYPerM
}

func callQwenWithRetry(ctx context.Context, client catalogVisionClient, prompt string, imageURLs []string) (map[string]any, map[string]any, error) {
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		result, meta, err := client.AnalyzeWithImagesWithoutThinkingMeta(ctx, prompt, imageURLs)
		if err == nil {
			return result, meta, nil
		}
		lastErr = err
		delay := time.Duration(2*(1<<attempt)) * time.Second
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(delay):
		}
	}
	return nil, nil, fmt.Errorf("千问调用重试失败: %w", lastErr)
}

func ensureBudget(budget usageBudget) error {
	if budget.EstimatedCNY >= budget.LimitCNY {
		return fmt.Errorf("预计千问成本 %.2f 元已达到授权上限 %.2f 元", budget.EstimatedCNY, budget.LimitCNY)
	}
	return nil
}

func evenlySpacedIndices(total, count int) []int {
	if count <= 0 || total <= 0 {
		return nil
	}
	if count >= total {
		out := make([]int, total)
		for i := range out {
			out[i] = i
		}
		return out
	}
	out := make([]int, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, int(math.Round(float64(i)*float64(total-1)/float64(count-1))))
	}
	return out
}

func cleanTerms(value any) []string {
	items := anySlice(value)
	out := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		term := strings.TrimSpace(stringValue(item))
		if term == "" || len([]rune(term)) > 40 || seen[term] {
			continue
		}
		seen[term] = true
		out = append(out, term)
		if len(out) == 5 {
			break
		}
	}
	return out
}

func anySlice(value any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%v", value)
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		parsed, _ := strconv.ParseBool(v)
		return parsed
	default:
		return false
	}
}

func numberValue(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		n, _ := v.Float64()
		return n
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return n
	default:
		return 0
	}
}

func firstAny(values ...any) any {
	for _, value := range values {
		if value != nil && numberValue(value) > 0 {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func uniqueNonEmpty(values []string) []string {
	out := []string{}
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

func contains(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func writeJSON(path string, value any) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(dir, filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	defer os.Remove(tmp)
	if err := tmpFile.Chmod(0o600); err != nil {
		tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	var renameErr error
	for attempt := 0; attempt < 20; attempt++ {
		renameErr = os.Rename(tmp, path)
		if renameErr == nil {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return renameErr
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
