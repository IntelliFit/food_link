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

type recordRow struct {
	ID            string         `gorm:"column:id"`
	UserID        string         `gorm:"column:user_id"`
	Nickname      string         `gorm:"column:nickname"`
	MealType      string         `gorm:"column:meal_type"`
	Items         datatypes.JSON `gorm:"column:items"`
	TotalCalories float64        `gorm:"column:total_calories"`
	TotalProtein  float64        `gorm:"column:total_protein"`
	TotalCarbs    float64        `gorm:"column:total_carbs"`
	TotalFat      float64        `gorm:"column:total_fat"`
	RecordTime    time.Time      `gorm:"column:record_time"`
	CreatedAt     time.Time      `gorm:"column:created_at"`
	SourceTaskID  *string        `gorm:"column:source_task_id"`
}

type taskRow struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	Nickname  string         `gorm:"column:nickname"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	Result    datatypes.JSON `gorm:"column:result"`
	CreatedAt time.Time      `gorm:"column:created_at"`
}

type itemView struct {
	Index              int
	Item               map[string]any
	Name               string
	WeightG            float64
	Calories           float64
	Protein            float64
	Carbs              float64
	Fat                float64
	NutritionSource    string
	ResolveStatus      string
	PackageStatus      string
	PackageWeightSrc   string
	PackageWeightApply string
	MatchedFoodID      string
	PackagedFoodID     string
}

type auditReport struct {
	GeneratedAt string          `json:"generated_at"`
	Days        int             `json:"days"`
	Since       string          `json:"since"`
	MinWeightG  float64         `json:"min_weight_g"`
	Record      auditSummary    `json:"record"`
	Task        auditSummary    `json:"task"`
	Overall     auditSummary    `json:"overall"`
	IssueCounts []issueCount    `json:"issue_counts"`
	Rows        []auditIssueRow `json:"rows"`
}

type auditSummary struct {
	ContainersScanned int `json:"containers_scanned"`
	ItemsScanned      int `json:"items_scanned"`
	IssueItems        int `json:"issue_items"`
	IssueRows         int `json:"issue_rows"`
	HighIssues        int `json:"high_issues"`
	MediumIssues      int `json:"medium_issues"`
	LowIssues         int `json:"low_issues"`
}

type issueCount struct {
	IssueType string `json:"issue_type"`
	Severity  string `json:"severity"`
	Count     int    `json:"count"`
}

type auditIssueRow struct {
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
	KcalPer100g       float64 `json:"kcal_per_100g,omitempty"`
	MacroEnergyKcal   float64 `json:"macro_energy_kcal,omitempty"`
	MacroEnergyDiff   float64 `json:"macro_energy_diff,omitempty"`
	NutritionSource   string  `json:"nutrition_source,omitempty"`
	ResolveStatus     string  `json:"resolve_status,omitempty"`
	PackageStatus     string  `json:"package_match_status,omitempty"`
	MatchedFoodID     string  `json:"matched_food_id,omitempty"`
	PackagedFoodID    string  `json:"packaged_food_id,omitempty"`
	IssueType         string  `json:"issue_type"`
	Severity          string  `json:"severity"`
	Reason            string  `json:"reason"`
	RecommendedAction string  `json:"recommended_action,omitempty"`
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON/CSV/Markdown reports")
	days := flag.Int("days", 0, "look back this many days; 0 scans all history")
	recordLimit := flag.Int("record-limit", 50000, "maximum user_food_records rows to scan")
	taskLimit := flag.Int("task-limit", 50000, "maximum done analysis_tasks rows to scan")
	taskTypes := flag.String("task-types", "food,food_text,food_correction,precision_aggregate", "comma-separated analysis task types to scan; empty scans all task types")
	sinceRaw := flag.String("since", "", "optional lower bound for created_at, RFC3339 or '2006-01-02 15:04:05'; overrides --days")
	minWeight := flag.Float64("min-weight-g", 5, "minimum item weight for weight-sensitive checks")
	reviewGenerated := flag.Bool("review-generated", true, "include low-severity rows for LLM/generated nutrition sources")
	includeMissingSource := flag.Bool("include-missing-source", false, "include low-severity rows when non-zero nutrition is missing nutrition_source")
	timeout := flag.Duration("timeout", 5*time.Minute, "command timeout")
	flag.Parse()

	if *days < 0 {
		log.Fatal("--days must be non-negative")
	}
	if *recordLimit < 0 || *taskLimit < 0 {
		log.Fatal("--record-limit and --task-limit must be non-negative")
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
		log.Fatalf("解析时间范围失败: %v", err)
	}
	records, err := loadRecords(ctx, db, since, *recordLimit)
	if err != nil {
		log.Fatalf("查询饮食记录失败: %v", err)
	}
	tasks, err := loadTasks(ctx, db, since, *taskLimit, parseCSVList(*taskTypes))
	if err != nil {
		log.Fatalf("查询分析任务失败: %v", err)
	}

	report := runAudit(records, tasks, *days, since, *minWeight, *reviewGenerated, *includeMissingSource)
	jsonPath, csvPath, mdPath, err := writeReports(*outputDir, report)
	if err != nil {
		log.Fatalf("写入审计报告失败: %v", err)
	}
	fmt.Printf("food analysis quality audit days=%d records=%d tasks=%d items=%d issue_items=%d issue_rows=%d high=%d medium=%d low=%d reports=%s,%s,%s\n",
		report.Days,
		report.Record.ContainersScanned,
		report.Task.ContainersScanned,
		report.Overall.ItemsScanned,
		report.Overall.IssueItems,
		report.Overall.IssueRows,
		report.Overall.HighIssues,
		report.Overall.MediumIssues,
		report.Overall.LowIssues,
		jsonPath,
		csvPath,
		mdPath,
	)
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
  COALESCE(r.total_calories, 0) AS total_calories,
  COALESCE(r.total_protein, 0) AS total_protein,
  COALESCE(r.total_carbs, 0) AS total_carbs,
  COALESCE(r.total_fat, 0) AS total_fat,
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
	err := db.WithContext(ctx).Raw(`
SELECT
  t.id,
  t.user_id,
  COALESCE(u.nickname, '') AS nickname,
  COALESCE(t.task_type, '') AS task_type,
  COALESCE(t.status, '') AS status,
  t.result,
  t.created_at
FROM analysis_tasks t
LEFT JOIN weapp_user u ON u.id = t.user_id
WHERE t.status = 'done'
  AND t.result IS NOT NULL
  AND (? = 0 OR t.task_type IN ?)
  AND t.created_at >= ?
ORDER BY t.created_at DESC
LIMIT ?`, len(taskTypes), taskTypes, since, limit).Scan(&rows).Error
	return rows, err
}

func runAudit(records []recordRow, tasks []taskRow, days int, since time.Time, minWeight float64, reviewGenerated bool, includeMissingSource bool) auditReport {
	report := auditReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Days:        days,
		Since:       since.Format(time.RFC3339),
		MinWeightG:  minWeight,
		Rows:        []auditIssueRow{},
	}
	recordIssueItems := map[string]bool{}
	taskIssueItems := map[string]bool{}

	report.Record.ContainersScanned = len(records)
	for _, record := range records {
		for _, item := range parseItems(record.Items) {
			report.Record.ItemsScanned++
			base := auditIssueRow{
				Surface:        "user_food_records",
				ContainerID:    record.ID,
				UserID:         record.UserID,
				Nickname:       record.Nickname,
				CreatedAt:      record.CreatedAt.Format(time.RFC3339),
				MealTypeOrTask: record.MealType,
				SourceTaskID:   stringPtrValue(record.SourceTaskID),
			}
			rows := evaluateItem(base, item, minWeight, reviewGenerated, includeMissingSource)
			if len(rows) > 0 {
				recordIssueItems[record.ID+":"+fmt.Sprint(item.Index)] = true
				addRows(&report.Record, &report.Rows, rows)
			}
		}
	}

	report.Task.ContainersScanned = len(tasks)
	for _, task := range tasks {
		for _, item := range parseTaskItems(task.Result) {
			report.Task.ItemsScanned++
			base := auditIssueRow{
				Surface:        "analysis_tasks",
				ContainerID:    task.ID,
				UserID:         task.UserID,
				Nickname:       task.Nickname,
				CreatedAt:      task.CreatedAt.Format(time.RFC3339),
				MealTypeOrTask: task.TaskType,
			}
			rows := evaluateItem(base, item, minWeight, reviewGenerated, includeMissingSource)
			if len(rows) > 0 {
				taskIssueItems[task.ID+":"+fmt.Sprint(item.Index)] = true
				addRows(&report.Task, &report.Rows, rows)
			}
		}
	}
	report.Record.IssueItems = len(recordIssueItems)
	report.Task.IssueItems = len(taskIssueItems)
	report.Overall = auditSummary{
		ContainersScanned: report.Record.ContainersScanned + report.Task.ContainersScanned,
		ItemsScanned:      report.Record.ItemsScanned + report.Task.ItemsScanned,
		IssueItems:        report.Record.IssueItems + report.Task.IssueItems,
		IssueRows:         report.Record.IssueRows + report.Task.IssueRows,
		HighIssues:        report.Record.HighIssues + report.Task.HighIssues,
		MediumIssues:      report.Record.MediumIssues + report.Task.MediumIssues,
		LowIssues:         report.Record.LowIssues + report.Task.LowIssues,
	}
	sort.SliceStable(report.Rows, func(i, j int) bool {
		if report.Rows[i].Severity != report.Rows[j].Severity {
			return severityRank(report.Rows[i].Severity) > severityRank(report.Rows[j].Severity)
		}
		if report.Rows[i].IssueType != report.Rows[j].IssueType {
			return report.Rows[i].IssueType < report.Rows[j].IssueType
		}
		return report.Rows[i].CreatedAt > report.Rows[j].CreatedAt
	})
	report.IssueCounts = buildIssueCounts(report.Rows)
	return report
}

func addRows(summary *auditSummary, allRows *[]auditIssueRow, rows []auditIssueRow) {
	for _, row := range rows {
		summary.IssueRows++
		switch row.Severity {
		case "high":
			summary.HighIssues++
		case "medium":
			summary.MediumIssues++
		default:
			summary.LowIssues++
		}
		*allRows = append(*allRows, row)
	}
}

func evaluateItem(base auditIssueRow, item itemView, minWeight float64, reviewGenerated bool, includeMissingSource bool) []auditIssueRow {
	if item.Name == "" || isCandidateLike(item.Item) {
		return nil
	}
	rows := []auditIssueRow{}
	row := func(issueType, severity, reason, action string) auditIssueRow {
		out := base
		out.ItemIndex = item.Index
		out.Name = item.Name
		out.WeightG = round2(item.WeightG)
		out.Calories = round2(item.Calories)
		out.Protein = round2(item.Protein)
		out.Carbs = round2(item.Carbs)
		out.Fat = round2(item.Fat)
		out.KcalPer100g = round2(kcalPer100g(item))
		out.MacroEnergyKcal = round2(macroEnergy(item))
		out.MacroEnergyDiff = round2(math.Abs(item.Calories - macroEnergy(item)))
		out.NutritionSource = item.NutritionSource
		out.ResolveStatus = item.ResolveStatus
		out.PackageStatus = item.PackageStatus
		out.MatchedFoodID = item.MatchedFoodID
		out.PackagedFoodID = item.PackagedFoodID
		out.IssueType = issueType
		out.Severity = severity
		out.Reason = reason
		out.RecommendedAction = action
		return out
	}

	if hasNegativeCore(item) {
		rows = append(rows, row("negative_nutrition", "high", "核心营养出现负数", "禁止保存负营养；回查生成结果或手动纠错"))
	}
	if looksLikeFoodName(item.Name) && !isKnownZeroItem(item) && (item.WeightG >= minWeight || item.WeightG == 0) && allCoreNutritionZero(item) {
		rows = append(rows, row("suspicious_zero_nutrition", "high", "非真实零卡食物核心营养全 0", "按当前算法重跑或手动补营养"))
	}
	if item.WeightG <= 0 && looksLikeFoodName(item.Name) && !isKnownZeroItem(item) {
		rows = append(rows, row("missing_or_zero_weight", "medium", "食物缺少有效重量，营养换算不可复核", "补重量或用原图/文本重跑估重"))
	}
	if item.WeightG > 3000 && !looksLikeLargeLiquid(item.Name) {
		rows = append(rows, row("extreme_weight", "medium", "单个食物重量超过 3000g，疑似估重或整餐拆分异常", "抽样复核重量和 item 拆分"))
	}
	if item.Calories > 2500 && item.WeightG > 0 && item.WeightG < 2000 {
		rows = append(rows, row("extreme_item_calories", "high", "单个 item 热量超过 2500kcal 且重量不支持该量级", "复核是否 kJ/kcal 混淆或重量/规格误用"))
	}
	if item.WeightG > 0 {
		kcal100 := kcalPer100g(item)
		if kcal100 > 1100 || (kcal100 > 950 && !looksLikeHighFatFood(item.Name)) {
			rows = append(rows, row("extreme_energy_density", "high", "能量密度超过 950 kcal/100g，超过常见食物物理上限", "优先检查 kJ 被当 kcal 或包装规格误用"))
		} else if kcal100 > 750 && !looksLikeHighFatFood(item.Name) {
			rows = append(rows, row("high_energy_density_review", "medium", "能量密度很高且不像油脂/坚果类食物", "抽样复核热量口径和重量"))
		}
		if item.Calories > 0 && item.WeightG >= 50 && kcal100 < 2 && !isKnownZeroItem(item) && !looksLikeLowEnergyLiquid(item.Name) {
			rows = append(rows, row("very_low_energy_density", "medium", "有热量但能量密度低于 2 kcal/100g，疑似仍接近 0 营养", "复核是否误用无糖饮料口径"))
		}
		if macroExceedsWeight(item) {
			rows = append(rows, row("macro_exceeds_weight", "high", "蛋白质/碳水/脂肪克数超过食物重量合理上限", "复核营养单位和本次重量"))
		}
	}
	if macroEnergyMismatch(item) {
		rows = append(rows, row("macro_energy_mismatch", "medium", "热量与蛋白质/碳水/脂肪按 4/4/9 换算差异过大", "复核宏量营养或热量字段来源"))
	}
	if includeMissingSource && item.NutritionSource == "" && !allCoreNutritionZero(item) {
		rows = append(rows, row("missing_nutrition_source", "low", "营养非 0 但缺少 nutrition_source，后续难以追溯", "补充来源字段或统一保存映射"))
	}
	if (item.NutritionSource == "unresolved" || item.ResolveStatus == "unresolved") && !allCoreNutritionZero(item) {
		rows = append(rows, row("unresolved_with_nutrition", "medium", "标记 unresolved 但已有非 0 营养，状态与数据不一致", "统一 resolve_status/nutrition_source 口径"))
	}
	if item.PackageStatus == "candidates_only" || item.PackageStatus == "packaged_needs_confirmation" || item.NutritionSource == "packaged_candidate_pending" {
		rows = append(rows, row("packaged_candidate_pending", "medium", "包装食品仍处于候选/待确认状态", "让用户选规格或降级为普通营养估算"))
	}
	if item.PackageStatus == "matched_weight_conflict" || (item.PackagedFoodID != "" && strings.EqualFold(item.PackageWeightApply, "false")) {
		rows = append(rows, row("packaged_weight_conflict", "medium", "包装 SKU 命中但重量锚点冲突或未应用", "复核图片净含量、用户重量和包装规格"))
	}
	if reviewGenerated && isGeneratedNutritionSource(item.NutritionSource) {
		rows = append(rows, row("llm_generated_review", "low", "营养来自 LLM/重跑生成，建议进入抽样复核池", "加入真实 holdout 或人工复核样本"))
	}
	return rows
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
				if key == "items" || key == "nutritionItems" {
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
		item := mapFromAny(value)
		if len(item) == 0 || isCandidateLike(item) {
			continue
		}
		nutrients := mapFromAny(item["nutrients"])
		view := itemView{
			Index:              index,
			Item:               item,
			Name:               firstString(item, "name", "food_name", "foodName", "display_name", "displayName"),
			WeightG:            firstPositiveNumber(item, "estimatedWeightGrams", "estimated_weight_grams", "grossWeightGrams", "gross_weight_grams", "weight", "weight_g", "intake", "water_ml"),
			Calories:           numberFromAny(firstNonNil(nutrients["calories"], item["calories"], item["kcal"])),
			Protein:            numberFromAny(firstNonNil(nutrients["protein"], item["protein"], item["protein_g"])),
			Carbs:              numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"], item["carbs_g"])),
			Fat:                numberFromAny(firstNonNil(nutrients["fat"], item["fat"], item["fat_g"])),
			NutritionSource:    firstString(item, "nutrition_source", "nutritionSource", "source"),
			ResolveStatus:      firstString(item, "resolve_status", "resolveStatus"),
			PackageStatus:      firstString(item, "package_match_status", "packageMatchStatus"),
			PackageWeightSrc:   firstString(item, "package_weight_source", "packageWeightSource"),
			PackageWeightApply: strings.ToLower(firstString(item, "package_weight_applied", "packageWeightApplied")),
			MatchedFoodID:      firstString(item, "matched_food_id", "matchedFoodId"),
			PackagedFoodID:     firstString(item, "packaged_food_id", "packagedFoodId"),
		}
		if view.Name != "" {
			items = append(items, view)
		}
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

func buildIssueCounts(rows []auditIssueRow) []issueCount {
	type key struct {
		issueType string
		severity  string
	}
	counts := map[key]int{}
	for _, row := range rows {
		counts[key{row.IssueType, row.Severity}]++
	}
	out := make([]issueCount, 0, len(counts))
	for k, count := range counts {
		out = append(out, issueCount{IssueType: k.issueType, Severity: k.severity, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if severityRank(out[i].Severity) != severityRank(out[j].Severity) {
			return severityRank(out[i].Severity) > severityRank(out[j].Severity)
		}
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].IssueType < out[j].IssueType
	})
	return out
}

func writeReports(outputDir string, report auditReport) (string, string, string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", "", "", err
	}
	jsonPath := filepath.Join(outputDir, "food_analysis_quality_audit.json")
	csvPath := filepath.Join(outputDir, "food_analysis_quality_issues.csv")
	mdPath := filepath.Join(outputDir, "food_analysis_quality_audit.md")
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

func writeCSV(path string, rows []auditIssueRow) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	defer writer.Flush()
	header := []string{"surface", "container_id", "user_id", "nickname", "created_at", "meal_type_or_task", "source_task_id", "item_index", "name", "weight_g", "calories", "protein", "carbs", "fat", "kcal_per_100g", "macro_energy_kcal", "macro_energy_diff", "nutrition_source", "resolve_status", "package_match_status", "matched_food_id", "packaged_food_id", "issue_type", "severity", "reason", "recommended_action"}
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
			fmt.Sprintf("%.2f", row.WeightG),
			fmt.Sprintf("%.2f", row.Calories),
			fmt.Sprintf("%.2f", row.Protein),
			fmt.Sprintf("%.2f", row.Carbs),
			fmt.Sprintf("%.2f", row.Fat),
			fmt.Sprintf("%.2f", row.KcalPer100g),
			fmt.Sprintf("%.2f", row.MacroEnergyKcal),
			fmt.Sprintf("%.2f", row.MacroEnergyDiff),
			row.NutritionSource,
			row.ResolveStatus,
			row.PackageStatus,
			row.MatchedFoodID,
			row.PackagedFoodID,
			row.IssueType,
			row.Severity,
			row.Reason,
			row.RecommendedAction,
		}
		if err := writer.Write(values); err != nil {
			return err
		}
	}
	return nil
}

func renderMarkdown(report auditReport) string {
	var b strings.Builder
	b.WriteString("# 食物识别质量审计\n\n")
	b.WriteString(fmt.Sprintf("- 生成时间：`%s`\n", report.GeneratedAt))
	b.WriteString(fmt.Sprintf("- 扫描起点：`%s`\n", report.Since))
	b.WriteString(fmt.Sprintf("- 容器：records `%d`，tasks `%d`\n", report.Record.ContainersScanned, report.Task.ContainersScanned))
	b.WriteString(fmt.Sprintf("- item：`%d`，有 issue 的 item：`%d`，issue rows：`%d`\n", report.Overall.ItemsScanned, report.Overall.IssueItems, report.Overall.IssueRows))
	b.WriteString(fmt.Sprintf("- 严重度：high `%d`，medium `%d`，low `%d`\n\n", report.Overall.HighIssues, report.Overall.MediumIssues, report.Overall.LowIssues))
	b.WriteString("## Issue 分布\n\n")
	b.WriteString("| issue_type | severity | count |\n|---|---:|---:|\n")
	for _, count := range report.IssueCounts {
		b.WriteString(fmt.Sprintf("| `%s` | `%s` | %d |\n", count.IssueType, count.Severity, count.Count))
	}
	b.WriteString("\n## 高优先级样例\n\n")
	b.WriteString("| surface | id | item | issue | kcal | weight | reason |\n|---|---|---|---|---:|---:|---|\n")
	shown := 0
	for _, row := range report.Rows {
		if row.Severity != "high" {
			continue
		}
		b.WriteString(fmt.Sprintf("| `%s` | `%s` | %s | `%s` | %.1f | %.1f | %s |\n",
			row.Surface, row.ContainerID, escapeMD(row.Name), row.IssueType, row.Calories, row.WeightG, escapeMD(row.Reason)))
		shown++
		if shown >= 30 {
			break
		}
	}
	return b.String()
}

func parseSince(raw string, days int) (time.Time, error) {
	if strings.TrimSpace(raw) != "" {
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if parsed, err := time.ParseInLocation(layout, strings.TrimSpace(raw), time.FixedZone("Asia/Shanghai", 8*3600)); err == nil {
				return parsed, nil
			}
		}
		return time.Time{}, fmt.Errorf("unsupported time format: %s", raw)
	}
	if days == 0 {
		return time.Unix(0, 0), nil
	}
	return time.Now().AddDate(0, 0, -days), nil
}

func parseCSVList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := []string{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func kcalPer100g(item itemView) float64 {
	if item.WeightG <= 0 {
		return 0
	}
	return item.Calories / item.WeightG * 100
}

func macroEnergy(item itemView) float64 {
	return item.Protein*4 + item.Carbs*4 + item.Fat*9
}

func macroEnergyMismatch(item itemView) bool {
	if item.Calories <= 30 {
		return false
	}
	macro := macroEnergy(item)
	if macro <= 20 {
		return false
	}
	diff := math.Abs(item.Calories - macro)
	denominator := math.Max(item.Calories, macro)
	return diff > 100 && diff/denominator > 0.55
}

func macroExceedsWeight(item itemView) bool {
	if item.WeightG <= 0 {
		return false
	}
	sum := item.Protein + item.Carbs + item.Fat
	if sum > item.WeightG*1.2+5 {
		return true
	}
	return item.Protein > item.WeightG*1.05+2 || item.Carbs > item.WeightG*1.05+2 || item.Fat > item.WeightG*1.05+2
}

func hasNegativeCore(item itemView) bool {
	return item.Calories < 0 || item.Protein < 0 || item.Carbs < 0 || item.Fat < 0
}

func allCoreNutritionZero(item itemView) bool {
	const eps = 0.0001
	return math.Abs(item.Calories) <= eps &&
		math.Abs(item.Protein) <= eps &&
		math.Abs(item.Carbs) <= eps &&
		math.Abs(item.Fat) <= eps
}

func isGeneratedNutritionSource(source string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	return strings.Contains(source, "deepseek_generated") ||
		strings.Contains(source, "gemini") ||
		strings.Contains(source, "llm") ||
		strings.Contains(source, "rerun_text_generated") ||
		strings.Contains(source, "history_text_rerun_generated") ||
		strings.Contains(source, "ai_generated")
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
	return len([]rune(strings.TrimSpace(name))) > 1
}

func looksLikeLargeLiquid(name string) bool {
	return containsAny(name, []string{"水", "汤", "茶", "饮料", "咖啡", "奶茶", "果汁", "可乐", "牛奶", "豆浆"})
}

func looksLikeLowEnergyLiquid(name string) bool {
	return containsAny(name, []string{"水", "茶", "咖啡", "汤", "无糖", "气泡水", "苏打水"})
}

func looksLikeHighFatFood(name string) bool {
	return containsAny(name, []string{"油", "黄油", "奶油", "坚果", "花生", "瓜子", "芝麻", "核桃", "杏仁", "肥肉"})
}

func containsAny(text string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func firstString(item map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := item[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
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

func numberFromAny(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		value, _ := typed.Float64()
		return value
	case string:
		text := strings.TrimSpace(strings.TrimSuffix(typed, "g"))
		value, _ := strconvParseFloat(text)
		return value
	default:
		return 0
	}
}

func strconvParseFloat(text string) (float64, error) {
	var value float64
	_, err := fmt.Sscanf(text, "%f", &value)
	return value, err
}

func mapFromAny(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
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

func itemFingerprint(item itemView) string {
	return fmt.Sprintf("%d:%s:%.2f:%.2f:%.2f:%.2f:%.2f", item.Index, item.Name, item.WeightG, item.Calories, item.Protein, item.Carbs, item.Fat)
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func flattenItemText(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
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

func escapeMD(text string) string {
	text = strings.ReplaceAll(text, "|", "\\|")
	text = strings.ReplaceAll(text, "\n", " ")
	return text
}

func resolveDefaultOutputDir() string {
	now := time.Now()
	return filepath.Join("..", "tmp", fmt.Sprintf("food-analysis-quality-audit-%s-%06d", now.Format("20060102-150405"), now.Nanosecond()/1000))
}
