package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	limit := flag.Int("limit", 100, "maximum existing nutrition rows to scan in this run")
	offset := flag.Int("offset", 0, "offset for existing nutrition rows; useful for chunked bulk runs")
	batchSize := flag.Int("batch-size", 1, "DeepSeek request batch size; keep 1 for the most reliable JSON output")
	timeout := flag.Duration("timeout", 30*time.Minute, "overall command timeout")
	apply := flag.Bool("apply", false, "write back generated nutrients; without this flag the command only previews target rows")
	includeUnresolved := flag.Bool("include-unresolved", false, "also generate full nutrition rows for top food_unresolved_logs names")
	unresolvedLimit := flag.Int("unresolved-limit", 50, "maximum unresolved names to process when include-unresolved is set")
	flag.Parse()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("get sql db: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	repo := foodrecordrepo.NewFoodNutritionRepo(db)
	totalTargets, err := repo.CountFoodsNeedingVitaminBackfill(ctx)
	if err != nil {
		log.Fatalf("count foods needing vitamin backfill: %v", err)
	}
	foods, err := repo.ListFoodsNeedingVitaminBackfill(ctx, *limit, *offset)
	if err != nil {
		log.Fatalf("list foods needing vitamin backfill: %v", err)
	}
	fmt.Printf("micronutrient_backfill_total=%d selected=%d offset=%d limit=%d apply=%v\n", totalTargets, len(foods), *offset, *limit, *apply)
	if *apply && *offset > 0 {
		fmt.Println("warning: offset is evaluated against the current missing-field set; for repeated apply runs, prefer offset=0 with a fixed limit until total reaches 0")
	}
	for i, food := range foods {
		if i >= 20 {
			fmt.Printf("... %d more targets omitted from preview\n", len(foods)-i)
			break
		}
		fmt.Printf("target[%d] id=%s name=%s kcal=%.2f protein=%.2f carbs=%.2f fat=%.2f source=%s\n",
			i, food.ID, food.CanonicalName, food.KcalPer100g, food.ProteinPer100g, food.CarbsPer100g, food.FatPer100g, food.Source)
	}
	if !*apply {
		fmt.Println("dry_run=true: add --apply to call DeepSeek and write missing vitamin/micronutrient fields")
		return
	}
	if cfg.External.DeepSeekAPIKey == "" {
		log.Fatalf("missing external.deepseek_api_key or DEEPSEEK_API_KEY")
	}
	if *batchSize <= 0 {
		*batchSize = 1
	}

	estimator := analyzeservice.NewDeepSeekNutritionEstimator(cfg.External.DeepSeekAPIKey, "", "deepseek-v4-pro")
	updatedRows, updatedFields := backfillExistingFoods(ctx, repo, estimator, foods, *batchSize)
	fmt.Printf("existing_backfill_done rows=%d fields=%d\n", updatedRows, updatedFields)

	if *includeUnresolved {
		inserted := backfillUnresolvedFoods(ctx, repo, estimator, *unresolvedLimit, *batchSize)
		fmt.Printf("unresolved_backfill_done inserted_or_matched=%d\n", inserted)
	}
}

func backfillExistingFoods(
	ctx context.Context,
	repo *foodrecordrepo.FoodNutritionRepo,
	estimator *analyzeservice.DeepSeekNutritionEstimator,
	foods []foodrecorddomain.FoodNutrition,
	batchSize int,
) (int, int) {
	updatedRows := 0
	updatedFields := 0
	for start := 0; start < len(foods); start += batchSize {
		end := start + batchSize
		if end > len(foods) {
			end = len(foods)
		}
		chunk := foods[start:end]
		candidates := make([]analyzeservice.UnresolvedNutritionCandidate, 0, len(chunk))
		for i, food := range chunk {
			candidates = append(candidates, analyzeservice.UnresolvedNutritionCandidate{
				Index:                i,
				Name:                 food.CanonicalName,
				EstimatedWeightGrams: 100,
			})
		}
		estimates, err := estimator.Estimate(ctx, candidates, existingFoodContext(chunk))
		if err != nil {
			log.Printf("estimate existing chunk failed start=%d size=%d error=%v", start, len(chunk), err)
			continue
		}
		for i, food := range chunk {
			unit := estimates[i]
			if len(unit) == 0 {
				log.Printf("estimate missing for existing id=%s name=%s", food.ID, food.CanonicalName)
				continue
			}
			fields, err := repo.FillMissingDeepSeekNutrients(ctx, food.ID, unit)
			if err != nil {
				log.Printf("update existing failed id=%s name=%s error=%v", food.ID, food.CanonicalName, err)
				continue
			}
			if len(fields) > 0 {
				updatedRows++
				updatedFields += len(fields)
				log.Printf("updated existing id=%s name=%s fields=%d", food.ID, food.CanonicalName, len(fields))
			}
		}
	}
	return updatedRows, updatedFields
}

func backfillUnresolvedFoods(
	ctx context.Context,
	repo *foodrecordrepo.FoodNutritionRepo,
	estimator *analyzeservice.DeepSeekNutritionEstimator,
	limit int,
	batchSize int,
) int {
	logs, err := repo.GetUnresolvedTop(ctx, limit)
	if err != nil {
		log.Printf("list unresolved failed: %v", err)
		return 0
	}
	inserted := 0
	for start := 0; start < len(logs); start += batchSize {
		end := start + batchSize
		if end > len(logs) {
			end = len(logs)
		}
		chunk := logs[start:end]
		candidates := make([]analyzeservice.UnresolvedNutritionCandidate, 0, len(chunk))
		for i, item := range chunk {
			candidates = append(candidates, analyzeservice.UnresolvedNutritionCandidate{
				Index:                i,
				Name:                 item.RawName,
				EstimatedWeightGrams: 100,
			})
		}
		estimates, err := estimator.Estimate(ctx, candidates, "这些名称来自 food_unresolved_logs，不在当前营养库中；请生成每100g完整营养，包括三大营养素、纤维、糖、矿物质和维生素。")
		if err != nil {
			log.Printf("estimate unresolved chunk failed start=%d size=%d error=%v", start, len(chunk), err)
			continue
		}
		for i, item := range chunk {
			unit := estimates[i]
			if len(unit) == 0 {
				log.Printf("estimate missing for unresolved name=%s", item.RawName)
				continue
			}
			id, err := repo.UpsertDeepSeekNutrition(ctx, item.RawName, unit)
			if err != nil {
				log.Printf("upsert unresolved failed name=%s error=%v", item.RawName, err)
				continue
			}
			if id != "" {
				inserted++
				log.Printf("inserted unresolved name=%s food_id=%s", item.RawName, id)
			}
		}
	}
	return inserted
}

func existingFoodContext(foods []foodrecorddomain.FoodNutrition) string {
	type item struct {
		Index    int     `json:"index"`
		Name     string  `json:"name"`
		Calories float64 `json:"calories"`
		Protein  float64 `json:"protein"`
		Carbs    float64 `json:"carbs"`
		Fat      float64 `json:"fat"`
	}
	payload := make([]item, 0, len(foods))
	for i, food := range foods {
		payload = append(payload, item{
			Index:    i,
			Name:     food.CanonicalName,
			Calories: food.KcalPer100g,
			Protein:  food.ProteinPer100g,
			Carbs:    food.CarbsPer100g,
			Fat:      food.FatPer100g,
		})
	}
	body, _ := json.Marshal(payload)
	return "这些食物已经在 food_nutrition_library 中有每100g三大营养素。请把已有三大营养素当作参考，重点补齐维生素和矿物质；返回完整 unitNutritionPer100g。已有非0字段会由程序保留，不会被覆盖。已有宏量参考：" + string(body)
}
