package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"encoding/xml"
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
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	defaultSource      = "boohee_ui_food_batch_001"
	defaultQualityTier = fooddomain.NutritionQualityUnreviewed
	importLockID       = int64(704631921178)
)

type options struct {
	configDir string
	inputPath string
	report    string
	source    string
	apply     bool
	timeout   time.Duration
}

type sourceRow struct {
	Sequence            int
	SearchTerm          string
	ActualName          string
	RecommendationLevel string
	Basis               string
	Kcal                *float64
	EnergyKJ            *float64
	Carbs               *float64
	Protein             *float64
	Fat                 *float64
	Fiber               *float64
	Sugar               *float64
	Sodium              *float64
	RevisionDate        string
	LimitationNote      string
}

type importCandidate struct {
	Sequence       int
	CanonicalName  string
	NormalizedName string
	Kcal           float64
	Protein        float64
	Carbs          float64
	Fat            float64
	Fiber          float64
	Sugar          float64
	Sodium         float64
	Evidence       datatypes.JSONMap
}

type rejectedRow struct {
	Sequence   int    `json:"sequence"`
	SearchTerm string `json:"search_term,omitempty"`
	ActualName string `json:"actual_name,omitempty"`
	Reason     string `json:"reason"`
}

type reportEntry struct {
	Sequence      int    `json:"sequence"`
	CanonicalName string `json:"canonical_name"`
	FoodID        string `json:"food_id,omitempty"`
	Action        string `json:"action"`
	Reason        string `json:"reason,omitempty"`
}

type importReport struct {
	StartedAt       time.Time     `json:"started_at"`
	FinishedAt      time.Time     `json:"finished_at"`
	Applied         bool          `json:"applied"`
	DatabaseHost    string        `json:"database_host"`
	DatabaseName    string        `json:"database_name"`
	Source          string        `json:"source"`
	InputPath       string        `json:"input_path"`
	SourceRows      int           `json:"source_rows"`
	Candidates      int           `json:"candidates"`
	Rejected        []rejectedRow `json:"rejected"`
	Created         int           `json:"created"`
	Updated         int           `json:"updated"`
	SkippedExisting int           `json:"skipped_existing"`
	Verified        int           `json:"verified"`
	Entries         []reportEntry `json:"entries"`
}

type existingFood struct {
	ID             string `gorm:"column:id"`
	CanonicalName  string `gorm:"column:canonical_name"`
	NormalizedName string `gorm:"column:normalized_name"`
	Source         string `gorm:"column:source"`
}

func main() {
	opts := parseFlags()
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	rows, err := readWorkbook(opts.inputPath)
	if err != nil {
		log.Fatalf("读取薄荷健康工作簿失败: %v", err)
	}
	candidates, rejected := buildCandidates(rows, opts.inputPath, opts.source)

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
		StartedAt: time.Now(), Applied: opts.apply, DatabaseHost: cfg.Database.Host,
		DatabaseName: cfg.Database.Name, Source: opts.source, InputPath: opts.inputPath,
		SourceRows: len(rows), Candidates: len(candidates), Rejected: rejected,
	}
	process := func(tx *gorm.DB) error {
		return processCandidates(ctx, tx, candidates, opts.source, filepath.Base(opts.inputPath), opts.apply, &report)
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
	if err == nil {
		report.Verified, err = verifyApplied(ctx, db, candidates, opts.source)
	}
	report.FinishedAt = time.Now()
	if writeErr := writeReport(opts.report, report); writeErr != nil {
		log.Fatalf("保存导入报告失败: %v", writeErr)
	}
	if err != nil {
		log.Fatalf("薄荷健康食物导入失败（事务已回滚）: %v；报告=%s", err, opts.report)
	}
	fmt.Printf("薄荷健康食物导入完成 database=%s@%s source_rows=%d candidates=%d rejected=%d created=%d updated=%d skipped_existing=%d verified=%d apply=%v report=%s\n",
		report.DatabaseName, report.DatabaseHost, report.SourceRows, report.Candidates, len(report.Rejected), report.Created,
		report.Updated, report.SkippedExisting, report.Verified, opts.apply, opts.report)
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "包含 Apollo/应用配置的目录")
	flag.StringVar(&opts.inputPath, "input", "", "薄荷健康 xlsx 工作簿路径")
	flag.StringVar(&opts.report, "report", "tmp/boohee-import-report.json", "审计报告路径")
	flag.StringVar(&opts.source, "source", defaultSource, "写入 food_nutrition_library.source 的来源标签")
	flag.BoolVar(&opts.apply, "apply", false, "写入数据库；默认只读预演")
	flag.DurationVar(&opts.timeout, "timeout", 10*time.Minute, "任务总超时")
	flag.Parse()
	if strings.TrimSpace(opts.inputPath) == "" {
		log.Fatal("必须通过 --input 指定 xlsx 工作簿")
	}
	return opts
}

func buildCandidates(rows []sourceRow, inputPath, source string) ([]importCandidate, []rejectedRow) {
	candidates := make([]importCandidate, 0, len(rows))
	rejected := make([]rejectedRow, 0)
	seen := map[string]int{}
	for _, row := range rows {
		reject := func(reason string) {
			rejected = append(rejected, rejectedRow{Sequence: row.Sequence, SearchTerm: row.SearchTerm, ActualName: row.ActualName, Reason: reason})
		}
		name := strings.TrimSpace(row.ActualName)
		normalized := normalizeName(name)
		switch {
		case row.Sequence <= 0:
			reject("序号缺失或无效")
			continue
		case name == "" || normalized == "":
			reject("实际条目名为空")
			continue
		case name == "收藏":
			reject("采集误把页面按钮“收藏”识别为食物名")
			continue
		case strings.TrimSpace(row.Basis) != "每100克可食部":
			reject("数据基准不是每100克可食部")
			continue
		case row.Kcal == nil || row.Protein == nil || row.Carbs == nil || row.Fat == nil:
			reject("热量或三大营养素存在空白，禁止按0推断")
			continue
		case !validNutrition(*row.Kcal, *row.Protein, *row.Carbs, *row.Fat):
			reject("热量或三大营养素超出合理数值范围")
			continue
		case row.EnergyKJ != nil && math.Abs(*row.EnergyKJ/4.184-*row.Kcal) > math.Max(3, *row.Kcal*0.03):
			reject("kJ 与 kcal 换算差异超过容差")
			continue
		case seen[normalized] > 0:
			reject(fmt.Sprintf("工作簿内规范化名称重复，首次出现于第%d条", seen[normalized]))
			continue
		}
		seen[normalized] = row.Sequence
		missing := make([]string, 0, 3)
		for label, value := range map[string]*float64{"膳食纤维(g)": row.Fiber, "糖(g)": row.Sugar, "钠(mg)": row.Sodium} {
			if value == nil {
				missing = append(missing, label)
			}
		}
		sort.Strings(missing)
		candidates = append(candidates, importCandidate{
			Sequence: row.Sequence, CanonicalName: name, NormalizedName: normalized,
			Kcal: *row.Kcal, Protein: *row.Protein, Carbs: *row.Carbs, Fat: *row.Fat,
			Fiber: valueOrZero(row.Fiber), Sugar: valueOrZero(row.Sugar), Sodium: valueOrZero(row.Sodium),
			Evidence: datatypes.JSONMap{
				"provider": "薄荷健康", "collection_method": "Android UI 文本采集",
				"source_file": filepath.Base(inputPath), "source": source, "source_row": row.Sequence,
				"search_term": row.SearchTerm, "actual_title": name, "recommendation_level": row.RecommendationLevel,
				"basis": row.Basis, "energy_kj": row.EnergyKJ, "revision_date": row.RevisionDate,
				"missing_fields": missing, "limitation_note": row.LimitationNote,
			},
		})
	}
	return candidates, rejected
}

func validNutrition(kcal, protein, carbs, fat float64) bool {
	values := []float64{kcal, protein, carbs, fat}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return false
		}
	}
	return kcal <= 1000 && protein <= 100 && carbs <= 100 && fat <= 100
}

func processCandidates(ctx context.Context, db *gorm.DB, candidates []importCandidate, source, inputFile string, apply bool, report *importReport) error {
	names := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		names = append(names, candidate.NormalizedName)
	}
	var existing []existingFood
	for start := 0; start < len(names); start += 500 {
		end := start + 500
		if end > len(names) {
			end = len(names)
		}
		var batch []existingFood
		if err := db.WithContext(ctx).Table("food_nutrition_library").
			Select("id, canonical_name, normalized_name, source").
			Where("normalized_name IN ?", names[start:end]).Find(&batch).Error; err != nil {
			return fmt.Errorf("查询现有标准食物失败: %w", err)
		}
		existing = append(existing, batch...)
	}
	existingByName := make(map[string]existingFood, len(existing))
	for _, food := range existing {
		existingByName[food.NormalizedName] = food
	}
	for _, candidate := range candidates {
		current, found := existingByName[candidate.NormalizedName]
		if found && current.Source != source {
			report.SkippedExisting++
			report.Entries = append(report.Entries, reportEntry{Sequence: candidate.Sequence, CanonicalName: candidate.CanonicalName, FoodID: current.ID, Action: "skipped_existing", Reason: "同名食物已有其他来源，未覆盖"})
			continue
		}
		id := current.ID
		action := "updated"
		if !found {
			id = uuid.NewSHA1(uuid.NameSpaceURL, []byte(source+":"+strconv.Itoa(candidate.Sequence))).String()
			action = "created"
		}
		if apply {
			values := map[string]any{
				"id": id, "canonical_name": candidate.CanonicalName, "normalized_name": candidate.NormalizedName,
				"kcal_per_100g": candidate.Kcal, "protein_per_100g": candidate.Protein,
				"carbs_per_100g": candidate.Carbs, "fat_per_100g": candidate.Fat,
				"fiber_per_100g": candidate.Fiber, "sugar_per_100g": candidate.Sugar,
				"sodium_mg_per_100g": candidate.Sodium, "is_active": false, "source": source,
				"quality_tier": defaultQualityTier, "quality_evidence": candidate.Evidence,
				"updated_at": time.Now(),
			}
			if found {
				delete(values, "id")
				if err := db.WithContext(ctx).Table("food_nutrition_library").Where("id = ? AND source = ?", id, source).Updates(values).Error; err != nil {
					return fmt.Errorf("更新第%d条 %s 失败: %w", candidate.Sequence, candidate.CanonicalName, err)
				}
			} else {
				values["created_at"] = time.Now()
				if err := db.WithContext(ctx).Table("food_nutrition_library").Create(values).Error; err != nil {
					return fmt.Errorf("新增第%d条 %s 失败: %w", candidate.Sequence, candidate.CanonicalName, err)
				}
			}
		}
		if found {
			report.Updated++
		} else {
			report.Created++
		}
		report.Entries = append(report.Entries, reportEntry{Sequence: candidate.Sequence, CanonicalName: candidate.CanonicalName, FoodID: id, Action: action, Reason: "source=" + source + "; input=" + inputFile})
	}
	return nil
}

func verifyApplied(ctx context.Context, db *gorm.DB, candidates []importCandidate, source string) (int, error) {
	type persistedNutrition struct {
		NormalizedName string  `gorm:"column:normalized_name"`
		Kcal           float64 `gorm:"column:kcal_per_100g"`
		Protein        float64 `gorm:"column:protein_per_100g"`
		Carbs          float64 `gorm:"column:carbs_per_100g"`
		Fat            float64 `gorm:"column:fat_per_100g"`
		IsActive       bool    `gorm:"column:is_active"`
		QualityTier    string  `gorm:"column:quality_tier"`
	}
	expected := make(map[string]importCandidate, len(candidates))
	for _, candidate := range candidates {
		expected[candidate.NormalizedName] = candidate
	}
	var persisted []persistedNutrition
	if err := db.WithContext(ctx).Table("food_nutrition_library").
		Select("normalized_name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_active, quality_tier").
		Where("source = ?", source).Find(&persisted).Error; err != nil {
		return 0, fmt.Errorf("复核导入结果失败: %w", err)
	}
	verified := 0
	for _, row := range persisted {
		candidate, ok := expected[row.NormalizedName]
		if !ok {
			return verified, fmt.Errorf("来源 %s 存在工作簿外记录: %s", source, row.NormalizedName)
		}
		if !almostEqual(row.Kcal, candidate.Kcal) || !almostEqual(row.Protein, candidate.Protein) ||
			!almostEqual(row.Carbs, candidate.Carbs) || !almostEqual(row.Fat, candidate.Fat) {
			return verified, fmt.Errorf("食物 %s 的核心营养写入值与工作簿不一致", candidate.CanonicalName)
		}
		if row.IsActive || row.QualityTier != defaultQualityTier {
			return verified, fmt.Errorf("食物 %s 未保持待审核停用状态", candidate.CanonicalName)
		}
		verified++
	}
	return verified, nil
}

func almostEqual(left, right float64) bool {
	return math.Abs(left-right) <= 0.0001
}

func normalizeName(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func valueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func writeReport(path string, report importReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// The workbook parser intentionally supports only the small XLSX surface used
// by evidence workbooks: shared strings, inline strings, and numeric cells.
func readWorkbook(path string) ([]sourceRow, error) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer archive.Close()
	files := make(map[string]*zip.File, len(archive.File))
	for _, file := range archive.File {
		files[file.Name] = file
	}
	shared, err := readSharedStrings(files["xl/sharedStrings.xml"])
	if err != nil {
		return nil, err
	}
	worksheetPath, err := findWorksheetPath(files, "食物数据")
	if err != nil {
		return nil, err
	}
	rows, err := readWorksheet(files[worksheetPath], shared)
	if err != nil {
		return nil, err
	}
	return mapSourceRows(rows)
}

func findWorksheetPath(files map[string]*zip.File, sheetName string) (string, error) {
	type workbookSheet struct {
		Name string `xml:"name,attr"`
		RID  string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
	}
	var workbook struct {
		Sheets []workbookSheet `xml:"sheets>sheet"`
	}
	if err := decodeXMLFile(files["xl/workbook.xml"], &workbook); err != nil {
		return "", fmt.Errorf("读取 workbook.xml 失败: %w", err)
	}
	var relationID string
	for _, sheet := range workbook.Sheets {
		if sheet.Name == sheetName {
			relationID = sheet.RID
			break
		}
	}
	if relationID == "" {
		return "", fmt.Errorf("工作表 %q 不存在", sheetName)
	}
	var relations struct {
		Items []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	if err := decodeXMLFile(files["xl/_rels/workbook.xml.rels"], &relations); err != nil {
		return "", fmt.Errorf("读取 workbook 关系失败: %w", err)
	}
	for _, relation := range relations.Items {
		if relation.ID == relationID {
			target := strings.TrimPrefix(relation.Target, "/")
			if !strings.HasPrefix(target, "xl/") {
				target = "xl/" + target
			}
			return filepath.ToSlash(filepath.Clean(target)), nil
		}
	}
	return "", fmt.Errorf("工作表 %q 缺少关系目标", sheetName)
}

func readSharedStrings(file *zip.File) ([]string, error) {
	if file == nil {
		return nil, nil
	}
	var table struct {
		Items []struct {
			Text string `xml:"t"`
			Runs []struct {
				Text string `xml:"t"`
			} `xml:"r"`
		} `xml:"si"`
	}
	if err := decodeXMLFile(file, &table); err != nil {
		return nil, fmt.Errorf("读取 sharedStrings.xml 失败: %w", err)
	}
	values := make([]string, 0, len(table.Items))
	for _, item := range table.Items {
		if item.Text != "" {
			values = append(values, item.Text)
			continue
		}
		var builder strings.Builder
		for _, run := range item.Runs {
			builder.WriteString(run.Text)
		}
		values = append(values, builder.String())
	}
	return values, nil
}

func readWorksheet(file *zip.File, shared []string) (map[int]map[string]string, error) {
	if file == nil {
		return nil, errors.New("工作表 XML 不存在")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	decoder := xml.NewDecoder(reader)
	rows := map[int]map[string]string{}
	for {
		token, tokenErr := decoder.Token()
		if tokenErr == io.EOF {
			break
		}
		if tokenErr != nil {
			return nil, tokenErr
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "c" {
			continue
		}
		var cell struct {
			Value  string `xml:"v"`
			Inline string `xml:"is>t"`
		}
		if err := decoder.DecodeElement(&cell, &start); err != nil {
			return nil, err
		}
		var reference, cellType string
		for _, attr := range start.Attr {
			switch attr.Name.Local {
			case "r":
				reference = attr.Value
			case "t":
				cellType = attr.Value
			}
		}
		column, rowNumber := splitCellReference(reference)
		if rowNumber == 0 {
			continue
		}
		value := cell.Value
		if cellType == "s" {
			index, parseErr := strconv.Atoi(cell.Value)
			if parseErr != nil || index < 0 || index >= len(shared) {
				return nil, fmt.Errorf("共享字符串索引无效: %q", cell.Value)
			}
			value = shared[index]
		} else if cellType == "inlineStr" {
			value = cell.Inline
		}
		if rows[rowNumber] == nil {
			rows[rowNumber] = map[string]string{}
		}
		rows[rowNumber][column] = value
	}
	return rows, nil
}

func mapSourceRows(rows map[int]map[string]string) ([]sourceRow, error) {
	header := rows[3]
	if header == nil || header["A"] != "序号" || header["C"] != "实际条目名" || header["F"] != "热量(kcal)" {
		return nil, errors.New("食物数据表头不符合预期")
	}
	result := make([]sourceRow, 0, len(rows)-3)
	for rowNumber := 4; ; rowNumber++ {
		cells, ok := rows[rowNumber]
		if !ok {
			if rowNumber > len(rows)+10 {
				break
			}
			continue
		}
		sequence, err := strconv.Atoi(strings.TrimSpace(cells["A"]))
		if err != nil {
			return nil, fmt.Errorf("第%d行序号无效: %w", rowNumber, err)
		}
		result = append(result, sourceRow{
			Sequence: sequence, SearchTerm: cells["B"], ActualName: cells["C"], RecommendationLevel: cells["D"], Basis: cells["E"],
			Kcal: parseOptionalNumber(cells["F"]), EnergyKJ: parseOptionalNumber(cells["G"]), Carbs: parseOptionalNumber(cells["H"]),
			Protein: parseOptionalNumber(cells["I"]), Fat: parseOptionalNumber(cells["J"]), Fiber: parseOptionalNumber(cells["K"]),
			Sugar: parseOptionalNumber(cells["L"]), Sodium: parseOptionalNumber(cells["M"]), RevisionDate: cells["N"], LimitationNote: cells["O"],
		})
	}
	return result, nil
}

func parseOptionalNumber(value string) *float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil
	}
	return &number
}

func splitCellReference(reference string) (string, int) {
	index := 0
	for index < len(reference) && reference[index] >= 'A' && reference[index] <= 'Z' {
		index++
	}
	if index == 0 || index == len(reference) {
		return "", 0
	}
	row, _ := strconv.Atoi(reference[index:])
	return reference[:index], row
}

func decodeXMLFile(file *zip.File, target any) error {
	if file == nil {
		return errors.New("xlsx 内部文件不存在")
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	return xml.NewDecoder(reader).Decode(target)
}
