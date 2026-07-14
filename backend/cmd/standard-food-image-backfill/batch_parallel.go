package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

type successRecord struct {
	FoodID       string         `json:"food_id"`
	FoodName     string         `json:"food_name"`
	Status       string         `json:"status"`
	CandidateURL string         `json:"candidate_url"`
	Query        string         `json:"query"`
	Confidence   float64        `json:"confidence"`
	FoodMatch    bool           `json:"food_match"`
	NoWatermark  bool           `json:"no_watermark"`
	Reason       string         `json:"reason"`
	ObjectKey    string         `json:"object_key,omitempty"`
	AccessURL    string         `json:"access_url,omitempty"`
	Uploaded     bool           `json:"uploaded"`
	DBUpdated    bool           `json:"db_updated"`
	ProcessedAt  time.Time      `json:"processed_at"`
	Decision     *imageDecision `json:"decision,omitempty"`
}

type successSummary struct {
	GeneratedAt  time.Time       `json:"generated_at"`
	Workers      int             `json:"workers"`
	ImageSearch  string          `json:"image_search"`
	DryRun       bool            `json:"dry_run"`
	Total        int             `json:"total"`
	SuccessCount int             `json:"success_count"`
	Successes    []successRecord `json:"successes"`
}

func runBackfill(ctx context.Context, opts options) error {
	runStart := time.Now()
	if err := os.MkdirAll(opts.outputDir, 0o755); err != nil {
		return err
	}
	cfgStart := time.Now()
	cfg, err := config.Load(opts.configDir)
	if err != nil {
		return err
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		return err
	}
	printTiming(opts, "config_and_db duration=%s", time.Since(cfgStart).Round(time.Millisecond))
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			return err
		}
	}

	loadStart := time.Now()
	foods, err := loadFoodsForRun(ctx, db, opts)
	if err != nil {
		return err
	}
	printTiming(opts, "load_foods duration=%s count=%d", time.Since(loadStart).Round(time.Millisecond), len(foods))
	if len(foods) == 0 {
		return errors.New("没有可处理的食物")
	}

	state := loadState(opts.statePath)
	storageClient := storage.New(cfg.Storage)

	pendingCount := 0
	for _, food := range foods {
		if opts.forceReprocess || !shouldSkip(food.ID, state, opts.failedOnly) {
			pendingCount++
		}
	}
	fmt.Printf("[启动] 本批次共 %d 条食物，待处理 %d 条（force=%v failedOnly=%v workers=%d）\n",
		len(foods), pendingCount, opts.forceReprocess, opts.failedOnly, opts.workers)

	var (
		mu        sync.Mutex
		results   []resultRow
		successes []successRecord
	)
	var processed int64
	var successCnt int64

	processOne := func(food foodRow) {
		if !opts.forceReprocess && shouldSkip(food.ID, state, opts.failedOnly) {
			return
		}
		result := processFood(ctx, db, storageClient, opts, state, food)
		current := atomic.AddInt64(&processed, 1)
		mu.Lock()
		updateState(state, result)
		results = append(results, result)
		if isSuccessStatus(result.Status) {
			successes = append(successes, resultToSuccessRecord(result))
		}
		_ = appendJSONL(opts.resultsPath, result)
		if isFailureStatus(result.Status) {
			_ = appendJSONL(opts.failedPath, result)
		}
		if shouldCheckpoint(current, opts.checkpointEvery) {
			_ = saveState(opts.statePath, state)
		}
		mu.Unlock()
		if isSuccessStatus(result.Status) {
			atomic.AddInt64(&successCnt, 1)
		}
		if pendingCount > 0 && (current%10 == 0 || int(current) == pendingCount) {
			sc := atomic.LoadInt64(&successCnt)
			fmt.Printf("[进度 %s] %d/%d (%.1f%%) | 成功:%d | 最新[%s] %s\n",
				time.Now().Format("15:04:05"), current, pendingCount,
				100.0*float64(current)/float64(pendingCount), sc, result.Status, food.CanonicalName)
		}
		fmt.Printf("[%s] %s %s\n", result.Status, food.ID, food.CanonicalName)
	}

	if opts.workers <= 1 {
		for _, food := range foods {
			processOne(food)
		}
	} else {
		sem := make(chan struct{}, opts.workers)
		var wg sync.WaitGroup
		for _, food := range foods {
			food := food
			wg.Add(1)
			sem <- struct{}{}
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				processOne(food)
			}()
		}
		wg.Wait()
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].FoodID < results[j].FoodID
	})
	sort.Slice(successes, func(i, j int) bool {
		return successes[i].FoodID < successes[j].FoodID
	})

	if err := saveState(opts.statePath, state); err != nil {
		return err
	}
	if opts.successJSON != "" {
		summary := successSummary{
			GeneratedAt:  time.Now(),
			Workers:      max(opts.workers, 1),
			ImageSearch:  opts.imageSearch,
			DryRun:       opts.dryRun,
			Total:        len(foods),
			SuccessCount: len(successes),
			Successes:    successes,
		}
		if err := writeSuccessJSON(opts.successJSON, summary); err != nil {
			return err
		}
		fmt.Printf("成功结果已写入 %s（%d/%d）\n", opts.successJSON, len(successes), len(foods))
	}
	printTiming(opts, "run_total duration=%s", time.Since(runStart).Round(time.Millisecond))
	return nil
}

func shouldCheckpoint(processed int64, every int) bool {
	return every > 0 && processed > 0 && processed%int64(every) == 0
}

func loadFoodsForRun(ctx context.Context, db *gorm.DB, opts options) ([]foodRow, error) {
	if id := strings.TrimSpace(opts.foodID); id != "" {
		return queryFoodsByIDs(ctx, db, []string{id})
	}
	if ids := parseFoodIDs(opts.foodIDs); len(ids) > 0 {
		return queryFoodsByIDs(ctx, db, ids)
	}
	return queryMissingFoods(ctx, db, opts)
}

func parseFoodIDs(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == ';' || r == ' '
	})
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

func queryFoodsByIDs(ctx context.Context, db *gorm.DB, ids []string) ([]foodRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	sql := `
SELECT
  f.id::text AS id,
  f.canonical_name,
  f.normalized_name,
  COALESCE(string_agg(a.alias_name, ' ' ORDER BY a.alias_name), '') AS aliases
FROM food_nutrition_library f
LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
WHERE f.id::text IN (` + strings.Join(placeholders, ",") + `)
GROUP BY f.id, f.canonical_name, f.normalized_name`
	var rows []foodRow
	if err := db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	order := make(map[string]int, len(ids))
	for i, id := range ids {
		order[id] = i
	}
	sort.Slice(rows, func(i, j int) bool {
		return order[rows[i].ID] < order[rows[j].ID]
	})
	return rows, nil
}

func isSuccessStatus(status string) bool {
	return status == "dry_run_match" || status == "db_updated"
}

func resultToSuccessRecord(result resultRow) successRecord {
	rec := successRecord{
		FoodID:       result.FoodID,
		FoodName:     result.FoodName,
		Status:       result.Status,
		CandidateURL: result.Candidate,
		Query:        result.Query,
		ObjectKey:    result.ObjectKey,
		AccessURL:    result.AccessURL,
		Uploaded:     result.Uploaded,
		DBUpdated:    result.DBUpdated,
		ProcessedAt:  result.ProcessedAt,
		Decision:     result.Decision,
	}
	if result.Decision != nil {
		rec.Confidence = result.Decision.Confidence
		rec.FoodMatch = result.Decision.FoodMatch
		rec.NoWatermark = result.Decision.NoWatermark
		rec.Reason = result.Decision.Reason
	}
	return rec
}

func writeSuccessJSON(path string, summary successSummary) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
