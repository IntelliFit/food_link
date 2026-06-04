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
	"strings"
	"time"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultCSVRelPath = "data/nutrition_alias_whitelist.csv"

	actionInserted       = "inserted"
	actionWouldInsert    = "would_insert"
	actionSkipped        = "skipped_existing"
	actionBlocked        = "blocked"
	actionTargetNotFound = "target_not_found"
)

type whitelistRecord struct {
	Line                int    `json:"line"`
	AliasName           string `json:"alias_name"`
	TargetCanonicalName string `json:"target_canonical_name"`
	Comment             string `json:"comment,omitempty"`
}

type nutritionFoodRow struct {
	ID            string  `gorm:"column:id"`
	CanonicalName string  `gorm:"column:canonical_name"`
	KcalPer100g   float64 `gorm:"column:kcal_per_100g"`
	IsActive      bool    `gorm:"column:is_active"`
}

type nutritionAliasRow struct {
	ID            string `gorm:"column:id"`
	FoodID        string `gorm:"column:food_id"`
	AliasName     string `gorm:"column:alias_name"`
	CanonicalName string `gorm:"column:canonical_name"`
}

type aliasStore interface {
	FindFoodsByCanonical(ctx context.Context, canonical string) ([]nutritionFoodRow, error)
	FindAliasesByName(ctx context.Context, aliasName, normalizedAlias string) ([]nutritionAliasRow, error)
	InsertAlias(ctx context.Context, foodID, aliasName, normalizedAlias string) error
}

type whitelistReport struct {
	GeneratedAt          string               `json:"generated_at"`
	Apply                bool                 `json:"apply"`
	InputPath            string               `json:"input_path"`
	Database             map[string]string    `json:"database,omitempty"`
	Total                int                  `json:"total"`
	Inserted             int                  `json:"inserted"`
	WouldInsert          int                  `json:"would_insert"`
	SkippedExisting      int                  `json:"skipped_existing"`
	Blocked              int                  `json:"blocked"`
	TargetNotFound       int                  `json:"target_not_found"`
	Rows                 []whitelistReportRow `json:"rows"`
	RemoteApplyGuardNote string               `json:"remote_apply_guard_note,omitempty"`
}

type whitelistReportRow struct {
	Line                int    `json:"line"`
	AliasName           string `json:"alias_name"`
	TargetCanonicalName string `json:"target_canonical_name"`
	TargetFoodID        string `json:"target_food_id,omitempty"`
	Action              string `json:"action"`
	Reason              string `json:"reason"`
	Applied             bool   `json:"applied"`
	Comment             string `json:"comment,omitempty"`
}

type gormAliasStore struct {
	db *gorm.DB
}

func main() {
	apply := flag.Bool("apply", false, "write valid aliases to food_nutrition_aliases; default is dry-run")
	configDir := flag.String("config-dir", ".", "backend config directory")
	inputPath := flag.String("input", resolveDefaultCSVPath(), "alias whitelist CSV path")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON report")
	confirmDB := flag.String("confirm-db", "", "required for --apply; must equal host/database/schema")
	timeout := flag.Duration("timeout", 2*time.Minute, "command timeout")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if *apply {
		expected := confirmDBToken(cfg.Database)
		if strings.TrimSpace(*confirmDB) != expected {
			log.Fatalf("拒绝 apply：请先查看 dry-run 汇总，确认目标库后追加 --confirm-db=%s", expected)
		}
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

	records, err := readWhitelistCSV(*inputPath)
	if err != nil {
		log.Fatalf("读取 CSV 失败: %v", err)
	}
	report, err := runWhitelistImport(ctx, gormAliasStore{db: db}, records, *apply)
	if err != nil {
		log.Fatalf("导入别名白名单失败: %v", err)
	}
	report.InputPath = *inputPath
	report.Database = map[string]string{
		"config_dir":    resolvedDir,
		"host":          maskHost(cfg.Database.Host),
		"database":      cfg.Database.Name,
		"schema":        normalizeSchema(cfg.Database.Schema),
		"confirm_token": confirmDBToken(cfg.Database),
	}
	report.RemoteApplyGuardNote = "apply 写库前必须先查看 dry-run 报告，并用 --confirm-db=host/database/schema 显式确认目标库。"

	reportPath, err := writeReport(*outputDir, report)
	if err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	fmt.Printf("nutrition alias whitelist apply=%v total=%d inserted=%d would_insert=%d skipped_existing=%d blocked=%d target_not_found=%d report=%s\n",
		report.Apply,
		report.Total,
		report.Inserted,
		report.WouldInsert,
		report.SkippedExisting,
		report.Blocked,
		report.TargetNotFound,
		reportPath,
	)
	if !*apply {
		fmt.Printf("dry-run only; to write after review, rerun with --apply --confirm-db=%s\n", confirmDBToken(cfg.Database))
	}
}

func runWhitelistImport(ctx context.Context, store aliasStore, records []whitelistRecord, apply bool) (whitelistReport, error) {
	report := whitelistReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Apply:       apply,
		Total:       len(records),
		Rows:        make([]whitelistReportRow, 0, len(records)),
	}
	plannedAliases := map[string]string{}
	for _, record := range records {
		row, err := processWhitelistRecord(ctx, store, record, apply, plannedAliases)
		if err != nil {
			return report, err
		}
		report.Rows = append(report.Rows, row)
		switch row.Action {
		case actionInserted:
			report.Inserted++
		case actionWouldInsert:
			report.WouldInsert++
		case actionSkipped:
			report.SkippedExisting++
		case actionTargetNotFound:
			report.TargetNotFound++
		case actionBlocked:
			report.Blocked++
		}
	}
	return report, nil
}

func processWhitelistRecord(ctx context.Context, store aliasStore, record whitelistRecord, apply bool, plannedAliases map[string]string) (whitelistReportRow, error) {
	aliasName := strings.TrimSpace(record.AliasName)
	targetName := strings.TrimSpace(record.TargetCanonicalName)
	row := whitelistReportRow{
		Line:                record.Line,
		AliasName:           aliasName,
		TargetCanonicalName: targetName,
		Comment:             strings.TrimSpace(record.Comment),
	}
	aliasNorm := normalizeFoodName(aliasName)
	targetNorm := normalizeFoodName(targetName)
	if aliasName == "" {
		return block(row, "alias_empty"), nil
	}
	if targetName == "" {
		return block(row, "target_empty"), nil
	}
	if aliasNorm == "" {
		return block(row, "alias_normalized_empty"), nil
	}
	if aliasNorm == targetNorm || strings.EqualFold(aliasName, targetName) {
		return block(row, "alias_equals_target"), nil
	}
	if reason := unsafeAliasInputReason(aliasName); reason != "" {
		return block(row, reason), nil
	}

	foods, err := store.FindFoodsByCanonical(ctx, targetName)
	if err != nil {
		return row, err
	}
	if len(foods) == 0 {
		row.Action = actionTargetNotFound
		row.Reason = "target_canonical_not_found"
		return row, nil
	}
	validFoods := make([]nutritionFoodRow, 0, len(foods))
	for _, food := range foods {
		if food.IsActive && food.KcalPer100g > 0 {
			validFoods = append(validFoods, food)
		}
	}
	if len(validFoods) == 0 {
		return block(row, "target_inactive_or_missing_kcal"), nil
	}
	if len(validFoods) > 1 {
		return block(row, "target_canonical_ambiguous"), nil
	}
	target := validFoods[0]
	row.TargetFoodID = target.ID
	if isUnsafeNutritionAliasMatch(aliasName, aliasName, target.CanonicalName) {
		return block(row, "unsafe_processed_food_target"), nil
	}
	if pendingFoodID, ok := plannedAliases[aliasNorm]; ok {
		if pendingFoodID == target.ID {
			row.Action = actionSkipped
			row.Reason = "duplicate_alias_in_input"
			return row, nil
		}
		return block(row, "duplicate_alias_conflicts_in_input"), nil
	}

	aliases, err := store.FindAliasesByName(ctx, aliasName, aliasNorm)
	if err != nil {
		return row, err
	}
	for _, alias := range aliases {
		if alias.FoodID == target.ID {
			row.Action = actionSkipped
			row.Reason = "alias_already_points_to_target"
			return row, nil
		}
	}
	if len(aliases) > 0 {
		return block(row, "alias_already_points_to_other_food"), nil
	}

	if !apply {
		plannedAliases[aliasNorm] = target.ID
		row.Action = actionWouldInsert
		row.Reason = "dry_run_valid_new_alias"
		return row, nil
	}
	if err := store.InsertAlias(ctx, target.ID, aliasName, aliasNorm); err != nil {
		return block(row, "insert_failed: "+err.Error()), nil
	}
	plannedAliases[aliasNorm] = target.ID
	row.Action = actionInserted
	row.Reason = "inserted_new_alias"
	row.Applied = true
	return row, nil
}

func block(row whitelistReportRow, reason string) whitelistReportRow {
	row.Action = actionBlocked
	row.Reason = reason
	return row
}

func (s gormAliasStore) FindFoodsByCanonical(ctx context.Context, canonical string) ([]nutritionFoodRow, error) {
	var rows []nutritionFoodRow
	err := s.db.WithContext(ctx).
		Table((&domain.FoodNutrition{}).TableName()).
		Select("id, canonical_name, kcal_per_100g, is_active").
		Where("LOWER(canonical_name) = LOWER(?)", strings.TrimSpace(canonical)).
		Find(&rows).Error
	return rows, err
}

func (s gormAliasStore) FindAliasesByName(ctx context.Context, aliasName, normalizedAlias string) ([]nutritionAliasRow, error) {
	var rows []nutritionAliasRow
	err := s.db.WithContext(ctx).
		Table((&domain.FoodNutritionAlias{}).TableName()+" AS a").
		Select("a.id, a.food_id, a.alias_name, f.canonical_name").
		Joins("LEFT JOIN "+(&domain.FoodNutrition{}).TableName()+" AS f ON f.id = a.food_id").
		Where("LOWER(a.alias_name) = LOWER(?) OR a.normalized_alias = ?", strings.TrimSpace(aliasName), normalizedAlias).
		Find(&rows).Error
	return rows, err
}

func (s gormAliasStore) InsertAlias(ctx context.Context, foodID, aliasName, normalizedAlias string) error {
	return s.db.WithContext(ctx).
		Table((&domain.FoodNutritionAlias{}).TableName()).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(map[string]any{
			"food_id":          foodID,
			"alias_name":       strings.TrimSpace(aliasName),
			"normalized_alias": normalizedAlias,
		}).Error
}

func readWhitelistCSV(path string) ([]whitelistRecord, error) {
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
	aliasCol, okAlias := header["alias_name"]
	targetCol, okTarget := header["target_canonical_name"]
	commentCol, okComment := header["comment"]
	if !okAlias || !okTarget {
		return nil, fmt.Errorf("CSV header must contain alias_name,target_canonical_name,comment")
	}
	if !okComment {
		commentCol = -1
	}
	records := make([]whitelistRecord, 0, len(rows)-1)
	for i, row := range rows[1:] {
		if rowEmpty(row) {
			continue
		}
		record := whitelistRecord{
			Line:                i + 2,
			AliasName:           csvValue(row, aliasCol),
			TargetCanonicalName: csvValue(row, targetCol),
		}
		if commentCol >= 0 {
			record.Comment = csvValue(row, commentCol)
		}
		records = append(records, record)
	}
	return records, nil
}

func writeReport(outputDir string, report whitelistReport) (string, error) {
	if strings.TrimSpace(outputDir) == "" {
		outputDir = resolveDefaultOutputDir()
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", err
	}
	timestamp := time.Now().Format("20060102_150405")
	path := filepath.Join(outputDir, "nutrition_alias_whitelist_"+timestamp+".json")
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o644); err != nil {
		return "", err
	}
	return path, nil
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

func normalizeFoodName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func isUnsafeNutritionAliasMatch(query, aliasName, canonicalName string) bool {
	queryNorm := normalizeFoodName(query)
	aliasNorm := normalizeFoodName(aliasName)
	canonicalNorm := normalizeFoodName(canonicalName)
	if queryNorm == "" || canonicalNorm == "" || queryNorm == canonicalNorm {
		return false
	}
	queryText := queryNorm + aliasNorm
	processedTokens := []string{"肠", "香肠", "火腿", "热狗", "肉肠", "鱼肠", "鸡肉肠", "玉米肠"}
	if containsAnyToken(canonicalNorm, processedTokens) && !containsAnyToken(queryText, processedTokens) {
		return true
	}
	return false
}

func containsAnyToken(text string, tokens []string) bool {
	for _, token := range tokens {
		if token != "" && strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func unsafeAliasInputReason(aliasName string) string {
	aliasNorm := normalizeFoodName(aliasName)
	if aliasNorm == "" {
		return "alias_normalized_empty"
	}
	fragmentTokens := []string{"摄入量", "食用量", "大杯", "中杯", "小杯", "去冰", "少冰", "半糖", "少糖", "无糖", "适量", "少许"}
	if containsAnyToken(aliasName, fragmentTokens) {
		return "alias_looks_like_user_input_fragment"
	}
	if strings.Contains(aliasName, "%") {
		return "alias_looks_like_user_input_fragment"
	}
	return ""
}

func resolveDefaultCSVPath() string {
	if _, err := os.Stat(defaultCSVRelPath); err == nil {
		return defaultCSVRelPath
	}
	rootPath := filepath.Join("backend", defaultCSVRelPath)
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath
	}
	return defaultCSVRelPath
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

func confirmDBToken(cfg config.DatabaseConfig) string {
	return fmt.Sprintf("%s/%s/%s", strings.TrimSpace(cfg.Host), strings.TrimSpace(cfg.Name), normalizeSchema(cfg.Schema))
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
