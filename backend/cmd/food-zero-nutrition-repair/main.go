package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type userRow struct {
	ID       string `gorm:"column:id" json:"id"`
	Nickname string `gorm:"column:nickname" json:"nickname"`
}

type recordRow struct {
	ID            string         `gorm:"column:id" json:"id"`
	UserID        string         `gorm:"column:user_id" json:"user_id"`
	Nickname      string         `gorm:"column:nickname" json:"nickname"`
	MealType      string         `gorm:"column:meal_type" json:"meal_type"`
	Items         datatypes.JSON `gorm:"column:items" json:"items"`
	TotalCalories float64        `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein  float64        `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs    float64        `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat      float64        `gorm:"column:total_fat" json:"total_fat"`
	TotalWeight   float64        `gorm:"column:total_weight_grams" json:"total_weight_grams"`
	RecordTime    time.Time      `gorm:"column:record_time" json:"record_time"`
	CreatedAt     time.Time      `gorm:"column:created_at" json:"created_at"`
	SourceTaskID  *string        `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	ImagePath     *string        `gorm:"column:image_path" json:"image_path,omitempty"`
	Description   *string        `gorm:"column:description" json:"description,omitempty"`
	PFCRatio      *string        `gorm:"column:pfc_ratio_comment" json:"pfc_ratio_comment,omitempty"`
	ContextAdvice *string        `gorm:"column:context_advice" json:"context_advice,omitempty"`
	AbsorbNotes   *string        `gorm:"column:absorption_notes" json:"absorption_notes,omitempty"`
}

type itemReport struct {
	Index              int                       `json:"index"`
	Name               string                    `json:"name"`
	Weight             float64                   `json:"weight_g,omitempty"`
	Calories           float64                   `json:"calories"`
	Protein            float64                   `json:"protein"`
	Carbs              float64                   `json:"carbs"`
	Fat                float64                   `json:"fat"`
	NutritionSource    string                    `json:"nutrition_source,omitempty"`
	ResolveStatus      string                    `json:"resolve_status,omitempty"`
	MatchedFoodID      string                    `json:"matched_food_id,omitempty"`
	PackagedFoodID     string                    `json:"packaged_food_id,omitempty"`
	PackageMatchStatus string                    `json:"package_match_status,omitempty"`
	PackageWeightSrc   string                    `json:"package_weight_source,omitempty"`
	PackagedResolve    *packagedResolveReport    `json:"packaged_resolve,omitempty"`
	PackagedCandidates []packagedCandidateReport `json:"packaged_candidates,omitempty"`
	StandardResolve    *standardResolveReport    `json:"standard_resolve,omitempty"`
	Raw                map[string]any            `json:"raw,omitempty"`
}

type packagedResolveReport struct {
	Status string                   `json:"status"`
	Score  float64                  `json:"score"`
	Food   *packagedCandidateReport `json:"food,omitempty"`
}

type packagedCandidateReport struct {
	ID               string  `json:"id"`
	DisplayName      string  `json:"display_name"`
	Brand            string  `json:"brand,omitempty"`
	ProductName      string  `json:"product_name"`
	SpecText         string  `json:"spec_text,omitempty"`
	NetWeightG       float64 `json:"net_weight_g,omitempty"`
	KcalPer100g      float64 `json:"kcal_per_100g"`
	ProteinPer100g   float64 `json:"protein_per_100g"`
	CarbsPer100g     float64 `json:"carbs_per_100g"`
	FatPer100g       float64 `json:"fat_per_100g"`
	ReviewStatus     string  `json:"review_status,omitempty"`
	IsActive         bool    `json:"is_active"`
	ConversionStatus string  `json:"conversion_status,omitempty"`
	Source           string  `json:"source,omitempty"`
}

type standardResolveReport struct {
	Status      string  `json:"status"`
	Score       float64 `json:"score"`
	ID          string  `json:"id,omitempty"`
	Name        string  `json:"name,omitempty"`
	KcalPer100g float64 `json:"kcal_per_100g,omitempty"`
	Protein100g float64 `json:"protein_per_100g,omitempty"`
	Carbs100g   float64 `json:"carbs_per_100g,omitempty"`
	Fat100g     float64 `json:"fat_per_100g,omitempty"`
}

type outputReport struct {
	GeneratedAt string       `json:"generated_at"`
	Users       []userRow    `json:"users"`
	Records     []recordDump `json:"records"`
}

type recordDump struct {
	Record recordRow    `json:"record"`
	Items  []itemReport `json:"items"`
}

type repairReport struct {
	GeneratedAt string               `json:"generated_at"`
	Apply       bool                 `json:"apply"`
	Records     []repairRecordReport `json:"records"`
}

type repairRecordReport struct {
	RecordID      string             `json:"record_id"`
	UserID        string             `json:"user_id"`
	Nickname      string             `json:"nickname"`
	MealType      string             `json:"meal_type"`
	SourceTaskID  string             `json:"source_task_id,omitempty"`
	Changed       bool               `json:"changed"`
	Applied       bool               `json:"applied"`
	BackupPath    string             `json:"backup_path,omitempty"`
	BeforeTotals  nutritionTotals    `json:"before_totals"`
	AfterTotals   nutritionTotals    `json:"after_totals"`
	ChangedItems  []repairItemReport `json:"changed_items,omitempty"`
	SkippedReason string             `json:"skipped_reason,omitempty"`
	Error         string             `json:"error,omitempty"`
}

type repairItemReport struct {
	Index         int                `json:"index"`
	Name          string             `json:"name"`
	WeightG       float64            `json:"weight_g"`
	Source        string             `json:"source"`
	MatchedFoodID string             `json:"matched_food_id"`
	MatchedName   string             `json:"matched_name"`
	Before        map[string]float64 `json:"before"`
	After         map[string]float64 `json:"after"`
}

type nutritionTotals struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
	WeightG  float64 `json:"weight_g"`
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	nickname := flag.String("nickname", "饭饭", "weapp_user.nickname exact match")
	date := flag.String("date", time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01-02"), "record date in Asia/Shanghai")
	mealType := flag.String("meal-type", "", "optional meal_type filter")
	recordID := flag.String("record-id", "", "optional record id filter")
	fromBenchmarkCSV := flag.String("from-benchmark-csv", "", "optional zero-nutrition benchmark suspicious rows CSV; loads unique user_food_records container_id values")
	repair := flag.Bool("repair", false, "repair zero-nutrition target items; dry-run unless --apply is set")
	apply := flag.Bool("apply", false, "write repaired record/task JSON to database")
	targetNames := flag.String("target-names", "如实酸奶,双汇玉米热狗肠", "comma-separated exact item names to repair")
	skipNames := flag.String("skip-names", "", "comma-separated exact item names to leave unchanged")
	backupDir := flag.String("backup-dir", filepath.Join("..", "tmp"), "directory for old JSON backups when --apply is set")
	outputJSON := flag.String("output-json", "", "optional path for clean JSON report output")
	timeout := flag.Duration("timeout", 90*time.Second, "command timeout")
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
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置 schema 失败: %v", err)
		}
	}

	var users []userRow
	userQuery := strings.TrimSpace(*nickname)
	if userQuery != "" {
		if err := db.WithContext(ctx).Raw(`
SELECT id, COALESCE(nickname, '') AS nickname
FROM weapp_user
WHERE nickname = ?
ORDER BY create_time DESC`, userQuery).Scan(&users).Error; err != nil {
			log.Fatalf("查询用户失败: %v", err)
		}
	}

	var records []recordRow
	if strings.TrimSpace(*fromBenchmarkCSV) != "" {
		records, err = loadRecordsFromBenchmarkCSV(ctx, db, *fromBenchmarkCSV)
	} else {
		records, err = loadRecords(ctx, db, userQuery, *date, *mealType, *recordID)
	}
	if err != nil {
		log.Fatalf("查询饮食记录失败: %v", err)
	}

	repo := foodrecordrepo.NewFoodNutritionRepo(db)
	if *repair {
		report := runRepair(ctx, db, repo, records, parseTargetNames(*targetNames), parseTargetNames(*skipNames), *apply, *backupDir)
		if err := writeJSONReport(*outputJSON, report); err != nil {
			log.Fatalf("输出修复报告失败: %v", err)
		}
		return
	}

	dumps := make([]recordDump, 0, len(records))
	for _, record := range records {
		items := parseItems(record.Items)
		itemReports := make([]itemReport, 0, len(items))
		for index, item := range items {
			itemReports = append(itemReports, buildItemReport(ctx, repo, item, index))
		}
		dumps = append(dumps, recordDump{Record: record, Items: itemReports})
	}
	out := outputReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Users:       users,
		Records:     dumps,
	}
	if err := writeJSONReport(*outputJSON, out); err != nil {
		log.Fatalf("输出 JSON 失败: %v", err)
	}
}

func writeJSONReport(path string, value any) error {
	if strings.TrimSpace(path) != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		raw, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(path, raw, 0o644)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func loadRecords(ctx context.Context, db *gorm.DB, nickname, date, mealType, recordID string) ([]recordRow, error) {
	conditions := []string{"1 = 1"}
	args := []any{}
	if strings.TrimSpace(recordID) != "" {
		conditions = append(conditions, "r.id = ?")
		args = append(args, strings.TrimSpace(recordID))
	} else {
		if strings.TrimSpace(nickname) != "" {
			conditions = append(conditions, "u.nickname = ?")
			args = append(args, strings.TrimSpace(nickname))
		}
		if strings.TrimSpace(date) != "" {
			conditions = append(conditions, "(r.record_time AT TIME ZONE 'Asia/Shanghai')::date = ?::date")
			args = append(args, strings.TrimSpace(date))
		}
		if strings.TrimSpace(mealType) != "" {
			conditions = append(conditions, "r.meal_type = ?")
			args = append(args, strings.TrimSpace(mealType))
		}
	}
	sql := `
SELECT
  r.id,
  r.user_id,
  COALESCE(u.nickname, '') AS nickname,
  COALESCE(r.meal_type, '') AS meal_type,
  r.items,
  COALESCE(r.total_calories, 0) AS total_calories,
  COALESCE(r.total_protein, 0) AS total_protein,
  COALESCE(r.total_carbs, 0) AS total_carbs,
  COALESCE(r.total_fat, 0) AS total_fat,
  COALESCE(r.total_weight_grams, 0) AS total_weight_grams,
  r.record_time,
  r.created_at,
  r.source_task_id,
  r.image_path,
  r.description,
  r.pfc_ratio_comment,
  r.context_advice,
  r.absorption_notes
FROM user_food_records r
JOIN weapp_user u ON u.id = r.user_id
WHERE ` + strings.Join(conditions, " AND ") + `
ORDER BY r.created_at DESC
LIMIT 20`
	var records []recordRow
	if err := db.WithContext(ctx).Raw(sql, args...).Scan(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

func loadRecordsFromBenchmarkCSV(ctx context.Context, db *gorm.DB, csvPath string) ([]recordRow, error) {
	file, err := os.Open(csvPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := csv.NewReader(file)
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	header := map[string]int{}
	for index, name := range rows[0] {
		header[strings.TrimSpace(name)] = index
	}
	surfaceIndex, ok := header["surface"]
	if !ok {
		return nil, fmt.Errorf("CSV 缺少 surface 列")
	}
	containerIndex, ok := header["container_id"]
	if !ok {
		return nil, fmt.Errorf("CSV 缺少 container_id 列")
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, row := range rows[1:] {
		if surfaceIndex >= len(row) || containerIndex >= len(row) {
			continue
		}
		if strings.TrimSpace(row[surfaceIndex]) != "user_food_records" {
			continue
		}
		id := strings.TrimSpace(row[containerIndex])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var records []recordRow
	err = db.WithContext(ctx).Raw(`
SELECT
  r.id,
  r.user_id,
  COALESCE(u.nickname, '') AS nickname,
  COALESCE(r.meal_type, '') AS meal_type,
  r.items,
  COALESCE(r.total_calories, 0) AS total_calories,
  COALESCE(r.total_protein, 0) AS total_protein,
  COALESCE(r.total_carbs, 0) AS total_carbs,
  COALESCE(r.total_fat, 0) AS total_fat,
  COALESCE(r.total_weight_grams, 0) AS total_weight_grams,
  r.record_time,
  r.created_at,
  r.source_task_id,
  r.image_path,
  r.description,
  r.pfc_ratio_comment,
  r.context_advice,
  r.absorption_notes
FROM user_food_records r
JOIN weapp_user u ON u.id = r.user_id
WHERE r.id IN ?
ORDER BY r.created_at DESC`, ids).Scan(&records).Error
	return records, err
}

func parseItems(raw datatypes.JSON) []map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var values []map[string]any
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	var generic []any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(generic))
	for _, value := range generic {
		if item, ok := value.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

func buildItemReport(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, item map[string]any, index int) itemReport {
	name := stringFromAny(item["name"], item["food_name"], item["display_name"])
	nutrients := mapFromAny(item["nutrients"])
	report := itemReport{
		Index:              index,
		Name:               name,
		Weight:             firstPositiveNumber(item, "estimatedWeightGrams", "estimated_weight_grams", "intake", "weight", "grossWeightGrams", "gross_weight_grams"),
		Calories:           numberFromAny(firstNonNil(nutrients["calories"], item["calories"], item["kcal"])),
		Protein:            numberFromAny(firstNonNil(nutrients["protein"], item["protein"], item["protein_g"])),
		Carbs:              numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"], item["carbs_g"])),
		Fat:                numberFromAny(firstNonNil(nutrients["fat"], item["fat"], item["fat_g"])),
		NutritionSource:    stringFromAny(item["nutrition_source"], item["nutritionSource"]),
		ResolveStatus:      stringFromAny(item["resolve_status"], item["resolveStatus"]),
		MatchedFoodID:      stringFromAny(item["matched_food_id"], item["matchedFoodId"]),
		PackagedFoodID:     stringFromAny(item["packaged_food_id"], item["packagedFoodId"]),
		PackageMatchStatus: stringFromAny(item["package_match_status"], item["packageMatchStatus"]),
		PackageWeightSrc:   stringFromAny(item["package_weight_source"], item["packageWeightSource"]),
		Raw:                item,
	}
	if name != "" {
		if resolved, err := repo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{Name: name, NetWeightG: report.Weight}); err == nil && resolved != nil {
			report.PackagedResolve = &packagedResolveReport{Status: resolved.Status, Score: round2(resolved.Score)}
			if resolved.Food != nil {
				report.PackagedResolve.Food = packagedCandidateFromFood(resolved.Food)
			}
		}
		if candidates, err := repo.SearchPackagedFood(ctx, name, 8); err == nil {
			report.PackagedCandidates = make([]packagedCandidateReport, 0, len(candidates))
			for _, candidate := range candidates {
				food := candidate
				report.PackagedCandidates = append(report.PackagedCandidates, *packagedCandidateFromFood(&food))
			}
		}
		if resolved, err := repo.ResolveFood(ctx, name); err == nil && resolved != nil {
			standard := standardResolveReport{Status: resolved.Status, Score: round2(resolved.Score)}
			if resolved.Food != nil {
				standard.ID = resolved.Food.ID
				standard.Name = resolved.Food.CanonicalName
				standard.KcalPer100g = round2(resolved.Food.KcalPer100g)
				standard.Protein100g = round2(resolved.Food.ProteinPer100g)
				standard.Carbs100g = round2(resolved.Food.CarbsPer100g)
				standard.Fat100g = round2(resolved.Food.FatPer100g)
			}
			report.StandardResolve = &standard
		}
	}
	return report
}

func packagedCandidateFromFood(food *foodrecorddomain.PackagedFood) *packagedCandidateReport {
	if food == nil {
		return nil
	}
	return &packagedCandidateReport{
		ID:               food.ID,
		DisplayName:      packagedDisplayName(food),
		Brand:            food.Brand,
		ProductName:      food.ProductName,
		SpecText:         stringPtrValue(food.SpecText),
		NetWeightG:       round2(food.NetWeightG),
		KcalPer100g:      round2(food.KcalPer100g),
		ProteinPer100g:   round2(food.ProteinPer100g),
		CarbsPer100g:     round2(food.CarbsPer100g),
		FatPer100g:       round2(food.FatPer100g),
		ReviewStatus:     food.ReviewStatus,
		IsActive:         food.IsActive,
		ConversionStatus: stringPtrValue(food.ConversionStatus),
		Source:           food.Source,
	}
}

func packagedDisplayName(food *foodrecorddomain.PackagedFood) string {
	if strings.TrimSpace(food.DisplayName) != "" {
		return strings.TrimSpace(food.DisplayName)
	}
	parts := []string{food.Brand, food.ProductName, stringPtrValue(food.SpecText)}
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			out = append(out, strings.TrimSpace(part))
		}
	}
	return strings.Join(out, " ")
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if out, ok := value.(map[string]any); ok {
		return out
	}
	return nil
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstPositiveNumber(item map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := numberFromAny(item[key]); value > 0 {
			return value
		}
	}
	return 0
}

func stringFromAny(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmtAny(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func numberFromAny(value any) float64 {
	switch v := value.(type) {
	case nil:
		return 0
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
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
		var n float64
		if _, err := fmt.Sscanf(strings.TrimSpace(v), "%f", &n); err == nil {
			return n
		}
	}
	return 0
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func fmtAny(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprintf("%v", value))
}

func parseTargetNames(raw string) map[string]bool {
	targets := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		name := strings.TrimSpace(part)
		if name != "" {
			targets[name] = true
		}
	}
	return targets
}

func runRepair(ctx context.Context, db *gorm.DB, repo *foodrecordrepo.FoodNutritionRepo, records []recordRow, targets map[string]bool, skipNames map[string]bool, apply bool, backupDir string) repairReport {
	report := repairReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Apply:       apply,
		Records:     []repairRecordReport{},
	}
	for _, record := range records {
		row := repairOneRecord(ctx, db, repo, record, targets, skipNames, apply, backupDir)
		report.Records = append(report.Records, row)
	}
	return report
}

func repairOneRecord(ctx context.Context, db *gorm.DB, repo *foodrecordrepo.FoodNutritionRepo, record recordRow, targets map[string]bool, skipNames map[string]bool, apply bool, backupDir string) repairRecordReport {
	beforeItems := parseItems(record.Items)
	out := repairRecordReport{
		RecordID:     record.ID,
		UserID:       record.UserID,
		Nickname:     record.Nickname,
		MealType:     record.MealType,
		BeforeTotals: totalsFromItems(beforeItems),
	}
	if record.SourceTaskID != nil {
		out.SourceTaskID = strings.TrimSpace(*record.SourceTaskID)
	}
	if len(beforeItems) == 0 {
		out.SkippedReason = "empty_items"
		out.AfterTotals = out.BeforeTotals
		return out
	}
	items := make([]map[string]any, 0, len(beforeItems))
	for _, item := range beforeItems {
		items = append(items, copyMap(item))
	}
	for index := range items {
		change, changed, err := repairOneItem(ctx, repo, items[index], index, targets, skipNames)
		if err != nil {
			out.Error = err.Error()
			out.AfterTotals = totalsFromItems(items)
			return out
		}
		if changed {
			out.Changed = true
			out.ChangedItems = append(out.ChangedItems, change)
		}
	}
	out.AfterTotals = totalsFromItems(items)
	if !out.Changed {
		out.SkippedReason = "no_target_zero_items"
		return out
	}
	if !apply {
		return out
	}
	backupPath, err := writeBackup(backupDir, record, beforeItems)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	if err := applyRecordRepair(ctx, db, record, items, out.AfterTotals); err != nil {
		out.Error = err.Error()
		return out
	}
	if out.SourceTaskID != "" {
		if err := applyTaskRepair(ctx, db, out.SourceTaskID, items, out.AfterTotals); err != nil {
			out.Error = err.Error()
			return out
		}
	}
	out.Applied = true
	out.BackupPath = backupPath
	return out
}

func repairOneItem(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, item map[string]any, index int, targets map[string]bool, skipNames map[string]bool) (repairItemReport, bool, error) {
	name := stringFromAny(item["name"], item["food_name"], item["foodName"], item["display_name"], item["displayName"])
	if len(skipNames) > 0 && skipNames[name] {
		return repairItemReport{}, false, nil
	}
	if len(targets) > 0 && !targets[name] {
		return repairItemReport{}, false, nil
	}
	beforeNutrients := mapFromAny(item["nutrients"])
	beforeCore := coreNutrients(beforeNutrients, item)
	if !isZeroCore(beforeCore) {
		return repairItemReport{}, false, nil
	}
	weight := firstPositiveNumber(item, "intake", "weight", "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams")
	if weight <= 0 {
		return repairItemReport{}, false, nil
	}
	if fixed, ok, err := repairFromPackagedFood(ctx, repo, name, weight); err != nil {
		return repairItemReport{}, false, err
	} else if ok {
		applyFixedNutrition(item, fixed)
		return repairItemReport{
			Index:         index,
			Name:          name,
			WeightG:       fixed.WeightG,
			Source:        fixed.Source,
			MatchedFoodID: fixed.MatchedFoodID,
			MatchedName:   fixed.MatchedName,
			Before:        beforeCore,
			After:         coreNutrients(mapFromAny(item["nutrients"]), item),
		}, true, nil
	}
	if fixed, ok, err := repairFromStandardFood(ctx, repo, name, weight); err != nil {
		return repairItemReport{}, false, err
	} else if ok {
		applyFixedNutrition(item, fixed)
		return repairItemReport{
			Index:         index,
			Name:          name,
			WeightG:       fixed.WeightG,
			Source:        fixed.Source,
			MatchedFoodID: fixed.MatchedFoodID,
			MatchedName:   fixed.MatchedName,
			Before:        beforeCore,
			After:         coreNutrients(mapFromAny(item["nutrients"]), item),
		}, true, nil
	}
	return repairItemReport{}, false, nil
}

type fixedNutrition struct {
	Source        string
	MatchedFoodID string
	MatchedName   string
	Status        string
	Score         float64
	WeightG       float64
	Unit          map[string]any
	Nutrients     map[string]any
	Packaged      *packagedCandidateReport
}

func repairFromPackagedFood(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, name string, weight float64) (fixedNutrition, bool, error) {
	resolved, err := repo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{Name: name, NetWeightG: weight})
	if err != nil || resolved == nil || resolved.Food == nil {
		return fixedNutrition{}, false, err
	}
	food := resolved.Food
	if !hasPositiveCorePackaged(food) {
		return fixedNutrition{}, false, nil
	}
	usedWeight := weight
	if packageWeight := packagedNetWeight(food); packageWeight > 0 && math.Abs(packageWeight-weight) <= math.Max(5, weight*0.25) {
		usedWeight = packageWeight
	}
	unit := unitFromPackaged(food)
	return fixedNutrition{
		Source:        "packaged_food_library",
		MatchedFoodID: food.ID,
		MatchedName:   packagedDisplayName(food),
		Status:        resolved.Status,
		Score:         round2(resolved.Score),
		WeightG:       round2(usedWeight),
		Unit:          unit,
		Nutrients:     scaleUnit(unit, usedWeight),
		Packaged:      packagedCandidateFromFood(food),
	}, true, nil
}

func repairFromStandardFood(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, name string, weight float64) (fixedNutrition, bool, error) {
	resolved, err := repo.ResolveFood(ctx, name)
	if err != nil || resolved == nil || resolved.Food == nil {
		return fixedNutrition{}, false, err
	}
	if !isSafeStandardRepairMatch(name, resolved) {
		return fixedNutrition{}, false, nil
	}
	food := resolved.Food
	if food.KcalPer100g <= 0 && food.ProteinPer100g <= 0 && food.CarbsPer100g <= 0 && food.FatPer100g <= 0 {
		return fixedNutrition{}, false, nil
	}
	unit := unitFromStandard(food)
	return fixedNutrition{
		Source:        "food_nutrition_library",
		MatchedFoodID: food.ID,
		MatchedName:   food.CanonicalName,
		Status:        resolved.Status,
		Score:         round2(resolved.Score),
		WeightG:       round2(weight),
		Unit:          unit,
		Nutrients:     scaleUnit(unit, weight),
	}, true, nil
}

func applyFixedNutrition(item map[string]any, fixed fixedNutrition) {
	oldWeight := firstPositiveNumber(item, "weight", "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams")
	oldIntake := numberFromAny(item["intake"])
	oldRatio := numberFromAny(item["ratio"])
	if oldIntake <= 0 {
		oldIntake = numberFromAny(item["intake_g"])
	}
	item["nutrients"] = fixed.Nutrients
	item["unit_nutrition_per_100g"] = fixed.Unit
	item["matched_food_id"] = fixed.MatchedFoodID
	item["matched_food_name"] = fixed.MatchedName
	item["nutrition_source"] = fixed.Source
	item["resolve_status"] = fixed.Status
	item["resolve_score"] = fixed.Score
	item["is_unresolved"] = false
	item["weight"] = fixed.WeightG
	intake := fixed.WeightG
	ratio := 100.0
	if oldRatio > 0 {
		ratio = math.Min(100, math.Max(0, oldRatio))
		intake = fixed.WeightG * ratio / 100
	} else if oldIntake > 0 && oldWeight > 0 {
		ratio = math.Min(100, math.Max(0, oldIntake/oldWeight*100))
		intake = fixed.WeightG * ratio / 100
	}
	item["intake"] = round2(intake)
	item["ratio"] = round2(ratio)
	if _, ok := item["gross_weight_grams"]; ok {
		item["gross_weight_grams"] = fixed.WeightG
	}
	if fixed.Source == "packaged_food_library" && fixed.Packaged != nil {
		item["packaged_food_id"] = fixed.MatchedFoodID
		item["package_match_status"] = "matched"
		item["package_match_confidence"] = fixed.Score
		item["package_weight_source"] = "packaged_food_library"
		item["package_weight_applied"] = true
		item["package_weight_reason"] = "命中包装库规格/净含量，按完整包装计入"
		item["packaged_candidates"] = []map[string]any{{
			"id":               fixed.Packaged.ID,
			"packaged_food_id": fixed.Packaged.ID,
			"display_name":     fixed.Packaged.DisplayName,
			"name":             fixed.Packaged.ProductName,
			"brand":            fixed.Packaged.Brand,
			"spec_text":        fixed.Packaged.SpecText,
			"net_weight_g":     fixed.Packaged.NetWeightG,
			"kcal_per_100g":    fixed.Packaged.KcalPer100g,
			"protein_per_100g": fixed.Packaged.ProteinPer100g,
			"carbs_per_100g":   fixed.Packaged.CarbsPer100g,
			"fat_per_100g":     fixed.Packaged.FatPer100g,
			"match_status":     fixed.Status,
			"score":            fixed.Score,
		}}
		return
	}
	for _, key := range []string{"packaged_food_id", "package_match_status", "package_match_confidence", "package_weight_source", "package_weight_applied", "package_weight_reason", "packaged_candidates"} {
		delete(item, key)
	}
}

func totalsFromItems(items []map[string]any) nutritionTotals {
	var totals nutritionTotals
	for _, item := range items {
		nutrients := mapFromAny(item["nutrients"])
		scale := consumedScale(item)
		totals.Calories += numberFromAny(firstNonNil(nutrients["calories"], item["calories"])) * scale
		totals.Protein += numberFromAny(firstNonNil(nutrients["protein"], item["protein"])) * scale
		totals.Carbs += numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"])) * scale
		totals.Fat += numberFromAny(firstNonNil(nutrients["fat"], item["fat"])) * scale
		totals.WeightG += consumedWeight(item)
	}
	totals.Calories = round2(totals.Calories)
	totals.Protein = round2(totals.Protein)
	totals.Carbs = round2(totals.Carbs)
	totals.Fat = round2(totals.Fat)
	totals.WeightG = round2(totals.WeightG)
	return totals
}

func consumedScale(item map[string]any) float64 {
	weight := firstPositiveNumber(item, "weight", "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams")
	intake := numberFromAny(item["intake"])
	if intake <= 0 {
		intake = numberFromAny(item["intake_g"])
	}
	if weight > 0 && intake > 0 {
		return math.Min(1, math.Max(0, intake/weight))
	}
	ratio := numberFromAny(item["ratio"])
	if ratio > 0 {
		return math.Min(1, math.Max(0, ratio/100))
	}
	return 1
}

func consumedWeight(item map[string]any) float64 {
	weight := firstPositiveNumber(item, "weight", "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams")
	intake := numberFromAny(item["intake"])
	if intake <= 0 {
		intake = numberFromAny(item["intake_g"])
	}
	if intake > 0 {
		return intake
	}
	ratio := numberFromAny(item["ratio"])
	if weight > 0 && ratio > 0 {
		return weight * math.Min(100, math.Max(0, ratio)) / 100
	}
	return weight
}

func isSafeStandardRepairMatch(query string, resolved *foodrecordrepo.ResolveResult) bool {
	if resolved == nil || resolved.Food == nil {
		return false
	}
	query = strings.TrimSpace(query)
	canonical := strings.TrimSpace(resolved.Food.CanonicalName)
	if query == "" || canonical == "" {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(resolved.Status))
	if strings.Contains(status, "exact") {
		return !hasUnsafeStandardRepairDrift(query, canonical)
	}
	nq := normalizeRepairName(query)
	nc := normalizeRepairName(canonical)
	if nq == "" || nc == "" {
		return false
	}
	if nq == nc {
		return !hasUnsafeStandardRepairDrift(query, canonical)
	}
	if strings.Contains(nq, nc) && len([]rune(nc)) >= 2 {
		return !hasUnsafeStandardRepairDrift(query, canonical)
	}
	if strings.Contains(nc, nq) && isSafeCanonicalExpansion(nq, nc) {
		return !hasUnsafeStandardRepairDrift(query, canonical)
	}
	return false
}

func normalizeRepairName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "（", "(")
	value = strings.ReplaceAll(value, "）", ")")
	for {
		start := strings.Index(value, "(")
		end := strings.Index(value, ")")
		if start < 0 || end <= start {
			break
		}
		value = strings.TrimSpace(value[:start] + value[end+1:])
	}
	for _, token := range []string{"清炒", "清蒸", "水煮", "凉拌", "炒", "炖", "煮", "去皮", "原味"} {
		value = strings.ReplaceAll(value, token, "")
	}
	for _, token := range []string{"片", "块", "丁", "丝", "条", "粒"} {
		if strings.HasSuffix(value, token) && len([]rune(value)) > 2 {
			value = strings.TrimSuffix(value, token)
		}
	}
	return strings.TrimSpace(value)
}

func isSafeCanonicalExpansion(normalizedQuery, normalizedCanonical string) bool {
	if !strings.Contains(normalizedCanonical, normalizedQuery) {
		return false
	}
	extra := strings.ReplaceAll(normalizedCanonical, normalizedQuery, "")
	if extra == "" {
		return true
	}
	for _, token := range []string{"净肉", "熟", "鲜"} {
		extra = strings.ReplaceAll(extra, token, "")
	}
	return strings.TrimSpace(extra) == ""
}

func hasUnsafeStandardRepairDrift(query, canonical string) bool {
	query = strings.TrimSpace(query)
	canonical = strings.TrimSpace(canonical)
	if query == "" || canonical == "" {
		return true
	}
	queryHas := func(token string) bool { return strings.Contains(query, token) }
	canonicalHas := func(token string) bool { return strings.Contains(canonical, token) }
	for _, token := range []string{"冻干", "干制", "脆", "酥", "烧肉", "腊", "腌"} {
		if canonicalHas(token) && !queryHas(token) {
			return true
		}
	}
	for _, token := range []string{"肉", "牛", "羊", "猪", "鸡", "鸭"} {
		if canonicalHas(token) && !queryHas(token) {
			return true
		}
	}
	if strings.Contains(query, "根") && strings.Contains(canonical, "尖") {
		return true
	}
	for _, token := range []string{"豆腐", "西兰花", "花椰菜", "菜花", "木耳", "香菇", "虾", "鱼", "牛肉", "猪肉", "鸡肉", "鸭肉", "鸡蛋"} {
		if strings.Contains(query, token) && !strings.Contains(canonical, token) {
			if token == "香菇" && strings.Contains(query, "油麦菜") && strings.Contains(canonical, "油麦菜") {
				continue
			}
			return true
		}
	}
	if containsAny(query, []string{"与", "和", "及", "、", "+"}) {
		for _, token := range []string{"西兰花", "花椰菜", "菜花", "豆腐", "鸡蛋", "虾", "鱼", "肉", "木耳", "香菇", "土豆", "豆角"} {
			if strings.Contains(query, token) && !strings.Contains(canonical, token) {
				return true
			}
		}
	}
	for _, generic := range []string{"茶饮", "茶饮料", "凉拌菜", "调味蘸料", "蘸料", "饮料"} {
		if query == generic && canonical != generic {
			return true
		}
	}
	return false
}

func containsAny(value string, tokens []string) bool {
	for _, token := range tokens {
		if strings.Contains(value, token) {
			return true
		}
	}
	return false
}

func coreNutrients(nutrients map[string]any, item map[string]any) map[string]float64 {
	return map[string]float64{
		"calories": round2(numberFromAny(firstNonNil(nutrients["calories"], item["calories"]))),
		"protein":  round2(numberFromAny(firstNonNil(nutrients["protein"], item["protein"]))),
		"carbs":    round2(numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"]))),
		"fat":      round2(numberFromAny(firstNonNil(nutrients["fat"], item["fat"]))),
	}
}

func isZeroCore(values map[string]float64) bool {
	return values["calories"] <= 0 && values["protein"] <= 0 && values["carbs"] <= 0 && values["fat"] <= 0
}

func unitFromPackaged(food *foodrecorddomain.PackagedFood) map[string]any {
	return map[string]any{
		"calories":       round2(food.KcalPer100g),
		"protein":        round2(food.ProteinPer100g),
		"carbs":          round2(food.CarbsPer100g),
		"fat":            round2(food.FatPer100g),
		"fiber":          round2(food.FiberPer100g),
		"sugar":          round2(food.SugarPer100g),
		"saturatedFat":   round2(food.SaturatedFatPer100g),
		"cholesterolMg":  round2(food.CholesterolMgPer100g),
		"sodiumMg":       round2(food.SodiumMgPer100g),
		"potassiumMg":    round2(food.PotassiumMgPer100g),
		"calciumMg":      round2(food.CalciumMgPer100g),
		"ironMg":         round2(food.IronMgPer100g),
		"magnesiumMg":    round2(food.MagnesiumMgPer100g),
		"zincMg":         round2(food.ZincMgPer100g),
		"vitaminARaeMcg": round2(food.VitaminARaeMcgPer100g),
		"vitaminCMg":     round2(food.VitaminCMgPer100g),
		"vitaminDMcg":    round2(food.VitaminDMcgPer100g),
		"vitaminEMg":     round2(food.VitaminEMgPer100g),
		"vitaminKMcg":    round2(food.VitaminKMcgPer100g),
		"thiaminMg":      round2(food.ThiaminMgPer100g),
		"riboflavinMg":   round2(food.RiboflavinMgPer100g),
		"niacinMg":       round2(food.NiacinMgPer100g),
		"vitaminB6Mg":    round2(food.VitaminB6MgPer100g),
		"folateMcg":      round2(food.FolateMcgPer100g),
		"vitaminB12Mcg":  round2(food.VitaminB12McgPer100g),
	}
}

func unitFromStandard(food *foodrecorddomain.FoodNutrition) map[string]any {
	return map[string]any{
		"calories":       round2(food.KcalPer100g),
		"protein":        round2(food.ProteinPer100g),
		"carbs":          round2(food.CarbsPer100g),
		"fat":            round2(food.FatPer100g),
		"fiber":          round2(food.FiberPer100g),
		"sugar":          round2(food.SugarPer100g),
		"saturatedFat":   round2(food.SaturatedFatPer100g),
		"cholesterolMg":  round2(food.CholesterolMgPer100g),
		"sodiumMg":       round2(food.SodiumMgPer100g),
		"potassiumMg":    round2(food.PotassiumMgPer100g),
		"calciumMg":      round2(food.CalciumMgPer100g),
		"ironMg":         round2(food.IronMgPer100g),
		"magnesiumMg":    round2(food.MagnesiumMgPer100g),
		"zincMg":         round2(food.ZincMgPer100g),
		"vitaminARaeMcg": round2(food.VitaminARaeMcgPer100g),
		"vitaminCMg":     round2(food.VitaminCMgPer100g),
		"vitaminDMcg":    round2(food.VitaminDMcgPer100g),
		"vitaminEMg":     round2(food.VitaminEMgPer100g),
		"vitaminKMcg":    round2(food.VitaminKMcgPer100g),
		"thiaminMg":      round2(food.ThiaminMgPer100g),
		"riboflavinMg":   round2(food.RiboflavinMgPer100g),
		"niacinMg":       round2(food.NiacinMgPer100g),
		"vitaminB6Mg":    round2(food.VitaminB6MgPer100g),
		"folateMcg":      round2(food.FolateMcgPer100g),
		"vitaminB12Mcg":  round2(food.VitaminB12McgPer100g),
	}
}

func scaleUnit(unit map[string]any, weight float64) map[string]any {
	out := make(map[string]any, len(unit))
	for key, value := range unit {
		out[key] = round2(numberFromAny(value) * weight / 100)
	}
	return out
}

func hasPositiveCorePackaged(food *foodrecorddomain.PackagedFood) bool {
	return food != nil && (food.KcalPer100g > 0 || food.ProteinPer100g > 0 || food.CarbsPer100g > 0 || food.FatPer100g > 0)
}

func packagedNetWeight(food *foodrecorddomain.PackagedFood) float64 {
	if food == nil {
		return 0
	}
	if food.NetWeightG > 0 {
		return food.NetWeightG
	}
	if food.NetContentValue > 0 {
		unit := strings.ToLower(stringPtrValue(food.NetContentUnit))
		if unit == "g" || unit == "ml" {
			return food.NetContentValue
		}
	}
	return 0
}

func writeBackup(backupDir string, record recordRow, items []map[string]any) (string, error) {
	if strings.TrimSpace(backupDir) == "" {
		backupDir = filepath.Join("..", "tmp")
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(backupDir, fmt.Sprintf("food_zero_nutrition_backup_%s_%s.json", record.ID, time.Now().Format("20060102_150405")))
	payload := map[string]any{
		"record":     record,
		"items":      items,
		"created_at": time.Now().Format(time.RFC3339),
	}
	bytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, bytes, 0o644)
}

func applyRecordRepair(ctx context.Context, db *gorm.DB, record recordRow, items []map[string]any, totals nutritionTotals) error {
	itemsBytes, err := json.Marshal(items)
	if err != nil {
		return err
	}
	updates := map[string]any{
		"items":              datatypes.JSON(itemsBytes),
		"total_calories":     totals.Calories,
		"total_protein":      totals.Protein,
		"total_carbs":        totals.Carbs,
		"total_fat":          totals.Fat,
		"total_weight_grams": int(math.Round(totals.WeightG)),
	}
	return db.WithContext(ctx).Table("user_food_records").
		Where("id = ? AND user_id = ?", record.ID, record.UserID).
		Updates(updates).Error
}

func applyTaskRepair(ctx context.Context, db *gorm.DB, taskID string, items []map[string]any, totals nutritionTotals) error {
	var row struct {
		Result datatypes.JSON `gorm:"column:result"`
	}
	if err := db.WithContext(ctx).Table("analysis_tasks").Select("result").Where("id = ?", taskID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}
	if len(row.Result) == 0 {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(row.Result, &result); err != nil {
		return err
	}
	result["items"] = items
	result["total_calories"] = totals.Calories
	result["totalCalories"] = totals.Calories
	result["total_protein"] = totals.Protein
	result["totalProtein"] = totals.Protein
	result["total_carbs"] = totals.Carbs
	result["totalCarbs"] = totals.Carbs
	result["total_fat"] = totals.Fat
	result["totalFat"] = totals.Fat
	result["total_weight_grams"] = totals.WeightG
	result["totalWeightGrams"] = totals.WeightG
	bytes, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Table("analysis_tasks").Where("id = ?", taskID).Update("result", datatypes.JSON(bytes)).Error
}

func copyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		if nested, ok := value.(map[string]any); ok {
			out[key] = copyMap(nested)
		} else {
			out[key] = value
		}
	}
	return out
}
