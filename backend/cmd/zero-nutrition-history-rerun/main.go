package main

import (
	"bytes"
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
	"strconv"
	"strings"
	"time"

	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type suspectRow struct {
	Surface  string
	RecordID string
	UserID   string
	Nickname string
	Name     string
	WeightG  float64
	Index    int
}

type recordRow struct {
	ID            string         `gorm:"column:id" json:"id"`
	UserID        string         `gorm:"column:user_id" json:"user_id"`
	SourceTaskID  *string        `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	Items         datatypes.JSON `gorm:"column:items" json:"items"`
	TotalCalories float64        `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein  float64        `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs    float64        `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat      float64        `gorm:"column:total_fat" json:"total_fat"`
	TotalWeight   float64        `gorm:"column:total_weight_grams" json:"total_weight_grams"`
}

type taskResponse struct {
	ID           string         `json:"id"`
	Status       string         `json:"status"`
	Result       map[string]any `json:"result"`
	ErrorMessage string         `json:"error_message"`
}

type apiEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type submitResponse struct {
	TaskID string `json:"task_id"`
	TaskId string `json:"taskId"`
}

type rerunReport struct {
	GeneratedAt     string             `json:"generated_at"`
	Apply           bool               `json:"apply"`
	SuspectItems    int                `json:"suspect_items"`
	Submitted       int                `json:"submitted"`
	Resolved        int                `json:"resolved"`
	AppliedRecords  int                `json:"applied_records"`
	AppliedItems    int                `json:"applied_items"`
	TempUserID      string             `json:"temp_user_id,omitempty"`
	Rows            []rerunItemReport  `json:"rows"`
	RecordSummaries []recordApplyEntry `json:"record_summaries,omitempty"`
}

type rerunItemReport struct {
	RecordID      string             `json:"record_id"`
	UserID        string             `json:"user_id"`
	Nickname      string             `json:"nickname,omitempty"`
	ItemIndex     int                `json:"item_index"`
	Name          string             `json:"name"`
	WeightG       float64            `json:"weight_g"`
	Query         string             `json:"query"`
	TaskID        string             `json:"task_id,omitempty"`
	Status        string             `json:"status"`
	Error         string             `json:"error,omitempty"`
	MatchedName   string             `json:"matched_name,omitempty"`
	Nutrients     map[string]float64 `json:"nutrients,omitempty"`
	Source        string             `json:"source,omitempty"`
	Applied       bool               `json:"applied"`
	SkippedReason string             `json:"skipped_reason,omitempty"`
}

type recordApplyEntry struct {
	RecordID     string          `json:"record_id"`
	ChangedItems int             `json:"changed_items"`
	BeforeTotals nutritionTotals `json:"before_totals"`
	AfterTotals  nutritionTotals `json:"after_totals"`
	BackupPath   string          `json:"backup_path,omitempty"`
	Error        string          `json:"error,omitempty"`
}

type nutritionTotals struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
	WeightG  float64 `json:"weight_g"`
}

type fixedItem struct {
	Surface     string
	RecordID    string
	ItemIndex   int
	Name        string
	WeightG     float64
	MatchedName string
	Nutrients   map[string]float64
	Source      string
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	baseURL := flag.String("base-url", "http://127.0.0.1:3010", "running backend base URL")
	csvPath := flag.String("from-benchmark-csv", "", "zero-nutrition benchmark suspicious rows CSV")
	outputJSON := flag.String("output-json", filepath.Join("..", "tmp", "zero-nutrition-history-rerun.json"), "JSON report path")
	backupDir := flag.String("backup-dir", filepath.Join("..", "tmp"), "backup directory when --apply is set")
	limit := flag.Int("limit", 0, "max suspect items to rerun; 0 means all")
	apply := flag.Bool("apply", false, "write resolved nutrients back to records and linked tasks")
	cleanup := flag.Bool("cleanup-temp", true, "delete temporary user and rerun tasks before exit")
	pollInterval := flag.Duration("poll-interval", time.Second, "poll interval")
	taskTimeout := flag.Duration("task-timeout", 3*time.Minute, "timeout per text task")
	fallbackModel := flag.String("fallback-model", "gemini35_flash", "modelName for second attempt when first text rerun still returns zero; empty disables model override")
	timeout := flag.Duration("timeout", 45*time.Minute, "overall timeout")
	flag.Parse()

	if strings.TrimSpace(*csvPath) == "" {
		log.Fatal("--from-benchmark-csv is required")
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
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if strings.TrimSpace(cfg.Database.Schema) != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置 schema 失败: %v", err)
		}
	}

	suspects, err := loadSuspects(*csvPath, *limit)
	if err != nil {
		log.Fatalf("读取可疑 CSV 失败: %v", err)
	}
	userID, tag, err := createTempUser(ctx, db)
	if err != nil {
		log.Fatalf("创建临时重跑用户失败: %v", err)
	}
	if *cleanup {
		defer func() {
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cleanupCancel()
			if err := cleanupTempUser(cleanupCtx, db, tag); err != nil {
				log.Printf("清理临时重跑用户失败: %v", err)
			}
		}()
	}
	token, err := issueLocalToken(cfg, userID)
	if err != nil {
		log.Fatalf("签发临时 JWT 失败: %v", err)
	}

	client := &http.Client{Timeout: 45 * time.Second}
	report := rerunReport{
		GeneratedAt:  time.Now().Format(time.RFC3339),
		Apply:        *apply,
		SuspectItems: len(suspects),
		TempUserID:   userID,
		Rows:         []rerunItemReport{},
	}
	fixes := []fixedItem{}
	for _, suspect := range suspects {
		row := rerunOne(ctx, client, strings.TrimRight(*baseURL, "/"), token, suspect, *pollInterval, *taskTimeout, *fallbackModel)
		report.Rows = append(report.Rows, row)
		if row.TaskID != "" {
			report.Submitted++
		}
		if row.Status == "resolved" {
			report.Resolved++
			fixes = append(fixes, fixedItem{
				Surface:     suspect.Surface,
				RecordID:    suspect.RecordID,
				ItemIndex:   suspect.Index,
				Name:        suspect.Name,
				WeightG:     suspect.WeightG,
				MatchedName: row.MatchedName,
				Nutrients:   row.Nutrients,
				Source:      row.Source,
			})
		}
	}
	if *apply && len(fixes) > 0 {
		entries := applyFixes(ctx, db, fixes, *backupDir)
		report.RecordSummaries = entries
		for _, entry := range entries {
			if entry.Error == "" && entry.ChangedItems > 0 {
				report.AppliedRecords++
				report.AppliedItems += entry.ChangedItems
			}
		}
		applied := map[string]bool{}
		for _, entry := range entries {
			if entry.Error == "" && entry.ChangedItems > 0 {
				applied[entry.RecordID] = true
			}
		}
		for i := range report.Rows {
			if applied[report.Rows[i].RecordID] && report.Rows[i].Status == "resolved" {
				report.Rows[i].Applied = true
			}
		}
	}
	if err := writeJSON(*outputJSON, report); err != nil {
		log.Fatalf("写入报告失败: %v", err)
	}
	fmt.Printf("zero nutrition history rerun suspects=%d submitted=%d resolved=%d apply=%v applied_records=%d applied_items=%d report=%s\n",
		report.SuspectItems, report.Submitted, report.Resolved, report.Apply, report.AppliedRecords, report.AppliedItems, *outputJSON)
}

func loadSuspects(path string, limit int) ([]suspectRow, error) {
	file, err := os.Open(path)
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
	for i, name := range rows[0] {
		header[strings.TrimSpace(name)] = i
	}
	get := func(row []string, key string) string {
		index, ok := header[key]
		if !ok || index >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[index])
	}
	out := []suspectRow{}
	seen := map[string]bool{}
	for _, row := range rows[1:] {
		surface := get(row, "surface")
		if surface != "user_food_records" && surface != "analysis_tasks" {
			continue
		}
		name := get(row, "name")
		if isKnownZeroName(name) {
			continue
		}
		recordID := get(row, "container_id")
		index, _ := strconv.Atoi(get(row, "item_index"))
		key := fmt.Sprintf("%s:%s:%d:%s", surface, recordID, index, name)
		if recordID == "" || name == "" || seen[key] {
			continue
		}
		seen[key] = true
		weight, _ := strconv.ParseFloat(get(row, "weight_g"), 64)
		if weight <= 0 {
			weight = 100
		}
		out = append(out, suspectRow{
			Surface:  surface,
			RecordID: recordID,
			UserID:   get(row, "user_id"),
			Nickname: get(row, "nickname"),
			Name:     name,
			WeightG:  weight,
			Index:    index,
		})
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func rerunOne(ctx context.Context, client *http.Client, baseURL, token string, suspect suspectRow, pollInterval, timeout time.Duration, fallbackModel string) rerunItemReport {
	queryName := rerunQueryName(suspect.Name)
	query := fmt.Sprintf("%s %.1fg", queryName, suspect.WeightG)
	row := rerunTextAttempt(ctx, client, baseURL, token, suspect, query, "", pollInterval, timeout)
	if row.Status == "resolved" || strings.TrimSpace(fallbackModel) == "" {
		return row
	}
	fallbackQuery := fmt.Sprintf("请按常见做法估算这个食物的营养：%s，食用重量 %.1f 克。需要热量、蛋白质、碳水、脂肪，请不要返回 0。", queryName, suspect.WeightG)
	retry := rerunTextAttempt(ctx, client, baseURL, token, suspect, fallbackQuery, fallbackModel, pollInterval, timeout)
	if retry.Status == "resolved" {
		retry.Query = query + " || fallback: " + fallbackQuery
		return retry
	}
	row.SkippedReason = firstNonEmpty(row.SkippedReason, "first_attempt_not_resolved")
	row.Error = strings.TrimSpace(row.Error + "; fallback_status=" + retry.Status + " fallback_error=" + retry.Error)
	return row
}

func rerunQueryName(name string) string {
	name = strings.TrimSpace(name)
	switch name {
	case "茶饮":
		return "茶饮料"
	default:
		return name
	}
}

func rerunTextAttempt(ctx context.Context, client *http.Client, baseURL, token string, suspect suspectRow, query, modelName string, pollInterval, timeout time.Duration) rerunItemReport {
	row := rerunItemReport{
		RecordID:  suspect.RecordID,
		UserID:    suspect.UserID,
		Nickname:  suspect.Nickname,
		ItemIndex: suspect.Index,
		Name:      suspect.Name,
		WeightG:   round2(suspect.WeightG),
		Query:     query,
		Status:    "submitted",
	}
	taskID, err := submitTextTask(ctx, client, baseURL, token, query, modelName)
	if err != nil {
		row.Status = "submit_failed"
		row.Error = err.Error()
		return row
	}
	row.TaskID = taskID
	task, err := pollTask(ctx, client, baseURL, token, taskID, pollInterval, timeout)
	if err != nil {
		row.Status = "poll_failed"
		row.Error = err.Error()
		return row
	}
	if task.Status != "done" {
		row.Status = task.Status
		row.Error = task.ErrorMessage
		return row
	}
	item := bestResultItem(task.Result, suspect.Name)
	if len(item) == 0 {
		row.Status = "no_item"
		row.SkippedReason = "rerun_result_has_no_item"
		return row
	}
	nutrients := coreNutrients(item)
	if isZeroCore(nutrients) {
		row.Status = "still_zero"
		row.MatchedName = stringFromAny(item["name"], item["food_name"], item["display_name"])
		row.Nutrients = nutrients
		row.Source = stringFromAny(item["nutrition_source"], item["nutritionSource"], item["source"])
		row.SkippedReason = "rerun_still_zero"
		return row
	}
	row.Status = "resolved"
	row.MatchedName = stringFromAny(item["name"], item["food_name"], item["display_name"])
	row.Nutrients = nutrients
	row.Source = firstNonEmpty(stringFromAny(item["nutrition_source"], item["nutritionSource"], item["source"]), "rerun_text_generated")
	return row
}

func submitTextTask(ctx context.Context, client *http.Client, baseURL, token, text, modelName string) (string, error) {
	offset := -480
	body := map[string]any{
		"text":                    text,
		"text_input":              text,
		"meal_type":               "snack",
		"execution_mode":          "standard",
		"analysis_engine":         "db_first",
		"suggest_ratio_enabled":   false,
		"timezone_offset_minutes": offset,
		"additionalContext":       "历史 0 营养修复：只为这一个食物按给定重量生成合理营养；数据库没有时使用模型生成，不要返回 0。",
	}
	if strings.TrimSpace(modelName) != "" {
		body["modelName"] = strings.TrimSpace(modelName)
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/analyze-text/submit", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	setBearer(req, token)
	var payload submitResponse
	if err := doJSON(client, req, &payload); err != nil {
		return "", err
	}
	taskID := strings.TrimSpace(payload.TaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(payload.TaskId)
	}
	if taskID == "" {
		return "", fmt.Errorf("submit response missing task_id: %#v", payload)
	}
	return taskID, nil
}

func pollTask(ctx context.Context, client *http.Client, baseURL, token, taskID string, interval, timeout time.Duration) (taskResponse, error) {
	deadline := time.Now().Add(timeout)
	for {
		task, err := getTask(ctx, client, baseURL, token, taskID)
		if err != nil {
			return task, err
		}
		switch task.Status {
		case "done", "failed", "timed_out", "cancelled", "violated":
			return task, nil
		}
		if time.Now().After(deadline) {
			return task, fmt.Errorf("task %s timeout, last status=%s", taskID, task.Status)
		}
		select {
		case <-ctx.Done():
			return task, ctx.Err()
		case <-time.After(interval):
		}
	}
}

func getTask(ctx context.Context, client *http.Client, baseURL, token, taskID string) (taskResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/analyze/tasks/"+url.PathEscape(taskID), nil)
	if err != nil {
		return taskResponse{}, err
	}
	setBearer(req, token)
	var payload taskResponse
	if err := doJSON(client, req, &payload); err != nil {
		return taskResponse{}, err
	}
	return payload, nil
}

func bestResultItem(result map[string]any, originalName string) map[string]any {
	items := anySlice(result["items"])
	if len(items) == 0 {
		items = anySlice(result["nutritionItems"])
	}
	if len(items) == 0 {
		return nil
	}
	best := map[string]any{}
	bestScore := -1
	for _, raw := range items {
		item := mapFromAny(raw)
		if len(item) == 0 {
			continue
		}
		name := stringFromAny(item["name"], item["food_name"], item["display_name"])
		score := nameOverlapScore(originalName, name)
		if score > bestScore {
			bestScore = score
			best = item
		}
	}
	return best
}

func applyFixes(ctx context.Context, db *gorm.DB, fixes []fixedItem, backupDir string) []recordApplyEntry {
	recordGrouped := map[string][]fixedItem{}
	taskGrouped := map[string][]fixedItem{}
	for _, fix := range fixes {
		switch fix.Surface {
		case "analysis_tasks":
			taskGrouped[fix.RecordID] = append(taskGrouped[fix.RecordID], fix)
		default:
			recordGrouped[fix.RecordID] = append(recordGrouped[fix.RecordID], fix)
		}
	}
	entries := []recordApplyEntry{}
	for recordID, recordFixes := range recordGrouped {
		entry := applyRecordFixes(ctx, db, recordID, recordFixes, backupDir)
		entries = append(entries, entry)
	}
	for taskID, taskFixes := range taskGrouped {
		entry := applyStandaloneTaskFixes(ctx, db, taskID, taskFixes, backupDir)
		entries = append(entries, entry)
	}
	return entries
}

func applyRecordFixes(ctx context.Context, db *gorm.DB, recordID string, fixes []fixedItem, backupDir string) recordApplyEntry {
	var record recordRow
	entry := recordApplyEntry{RecordID: recordID}
	if err := db.WithContext(ctx).Table("user_food_records").Where("id = ?", recordID).First(&record).Error; err != nil {
		entry.Error = err.Error()
		return entry
	}
	items := parseItems(record.Items)
	entry.BeforeTotals = totalsFromItems(items)
	if len(items) == 0 {
		entry.Error = "empty_items"
		return entry
	}
	for _, fix := range fixes {
		if fix.ItemIndex < 0 || fix.ItemIndex >= len(items) {
			continue
		}
		item := items[fix.ItemIndex]
		name := stringFromAny(item["name"], item["food_name"], item["display_name"])
		if name != fix.Name {
			continue
		}
		before := coreNutrients(item)
		if !isZeroCore(before) {
			continue
		}
		applyGeneratedNutrition(item, fix)
		entry.ChangedItems++
	}
	if entry.ChangedItems == 0 {
		entry.AfterTotals = entry.BeforeTotals
		return entry
	}
	entry.AfterTotals = totalsFromItems(items)
	backupPath, err := writeBackup(backupDir, record, parseItems(record.Items))
	if err != nil {
		entry.Error = err.Error()
		return entry
	}
	entry.BackupPath = backupPath
	itemsBytes, err := json.Marshal(items)
	if err != nil {
		entry.Error = err.Error()
		return entry
	}
	updates := map[string]any{
		"items":              datatypes.JSON(itemsBytes),
		"total_calories":     entry.AfterTotals.Calories,
		"total_protein":      entry.AfterTotals.Protein,
		"total_carbs":        entry.AfterTotals.Carbs,
		"total_fat":          entry.AfterTotals.Fat,
		"total_weight_grams": int(math.Round(entry.AfterTotals.WeightG)),
	}
	if err := db.WithContext(ctx).Table("user_food_records").Where("id = ? AND user_id = ?", record.ID, record.UserID).Updates(updates).Error; err != nil {
		entry.Error = err.Error()
		return entry
	}
	if record.SourceTaskID != nil && strings.TrimSpace(*record.SourceTaskID) != "" {
		if err := applyTaskItems(ctx, db, strings.TrimSpace(*record.SourceTaskID), items, entry.AfterTotals); err != nil {
			entry.Error = err.Error()
			return entry
		}
	}
	return entry
}

func applyGeneratedNutrition(item map[string]any, fix fixedItem) {
	nutrients := map[string]any{
		"calories": fix.Nutrients["calories"],
		"protein":  fix.Nutrients["protein"],
		"carbs":    fix.Nutrients["carbs"],
		"fat":      fix.Nutrients["fat"],
	}
	item["nutrients"] = nutrients
	item["calories"] = fix.Nutrients["calories"]
	item["protein"] = fix.Nutrients["protein"]
	item["carbs"] = fix.Nutrients["carbs"]
	item["fat"] = fix.Nutrients["fat"]
	item["nutrition_source"] = firstNonEmpty(fix.Source, "history_text_rerun_generated")
	item["resolve_status"] = "history_text_rerun"
	item["matched_food_name"] = fix.MatchedName
	item["is_unresolved"] = false
	if numberFromAny(item["weight"]) <= 0 {
		item["weight"] = fix.WeightG
	}
	if numberFromAny(item["intake"]) <= 0 && numberFromAny(item["ratio"]) <= 0 {
		item["intake"] = fix.WeightG
		item["ratio"] = 100
	}
}

func applyTaskItems(ctx context.Context, db *gorm.DB, taskID string, items []map[string]any, totals nutritionTotals) error {
	var row struct {
		Result datatypes.JSON `gorm:"column:result"`
	}
	if err := db.WithContext(ctx).Table("analysis_tasks").Select("result").Where("id = ?", taskID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	var result map[string]any
	if len(row.Result) > 0 {
		if err := json.Unmarshal(row.Result, &result); err != nil {
			return err
		}
	}
	if result == nil {
		result = map[string]any{}
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

func applyStandaloneTaskFixes(ctx context.Context, db *gorm.DB, taskID string, fixes []fixedItem, backupDir string) recordApplyEntry {
	var row struct {
		Result datatypes.JSON `gorm:"column:result"`
	}
	entry := recordApplyEntry{RecordID: taskID}
	if err := db.WithContext(ctx).Table("analysis_tasks").Select("result").Where("id = ?", taskID).First(&row).Error; err != nil {
		entry.Error = err.Error()
		return entry
	}
	var result map[string]any
	if len(row.Result) > 0 {
		if err := json.Unmarshal(row.Result, &result); err != nil {
			entry.Error = err.Error()
			return entry
		}
	}
	items := resultItems(result)
	entry.BeforeTotals = totalsFromItems(items)
	for _, fix := range fixes {
		if fix.ItemIndex < 0 || fix.ItemIndex >= len(items) {
			continue
		}
		item := items[fix.ItemIndex]
		name := stringFromAny(item["name"], item["food_name"], item["display_name"])
		if name != fix.Name || !isZeroCore(coreNutrients(item)) {
			continue
		}
		applyGeneratedNutrition(item, fix)
		entry.ChangedItems++
	}
	if entry.ChangedItems == 0 {
		entry.AfterTotals = entry.BeforeTotals
		return entry
	}
	entry.AfterTotals = totalsFromItems(items)
	backupPath, err := writeTaskBackup(backupDir, taskID, result)
	if err != nil {
		entry.Error = err.Error()
		return entry
	}
	entry.BackupPath = backupPath
	result["items"] = items
	result["total_calories"] = entry.AfterTotals.Calories
	result["totalCalories"] = entry.AfterTotals.Calories
	result["total_protein"] = entry.AfterTotals.Protein
	result["totalProtein"] = entry.AfterTotals.Protein
	result["total_carbs"] = entry.AfterTotals.Carbs
	result["totalCarbs"] = entry.AfterTotals.Carbs
	result["total_fat"] = entry.AfterTotals.Fat
	result["totalFat"] = entry.AfterTotals.Fat
	result["total_weight_grams"] = entry.AfterTotals.WeightG
	result["totalWeightGrams"] = entry.AfterTotals.WeightG
	bytes, err := json.Marshal(result)
	if err != nil {
		entry.Error = err.Error()
		return entry
	}
	if err := db.WithContext(ctx).Table("analysis_tasks").Where("id = ?", taskID).Update("result", datatypes.JSON(bytes)).Error; err != nil {
		entry.Error = err.Error()
	}
	return entry
}

func resultItems(result map[string]any) []map[string]any {
	rawItems := anySlice(result["items"])
	if len(rawItems) == 0 {
		rawItems = anySlice(result["nutritionItems"])
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		if item := mapFromAny(raw); len(item) > 0 {
			items = append(items, item)
		}
	}
	return items
}

func createTempUser(ctx context.Context, db *gorm.DB) (string, string, error) {
	tag := fmt.Sprintf("zero-nutrition-rerun-%s-%d", time.Now().UTC().Format("20060102T150405"), os.Getpid())
	var row struct {
		ID string `gorm:"column:id"`
	}
	err := db.WithContext(ctx).Raw(`
INSERT INTO weapp_user (
  openid, nickname, avatar, earned_credits_balance, onboarding_completed,
  execution_mode, health_condition, create_time, update_time
) VALUES (?, 'Zero Nutrition Rerun', '', 1000, true, 'standard', '{}'::jsonb, now(), now())
RETURNING id::text AS id
`, tag).Scan(&row).Error
	return row.ID, tag, err
}

func cleanupTempUser(ctx context.Context, db *gorm.DB, tag string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`DELETE FROM user_earned_credit_ledger WHERE user_id IN (SELECT id FROM weapp_user WHERE openid = ?)`, tag).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM analysis_tasks WHERE user_id IN (SELECT id FROM weapp_user WHERE openid = ?)`, tag).Error; err != nil {
			return err
		}
		return tx.Exec(`DELETE FROM weapp_user WHERE openid = ?`, tag).Error
	})
}

func issueLocalToken(cfg *config.Config, userID string) (string, error) {
	if strings.TrimSpace(cfg.JWT.Secret) == "" {
		return "", errors.New("jwt.secret is empty")
	}
	accessTTL := cfg.JWT.AccessTokenTTLSeconds
	if accessTTL <= 0 {
		accessTTL = 3600
	}
	refreshTTL := cfg.JWT.RefreshTokenTTLSeconds
	if refreshTTL <= 0 {
		refreshTTL = accessTTL * 2
	}
	svc := authservice.NewJWTService(cfg.JWT.Secret, accessTTL, refreshTTL)
	return svc.IssueAccess(userID, "zero-nutrition-rerun-openid", "")
}

func parseItems(raw datatypes.JSON) []map[string]any {
	var generic []any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(generic))
	for _, value := range generic {
		item := mapFromAny(value)
		if len(item) > 0 {
			out = append(out, item)
		}
	}
	return out
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
	if intake > 0 {
		return intake
	}
	ratio := numberFromAny(item["ratio"])
	if weight > 0 && ratio > 0 {
		return weight * math.Min(100, math.Max(0, ratio)) / 100
	}
	return weight
}

func coreNutrients(item map[string]any) map[string]float64 {
	nutrients := mapFromAny(item["nutrients"])
	return map[string]float64{
		"calories": round2(numberFromAny(firstNonNil(nutrients["calories"], item["calories"], item["kcal"]))),
		"protein":  round2(numberFromAny(firstNonNil(nutrients["protein"], item["protein"], item["protein_g"]))),
		"carbs":    round2(numberFromAny(firstNonNil(nutrients["carbs"], item["carbs"], item["carbs_g"]))),
		"fat":      round2(numberFromAny(firstNonNil(nutrients["fat"], item["fat"], item["fat_g"]))),
	}
}

func isZeroCore(values map[string]float64) bool {
	return values["calories"] <= 0 && values["protein"] <= 0 && values["carbs"] <= 0 && values["fat"] <= 0
}

func anySlice(value any) []any {
	if arr, ok := value.([]any); ok {
		return arr
	}
	return nil
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
		value, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return value
	default:
		return 0
	}
}

func stringFromAny(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func nameOverlapScore(a, b string) int {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1000
	}
	if strings.Contains(a, b) || strings.Contains(b, a) {
		return 500 + minInt(len([]rune(a)), len([]rune(b)))
	}
	score := 0
	seen := map[rune]bool{}
	for _, r := range a {
		seen[r] = true
	}
	for _, r := range b {
		if seen[r] {
			score++
		}
	}
	return score
}

func isKnownZeroName(name string) bool {
	name = strings.TrimSpace(name)
	for _, exact := range []string{"水", "白开水", "温水", "热水", "冰水", "纯净水", "矿泉水", "饮用水", "饮用天然水"} {
		if name == exact {
			return true
		}
	}
	return strings.Contains(name, "无糖茶") || strings.Contains(name, "黑咖啡") || strings.Contains(name, "美式咖啡") || strings.Contains(name, "无糖可乐")
}

func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s returned %d: %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(data, &envelope); err == nil && len(envelope.Data) > 0 {
		if envelope.Code != 0 {
			return fmt.Errorf("api code=%d message=%s", envelope.Code, envelope.Message)
		}
		return json.Unmarshal(envelope.Data, out)
	}
	return json.Unmarshal(data, out)
}

func setBearer(req *http.Request, token string) {
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
}

func writeBackup(backupDir string, record recordRow, items []map[string]any) (string, error) {
	if strings.TrimSpace(backupDir) == "" {
		backupDir = filepath.Join("..", "tmp")
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(backupDir, fmt.Sprintf("zero_nutrition_rerun_backup_%s_%s.json", record.ID, time.Now().Format("20060102_150405")))
	payload := map[string]any{"record": record, "items": items, "created_at": time.Now().Format(time.RFC3339)}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, raw, 0o644)
}

func writeTaskBackup(backupDir, taskID string, result map[string]any) (string, error) {
	if strings.TrimSpace(backupDir) == "" {
		backupDir = filepath.Join("..", "tmp")
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(backupDir, fmt.Sprintf("zero_nutrition_rerun_task_backup_%s_%s.json", taskID, time.Now().Format("20060102_150405")))
	payload := map[string]any{"task_id": taskID, "result": result, "created_at": time.Now().Format(time.RFC3339)}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, raw, 0o644)
}

func writeJSON(path string, value any) error {
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

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
