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

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	foodrecordservice "food_link/backend/internal/foodrecord/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

const (
	modeDeterministic = "deterministic"
	modeVision        = "vision"
	modeAll           = "all"
)

type backfillResult struct {
	FoodID            string   `json:"food_id"`
	DisplayName       string   `json:"display_name"`
	Source            string   `json:"source"`
	Action            string   `json:"action"`
	Reason            string   `json:"reason,omitempty"`
	Applied           bool     `json:"applied"`
	IssueTags         []string `json:"issue_tags,omitempty"`
	ChangedFields     []string `json:"changed_fields,omitempty"`
	ConflictFields    []string `json:"conflict_fields,omitempty"`
	BeforeNetWeightG  float64  `json:"before_net_weight_g,omitempty"`
	AfterNetWeightG   float64  `json:"after_net_weight_g,omitempty"`
	BeforeNetContent  string   `json:"before_net_content,omitempty"`
	AfterNetContent   string   `json:"after_net_content,omitempty"`
	ImageCount        int      `json:"image_count,omitempty"`
	ExtractConfidence float64  `json:"extract_confidence,omitempty"`
	Error             string   `json:"error,omitempty"`
}

type summary struct {
	StartedAt      time.Time      `json:"started_at"`
	FinishedAt     time.Time      `json:"finished_at"`
	Mode           string         `json:"mode"`
	DryRun         bool           `json:"dry_run"`
	Apply          bool           `json:"apply"`
	Limit          int            `json:"limit"`
	Processed      int            `json:"processed"`
	Applied        int            `json:"applied"`
	Deterministic  int            `json:"deterministic"`
	Vision         int            `json:"vision"`
	Review         int            `json:"review"`
	Skipped        int            `json:"skipped"`
	Errors         int            `json:"errors"`
	ActionCounts   map[string]int `json:"action_counts"`
	VisionProvider string         `json:"vision_provider,omitempty"`
	VisionModel    string         `json:"vision_model,omitempty"`
	OutputDir      string         `json:"output_dir"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	mode := flag.String("mode", modeAll, "backfill mode: deterministic, vision, all")
	outputDir := flag.String("output-dir", "", "directory for results.jsonl/review.csv/summary.json")
	limit := flag.Int("limit", 0, "max records to process")
	apply := flag.Bool("apply", false, "write safe patches to database")
	visionProvider := flag.String("vision-provider", "gemini", "vision provider: gemini or doubao")
	visionModel := flag.String("vision-model", "gemini-3-flash-preview", "vision model")
	retryAttempts := flag.Int("retry-attempts", 2, "transient vision retry attempts")
	retryDelay := flag.Duration("retry-delay", 3*time.Second, "delay between retries")
	timeout := flag.Duration("timeout", 6*time.Hour, "overall timeout")
	flag.Parse()

	normalizedMode := normalizeMode(*mode)
	if normalizedMode == "" {
		log.Fatalf("--mode must be %s, %s, or %s", modeDeterministic, modeVision, modeAll)
	}
	outDir := strings.TrimSpace(*outputDir)
	if outDir == "" {
		outDir = filepath.Join("..", "tmp", fmt.Sprintf("packaged-quality-backfill-%s", time.Now().Format("20060102-150405")))
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		log.Fatalf("create output dir: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("database ping: %v", err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("set schema: %v", err)
		}
	}

	nutritionRepo := foodrecordrepo.NewFoodNutritionRepo(db)
	nutritionSvc := foodrecordservice.NewFoodNutritionService(nutritionRepo)
	resolvedProvider := ""
	resolvedModel := ""
	if normalizedMode == modeVision || normalizedMode == modeAll {
		var visionClient foodrecordservice.NutritionLabelVisionClient
		visionClient, resolvedProvider, resolvedModel, err = buildVisionClient(cfg, *visionProvider, *visionModel)
		if err != nil {
			log.Fatalf("init vision client: %v", err)
		}
		nutritionSvc.ConfigureNutritionLabelVisionClient(visionClient)
	}

	foods, err := loadIssueFoods(ctx, db, *limit)
	if err != nil {
		log.Fatalf("load issue foods: %v", err)
	}
	sum := summary{
		StartedAt:      time.Now(),
		Mode:           normalizedMode,
		DryRun:         !*apply,
		Apply:          *apply,
		Limit:          *limit,
		OutputDir:      outDir,
		ActionCounts:   map[string]int{},
		VisionProvider: resolvedProvider,
		VisionModel:    resolvedModel,
	}

	resultsPath := filepath.Join(outDir, "results.jsonl")
	resultsFile, err := os.Create(resultsPath)
	if err != nil {
		log.Fatalf("create results.jsonl: %v", err)
	}
	defer resultsFile.Close()
	encoder := json.NewEncoder(resultsFile)
	reviewRows := [][]string{}

	for _, food := range foods {
		sum.Processed++
		result := processFood(ctx, nutritionRepo, nutritionSvc, food, normalizedMode, *apply, maxInt(0, *retryAttempts), *retryDelay)
		if err := encoder.Encode(result); err != nil {
			log.Printf("write result failed food=%s err=%v", food.ID, err)
		}
		if result.Applied {
			sum.Applied++
		}
		if result.Error != "" {
			sum.Errors++
		}
		switch result.Action {
		case "deterministic_patch":
			sum.Deterministic++
		case "vision_patch":
			sum.Vision++
		case "review":
			sum.Review++
			reviewRows = append(reviewRows, reviewRow(result))
		case "skip":
			sum.Skipped++
		}
		sum.ActionCounts[result.Action]++
		log.Printf("food=%s action=%s applied=%t name=%s reason=%s err=%s", food.ID, result.Action, result.Applied, result.DisplayName, result.Reason, result.Error)
	}

	if err := writeCSV(filepath.Join(outDir, "review.csv"), []string{
		"food_id", "display_name", "source", "action", "reason", "issue_tags", "changed_fields", "conflict_fields", "before_net_weight_g", "after_net_weight_g", "before_net_content", "after_net_content", "image_count", "error",
	}, reviewRows); err != nil {
		log.Fatalf("write review.csv: %v", err)
	}
	sum.FinishedAt = time.Now()
	if err := writeJSON(filepath.Join(outDir, "summary.json"), sum); err != nil {
		log.Fatalf("write summary.json: %v", err)
	}
	fmt.Printf("done processed=%d applied=%d deterministic=%d vision=%d review=%d skipped=%d errors=%d output=%s\n", sum.Processed, sum.Applied, sum.Deterministic, sum.Vision, sum.Review, sum.Skipped, sum.Errors, outDir)
}

func processFood(
	ctx context.Context,
	repo *foodrecordrepo.FoodNutritionRepo,
	svc *foodrecordservice.FoodNutritionService,
	food foodrecorddomain.PackagedFood,
	mode string,
	apply bool,
	retryAttempts int,
	retryDelay time.Duration,
) backfillResult {
	result := backfillResult{
		FoodID:           food.ID,
		DisplayName:      food.DisplayName,
		Source:           food.Source,
		IssueTags:        issueTags(food),
		BeforeNetWeightG: food.NetWeightG,
		BeforeNetContent: formatNetContent(food.NetContentValue, derefString(food.NetContentUnit)),
		ImageCount:       len(food.SourceImageURLs),
	}
	if result.DisplayName == "" {
		result.DisplayName = food.ProductName
	}
	if mode == modeDeterministic || mode == modeAll {
		patch := deterministicPatch(food)
		if len(patch) > 0 {
			after, err := maybeApplyPatch(ctx, repo, food.ID, patch, apply)
			if err != nil {
				result.Action = "review"
				result.Error = err.Error()
				return result
			}
			result.Action = "deterministic_patch"
			result.Reason = "parsed_existing_text"
			result.Applied = apply
			result.ChangedFields = sortedKeys(patch)
			if after != nil {
				result.AfterNetWeightG = after.NetWeightG
				result.AfterNetContent = formatNetContent(after.NetContentValue, derefString(after.NetContentUnit))
			} else {
				result.AfterNetWeightG = numberFromAny(patch["net_weight_g"], food.NetWeightG)
				result.AfterNetContent = formatNetContent(numberFromAny(patch["net_content_value"], food.NetContentValue), stringFromAny(patch["net_content_unit"], derefString(food.NetContentUnit)))
			}
			return result
		}
	}
	if (mode == modeVision || mode == modeAll) && len(food.SourceImageURLs) > 0 {
		extract, attempts, retried, transient, err := extractWithRetry(ctx, svc, food.SourceImageURLs, retryAttempts, retryDelay)
		result.Reason = fmt.Sprintf("vision_attempts=%d retried=%t transient=%t", attempts, retried, transient)
		if err != nil {
			result.Action = "review"
			result.Error = err.Error()
			return result
		}
		result.ExtractConfidence = extract.ExtractConfidence
		patch, conflicts := buildVisionPatch(food, extract)
		result.ConflictFields = conflicts
		if len(patch) == 0 {
			result.Action = "review"
			if len(conflicts) > 0 {
				result.Reason = "vision_conflict_review"
			} else {
				result.Reason = "vision_no_safe_fields"
			}
			return result
		}
		after, err := maybeApplyPatch(ctx, repo, food.ID, patch, apply)
		if err != nil {
			result.Action = "review"
			result.Error = err.Error()
			return result
		}
		result.Action = "vision_patch"
		result.Applied = apply
		result.ChangedFields = sortedKeys(patch)
		if after != nil {
			result.AfterNetWeightG = after.NetWeightG
			result.AfterNetContent = formatNetContent(after.NetContentValue, derefString(after.NetContentUnit))
		} else {
			result.AfterNetWeightG = numberFromAny(patch["net_weight_g"], food.NetWeightG)
			result.AfterNetContent = formatNetContent(numberFromAny(patch["net_content_value"], food.NetContentValue), stringFromAny(patch["net_content_unit"], derefString(food.NetContentUnit)))
		}
		return result
	}
	result.Action = "review"
	if len(food.SourceImageURLs) == 0 {
		result.Reason = "no_source_images"
	} else {
		result.Reason = "no_safe_patch"
	}
	return result
}

func loadIssueFoods(ctx context.Context, db *gorm.DB, limit int) ([]foodrecorddomain.PackagedFood, error) {
	query := db.WithContext(ctx).
		Where(`is_active = true AND (
			COALESCE(net_weight_g,0) <= 0
			OR COALESCE(net_content_value,0) <= 0
			OR COALESCE(net_content_unit,'') = ''
			OR (COALESCE(protein_per_100g,0)=0 AND COALESCE(carbs_per_100g,0)=0 AND COALESCE(fat_per_100g,0)=0)
			OR COALESCE(kcal_per_100g,0) > 900
			OR COALESCE(protein_per_100g,0)+COALESCE(carbs_per_100g,0)+COALESCE(fat_per_100g,0) > 120
		)`).
		Order(`CASE WHEN jsonb_array_length(COALESCE(source_image_urls,'[]'::jsonb)) > 0 THEN 0 ELSE 1 END, updated_at DESC`)
	if limit > 0 {
		query = query.Limit(limit)
	}
	var foods []foodrecorddomain.PackagedFood
	return foods, query.Find(&foods).Error
}

func deterministicPatch(food foodrecorddomain.PackagedFood) map[string]any {
	patch := map[string]any{}
	spec := firstContentSpec(derefString(food.SpecText), food.DisplayName, food.ProductName)
	if spec.Value > 0 && spec.Unit != "" {
		if food.NetContentValue <= 0 {
			patch["net_content_value"] = spec.Value
		}
		if derefString(food.NetContentUnit) == "" {
			patch["net_content_unit"] = spec.Unit
		}
		if food.NetWeightG <= 0 && spec.Unit == "g" {
			patch["net_weight_g"] = spec.Value
		}
		if derefString(food.SpecText) == "" {
			patch["spec_text"] = formatNetContent(spec.Value, spec.Unit)
		}
	}
	if food.NetContentValue > 0 && derefString(food.NetContentUnit) == "g" && food.NetWeightG <= 0 {
		patch["net_weight_g"] = food.NetContentValue
	}
	if food.NetWeightG > 0 && food.NetContentValue <= 0 {
		patch["net_content_value"] = food.NetWeightG
		patch["net_content_unit"] = "g"
	}
	return patch
}

func firstContentSpec(values ...string) contentSpec {
	joined := strings.Join(values, " ")
	if spec := parseContentSpec(joined); spec.Value > 0 && spec.Unit != "" {
		return spec
	}
	for _, value := range values {
		if spec := parseContentSpec(value); spec.Value > 0 && spec.Unit != "" {
			return spec
		}
	}
	return contentSpec{}
}

type contentSpec struct {
	Value float64
	Unit  string
}

func parseContentSpec(text string) contentSpec {
	text = strings.ToLower(strings.TrimSpace(text))
	text = strings.ReplaceAll(text, "：", ":")
	text = strings.ReplaceAll(text, "千克", "kg")
	text = strings.ReplaceAll(text, "毫升", "ml")
	text = strings.ReplaceAll(text, "克", "g")
	text = strings.ReplaceAll(text, "升", "l")
	evidencePatterns := []string{
		`净含量\s*:?\s*\((\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\)\s*(kg|g|ml|l)`,
		`净含量\s*:?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)`,
		`净重\s*:?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)`,
		`规格\s*:?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)`,
	}
	for _, pattern := range evidencePatterns {
		re := regexp.MustCompile(pattern)
		match := re.FindStringSubmatch(text)
		if len(match) == 4 {
			value := parseFloat(match[1]) + parseFloat(match[2])
			return contentSpecFromMatch(formatFloat(value), match[3])
		}
		if len(match) != 3 {
			continue
		}
		return contentSpecFromMatch(match[1], match[2])
	}
	if strings.Contains(text, "营养成分") || strings.Contains(text, "每100") || strings.Contains(text, "per 100") {
		return contentSpec{}
	}
	tailPattern := regexp.MustCompile(`(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\s*$`)
	if match := tailPattern.FindStringSubmatch(text); len(match) == 3 {
		return contentSpecFromMatch(match[1], match[2])
	}
	return contentSpec{}
}

func contentSpecFromMatch(rawValue, rawUnit string) contentSpec {
	value := parseFloat(rawValue)
	unit := normalizeUnit(rawUnit)
	if value <= 0 || unit == "" {
		return contentSpec{}
	}
	switch strings.ToLower(strings.TrimSpace(rawUnit)) {
	case "kg", "l":
		value *= 1000
	}
	return contentSpec{Value: round2(value), Unit: unit}
}

func buildVisionPatch(food foodrecorddomain.PackagedFood, extract *foodrecordservice.PackagedProductExtractResult) (map[string]any, []string) {
	patch := map[string]any{}
	conflicts := []string{}
	if extract == nil {
		return patch, conflicts
	}
	addString := func(field, current, next string) {
		current = strings.TrimSpace(current)
		next = strings.TrimSpace(next)
		if next == "" {
			return
		}
		if current == "" {
			patch[field] = next
			return
		}
		if !strings.EqualFold(current, next) {
			conflicts = append(conflicts, field)
		}
	}
	addNumber := func(field string, current, next float64) {
		if next <= 0 {
			return
		}
		if current <= 0 {
			patch[field] = next
			return
		}
		tolerance := math.Max(2, current*0.05)
		if math.Abs(current-next) > tolerance {
			conflicts = append(conflicts, field)
		}
	}
	addString("brand", food.Brand, extract.Brand)
	addString("spec_text", derefString(food.SpecText), extract.SpecText)
	addString("barcode", derefString(food.Barcode), extract.Barcode)
	addString("flavor_text", derefString(food.FlavorText), extract.FlavorText)
	addString("package_category", derefString(food.PackageCategory), extract.PackageCategory)
	addString("ingredients_text", derefString(food.IngredientsText), extract.IngredientsText)
	addString("ocr_raw_text", derefString(food.OCRRawText), extract.OCRRawText)
	addString("nutrition_basis_unit", derefString(food.NutritionBasisUnit), extract.NutritionBasisUnit)
	addString("energy_unit_raw", derefString(food.EnergyUnitRaw), extract.EnergyUnitRaw)
	addString("conversion_status", derefString(food.ConversionStatus), extract.ConversionStatus)
	addNumber("net_weight_g", food.NetWeightG, extract.NetWeightG)
	addNumber("net_content_value", food.NetContentValue, extract.NetContentValue)
	addString("net_content_unit", derefString(food.NetContentUnit), extract.NetContentUnit)
	addNumber("unit_count", food.UnitCount, extract.UnitCount)
	addNumber("unit_content_value", food.UnitContentValue, extract.UnitContentValue)
	addString("unit_content_unit", derefString(food.UnitContentUnit), extract.UnitContentUnit)
	addNumber("serving_weight_g", food.ServingWeightG, extract.ServingWeightG)
	addNumber("kcal_per_100g", food.KcalPer100g, numberFromMap(extract.UnitNutritionPer100g, "calories"))
	addNumber("protein_per_100g", food.ProteinPer100g, numberFromMap(extract.UnitNutritionPer100g, "protein"))
	addNumber("carbs_per_100g", food.CarbsPer100g, numberFromMap(extract.UnitNutritionPer100g, "carbs"))
	addNumber("fat_per_100g", food.FatPer100g, numberFromMap(extract.UnitNutritionPer100g, "fat"))
	if len(food.RawLabelPayload) == 0 && len(extract.RawLabelPayload) > 0 {
		patch["raw_label_payload"] = extract.RawLabelPayload
	}
	if len(food.FieldConfidence) == 0 && len(extract.FieldConfidence) > 0 {
		patch["field_confidence"] = extract.FieldConfidence
	}
	if food.ExtractConfidence <= 0 && extract.ExtractConfidence > 0 {
		patch["extract_confidence"] = extract.ExtractConfidence
	}
	return patch, uniqueStrings(conflicts)
}

func maybeApplyPatch(ctx context.Context, repo *foodrecordrepo.FoodNutritionRepo, foodID string, patch map[string]any, apply bool) (*foodrecorddomain.PackagedFood, error) {
	if !apply {
		return nil, nil
	}
	return repo.PatchPackagedFood(ctx, foodID, patch)
}

func buildVisionClient(cfg *config.Config, provider, model string) (foodrecordservice.NutritionLabelVisionClient, string, string, error) {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	model = strings.TrimSpace(model)
	switch normalizedProvider {
	case "", "gemini", "ofox", "ofoxai", "ofox-gemini":
		if cfg.External.OfoxAIAPIKey == "" {
			return nil, "", "", fmt.Errorf("Gemini 需要配置 external.ofoxai_api_key")
		}
		if model == "" {
			model = "gemini-3-flash-preview"
		}
		return analyzeservice.NewOfoxAIClient(cfg.External.OfoxAIAPIKey, model, cfg.External.OfoxAIBaseURL), "gemini", model, nil
	case "doubao":
		if model == "" {
			model = "doubao-seed-2-0-lite-260428"
		}
		return analyzeservice.NewDoubaoClient(cfg.External.DoubaoAPIKey, model, cfg.External.DoubaoBaseURL), "doubao", model, nil
	default:
		return nil, "", "", fmt.Errorf("unknown vision provider: %s", provider)
	}
}

func extractWithRetry(ctx context.Context, svc *foodrecordservice.FoodNutritionService, imageURLs []string, retryAttempts int, retryDelay time.Duration) (*foodrecordservice.PackagedProductExtractResult, int, bool, bool, error) {
	attempts := 0
	retried := false
	lastTransient := false
	maxAttempts := 1 + retryAttempts
	for attempts < maxAttempts {
		attempts++
		extract, err := svc.ExtractPackagedProduct(ctx, imageURLs, "")
		if err == nil {
			return extract, attempts, retried, lastTransient, nil
		}
		lastTransient = isTransientVisionError(err)
		if !lastTransient || attempts >= maxAttempts {
			return nil, attempts, retried, lastTransient, err
		}
		retried = true
		if retryDelay > 0 {
			timer := time.NewTimer(retryDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, attempts, retried, lastTransient, ctx.Err()
			case <-timer.C:
			}
		}
	}
	return nil, attempts, retried, lastTransient, fmt.Errorf("vision attempts exhausted")
}

func isTransientVisionError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, marker := range []string{"timeout", "deadline exceeded", "eof", "502", "503", "504", "connection reset", "temporarily"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

func issueTags(food foodrecorddomain.PackagedFood) []string {
	tags := []string{}
	if food.NetWeightG <= 0 {
		tags = append(tags, "missing_net_weight_g")
	}
	if food.NetContentValue <= 0 || derefString(food.NetContentUnit) == "" {
		tags = append(tags, "missing_net_content")
	}
	if food.KcalPer100g > 900 {
		tags = append(tags, "kcal_over_900")
	}
	if food.ProteinPer100g == 0 && food.CarbsPer100g == 0 && food.FatPer100g == 0 {
		tags = append(tags, "macros_all_zero")
	}
	if food.ProteinPer100g+food.CarbsPer100g+food.FatPer100g > 120 {
		tags = append(tags, "macro_sum_over_120")
	}
	if len(food.SourceImageURLs) == 0 {
		tags = append(tags, "missing_source_images")
	}
	return tags
}

func reviewRow(result backfillResult) []string {
	return []string{
		result.FoodID,
		result.DisplayName,
		result.Source,
		result.Action,
		result.Reason,
		strings.Join(result.IssueTags, "|"),
		strings.Join(result.ChangedFields, "|"),
		strings.Join(result.ConflictFields, "|"),
		formatFloat(result.BeforeNetWeightG),
		formatFloat(result.AfterNetWeightG),
		result.BeforeNetContent,
		result.AfterNetContent,
		fmt.Sprintf("%d", result.ImageCount),
		result.Error,
	}
}

func normalizeMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case modeDeterministic, modeVision, modeAll:
		return strings.ToLower(strings.TrimSpace(mode))
	default:
		return ""
	}
}

func formatNetContent(value float64, unit string) string {
	if value <= 0 || strings.TrimSpace(unit) == "" {
		return ""
	}
	return formatFloat(value) + strings.TrimSpace(unit)
}

func formatFloat(value float64) string {
	if value == 0 {
		return "0"
	}
	if math.Abs(value-math.Round(value)) < 0.005 {
		return fmt.Sprintf("%.0f", math.Round(value))
	}
	return fmt.Sprintf("%.2f", value)
}

func normalizeUnit(unit string) string {
	switch strings.ToLower(strings.TrimSpace(unit)) {
	case "g", "kg":
		return "g"
	case "ml", "l":
		return "ml"
	default:
		return ""
	}
}

func parseFloat(text string) float64 {
	var out float64
	if _, err := fmt.Sscanf(strings.TrimSpace(text), "%f", &out); err != nil || out <= 0 {
		return 0
	}
	return out
}

func numberFromMap(values map[string]any, key string) float64 {
	if values == nil {
		return 0
	}
	return numberFromAny(values[key])
}

func numberFromAny(values ...any) float64 {
	for _, value := range values {
		switch typed := value.(type) {
		case nil:
			continue
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		case float32:
			return float64(typed)
		case float64:
			return typed
		case string:
			if n := parseFloat(typed); n > 0 {
				return n
			}
		}
	}
	return 0
}

func stringFromAny(values ...any) string {
	for _, value := range values {
		if value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprintf("%v", value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func uniqueStrings(values []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func writeCSV(path string, header []string, rows [][]string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	if err := writer.Write(header); err != nil {
		return err
	}
	for _, row := range rows {
		if err := writer.Write(row); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
