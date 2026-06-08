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
	"regexp"
	"sort"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const defaultTargetRate = 0.0001

type recordRow struct {
	ID           string         `gorm:"column:id"`
	UserID       string         `gorm:"column:user_id"`
	Nickname     string         `gorm:"column:nickname"`
	MealType     string         `gorm:"column:meal_type"`
	Items        datatypes.JSON `gorm:"column:items"`
	RecordTime   time.Time      `gorm:"column:record_time"`
	CreatedAt    time.Time      `gorm:"column:created_at"`
	SourceTaskID *string        `gorm:"column:source_task_id"`
}

type taskRow struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	Result    datatypes.JSON `gorm:"column:result"`
	CreatedAt time.Time      `gorm:"column:created_at"`
}

type benchmarkReport struct {
	GeneratedAt string             `json:"generated_at"`
	Days        int                `json:"days"`
	MinWeightG  float64            `json:"min_weight_g"`
	TargetRate  float64            `json:"target_rate"`
	Record      zeroSummary        `json:"record"`
	Task        zeroSummary        `json:"task"`
	Overall     zeroSummary        `json:"overall"`
	Rows        []zeroSuspicionRow `json:"rows"`
}

type zeroSummary struct {
	ContainersScanned   int     `json:"containers_scanned"`
	ItemsScanned        int     `json:"items_scanned"`
	MeaningfulItems     int     `json:"meaningful_items"`
	KnownZeroItems      int     `json:"known_zero_items"`
	SuspiciousZeroItems int     `json:"suspicious_zero_items"`
	SuspiciousRate      float64 `json:"suspicious_rate"`
	TargetRate          float64 `json:"target_rate"`
	PassTarget          bool    `json:"pass_target"`
}

type zeroSuspicionRow struct {
	Surface           string  `json:"surface"`
	ContainerID       string  `json:"container_id"`
	UserID            string  `json:"user_id"`
	Nickname          string  `json:"nickname,omitempty"`
	CreatedAt         string  `json:"created_at"`
	MealTypeOrTask    string  `json:"meal_type_or_task,omitempty"`
	SourceTaskID      string  `json:"source_task_id,omitempty"`
	ItemIndex         int     `json:"item_index"`
	Name              string  `json:"name"`
	WeightG           float64 `json:"weight_g"`
	Calories          float64 `json:"calories"`
	Protein           float64 `json:"protein"`
	Carbs             float64 `json:"carbs"`
	Fat               float64 `json:"fat"`
	NutritionSource   string  `json:"nutrition_source,omitempty"`
	ResolveStatus     string  `json:"resolve_status,omitempty"`
	PackageStatus     string  `json:"package_match_status,omitempty"`
	MatchedFoodID     string  `json:"matched_food_id,omitempty"`
	PackagedFoodID    string  `json:"packaged_food_id,omitempty"`
	Classification    string  `json:"classification"`
	Reason            string  `json:"reason"`
	SuggestedSeverity string  `json:"suggested_severity,omitempty"`
}

type itemView struct {
	Index           int
	Item            map[string]any
	Name            string
	WeightG         float64
	Calories        float64
	Protein         float64
	Carbs           float64
	Fat             float64
	NutritionSource string
	ResolveStatus   string
	PackageStatus   string
	MatchedFoodID   string
	PackagedFoodID  string
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON/CSV/Markdown reports")
	days := flag.Int("days", 30, "look back this many days")
	recordLimit := flag.Int("record-limit", 5000, "maximum user_food_records rows to scan")
	taskLimit := flag.Int("task-limit", 5000, "maximum done analysis_tasks rows to scan")
	taskTypes := flag.String("task-types", "food,food_text,food_correction,precision_aggregate", "comma-separated analysis task types to scan; empty scans all task types")
	sinceRaw := flag.String("since", "", "optional lower bound for created_at, RFC3339 or '2006-01-02 15:04:05'; overrides --days")
	minWeight := flag.Float64("min-weight-g", 5, "minimum item weight to include in meaningful denominator")
	targetRate := flag.Float64("target-rate", defaultTargetRate, "target suspicious zero rate, e.g. 0.0001 = one in ten thousand")
	failOnThreshold := flag.Bool("fail-on-threshold", false, "exit non-zero when suspicious rate exceeds target")
	timeout := flag.Duration("timeout", 3*time.Minute, "command timeout")
	flag.Parse()

	if *days <= 0 {
		log.Fatal("--days must be positive")
	}
	if *recordLimit < 0 || *taskLimit < 0 {
		log.Fatal("--record-limit and --task-limit must be non-negative")
	}
	if *minWeight < 0 {
		log.Fatal("--min-weight-g must be non-negative")
	}
	if *targetRate < 0 {
		log.Fatal("--target-rate must be non-negative")
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
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if strings.TrimSpace(cfg.Database.Schema) != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置 schema 失败: %v", err)
		}
	}

	since, err := parseSince(*sinceRaw, *days)
	if err != nil {
		log.Fatalf("解析 --since 失败: %v", err)
	}

	records, err := loadRecords(ctx, db, since, *recordLimit)
	if err != nil {
		log.Fatalf("查询饮食记录失败: %v", err)
	}
	taskTypeList := parseCSVList(*taskTypes)
	tasks, err := loadTasks(ctx, db, since, *taskLimit, taskTypeList)
	if err != nil {
		log.Fatalf("查询分析任务失败: %v", err)
	}

	report := runBenchmark(records, tasks, *days, *minWeight, *targetRate)
	jsonPath, csvPath, mdPath, err := writeReports(*outputDir, report)
	if err != nil {
		log.Fatalf("写入 benchmark 报告失败: %v", err)
	}
	fmt.Printf("zero nutrition benchmark days=%d records=%d tasks=%d meaningful_items=%d suspicious_zero=%d rate=%.8f target=%.8f pass=%v reports=%s,%s,%s\n",
		report.Days,
		report.Record.ContainersScanned,
		report.Task.ContainersScanned,
		report.Overall.MeaningfulItems,
		report.Overall.SuspiciousZeroItems,
		report.Overall.SuspiciousRate,
		report.TargetRate,
		report.Overall.PassTarget,
		jsonPath,
		csvPath,
		mdPath,
	)
	if *failOnThreshold && !report.Overall.PassTarget {
		os.Exit(1)
	}
}

func loadRecords(ctx context.Context, db *gorm.DB, since time.Time, limit int) ([]recordRow, error) {
	if limit == 0 {
		return nil, nil
	}
	var rows []recordRow
	err := db.WithContext(ctx).Raw(`
SELECT
  r.id,
  r.user_id,
  COALESCE(u.nickname, '') AS nickname,
  COALESCE(r.meal_type, '') AS meal_type,
  r.items,
  r.record_time,
  r.created_at,
  r.source_task_id
FROM user_food_records r
LEFT JOIN weapp_user u ON u.id = r.user_id
WHERE r.items IS NOT NULL
  AND r.created_at >= ?
ORDER BY r.created_at DESC
LIMIT ?`, since, limit).Scan(&rows).Error
	return rows, err
}

func loadTasks(ctx context.Context, db *gorm.DB, since time.Time, limit int, taskTypes []string) ([]taskRow, error) {
	if limit == 0 {
		return nil, nil
	}
	var rows []taskRow
	q := db.WithContext(ctx).Raw(`
SELECT id, user_id, COALESCE(task_type, '') AS task_type, COALESCE(status, '') AS status, result, created_at
FROM analysis_tasks
WHERE status = 'done'
  AND result IS NOT NULL
  AND (? = 0 OR task_type IN ?)
  AND created_at >= ?
ORDER BY created_at DESC
LIMIT ?`, len(taskTypes), taskTypes, since, limit)
	return rows, q.Scan(&rows).Error
}

func runBenchmark(records []recordRow, tasks []taskRow, days int, minWeight, targetRate float64) benchmarkReport {
	report := benchmarkReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Days:        days,
		MinWeightG:  minWeight,
		TargetRate:  targetRate,
		Rows:        []zeroSuspicionRow{},
	}
	report.Record.TargetRate = targetRate
	report.Task.TargetRate = targetRate
	report.Overall.TargetRate = targetRate

	report.Record.ContainersScanned = len(records)
	for _, record := range records {
		items := parseItems(record.Items)
		for _, item := range items {
			report.Record.ItemsScanned++
			row, classification := evaluateRecordItem(record, item, minWeight)
			applyClassification(&report.Record, classification)
			if row != nil {
				report.Rows = append(report.Rows, *row)
			}
		}
	}

	report.Task.ContainersScanned = len(tasks)
	for _, task := range tasks {
		items := parseTaskItems(task.Result)
		for _, item := range items {
			report.Task.ItemsScanned++
			row, classification := evaluateTaskItem(task, item, minWeight)
			applyClassification(&report.Task, classification)
			if row != nil {
				report.Rows = append(report.Rows, *row)
			}
		}
	}

	finalizeSummary(&report.Record, targetRate)
	finalizeSummary(&report.Task, targetRate)
	report.Overall = zeroSummary{
		ContainersScanned:   report.Record.ContainersScanned + report.Task.ContainersScanned,
		ItemsScanned:        report.Record.ItemsScanned + report.Task.ItemsScanned,
		MeaningfulItems:     report.Record.MeaningfulItems + report.Task.MeaningfulItems,
		KnownZeroItems:      report.Record.KnownZeroItems + report.Task.KnownZeroItems,
		SuspiciousZeroItems: report.Record.SuspiciousZeroItems + report.Task.SuspiciousZeroItems,
		TargetRate:          targetRate,
	}
	finalizeSummary(&report.Overall, targetRate)
	sort.SliceStable(report.Rows, func(i, j int) bool {
		if report.Rows[i].SuggestedSeverity != report.Rows[j].SuggestedSeverity {
			return severityRank(report.Rows[i].SuggestedSeverity) > severityRank(report.Rows[j].SuggestedSeverity)
		}
		return report.Rows[i].CreatedAt > report.Rows[j].CreatedAt
	})
	return report
}

func evaluateRecordItem(record recordRow, item itemView, minWeight float64) (*zeroSuspicionRow, string) {
	return evaluateItem(zeroSuspicionRow{
		Surface:        "user_food_records",
		ContainerID:    record.ID,
		UserID:         record.UserID,
		Nickname:       record.Nickname,
		CreatedAt:      record.CreatedAt.Format(time.RFC3339),
		MealTypeOrTask: record.MealType,
		SourceTaskID:   stringPtrValue(record.SourceTaskID),
	}, item, minWeight)
}

func evaluateTaskItem(task taskRow, item itemView, minWeight float64) (*zeroSuspicionRow, string) {
	return evaluateItem(zeroSuspicionRow{
		Surface:        "analysis_tasks",
		ContainerID:    task.ID,
		UserID:         task.UserID,
		CreatedAt:      task.CreatedAt.Format(time.RFC3339),
		MealTypeOrTask: task.TaskType,
	}, item, minWeight)
}

func evaluateItem(base zeroSuspicionRow, item itemView, minWeight float64) (*zeroSuspicionRow, string) {
	if item.Name == "" {
		return nil, "ignored"
	}
	if item.WeightG > 0 && item.WeightG < minWeight {
		return nil, "ignored"
	}
	if item.WeightG == 0 && !looksLikeFoodName(item.Name) {
		return nil, "ignored"
	}
	if isKnownZeroItem(item) {
		return nil, "known_zero"
	}
	if item.WeightG >= minWeight || item.WeightG == 0 {
		if !allCoreNutritionZero(item) {
			return nil, "meaningful_non_zero"
		}
		row := base
		row.ItemIndex = item.Index
		row.Name = item.Name
		row.WeightG = round2(item.WeightG)
		row.Calories = round2(item.Calories)
		row.Protein = round2(item.Protein)
		row.Carbs = round2(item.Carbs)
		row.Fat = round2(item.Fat)
		row.NutritionSource = item.NutritionSource
		row.ResolveStatus = item.ResolveStatus
		row.PackageStatus = item.PackageStatus
		row.MatchedFoodID = item.MatchedFoodID
		row.PackagedFoodID = item.PackagedFoodID
		row.Classification = "suspicious_zero"
		row.Reason = suspiciousReason(item)
		row.SuggestedSeverity = suspiciousSeverity(item)
		return &row, "suspicious_zero"
	}
	return nil, "ignored"
}

func applyClassification(summary *zeroSummary, classification string) {
	switch classification {
	case "known_zero":
		summary.KnownZeroItems++
	case "meaningful_non_zero":
		summary.MeaningfulItems++
	case "suspicious_zero":
		summary.MeaningfulItems++
		summary.SuspiciousZeroItems++
	}
}

func finalizeSummary(summary *zeroSummary, targetRate float64) {
	if summary.MeaningfulItems > 0 {
		summary.SuspiciousRate = float64(summary.SuspiciousZeroItems) / float64(summary.MeaningfulItems)
	}
	summary.TargetRate = targetRate
	summary.PassTarget = summary.SuspiciousRate <= targetRate
}

func parseItems(raw datatypes.JSON) []itemView {
	if len(raw) == 0 {
		return nil
	}
	var values []any
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil
	}
	return mapItems(values)
}

func parseTaskItems(raw datatypes.JSON) []itemView {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	items := []itemView{}
	seen := map[string]bool{}
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			for key, child := range typed {
				if key == "items" {
					if arr, ok := child.([]any); ok {
						for _, mapped := range mapItems(arr) {
							fingerprint := itemFingerprint(mapped)
							if !seen[fingerprint] {
								items = append(items, mapped)
								seen[fingerprint] = true
							}
						}
					}
					continue
				}
				if key == "packaged_candidates" || key == "packagedCandidates" || key == "candidates" {
					continue
				}
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(value)
	return items
}

func mapItems(values []any) []itemView {
	items := make([]itemView, 0, len(values))
	for index, value := range values {
		item, ok := value.(map[string]any)
		if !ok || isCandidateLike(item) {
			continue
		}
		view := itemView{
			Index:           index,
			Item:            item,
			Name:            firstString(item, "name", "food_name", "foodName", "display_name", "displayName"),
			WeightG:         firstPositiveNumber(item, "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams", "weight", "weight_g", "intake", "water_ml"),
			NutritionSource: firstString(item, "nutrition_source", "nutritionSource", "source"),
			ResolveStatus:   firstString(item, "resolve_status", "resolveStatus"),
			PackageStatus:   firstString(item, "package_match_status", "packageMatchStatus"),
			MatchedFoodID:   firstString(item, "matched_food_id", "matchedFoodId"),
			PackagedFoodID:  firstString(item, "packaged_food_id", "packagedFoodId"),
		}
		nutrients := mapFromAny(item["nutrients"])
		view.Calories = numberFromAny(firstNonNil(nutrients["calories"], item["calories"], item["kcal"]))
		view.Protein = numberFromAny(firstNonNil(nutrients["protein"], item["protein"], item["protein_g"]))
		view.Carbs = numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"], item["carbs_g"]))
		view.Fat = numberFromAny(firstNonNil(nutrients["fat"], item["fat"], item["fat_g"]))
		if view.Name == "" {
			continue
		}
		items = append(items, view)
	}
	return items
}

func isCandidateLike(item map[string]any) bool {
	if firstString(item, "display_name", "displayName") != "" && firstString(item, "name", "food_name", "foodName") == "" {
		return true
	}
	if firstString(item, "packaged_food_id", "packagedFoodId") != "" && firstString(item, "nutrition_source", "nutritionSource") == "" && mapFromAny(item["nutrients"]) == nil {
		return true
	}
	return false
}

func allCoreNutritionZero(item itemView) bool {
	const eps = 0.0001
	return math.Abs(item.Calories) <= eps &&
		math.Abs(item.Protein) <= eps &&
		math.Abs(item.Carbs) <= eps &&
		math.Abs(item.Fat) <= eps
}

var knownZeroNamePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(^水$|温水|热水|冰水|白开水|纯净水|矿泉水|饮用天然水|饮用水|苏打水|气泡水|无糖茶|茶水|绿茶|乌龙茶|黑咖啡|美式咖啡|深烘美式|椰青美式|无糖可乐|无糖可口可乐|无糖芬达)`),
}

func isKnownZeroItem(item itemView) bool {
	normalized := strings.TrimSpace(item.Name)
	if normalized == "" {
		return false
	}
	for _, pattern := range knownZeroNamePatterns {
		if pattern.MatchString(normalized) {
			return true
		}
	}
	blob := strings.ToLower(flattenItemText(item.Item))
	return strings.Contains(blob, "verified-zero") || strings.Contains(blob, "verified_zero")
}

func looksLikeFoodName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	if len([]rune(name)) <= 1 {
		return false
	}
	return true
}

func suspiciousReason(item itemView) string {
	if item.NutritionSource == "unresolved" || item.ResolveStatus == "unresolved" {
		return "非真实零卡食物 unresolved 后核心营养全 0"
	}
	if item.PackageStatus == "candidates_only" || item.PackageStatus == "packaged_needs_confirmation" {
		return "包装库只有候选/待确认，但核心营养全 0"
	}
	if item.NutritionSource == "" {
		return "缺少营养来源且核心营养全 0"
	}
	return "核心营养全 0，未识别为真实零卡"
}

func suspiciousSeverity(item itemView) string {
	if item.NutritionSource == "unresolved" || item.ResolveStatus == "unresolved" || item.NutritionSource == "" {
		return "high"
	}
	if item.PackageStatus == "candidates_only" || item.PackageStatus == "packaged_needs_confirmation" {
		return "medium"
	}
	return "low"
}

func severityRank(severity string) int {
	switch severity {
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func writeReports(outputDir string, report benchmarkReport) (string, string, string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", "", "", err
	}
	jsonPath := filepath.Join(outputDir, "zero_nutrition_benchmark.json")
	csvPath := filepath.Join(outputDir, "zero_nutrition_suspicious_rows.csv")
	mdPath := filepath.Join(outputDir, "zero_nutrition_benchmark.md")
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(jsonPath, raw, 0o644); err != nil {
		return "", "", "", err
	}
	if err := writeCSV(csvPath, report.Rows); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(mdPath, []byte(renderMarkdown(report)), 0o644); err != nil {
		return "", "", "", err
	}
	return jsonPath, csvPath, mdPath, nil
}

func writeCSV(path string, rows []zeroSuspicionRow) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	defer writer.Flush()
	header := []string{"surface", "container_id", "user_id", "nickname", "created_at", "meal_type_or_task", "source_task_id", "item_index", "name", "weight_g", "calories", "protein", "carbs", "fat", "nutrition_source", "resolve_status", "package_match_status", "matched_food_id", "packaged_food_id", "severity", "reason"}
	if err := writer.Write(header); err != nil {
		return err
	}
	for _, row := range rows {
		values := []string{
			row.Surface,
			row.ContainerID,
			row.UserID,
			row.Nickname,
			row.CreatedAt,
			row.MealTypeOrTask,
			row.SourceTaskID,
			fmt.Sprint(row.ItemIndex),
			row.Name,
			formatFloat(row.WeightG),
			formatFloat(row.Calories),
			formatFloat(row.Protein),
			formatFloat(row.Carbs),
			formatFloat(row.Fat),
			row.NutritionSource,
			row.ResolveStatus,
			row.PackageStatus,
			row.MatchedFoodID,
			row.PackagedFoodID,
			row.SuggestedSeverity,
			row.Reason,
		}
		if err := writer.Write(values); err != nil {
			return err
		}
	}
	return writer.Error()
}

func renderMarkdown(report benchmarkReport) string {
	var b strings.Builder
	b.WriteString("# 0 营养保存 Benchmark\n\n")
	b.WriteString(fmt.Sprintf("- 生成时间：`%s`\n", report.GeneratedAt))
	b.WriteString(fmt.Sprintf("- 扫描窗口：最近 `%d` 天\n", report.Days))
	b.WriteString(fmt.Sprintf("- 有效重量阈值：`%.1fg`\n", report.MinWeightG))
	b.WriteString(fmt.Sprintf("- 目标可疑率：`%.6f`（约等于每 %.0f 个有效 item 不超过 1 个）\n\n", report.TargetRate, reciprocal(report.TargetRate)))
	appendSummary := func(title string, summary zeroSummary) {
		b.WriteString(fmt.Sprintf("## %s\n\n", title))
		b.WriteString(fmt.Sprintf("- 容器数：`%d`\n", summary.ContainersScanned))
		b.WriteString(fmt.Sprintf("- 扫描 item：`%d`\n", summary.ItemsScanned))
		b.WriteString(fmt.Sprintf("- 有效非零卡候选 item：`%d`\n", summary.MeaningfulItems))
		b.WriteString(fmt.Sprintf("- 已排除真实零卡/近似零卡 item：`%d`\n", summary.KnownZeroItems))
		b.WriteString(fmt.Sprintf("- 可疑 0 营养 item：`%d`\n", summary.SuspiciousZeroItems))
		b.WriteString(fmt.Sprintf("- 可疑率：`%.8f`\n", summary.SuspiciousRate))
		b.WriteString(fmt.Sprintf("- 是否达到目标：`%v`\n\n", summary.PassTarget))
	}
	appendSummary("正式饮食记录 user_food_records", report.Record)
	appendSummary("分析任务 analysis_tasks", report.Task)
	appendSummary("总体", report.Overall)
	if len(report.Rows) == 0 {
		b.WriteString("## 可疑样本\n\n未发现可疑 0 营养 item。\n")
		return b.String()
	}
	b.WriteString("## 可疑样本 Top 50\n\n")
	b.WriteString("| surface | container | user | item | weight | source | status | severity | reason |\n")
	b.WriteString("|---|---|---|---|---:|---|---|---|---|\n")
	for i, row := range report.Rows {
		if i >= 50 {
			break
		}
		b.WriteString(fmt.Sprintf("| %s | `%s` | %s | %s | %.1f | %s | %s/%s | %s | %s |\n",
			escapeMD(row.Surface),
			row.ContainerID,
			escapeMD(firstNonEmpty(row.Nickname, row.UserID)),
			escapeMD(row.Name),
			row.WeightG,
			escapeMD(row.NutritionSource),
			escapeMD(row.ResolveStatus),
			escapeMD(row.PackageStatus),
			escapeMD(row.SuggestedSeverity),
			escapeMD(row.Reason),
		))
	}
	return b.String()
}

func resolveDefaultOutputDir() string {
	now := time.Now()
	return filepath.Join("..", "tmp", fmt.Sprintf("zero-nutrition-benchmark-%s-%06d", now.Format("20060102-150405"), now.Nanosecond()/1000))
}

func parseSince(raw string, days int) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Now().Add(-time.Duration(days) * 24 * time.Hour), nil
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	}
	var lastErr error
	for _, layout := range layouts {
		parsed, err := time.ParseInLocation(layout, raw, time.Local)
		if err == nil {
			return parsed, nil
		}
		lastErr = err
	}
	return time.Time{}, lastErr
}

func parseCSVList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}

func firstString(item map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := item[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		default:
			text := strings.TrimSpace(fmt.Sprintf("%v", typed))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func firstPositiveNumber(item map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := numberFromAny(item[key]); value > 0 {
			return value
		}
	}
	return 0
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func numberFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		v, _ := typed.Float64()
		return v
	case string:
		v, _ := strconvParseFloat(strings.TrimSpace(typed))
		return v
	default:
		return 0
	}
}

func strconvParseFloat(raw string) (float64, error) {
	if raw == "" || raw == "<nil>" {
		return 0, fmt.Errorf("empty")
	}
	return strconvParseFloatImpl(raw)
}

func strconvParseFloatImpl(raw string) (float64, error) {
	var value float64
	_, err := fmt.Sscanf(raw, "%f", &value)
	return value, err
}

func flattenItemText(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(raw)
}

func itemFingerprint(item itemView) string {
	return fmt.Sprintf("%d:%s:%.2f:%s:%s", item.Index, item.Name, item.WeightG, item.NutritionSource, item.ResolveStatus)
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

func formatFloat(value float64) string {
	return strconvFormatFloat(value)
}

func strconvFormatFloat(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.4f", value), "0"), ".")
}

func reciprocal(value float64) float64 {
	if value <= 0 {
		return 0
	}
	return 1 / value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func escapeMD(value string) string {
	value = strings.ReplaceAll(value, "|", "\\|")
	value = strings.ReplaceAll(value, "\n", " ")
	return value
}
