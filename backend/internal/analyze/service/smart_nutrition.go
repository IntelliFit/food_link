package service

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
)

const (
	// smartLookupTimeout bounds the whole library pass. Lookups are plain
	// indexed queries; anything slower keeps the model's estimate instead of
	// holding the user's result.
	smartLookupTimeout     = 4 * time.Second
	smartLookupConcurrency = 6
)

// smartItemKind is the library an item is matched against.
type smartItemKind string

const (
	smartKindPackaged smartItemKind = "packaged"
	smartKindSingle   smartItemKind = "single"
	smartKindDish     smartItemKind = "dish"
)

type smartItemOutcome struct {
	item   map[string]any
	kind   smartItemKind
	status string
}

// applySmartNutrition is the unified nutrition engine. The vision call already
// returned the model's own nutrition for every item; each item is then looked
// up, in parallel, in the library that fits its kind. Only an unambiguous,
// state-compatible match replaces the estimate. Misses keep the estimate and
// are listed as library backfill candidates; nothing is written here.
func (s *AnalyzeService) applySmartNutrition(ctx context.Context, resp map[string]any) map[string]any {
	resp = finalizeAIDirectNutrition(resp, analysisEngineAIDirect)
	resp["analysis_engine"] = analysisEngineSmart
	items := toItems(resp["items"])
	if s.nutrition == nil || len(items) == 0 {
		resp["smart_nutrition"] = map[string]any{"status": "skipped_no_repo", "item_count": len(items)}
		return resp
	}
	lookupCtx, cancel := context.WithTimeout(ctx, smartLookupTimeout)
	defer cancel()
	start := time.Now()
	items = s.smartWithDetectedBrands(lookupCtx, items)
	run := s.newSmartRun(lookupCtx, items)
	outcomes := make([]smartItemOutcome, len(items))
	slots := make(chan struct{}, smartLookupConcurrency)
	var wg sync.WaitGroup
	for index, item := range items {
		wg.Add(1)
		go func(index int, item map[string]any) {
			defer wg.Done()
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Warn(ctx, "智能营养匹配单项异常，保留模型估算", slog.Int("index", index), slog.Any("panic", recovered))
					outcomes[index] = smartItemOutcome{kind: smartItemKindOf(item), status: "panic_ai_kept"}
				}
			}()
			slots <- struct{}{}
			defer func() { <-slots }()
			outcomes[index] = run.resolveItem(lookupCtx, item)
		}(index, item)
	}
	wg.Wait()
	return assembleSmartNutrition(resp, items, outcomes, time.Since(start))
}

func assembleSmartNutrition(resp map[string]any, items []map[string]any, outcomes []smartItemOutcome, elapsed time.Duration) map[string]any {
	out := make([]map[string]any, len(items))
	counts := map[string]int{}
	backfill := []map[string]any{}
	resolved := 0
	for index, item := range items {
		outcome := outcomes[index]
		next := item
		if outcome.item != nil {
			next = outcome.item
			resolved++
		} else if outcome.status != "label_kept" {
			backfill = append(backfill, map[string]any{"name": stringFromAny(item["name"]), "kind": string(outcome.kind), "reason": outcome.status})
		}
		next = copyAnyMap(next)
		next["smart_match_kind"] = string(outcome.kind)
		next["smart_match_status"] = outcome.status
		next["nutrition_source_category"] = nutritionSourceCategory(stringFromAny(next["nutrition_source"]))
		out[index] = next
		counts[string(outcome.kind)+":"+outcome.status]++
	}
	resp["items"] = out
	resp["resolved_count"] = resolved
	resp["unresolved_count"] = len(items) - resolved
	resp["nutrition_library_used"] = resolved > 0
	resp["nutrition_library_mode"] = "smart_kind_routed"
	resp["smart_nutrition"] = map[string]any{
		"status": "completed", "item_count": len(items), "resolved_count": resolved,
		"outcomes": counts, "lookup_ms": elapsed.Milliseconds(),
	}
	if len(backfill) > 0 {
		resp["library_backfill_candidates"] = backfill
	}
	return resp
}

func smartItemKindOf(item map[string]any) smartItemKind {
	if stringFromAny(item["nutrition_source"]) == "ingredient_label" || smartLooksPackaged(item) {
		return smartKindPackaged
	}
	if len(smartDishComponents(item)) > 0 || smartItemIsComposite(item) {
		return smartKindDish
	}
	return smartKindSingle
}

func smartLooksPackaged(item map[string]any) bool {
	switch strings.ToLower(strings.TrimSpace(stringFromAny(firstNonNil(item["type"], item["food_type"])))) {
	case "snack", "packaged", "prepackaged", "packaged_food", "零食", "包装食品", "预包装食品":
		return true
	}
	return smartPackagedField(item, "brand", "brandName") != "" || smartPackagedField(item, "barcode", "ean", "gtin") != ""
}

// resolveSmartItem resolves one item on its own (offline replay and tests).
func (s *AnalyzeService) resolveSmartItem(ctx context.Context, item map[string]any) smartItemOutcome {
	item = s.smartWithDetectedBrands(ctx, []map[string]any{item})[0]
	return s.newSmartRun(ctx, []map[string]any{item}).resolveItem(ctx, item)
}

func (r *smartRun) resolveItem(ctx context.Context, item map[string]any) smartItemOutcome {
	kind := smartItemKindOf(item)
	if stringFromAny(item["nutrition_source"]) == "ingredient_label" {
		return smartItemOutcome{kind: kind, status: "label_kept"}
	}
	switch kind {
	case smartKindPackaged:
		next, status := r.s.resolveSmartPackaged(ctx, item)
		if next == nil {
			// "薯片" without a brand, or 完达山纯牛奶 missing from the
			// packaged library, cannot pick a product; a generic library
			// row is still better evidence than nothing.
			for _, name := range smartPackagedFallbackNames(item) {
				if single, singleStatus := r.resolveSingleAs(ctx, item, name); single != nil {
					return smartItemOutcome{item: single, kind: smartKindSingle, status: singleStatus}
				}
			}
		}
		return smartItemOutcome{item: next, kind: kind, status: status}
	case smartKindDish:
		next, status := r.resolveDish(ctx, item)
		return smartItemOutcome{item: next, kind: kind, status: status}
	default:
		next, status := r.resolveSingle(ctx, item)
		return smartItemOutcome{item: next, kind: kind, status: status}
	}
}

func (r *smartRun) resolveSingle(ctx context.Context, item map[string]any) (map[string]any, string) {
	return r.resolveSingleAs(ctx, item, stringFromAny(item["name"]))
}

// smartPackagedFallbackNames are the generic names a packaged item can match
// in the standard library: its own name, then that name without the brand
// ("特仑苏纯牛奶" -> "纯牛奶"). The product name read from the package is not
// used: it drops qualifiers the name keeps ("脱脂纯牛奶" read as "纯牛奶"
// would turn skim milk into whole milk, "即食鸡胸肉" into roast chicken).
func smartPackagedFallbackNames(item map[string]any) []string {
	name := strings.TrimSpace(stringFromAny(item["name"]))
	names := []string{name}
	if brand := smartPackagedField(item, "brand", "brandName"); brand != "" && strings.Contains(name, brand) {
		if stripped := strings.TrimSpace(strings.Replace(name, brand, "", 1)); stripped != "" {
			names = append(names, stripped)
		}
	}
	return names
}

func (r *smartRun) resolveSingleAs(ctx context.Context, item map[string]any, name string) (map[string]any, string) {
	match, reason := r.matchSingleFood(ctx, item, name)
	if match == nil {
		return nil, reason
	}
	next := applySmartLibraryNutrition(item, nutritionUnit(match.food), nutritionWeightFromItem(item))
	next["matched_food_id"] = match.food.ID
	next["matched_food_name"] = match.food.CanonicalName
	next["standardized_food_name"] = match.food.CanonicalName
	next["matched_food_state"] = match.food.FoodState
	next["matched_weight_basis"] = match.food.WeightBasis
	next["resolve_status"] = match.status
	next["resolve_score"] = 1
	next["is_unresolved"] = false
	next["nutrition_source"] = nutritionSource(match.status)
	next["nutrition_match_status"] = "accepted"
	next["smart_match_method"] = match.method
	return next, "matched_" + match.method
}

type smartFoodMatch struct {
	food   *foodrecorddomain.FoodNutrition
	status string
	method string
}

// matchSmartSingleFood tries identity-preserving spellings of the name against
// exact canonical/alias rows. Fuzzy recall never replaces an estimate here.
func (r *smartRun) matchSingleFood(ctx context.Context, item map[string]any, name string) (*smartFoodMatch, string) {
	reason := "no_exact_library_row"
	for _, query := range smartSingleFoodQueries(item, name) {
		if ctx.Err() != nil {
			return nil, "lookup_timeout"
		}
		result, err := r.resolveFood(ctx, query)
		if err != nil {
			reason = "lookup_error"
			continue
		}
		if result == nil || result.Food == nil {
			continue
		}
		method, rejection := smartFoodCompatibility(item, result.Food)
		if rejection != "" {
			reason = rejection
			continue
		}
		return &smartFoodMatch{food: result.Food, status: result.Status, method: method}, ""
	}
	return nil, reason
}

var smartNamePrefixes = []string{"切块的", "切块", "切片的", "切片", "新鲜的", "新鲜", "一整个", "一个", "半个", "一根", "半根", "一碗", "一杯", "一盒", "一份", "袋装", "盒装", "瓶装", "罐装"}

// smartSingleFoodNameSynonyms maps everyday names to the catalog's spelling.
// Every entry keeps food identity; preparation differences are still checked
// by smartFoodCompatibility.
var smartSingleFoodNameSynonyms = map[string][]string{
	"水煮蛋":   {"鸡蛋(全蛋)", "鸡蛋"},
	"煮鸡蛋":   {"鸡蛋(全蛋)", "鸡蛋"},
	"白煮蛋":   {"鸡蛋(全蛋)", "鸡蛋"},
	"水煮鸡蛋":  {"鸡蛋(全蛋)", "鸡蛋"},
	"鸡蛋":    {"鸡蛋(全蛋)"},
	"牛奶":    {"牛奶(全脂)"},
	"纯牛奶":   {"牛奶(全脂)"},
	"全脂牛奶":  {"牛奶(全脂)"},
	"脱脂牛奶":  {"牛奶(脱脂)"},
	"脱脂纯牛奶": {"牛奶(脱脂)"},
	"小橘子":   {"橘子"},
	"砂糖橘":   {"橘子"},
	"黑咖啡":   {"咖啡(美式无糖)"},
	"美式咖啡":  {"咖啡(美式无糖)"},
	"美式":    {"咖啡(美式无糖)"},
	"西红柿":   {"番茄"},
	"米饭":    {"白米饭"},
	"青菜":    {"上海青"},
	"绿叶菜":   {"上海青"},
	"绿叶蔬菜":  {"上海青"},
	"时蔬":    {"上海青"},
	"熟米饭":   {"白米饭"},
	"白粥":    {"米粥"},
	"大米粥":   {"米粥"},
	"稀饭":    {"米粥"},
	"甜玉米":   {"玉米(熟)"},
	"玉米棒":   {"玉米(熟)"},
	"玉米段":   {"玉米(熟)"},
	"鸡蛋清":   {"蛋清"},
	"大米饭":   {"白米饭"},
	"馒头":    {"白馒头"},
	"面条":    {"面条(熟)"},
	"玉米":    {"玉米(熟)"},
	"煮玉米":   {"玉米(熟)"},
	"水煮玉米":  {"玉米(熟)"},
	"蒸玉米":   {"玉米(熟)"},
	"鸡胸肉":   {"鸡胸肉(熟)"},
	"鸡腿肉":   {"鸡腿肉(熟)"},
}

func smartSingleFoodQueries(item map[string]any, name string) []string {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	queries := []string{name}
	if resolved := nutritionResolveName(item, name, ""); resolved != "" {
		queries = append(queries, resolved)
	}
	cleaned := smartCleanFoodName(name)
	queries = append(queries, cleaned)
	queries = append(queries, smartSingleFoodNameSynonyms[cleaned]...)
	for _, base := range smartBaseFoodNames(cleaned) {
		queries = append(queries, base)
		queries = append(queries, smartSingleFoodNameSynonyms[base]...)
	}
	if smartItemFoodState(item) == "cooked" && !strings.Contains(cleaned, "熟") {
		queries = append(queries, cleaned+"(熟)")
	}
	out := make([]string, 0, len(queries))
	seen := map[string]bool{}
	for _, query := range queries {
		query = strings.TrimSpace(query)
		if query == "" || seen[query] {
			continue
		}
		seen[query] = true
		out = append(out, query)
	}
	return out
}

// smartIdentityModifiers in brackets change what the food is ("去蛋黄",
// "无糖", "去皮"), so such brackets are kept; portion notes are dropped.
var smartIdentityModifiers = []string{"去", "不含", "无", "只", "仅", "蛋白", "蛋清", "蛋黄", "皮", "骨", "糖", "油", "脂", "奶"}

// smartCleanFoodName drops portion notes in brackets and leading portion or
// cutting words ("小香蕉（半根）" -> "小香蕉", "切块苹果" -> "苹果").
func smartCleanFoodName(name string) string {
	name = strings.TrimSpace(name)
	for _, pair := range [][2]string{{"（", "）"}, {"(", ")"}} {
		searchFrom := 0
		for {
			open := strings.Index(name[searchFrom:], pair[0])
			if open < 0 {
				break
			}
			open += searchFrom
			end := strings.Index(name[open:], pair[1])
			if end < 0 {
				break
			}
			inner := name[open+len(pair[0]) : open+end]
			if containsAnyAnalyzeText(inner, smartIdentityModifiers) {
				searchFrom = open + end + len(pair[1])
				continue
			}
			name = name[:open] + name[open+end+len(pair[1]):]
		}
	}
	name = strings.TrimSpace(name)
	for _, prefix := range smartNamePrefixes {
		if trimmed := strings.TrimPrefix(name, prefix); trimmed != name && runeCount(trimmed) >= 1 {
			name = strings.TrimSpace(trimmed)
			break
		}
	}
	return name
}

// smartWaterCookingPrefixes and smartCutSuffixes only describe how a single
// food was boiled, steamed or cut. Dropping them gives the catalog name; the
// preparation itself stays in the item and is still checked for compatibility.
var (
	smartWaterCookingPrefixes = []string{"清水煮", "水煮", "白灼", "清蒸", "焯水", "蒸", "煮"}
	smartCutSuffixes          = []string{"片", "丝", "块", "丁", "段", "条", "粒"}
)

func smartBaseFoodNames(name string) []string {
	out := []string{}
	for _, prefix := range smartWaterCookingPrefixes {
		if trimmed := strings.TrimPrefix(name, prefix); trimmed != name && runeCount(trimmed) >= 1 {
			out = append(out, trimmed)
			name = trimmed
			break
		}
	}
	for _, suffix := range smartCutSuffixes {
		if trimmed := strings.TrimSuffix(name, suffix); trimmed != name && runeCount(trimmed) >= 2 {
			out = append(out, trimmed)
			break
		}
	}
	return out
}

// smartCoreNutrientKeys always come from the library row when one is used.
// Other fields fall back to the model's estimate where the row is blank,
// because many label and catalog rows simply do not report vitamins.
var smartCoreNutrientKeys = map[string]bool{"calories": true, "protein": true, "carbs": true, "fat": true}

func applySmartLibraryNutrition(item map[string]any, unit map[string]any, weight float64) map[string]any {
	next := copyAnyMap(item)
	modelNutrients := mapFromAny(item["nutrients"])
	nutrients := scaleNutrition(unit, weight)
	filled := []string{}
	for key, value := range modelNutrients {
		if smartCoreNutrientKeys[key] {
			continue
		}
		if numberFromAny(nutrients[key]) <= 0 && numberFromAny(value) > 0 {
			nutrients[key] = value
			filled = append(filled, key)
		}
	}
	next["nutrients"] = nutrients
	next["unit_nutrition_per_100g"] = nutritionUnitFromTotals(nutrients, weight)
	next["model_nutrients"] = modelNutrients
	next["nutrition_source_category"] = "database"
	if len(filled) > 0 {
		next["model_filled_nutrient_keys"] = filled
	}
	next["estimatedWeightGrams"] = weight
	ensureGrossWeightField(next, weight)
	return next
}

func runeCount(text string) int {
	return len([]rune(text))
}
