package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
)

type taskRow struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	TextInput *string        `gorm:"column:text_input"`
	Result    datatypes.JSON `gorm:"column:result"`
	CreatedAt time.Time      `gorm:"column:created_at"`
}

type auditReport struct {
	GeneratedAt       string     `json:"generated_at"`
	Days              int        `json:"days"`
	TaskLimit         int        `json:"task_limit"`
	ScannedTasks      int        `json:"scanned_tasks"`
	PackagedItemCount int        `json:"packaged_item_count"`
	SameMatch         int        `json:"same_match"`
	NowUnresolved     int        `json:"now_unresolved"`
	ChangedMatch      int        `json:"changed_match"`
	Rows              []auditRow `json:"rows"`
}

type auditRow struct {
	TaskID             string  `json:"task_id"`
	CreatedAt          string  `json:"created_at"`
	TaskType           string  `json:"task_type"`
	QuerySource        string  `json:"query_source"`
	Query              string  `json:"query"`
	TaskTextInput      string  `json:"task_text_input,omitempty"`
	ItemName           string  `json:"item_name"`
	OldPackagedFoodID  string  `json:"old_packaged_food_id,omitempty"`
	OldNutritionSource string  `json:"old_nutrition_source,omitempty"`
	OldResolveStatus   string  `json:"old_resolve_status,omitempty"`
	NewStatus          string  `json:"new_status"`
	NewPackagedFoodID  string  `json:"new_packaged_food_id,omitempty"`
	NewDisplayName     string  `json:"new_display_name,omitempty"`
	NewScore           float64 `json:"new_score,omitempty"`
	Outcome            string  `json:"outcome"`
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	outputDir := flag.String("output-dir", resolveDefaultOutputDir(), "directory for JSON and CSV reports")
	days := flag.Int("days", 14, "look back this many days")
	limit := flag.Int("limit", 500, "maximum tasks to audit")
	timeout := flag.Duration("timeout", 2*time.Minute, "command timeout")
	flag.Parse()

	if *days <= 0 {
		log.Fatal("--days must be positive")
	}
	if *limit <= 0 {
		log.Fatal("--limit must be positive")
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

	var tasks []taskRow
	err = db.WithContext(ctx).Raw(`
SELECT id, user_id, task_type, text_input, result, created_at
FROM analysis_tasks
WHERE status = 'done'
  AND result IS NOT NULL
  AND result::text LIKE '%packaged_food_library%'
  AND created_at >= NOW() - (? * INTERVAL '1 day')
ORDER BY created_at DESC
LIMIT ?`, *days, *limit).Scan(&tasks).Error
	if err != nil {
		log.Fatalf("查询真实任务失败: %v", err)
	}

	repo := foodrecordrepo.NewFoodNutritionRepo(db)
	report, err := runAudit(ctx, repo, tasks, *days, *limit)
	if err != nil {
		log.Fatalf("审计真实任务失败: %v", err)
	}
	jsonPath, csvPath, err := writeAuditReports(*outputDir, report)
	if err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	fmt.Printf("packaged real task audit tasks=%d packaged_items=%d same_match=%d now_unresolved=%d changed_match=%d reports=%s,%s\n",
		report.ScannedTasks,
		report.PackagedItemCount,
		report.SameMatch,
		report.NowUnresolved,
		report.ChangedMatch,
		jsonPath,
		csvPath,
	)
}

func runAudit(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, tasks []taskRow, days int, limit int) (auditReport, error) {
	report := auditReport{
		GeneratedAt:  time.Now().Format(time.RFC3339),
		Days:         days,
		TaskLimit:    limit,
		ScannedTasks: len(tasks),
		Rows:         []auditRow{},
	}
	for _, task := range tasks {
		var result any
		if len(task.Result) == 0 {
			continue
		}
		if err := json.Unmarshal(task.Result, &result); err != nil {
			continue
		}
		items := collectPackagedItems(result)
		for _, item := range items {
			row := buildAuditRowBase(task, item)
			if row.Query == "" {
				continue
			}
			resolved, err := repo.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{Name: row.Query})
			if err != nil {
				return report, err
			}
			row.NewStatus = resolved.Status
			row.NewScore = resolved.Score
			if resolved.Food != nil {
				row.NewPackagedFoodID = resolved.Food.ID
				row.NewDisplayName = resolved.Food.DisplayName
			}
			row.Outcome = classifyOutcome(row.OldPackagedFoodID, row.NewPackagedFoodID, row.NewStatus)
			switch row.Outcome {
			case "same_match":
				report.SameMatch++
			case "now_unresolved":
				report.NowUnresolved++
			case "changed_match":
				report.ChangedMatch++
			}
			report.PackagedItemCount++
			report.Rows = append(report.Rows, row)
		}
	}
	return report, nil
}

func collectPackagedItems(value any) []map[string]any {
	out := []map[string]any{}
	var walk func(any)
	walk = func(v any) {
		switch current := v.(type) {
		case []any:
			for _, item := range current {
				walk(item)
			}
		case map[string]any:
			if isPackagedItem(current) {
				out = append(out, current)
				return
			}
			for _, child := range current {
				walk(child)
			}
		}
	}
	walk(value)
	return out
}

func isPackagedItem(item map[string]any) bool {
	source := firstString(item, "nutrition_source", "nutritionSource", "source")
	weightSource := firstString(item, "package_weight_source", "packageWeightSource")
	packagedID := firstString(item, "packaged_food_id", "packagedFoodId", "matched_packaged_food_id", "matchedPackagedFoodId")
	if source != "packaged_food_library" && weightSource != "packaged_food_library" && packagedID == "" {
		return false
	}
	return firstString(item, "name", "food_name", "foodName") != ""
}

func buildAuditRowBase(task taskRow, item map[string]any) auditRow {
	itemName := firstString(item, "name", "food_name", "foodName")
	query := itemName
	querySource := "item_name"
	taskTextInput := ""
	if task.TextInput != nil {
		taskTextInput = strings.TrimSpace(*task.TextInput)
	}
	return auditRow{
		TaskID:             task.ID,
		CreatedAt:          task.CreatedAt.Format(time.RFC3339),
		TaskType:           task.TaskType,
		QuerySource:        querySource,
		Query:              query,
		TaskTextInput:      taskTextInput,
		ItemName:           itemName,
		OldPackagedFoodID:  firstString(item, "packaged_food_id", "packagedFoodId", "matched_packaged_food_id", "matchedPackagedFoodId", "matched_food_id", "matchedFoodId"),
		OldNutritionSource: firstString(item, "nutrition_source", "nutritionSource", "source"),
		OldResolveStatus:   firstString(item, "resolve_status", "resolveStatus", "package_match_status", "packageMatchStatus"),
	}
}

func classifyOutcome(oldID string, newID string, newStatus string) string {
	if newID == "" || newStatus == "unresolved" {
		return "now_unresolved"
	}
	if oldID != "" && oldID == newID {
		return "same_match"
	}
	return "changed_match"
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

func writeAuditReports(outputDir string, report auditReport) (string, string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", "", err
	}
	stamp := time.Now().Format("20060102_150405")
	jsonPath := filepath.Join(outputDir, "packaged_real_task_audit_"+stamp+".json")
	csvPath := filepath.Join(outputDir, "packaged_real_task_audit_"+stamp+".csv")
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(jsonPath, payload, 0o644); err != nil {
		return "", "", err
	}
	file, err := os.Create(csvPath)
	if err != nil {
		return "", "", err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	defer writer.Flush()
	if err := writer.Write([]string{
		"task_id", "created_at", "task_type", "query_source", "query", "task_text_input", "item_name",
		"old_packaged_food_id", "old_nutrition_source", "old_resolve_status",
		"new_status", "new_packaged_food_id", "new_display_name", "new_score", "outcome",
	}); err != nil {
		return "", "", err
	}
	for _, row := range report.Rows {
		if err := writer.Write([]string{
			row.TaskID,
			row.CreatedAt,
			row.TaskType,
			row.QuerySource,
			row.Query,
			row.TaskTextInput,
			row.ItemName,
			row.OldPackagedFoodID,
			row.OldNutritionSource,
			row.OldResolveStatus,
			row.NewStatus,
			row.NewPackagedFoodID,
			row.NewDisplayName,
			fmt.Sprintf("%.4f", row.NewScore),
			row.Outcome,
		}); err != nil {
			return "", "", err
		}
	}
	return jsonPath, csvPath, writer.Error()
}

func resolveDefaultOutputDir() string {
	return filepath.Join("..", "tmp")
}
