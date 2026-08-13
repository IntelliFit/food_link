package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/google/uuid"
	"github.com/longbridgeapp/opencc"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	tfdaSource      = "tfda_food_nutrition"
	tfdaDatasetURL  = "https://data.gov.tw/dataset/8543"
	tfdaResourceURL = "https://data.fda.gov.tw/opendata/exportDataList.do?InfoId=20&logType=5&method=ExportData"
	tfdaLicense     = "Open Government Data License, version 1.0"
	tfdaLicenseURL  = "https://data.gov.tw/license"
	tfdaAttribution = "卫生福利部食品药物管理署 食品营养成分资料集"
	importLockID    = int64(704631921177)
)

var mappedNutrients = []string{
	"kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g",
	"fiber_per_100g", "sugar_per_100g", "saturated_fat_per_100g",
	"cholesterol_mg_per_100g", "sodium_mg_per_100g", "potassium_mg_per_100g",
	"calcium_mg_per_100g", "iron_mg_per_100g", "magnesium_mg_per_100g", "zinc_mg_per_100g",
	"vitamin_c_mg_per_100g", "vitamin_d_mcg_per_100g", "vitamin_e_mg_per_100g",
	"thiamin_mg_per_100g", "riboflavin_mg_per_100g", "niacin_mg_per_100g",
	"vitamin_b6_mg_per_100g", "folate_mcg_per_100g", "vitamin_b12_mcg_per_100g",
}

type options struct {
	configDir     string
	inputPath     string
	reviewPath    string
	reportPath    string
	onlyIDs       string
	limit         int
	apply         bool
	requireImages bool
	timeout       time.Duration
	verifyQueries string
}

type tfdaRow struct {
	Category         string  `json:"食品分類"`
	DataType         string  `json:"資料類別"`
	IntegrationID    string  `json:"整合編號"`
	SampleName       string  `json:"樣品名稱"`
	CommonNames      *string `json:"俗名"`
	EnglishName      *string `json:"樣品英文名稱"`
	Description      *string `json:"內容物描述"`
	WasteRate        *string `json:"廢棄率"`
	NutrientCategory string  `json:"分析項分類"`
	NutrientName     string  `json:"分析項"`
	Unit             *string `json:"含量單位"`
	Per100g          *string `json:"每100克含量"`
	SampleCount      *string `json:"樣本數"`
	StdDev           *string `json:"標準差"`
}

type nutrientValue struct {
	Value       float64  `json:"value"`
	Unit        string   `json:"unit"`
	SampleCount *int     `json:"sample_count,omitempty"`
	StdDev      *float64 `json:"stddev,omitempty"`
}

type sourceFood struct {
	IntegrationID string
	Category      string
	DataType      string
	OriginalName  string
	CanonicalName string
	CommonNames   string
	EnglishName   string
	Description   string
	WasteRate     string
	Nutrients     map[string]nutrientValue
}

type reviewManifest struct {
	Version       string                 `json:"version"`
	Entries       map[string]reviewEntry `json:"entries"`
	UnsafeAliases []unsafeAlias          `json:"unsafe_aliases"`
}

type reviewEntry struct {
	CanonicalName             string      `json:"canonical_name"`
	AdoptExisting             bool        `json:"adopt_existing"`
	ExpectedExistingCanonical string      `json:"expected_existing_canonical"`
	ExpectedExistingSource    string      `json:"expected_existing_source"`
	ApprovedAliases           []string    `json:"approved_aliases"`
	CandidateAliases          []string    `json:"candidate_aliases"`
	ReplaceAliases            []string    `json:"replace_aliases"`
	ImageReuse                *imageReuse `json:"image_reuse,omitempty"`
}

type imageReuse struct {
	SourceFoodID          string `json:"source_food_id"`
	ExpectedCanonicalName string `json:"expected_canonical_name"`
}

type unsafeAlias struct {
	Alias             string `json:"alias"`
	WrongTargetPrefix string `json:"wrong_target_prefix"`
	Reason            string `json:"reason"`
}

type importReport struct {
	StartedAt            time.Time     `json:"started_at"`
	FinishedAt           time.Time     `json:"finished_at"`
	Applied              bool          `json:"applied"`
	InputPath            string        `json:"input_path"`
	InputSHA256          string        `json:"input_sha256"`
	ReviewVersion        string        `json:"review_version"`
	SourceRows           int           `json:"source_rows"`
	SourceFoods          int           `json:"source_foods"`
	Selected             int           `json:"selected"`
	Ready                int           `json:"ready"`
	Created              int           `json:"created"`
	Updated              int           `json:"updated"`
	AlreadyPresent       int           `json:"already_present"`
	Rejected             int           `json:"rejected"`
	Conflicts            int           `json:"conflicts"`
	WithImages           int           `json:"with_images"`
	MissingImages        int           `json:"missing_images"`
	AliasesCreated       int           `json:"aliases_created"`
	AliasesUpdated       int           `json:"aliases_updated"`
	UnsafeAliasesBlocked int           `json:"unsafe_aliases_blocked"`
	Entries              []entryReport `json:"entries"`
}

type entryReport struct {
	IntegrationID    string   `json:"integration_id"`
	OriginalName     string   `json:"original_name"`
	CanonicalName    string   `json:"canonical_name"`
	FoodID           string   `json:"food_id,omitempty"`
	Status           string   `json:"status"`
	HasImage         bool     `json:"has_image"`
	MissingNutrients []string `json:"missing_nutrients,omitempty"`
	Reason           string   `json:"reason,omitempty"`
}

func main() {
	opts := parseFlags()
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	review, err := readReview(opts.reviewPath)
	if err != nil {
		log.Fatalf("读取 TFDA 人工审核清单失败: %v", err)
	}
	converter, err := opencc.New("t2s")
	if err != nil {
		log.Fatalf("初始化繁简转换失败: %v", err)
	}
	foods, sourceRows, inputHash, err := readTFDA(opts.inputPath, converter)
	if err != nil {
		log.Fatalf("读取 TFDA 数据失败: %v", err)
	}
	selected, err := selectFoods(foods, opts.onlyIDs, opts.limit)
	if err != nil {
		log.Fatalf("筛选 TFDA 数据失败: %v", err)
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
	if strings.TrimSpace(cfg.Database.Schema) != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			log.Fatalf("设置数据库 schema 失败: %v", err)
		}
	}

	report := importReport{
		StartedAt: time.Now(), Applied: opts.apply, InputPath: opts.inputPath,
		InputSHA256: inputHash, ReviewVersion: review.Version,
		SourceRows: sourceRows, SourceFoods: len(foods), Selected: len(selected),
	}
	process := func(tx *gorm.DB) error {
		blocked, blockErr := blockUnsafeAliases(ctx, tx, review.UnsafeAliases, opts.apply)
		if blockErr != nil {
			return blockErr
		}
		report.UnsafeAliasesBlocked = blocked
		return processFoods(ctx, tx, selected, review, opts, inputHash, &report)
	}
	if opts.apply {
		err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if lockErr := tx.Exec("SELECT pg_advisory_xact_lock(?)", importLockID).Error; lockErr != nil {
				return lockErr
			}
			return process(tx)
		})
	} else {
		err = process(db)
	}
	report.FinishedAt = time.Now()
	if writeErr := writeJSON(opts.reportPath, report); writeErr != nil {
		log.Fatalf("保存 TFDA 导入报告失败: %v", writeErr)
	}
	if err != nil {
		log.Fatalf("TFDA 导入失败（写库事务已回滚）: %v；报告=%s", err, opts.reportPath)
	}
	if err := verifyNutritionSearches(ctx, db, opts.verifyQueries); err != nil {
		log.Fatalf("验证用户端营养搜索失败: %v", err)
	}
	fmt.Printf("TFDA 导入完成 source_foods=%d selected=%d ready=%d created=%d updated=%d present=%d rejected=%d conflicts=%d images=%d/%d aliases_created=%d aliases_updated=%d unsafe_blocked=%d apply=%v report=%s\n",
		report.SourceFoods, report.Selected, report.Ready, report.Created, report.Updated,
		report.AlreadyPresent, report.Rejected, report.Conflicts, report.WithImages, report.Selected,
		report.AliasesCreated, report.AliasesUpdated, report.UnsafeAliasesBlocked, opts.apply, opts.reportPath)
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "后端配置目录")
	flag.StringVar(&opts.inputPath, "input", "tmp/tfda-import/tfda-food-nutrition.zip", "TFDA 官方 JSON、CSV 或 ZIP")
	flag.StringVar(&opts.reviewPath, "review", "data/tfda_food_import_review.json", "人工审核 canonical/alias/图片复用清单")
	flag.StringVar(&opts.reportPath, "report", "tmp/tfda-import/import-report.json", "审计报告路径")
	flag.StringVar(&opts.onlyIDs, "only-ids", "", "仅处理逗号分隔的 TFDA 整合编号")
	flag.IntVar(&opts.limit, "limit", 0, "最多处理 N 个食物，0=全部")
	flag.BoolVar(&opts.apply, "apply", false, "写入数据库；默认 dry-run")
	flag.BoolVar(&opts.requireImages, "require-images", false, "缺少有许可证图片时拒绝该条")
	flag.DurationVar(&opts.timeout, "timeout", 30*time.Minute, "任务总超时")
	flag.StringVar(&opts.verifyQueries, "verify-queries", "", "逗号分隔的用户端营养搜索词；输出实际召回名称")
	flag.Parse()
	return opts
}

func verifyNutritionSearches(ctx context.Context, db *gorm.DB, queryCSV string) error {
	queries := splitAliases(queryCSV)
	if len(queries) == 0 {
		return nil
	}
	repository := foodrepo.NewFoodNutritionRepo(db)
	for _, query := range queries {
		foods, err := repository.Search(ctx, query, 10)
		if err != nil {
			return fmt.Errorf("搜索 %q: %w", query, err)
		}
		if err := validateNutritionSearchHits(query, foods); err != nil {
			return err
		}
		names := make([]string, 0, len(foods))
		for _, food := range foods {
			names = append(names, food.CanonicalName)
		}
		fmt.Printf("TFDA 用户端搜索验证 query=%q results=%q\n", query, names)
	}
	return nil
}

func validateNutritionSearchHits(query string, foods []fooddomain.FoodNutrition) error {
	if len(foods) == 0 {
		return fmt.Errorf("搜索 %q 未召回任何营养食物", query)
	}
	return nil
}

func validateTFDACSVColumns(columns map[string]int) error {
	required := []string{"整合編號", "樣品名稱", "分析項", "含量單位", "每100克含量"}
	missing := make([]string, 0)
	for _, name := range required {
		if _, ok := columns[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("TFDA CSV 缺少必需欄位: %s", strings.Join(missing, ", "))
	}
	return nil
}

func readTFDA(path string, converter *opencc.OpenCC) (map[string]*sourceFood, int, string, error) {
	dataHash, err := fileSHA256(path)
	if err != nil {
		return nil, 0, "", err
	}
	reader, format, closer, err := openDataReader(path)
	if err != nil {
		return nil, 0, "", err
	}
	defer closer()
	foods := map[string]*sourceFood{}
	rowCount := 0
	consume := func(row tfdaRow) error {
		rowCount++
		return accumulateTFDARow(foods, row, converter)
	}
	if format == "json" {
		dec := json.NewDecoder(reader)
		token, decodeErr := dec.Token()
		if decodeErr != nil || token != json.Delim('[') {
			return nil, 0, "", errors.New("TFDA JSON 顶层必须是数组")
		}
		for dec.More() {
			var row tfdaRow
			if decodeErr := dec.Decode(&row); decodeErr != nil {
				return nil, rowCount, "", decodeErr
			}
			if consumeErr := consume(row); consumeErr != nil {
				return nil, rowCount, "", consumeErr
			}
		}
	} else {
		csvReader := csv.NewReader(reader)
		csvReader.FieldsPerRecord = -1
		header, readErr := csvReader.Read()
		if readErr != nil {
			return nil, 0, "", readErr
		}
		columns := map[string]int{}
		for idx, name := range header {
			columns[strings.TrimPrefix(strings.TrimSpace(name), "\ufeff")] = idx
		}
		if err := validateTFDACSVColumns(columns); err != nil {
			return nil, 0, "", err
		}
		value := func(record []string, name string) string {
			idx, ok := columns[name]
			if !ok || idx >= len(record) {
				return ""
			}
			return record[idx]
		}
		optional := func(record []string, name string) *string {
			v := value(record, name)
			if strings.TrimSpace(v) == "" {
				return nil
			}
			return &v
		}
		for {
			record, readErr := csvReader.Read()
			if errors.Is(readErr, io.EOF) {
				break
			}
			if readErr != nil {
				return nil, rowCount, "", readErr
			}
			row := tfdaRow{
				Category: value(record, "食品分類"), DataType: value(record, "資料類別"),
				IntegrationID: value(record, "整合編號"), SampleName: value(record, "樣品名稱"),
				CommonNames: optional(record, "俗名"), EnglishName: optional(record, "樣品英文名稱"),
				Description: optional(record, "內容物描述"), WasteRate: optional(record, "廢棄率"),
				NutrientCategory: value(record, "分析項分類"), NutrientName: value(record, "分析項"),
				Unit: optional(record, "含量單位"), Per100g: optional(record, "每100克含量"),
				SampleCount: optional(record, "樣本數"), StdDev: optional(record, "標準差"),
			}
			if consumeErr := consume(row); consumeErr != nil {
				return nil, rowCount, "", consumeErr
			}
		}
	}
	if len(foods) == 0 {
		return nil, rowCount, "", errors.New("TFDA 数据未解析出任何有效食物")
	}
	return foods, rowCount, dataHash, nil
}

func accumulateTFDARow(foods map[string]*sourceFood, row tfdaRow, converter *opencc.OpenCC) error {
	id := strings.TrimSpace(row.IntegrationID)
	name := strings.TrimSpace(row.SampleName)
	if id == "" || name == "" {
		return nil
	}
	food := foods[id]
	if food == nil {
		canonical, err := converter.Convert(name)
		if err != nil {
			return err
		}
		food = &sourceFood{
			IntegrationID: id, Category: strings.TrimSpace(row.Category), DataType: strings.TrimSpace(row.DataType),
			OriginalName: name, CanonicalName: normalizePunctuation(strings.TrimSpace(canonical)),
			CommonNames: stringValue(row.CommonNames), EnglishName: stringValue(row.EnglishName),
			Description: stringValue(row.Description), WasteRate: stringValue(row.WasteRate),
			Nutrients: map[string]nutrientValue{},
		}
		foods[id] = food
	}
	field, expectedUnit, ok := nutrientField(row.NutrientName)
	if !ok || row.Per100g == nil || strings.TrimSpace(stringValue(row.Unit)) != expectedUnit {
		return nil
	}
	value, err := parseNumber(*row.Per100g)
	if err != nil {
		return nil
	}
	nv := nutrientValue{Value: value, Unit: expectedUnit}
	if row.SampleCount != nil {
		if n, countErr := strconv.Atoi(strings.TrimSpace(*row.SampleCount)); countErr == nil {
			nv.SampleCount = &n
		}
	}
	if row.StdDev != nil {
		if std, stdErr := parseNumber(*row.StdDev); stdErr == nil {
			nv.StdDev = &std
		}
	}
	food.Nutrients[field] = nv
	return nil
}

func openDataReader(path string) (io.Reader, string, func(), error) {
	clean := filepath.Clean(path)
	if strings.EqualFold(filepath.Ext(clean), ".zip") {
		archive, err := zip.OpenReader(clean)
		if err != nil {
			return nil, "", func() {}, err
		}
		for _, file := range archive.File {
			ext := strings.ToLower(filepath.Ext(file.Name))
			if ext != ".json" && ext != ".csv" {
				continue
			}
			stream, openErr := file.Open()
			if openErr != nil {
				_ = archive.Close()
				return nil, "", func() {}, openErr
			}
			return stream, strings.TrimPrefix(ext, "."), func() { _ = stream.Close(); _ = archive.Close() }, nil
		}
		_ = archive.Close()
		return nil, "", func() {}, errors.New("ZIP 中没有 JSON 或 CSV 文件")
	}
	file, err := os.Open(clean)
	if err != nil {
		return nil, "", func() {}, err
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".json" && ext != ".csv" {
		_ = file.Close()
		return nil, "", func() {}, fmt.Errorf("不支持的 TFDA 文件格式 %s", ext)
	}
	return file, strings.TrimPrefix(ext, "."), func() { _ = file.Close() }, nil
}

func processFoods(ctx context.Context, db *gorm.DB, foods []*sourceFood, review reviewManifest, opts options, inputHash string, out *importReport) error {
	for _, food := range foods {
		entry := review.Entries[food.IntegrationID]
		if strings.TrimSpace(entry.CanonicalName) != "" {
			food.CanonicalName = strings.TrimSpace(entry.CanonicalName)
		}
		result := entryReport{IntegrationID: food.IntegrationID, OriginalName: food.OriginalName, CanonicalName: food.CanonicalName}
		missing := missingNutrients(food.Nutrients)
		result.MissingNutrients = missing
		if err := validateFood(food); err != nil {
			result.Status, result.Reason = "rejected", err.Error()
			out.Rejected++
			out.Entries = append(out.Entries, result)
			continue
		}
		var existing fooddomain.FoodNutrition
		foundBySource := false
		err := db.WithContext(ctx).Where("source = ? AND quality_evidence ->> 'integration_id' = ?", tfdaSource, food.IntegrationID).First(&existing).Error
		if err == nil {
			foundBySource = true
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		} else {
			err = db.WithContext(ctx).Where("normalized_name = ?", normalizeName(food.CanonicalName)).First(&existing).Error
			if err == nil {
				if !canAdoptExisting(existing, entry) {
					result.Status = "normalized_conflict"
					result.FoodID = existing.ID
					result.Reason = fmt.Sprintf("目标名称已属于 %s / %s", existing.Source, existing.CanonicalName)
					out.Conflicts++
					out.Entries = append(out.Entries, result)
					continue
				}
				foundBySource = true
			}
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}

		imageFood, imageErr := reviewedImage(ctx, db, entry.ImageReuse)
		if imageErr != nil {
			result.Status, result.Reason = "image_review_error", imageErr.Error()
			out.Rejected++
			out.Entries = append(out.Entries, result)
			continue
		}
		if foundBySource && foodImageCount(existing) > 0 {
			imageFood = &existing
		}
		result.HasImage = imageFood != nil && foodImageCount(*imageFood) > 0
		if opts.requireImages && !result.HasImage {
			result.Status, result.Reason = "missing_licensed_image", "未提供通过身份审核且保留许可证的图片"
			out.MissingImages++
			out.Rejected++
			out.Entries = append(out.Entries, result)
			continue
		}
		if result.HasImage {
			out.WithImages++
		} else {
			out.MissingImages++
		}
		out.Ready++
		if !opts.apply {
			result.Status = "ready"
			if foundBySource {
				result.FoodID = existing.ID
			}
			out.Entries = append(out.Entries, result)
			continue
		}

		now := time.Now().UTC()
		evidence := buildEvidence(food, review.Version, inputHash, missing, imageFood)
		if foundBySource {
			updates := nutritionUpdates(food, evidence, now)
			if imageFood != nil && foodImageCount(existing) == 0 {
				addImageUpdates(updates, *imageFood)
			}
			if err := db.WithContext(ctx).Model(&fooddomain.FoodNutrition{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
				return err
			}
			result.FoodID, result.Status = existing.ID, "updated"
			out.Updated++
		} else {
			row := newFoodRow(food, evidence, now, imageFood)
			if err := db.WithContext(ctx).Create(&row).Error; err != nil {
				return err
			}
			result.FoodID, result.Status = row.ID, "created"
			out.Created++
			existing = row
		}
		created, updated, aliasErr := upsertAliases(ctx, db, existing.ID, food, entry, review.Version, now)
		if aliasErr != nil {
			return aliasErr
		}
		out.AliasesCreated += created
		out.AliasesUpdated += updated
		out.Entries = append(out.Entries, result)
	}
	return nil
}

func canAdoptExisting(existing fooddomain.FoodNutrition, review reviewEntry) bool {
	if !review.AdoptExisting {
		return false
	}
	return existing.CanonicalName == strings.TrimSpace(review.ExpectedExistingCanonical) &&
		existing.Source == strings.TrimSpace(review.ExpectedExistingSource)
}

func reviewedImage(ctx context.Context, db *gorm.DB, reuse *imageReuse) (*fooddomain.FoodNutrition, error) {
	if reuse == nil || strings.TrimSpace(reuse.SourceFoodID) == "" {
		return nil, nil
	}
	var source fooddomain.FoodNutrition
	if err := db.WithContext(ctx).Where("id = ?", reuse.SourceFoodID).First(&source).Error; err != nil {
		return nil, err
	}
	if source.CanonicalName != reuse.ExpectedCanonicalName {
		return nil, fmt.Errorf("图片来源 canonical 漂移: %s", source.CanonicalName)
	}
	if foodImageCount(source) == 0 {
		return nil, errors.New("审核图片来源已无图片")
	}
	if strings.TrimSpace(stringPtr(source.ImageLicense)) == "" {
		return nil, errors.New("审核图片来源缺少许可证元数据，禁止复用")
	}
	return &source, nil
}

func validateFood(food *sourceFood) error {
	for _, field := range []string{"kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g"} {
		if _, ok := food.Nutrients[field]; !ok {
			return fmt.Errorf("缺少核心营养 %s", field)
		}
	}
	kcal := food.Nutrients["kcal_per_100g"].Value
	protein := food.Nutrients["protein_per_100g"].Value
	carbs := food.Nutrients["carbs_per_100g"].Value
	fat := food.Nutrients["fat_per_100g"].Value
	if !validRange(kcal, 0, 950) || !validRange(protein, 0, 100) || !validRange(carbs, 0, 100) || !validRange(fat, 0, 100) {
		return errors.New("核心营养超出物理范围")
	}
	macroEnergy := protein*4 + carbs*4 + fat*9
	if math.Abs(macroEnergy-kcal) > math.Max(80, kcal*0.45) {
		return fmt.Errorf("能量闭合异常 label=%.1f macro=%.1f", kcal, macroEnergy)
	}
	return nil
}

func newFoodRow(food *sourceFood, evidence datatypes.JSONMap, now time.Time, image *fooddomain.FoodNutrition) fooddomain.FoodNutrition {
	row := fooddomain.FoodNutrition{
		ID: uuid.NewString(), CanonicalName: food.CanonicalName, NormalizedName: normalizeName(food.CanonicalName),
		Source: tfdaSource, IsActive: true, QualityTier: fooddomain.NutritionQualityAuthoritative,
		QualityEvidence: evidence, QualityReviewedAt: &now,
	}
	assignNutrition(&row, food.Nutrients)
	if image != nil {
		copyImage(&row, *image)
	}
	return row
}

func nutritionUpdates(food *sourceFood, evidence datatypes.JSONMap, now time.Time) map[string]any {
	row := newFoodRow(food, evidence, now, nil)
	return map[string]any{
		"canonical_name": row.CanonicalName, "normalized_name": row.NormalizedName,
		"kcal_per_100g": row.KcalPer100g, "protein_per_100g": row.ProteinPer100g,
		"carbs_per_100g": row.CarbsPer100g, "fat_per_100g": row.FatPer100g,
		"fiber_per_100g": row.FiberPer100g, "sugar_per_100g": row.SugarPer100g,
		"saturated_fat_per_100g": row.SaturatedFatPer100g, "cholesterol_mg_per_100g": row.CholesterolMgPer100g,
		"sodium_mg_per_100g": row.SodiumMgPer100g, "potassium_mg_per_100g": row.PotassiumMgPer100g,
		"calcium_mg_per_100g": row.CalciumMgPer100g, "iron_mg_per_100g": row.IronMgPer100g,
		"magnesium_mg_per_100g": row.MagnesiumMgPer100g, "zinc_mg_per_100g": row.ZincMgPer100g,
		"vitamin_c_mg_per_100g": row.VitaminCMgPer100g, "vitamin_d_mcg_per_100g": row.VitaminDMcgPer100g,
		"vitamin_e_mg_per_100g": row.VitaminEMgPer100g, "thiamin_mg_per_100g": row.ThiaminMgPer100g,
		"riboflavin_mg_per_100g": row.RiboflavinMgPer100g, "niacin_mg_per_100g": row.NiacinMgPer100g,
		"vitamin_b6_mg_per_100g": row.VitaminB6MgPer100g, "folate_mcg_per_100g": row.FolateMcgPer100g,
		"vitamin_b12_mcg_per_100g": row.VitaminB12McgPer100g,
		"source":                   tfdaSource, "is_active": true, "quality_tier": fooddomain.NutritionQualityAuthoritative,
		"quality_evidence": evidence, "quality_reviewed_at": now, "updated_at": now,
	}
}

func assignNutrition(row *fooddomain.FoodNutrition, values map[string]nutrientValue) {
	value := func(field string) float64 { return values[field].Value }
	row.KcalPer100g = value("kcal_per_100g")
	row.ProteinPer100g = value("protein_per_100g")
	row.CarbsPer100g = value("carbs_per_100g")
	row.FatPer100g = value("fat_per_100g")
	row.FiberPer100g = value("fiber_per_100g")
	row.SugarPer100g = value("sugar_per_100g")
	row.SaturatedFatPer100g = value("saturated_fat_per_100g")
	row.CholesterolMgPer100g = value("cholesterol_mg_per_100g")
	row.SodiumMgPer100g = value("sodium_mg_per_100g")
	row.PotassiumMgPer100g = value("potassium_mg_per_100g")
	row.CalciumMgPer100g = value("calcium_mg_per_100g")
	row.IronMgPer100g = value("iron_mg_per_100g")
	row.MagnesiumMgPer100g = value("magnesium_mg_per_100g")
	row.ZincMgPer100g = value("zinc_mg_per_100g")
	row.VitaminCMgPer100g = value("vitamin_c_mg_per_100g")
	row.VitaminDMcgPer100g = value("vitamin_d_mcg_per_100g")
	row.VitaminEMgPer100g = value("vitamin_e_mg_per_100g")
	row.ThiaminMgPer100g = value("thiamin_mg_per_100g")
	row.RiboflavinMgPer100g = value("riboflavin_mg_per_100g")
	row.NiacinMgPer100g = value("niacin_mg_per_100g")
	row.VitaminB6MgPer100g = value("vitamin_b6_mg_per_100g")
	row.FolateMcgPer100g = value("folate_mcg_per_100g")
	row.VitaminB12McgPer100g = value("vitamin_b12_mcg_per_100g")
}

func upsertAliases(ctx context.Context, db *gorm.DB, foodID string, food *sourceFood, review reviewEntry, reviewVersion string, now time.Time) (int, int, error) {
	type aliasInput struct {
		Name, Status string
		Replace      bool
	}
	inputs := []aliasInput{}
	if food.OriginalName != food.CanonicalName {
		inputs = append(inputs, aliasInput{food.OriginalName, fooddomain.NutritionAliasApprovedExact, false})
	}
	for _, alias := range review.ApprovedAliases {
		inputs = append(inputs, aliasInput{alias, fooddomain.NutritionAliasApprovedExact, containsNormalized(review.ReplaceAliases, alias)})
	}
	for _, alias := range review.CandidateAliases {
		inputs = append(inputs, aliasInput{alias, fooddomain.NutritionAliasCandidateOnly, false})
	}
	for _, alias := range splitAliases(food.CommonNames) {
		inputs = append(inputs, aliasInput{alias, fooddomain.NutritionAliasCandidateOnly, false})
	}
	created, updated := 0, 0
	seen := map[string]bool{}
	for _, input := range inputs {
		normalized := normalizeName(input.Name)
		if normalized == "" || normalized == normalizeName(food.CanonicalName) || seen[normalized] {
			continue
		}
		seen[normalized] = true
		var existing fooddomain.FoodNutritionAlias
		err := db.WithContext(ctx).Where("normalized_alias = ?", normalized).First(&existing).Error
		evidence := datatypes.JSONMap{"source": tfdaSource, "integration_id": food.IntegrationID, "review_version": reviewVersion, "identity_rule": "tfda_source_or_curated_state_alias"}
		if err == nil {
			if existing.FoodID != foodID && !input.Replace {
				continue
			}
			if existing.FoodID == foodID && existing.MatchStatus == input.Status {
				continue
			}
			if err := db.WithContext(ctx).Model(&fooddomain.FoodNutritionAlias{}).Where("id = ?", existing.ID).Updates(map[string]any{
				"food_id": foodID, "alias_name": input.Name, "match_status": input.Status,
				"approval_evidence": evidence, "reviewed_at": now, "updated_at": now,
			}).Error; err != nil {
				return created, updated, err
			}
			updated++
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return created, updated, err
		}
		row := map[string]any{"id": uuid.NewString(), "food_id": foodID, "alias_name": input.Name, "normalized_alias": normalized,
			"match_status": input.Status, "approval_evidence": evidence, "reviewed_at": now, "created_at": now, "updated_at": now}
		if err := db.WithContext(ctx).Table("food_nutrition_aliases").Create(row).Error; err != nil {
			return created, updated, err
		}
		created++
	}
	return created, updated, nil
}

func blockUnsafeAliases(ctx context.Context, db *gorm.DB, aliases []unsafeAlias, apply bool) (int, error) {
	blocked := 0
	for _, item := range aliases {
		type row struct{ AliasID, CanonicalName, Status string }
		var found row
		err := db.WithContext(ctx).Raw(`SELECT a.id AS alias_id, f.canonical_name, a.match_status AS status FROM food_nutrition_aliases a JOIN food_nutrition_library f ON f.id=a.food_id WHERE a.normalized_alias=?`, normalizeName(item.Alias)).Scan(&found).Error
		if err != nil {
			return blocked, err
		}
		if found.AliasID == "" || !strings.HasPrefix(strings.ToLower(found.CanonicalName), strings.ToLower(item.WrongTargetPrefix)) || found.Status == fooddomain.NutritionAliasBlocked {
			continue
		}
		blocked++
		if !apply {
			continue
		}
		evidence := datatypes.JSONMap{"source": "tfda_species_identity_audit", "reason": item.Reason, "wrong_target": found.CanonicalName, "blocked_at": time.Now().UTC().Format(time.RFC3339)}
		if err := db.WithContext(ctx).Table("food_nutrition_aliases").Where("id = ?", found.AliasID).Updates(map[string]any{"match_status": fooddomain.NutritionAliasBlocked, "approval_evidence": evidence, "reviewed_at": time.Now().UTC(), "updated_at": time.Now().UTC()}).Error; err != nil {
			return blocked, err
		}
	}
	return blocked, nil
}

func buildEvidence(food *sourceFood, reviewVersion, inputHash string, missing []string, image *fooddomain.FoodNutrition) datatypes.JSONMap {
	nutrients := map[string]any{}
	for key, value := range food.Nutrients {
		nutrients[key] = value
	}
	evidence := datatypes.JSONMap{
		"provider": "卫生福利部食品药物管理署", "dataset": "食品营养成分资料集",
		"dataset_url": tfdaDatasetURL, "resource_url": tfdaResourceURL, "input_sha256": inputHash,
		"license": tfdaLicense, "license_url": tfdaLicenseURL, "attribution": tfdaAttribution,
		"integration_id": food.IntegrationID, "original_name_zh_tw": food.OriginalName,
		"common_names_zh_tw": food.CommonNames, "english_name": food.EnglishName,
		"food_category_zh_tw": food.Category, "data_type_zh_tw": food.DataType,
		"content_description_zh_tw": food.Description, "waste_rate_raw": food.WasteRate,
		"nutrition_basis": "per_100g_edible_portion", "transformation": "opencc_t2s",
		"mapped_nutrients": nutrients, "missing_mapped_nutrients": missing,
		"review_manifest_version": reviewVersion, "reviewed_at": time.Now().UTC().Format(time.RFC3339),
		"vitamin_a_policy": "not_mapped_RE_is_not_assumed_RAE", "vitamin_k_policy": "not_summed_from_partial_components",
	}
	if image != nil {
		evidence["image_reuse"] = map[string]any{"source_food_id": image.ID, "source_canonical_name": image.CanonicalName, "license": stringPtr(image.ImageLicense)}
	}
	return evidence
}

func readReview(path string) (reviewManifest, error) {
	var review reviewManifest
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return review, err
	}
	if err := json.Unmarshal(data, &review); err != nil {
		return review, err
	}
	if strings.TrimSpace(review.Version) == "" || len(review.Entries) == 0 {
		return review, errors.New("review version/entries 不能为空")
	}
	return review, nil
}

func selectFoods(all map[string]*sourceFood, onlyCSV string, limit int) ([]*sourceFood, error) {
	only := map[string]bool{}
	for _, id := range strings.Split(onlyCSV, ",") {
		if id = strings.TrimSpace(id); id != "" {
			only[id] = true
		}
	}
	if len(only) > 0 {
		for id := range only {
			if all[id] == nil {
				return nil, fmt.Errorf("找不到 TFDA 整合编号 %s", id)
			}
		}
	}
	ids := make([]string, 0, len(all))
	for id := range all {
		if len(only) == 0 || only[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]*sourceFood, 0, len(ids))
	for _, id := range ids {
		out = append(out, all[id])
	}
	return out, nil
}

func nutrientField(name string) (string, string, bool) {
	switch strings.TrimSpace(name) {
	case "熱量":
		return "kcal_per_100g", "kcal", true
	case "粗蛋白":
		return "protein_per_100g", "g", true
	case "總碳水化合物":
		return "carbs_per_100g", "g", true
	case "粗脂肪":
		return "fat_per_100g", "g", true
	case "膳食纖維":
		return "fiber_per_100g", "g", true
	case "糖質總量":
		return "sugar_per_100g", "g", true
	case "飽和脂肪":
		return "saturated_fat_per_100g", "g", true
	case "膽固醇":
		return "cholesterol_mg_per_100g", "mg", true
	case "鈉":
		return "sodium_mg_per_100g", "mg", true
	case "鉀":
		return "potassium_mg_per_100g", "mg", true
	case "鈣":
		return "calcium_mg_per_100g", "mg", true
	case "鐵":
		return "iron_mg_per_100g", "mg", true
	case "鎂":
		return "magnesium_mg_per_100g", "mg", true
	case "鋅":
		return "zinc_mg_per_100g", "mg", true
	case "維生素C":
		return "vitamin_c_mg_per_100g", "mg", true
	case "維生素D總量(ug)":
		return "vitamin_d_mcg_per_100g", "ug", true
	case "維生素E總量":
		return "vitamin_e_mg_per_100g", "mg", true
	case "維生素B1":
		return "thiamin_mg_per_100g", "mg", true
	case "維生素B2":
		return "riboflavin_mg_per_100g", "mg", true
	case "菸鹼素":
		return "niacin_mg_per_100g", "mg", true
	case "維生素B6":
		return "vitamin_b6_mg_per_100g", "mg", true
	case "葉酸":
		return "folate_mcg_per_100g", "ug", true
	case "維生素B12":
		return "vitamin_b12_mcg_per_100g", "ug", true
	default:
		return "", "", false
	}
}

func missingNutrients(values map[string]nutrientValue) []string {
	out := []string{}
	for _, field := range mappedNutrients {
		if _, ok := values[field]; !ok {
			out = append(out, field)
		}
	}
	return out
}
func parseNumber(raw string) (float64, error) {
	value := strings.TrimSpace(raw)
	if value == "" || value == "-" || strings.EqualFold(value, "tr") {
		return 0, errors.New("missing")
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return 0, errors.New("invalid number")
	}
	return n, nil
}
func normalizePunctuation(value string) string {
	return strings.NewReplacer("(", "（", ")", "）", ";", "；").Replace(value)
}
func normalizeName(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func splitAliases(value string) []string {
	return uniqueStrings(strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '，' || r == ';' || r == '；' || r == '、' }))
}
func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := normalizeName(value)
		if key != "" && !seen[key] {
			seen[key] = true
			out = append(out, value)
		}
	}
	return out
}
func containsNormalized(values []string, target string) bool {
	key := normalizeName(target)
	for _, value := range values {
		if normalizeName(value) == key {
			return true
		}
	}
	return false
}
func validRange(value, minValue, maxValue float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minValue && value <= maxValue
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func fileSHA256(path string) (string, error) {
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(filepath.Clean(path)), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Clean(path), append(data, '\n'), 0o644)
}
func quoteIdent(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
func foodImageCount(food fooddomain.FoodNutrition) int {
	seen := map[string]bool{}
	if food.ImagePath != nil && strings.TrimSpace(*food.ImagePath) != "" {
		seen[strings.TrimSpace(*food.ImagePath)] = true
	}
	for _, path := range food.ImagePaths {
		if strings.TrimSpace(path) != "" {
			seen[strings.TrimSpace(path)] = true
		}
	}
	return len(seen)
}
func copyImage(target *fooddomain.FoodNutrition, source fooddomain.FoodNutrition) {
	target.ImagePath = source.ImagePath
	target.ImagePaths = append([]string(nil), source.ImagePaths...)
	target.ImageSourceURL = source.ImageSourceURL
	target.ImageSourceLabel = source.ImageSourceLabel
	target.ImageLicense = source.ImageLicense
}
func addImageUpdates(updates map[string]any, source fooddomain.FoodNutrition) {
	updates["image_path"] = source.ImagePath
	updates["image_paths"] = source.ImagePaths
	updates["image_source_url"] = source.ImageSourceURL
	updates["image_source_label"] = source.ImageSourceLabel
	updates["image_license"] = source.ImageLicense
}
