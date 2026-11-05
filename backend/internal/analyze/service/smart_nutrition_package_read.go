package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
)

// The main photo call is not asked for brand or package fields: doing so made
// it report whole-package weights. Meals that contain packaged food instead get
// one separate call that only reads the packages, and its result feeds the
// smart engine's packaged-library match and the item weight.
//
// Reading printed text needs no deep reasoning: Gemini 3 Flash with low
// thinking read as many brands, net contents and panels as Gemini 3.6 on 42
// snack photos, at 2.4s p50 / 5.6s p90 instead of 7.3s / 12.9s.
const (
	smartPackageReadModel    = gemini3FlashModel
	smartPackageReadTimeout  = 8 * time.Second
	smartPackageReadStage    = "package_read"
	smartPackageReadAttempts = 2
	// A label weight far from the photo estimate is more likely a family
	// pack the user ate part of, or a misread, than a correction. On 502
	// replayed snack meals a 5x bound let a sealed 400 g bread bag replace an
	// 80 g portion; small packs are typically overestimated (25 g as 40-50 g).
	smartPackageWeightMinRatio = 0.4
	smartPackageWeightMaxRatio = 2.0
	smartLabelMaxKcalPer100g   = 900
)

const smartPackageReadPromptTemplate = `你只负责读图中包装上的文字。下面这些食物已被识别为包装食品或零食：
%s
对每一项，只根据包装上清楚可见的文字填写；看不清的字段留空字符串或填 0。不要根据外观、插画、颜色或常识猜品牌和数值。
- brand：包装上印的品牌
- productName：品名，不含品牌
- flavor：口味
- unitNetContent：单件包装上印的净含量数值；unitNetContentUnit 填 "g" 或 "ml"
- unitCount：画面中这一款包装的件数
- packageState："sealed"（未开封且完整）、"opened"（已开封、已倒出或吃了一部分）或 "unknown"
- nutritionPer100：只有营养成分表清楚可见且按每100g或每100ml标注时才填写 {"energyKJ":0,"energyKcal":0,"protein":0,"fat":0,"carbs":0}；表头是"每份"或看不清时全部填 0
- evidence：读到的原文，最多 30 字
只输出 JSON，不要解释：{"packages":[{"index":0,"brand":"","productName":"","flavor":"","unitNetContent":0,"unitNetContentUnit":"g","unitCount":0,"packageState":"unknown","nutritionPer100":{"energyKJ":0,"energyKcal":0,"protein":0,"fat":0,"carbs":0},"evidence":""}]}`

type smartPackageReading struct {
	brand, product, flavor, unit, state, evidence string
	net, count                                    float64
	label                                         map[string]any
}

// withSmartPackageReading reads brand, net content and the nutrition panel of
// every packaged item in an ordinary photo. Any failure keeps the items as
// they were; the smart engine then works from the item names alone.
func (s *AnalyzeService) withSmartPackageReading(ctx context.Context, resp map[string]any, input AnalyzeInput, executionMode string) map[string]any {
	items := toItems(resp["items"])
	images := foodAnalyzeImageURLs(input)
	if len(items) == 0 || len(images) == 0 || s.visionChannels == nil || s.nutrition == nil || !isOrdinaryFoodImageMode(executionMode) {
		return resp
	}
	keys := s.smartKnownBrands(ctx)
	indexes := []int{}
	for index, item := range items {
		// An item whose label the main call already read needs nothing more.
		if len(ingredientLabelNutritionFromItem(item)) == 0 && smartPackageReadCandidate(item, keys) {
			indexes = append(indexes, index)
		}
	}
	if len(indexes) == 0 {
		return resp
	}
	start := time.Now()
	parsed, upstream, err := s.callSmartPackageRead(ctx, buildSmartPackageReadPrompt(items, indexes), images, executionMode)
	summary := map[string]any{"candidate_count": len(indexes), "duration_ms": time.Since(start).Milliseconds(), "upstream": upstream}
	if err != nil {
		logger.Warn(ctx, "包装读取失败，保留按名称匹配", logger.Err(err), slog.Int("candidate_count", len(indexes)))
		summary["status"] = "failed"
		resp["smart_package_read"] = summary
		return resp
	}
	readings := parseSmartPackageReadings(parsed, indexes)
	out := make([]map[string]any, len(items))
	copy(out, items)
	counts := map[string]int{}
	for index, reading := range readings {
		reading.brand = smartLibraryBrand(reading, stringFromAny(out[index]["name"]), keys)
		next, applied := applySmartPackageReading(out[index], reading)
		out[index] = next
		for _, what := range applied {
			counts[what]++
		}
	}
	resp["items"] = out
	summary["status"] = "completed"
	summary["read_count"] = len(readings)
	summary["applied"] = counts
	resp["smart_package_read"] = summary
	return resp
}

// smartPackageReadCandidate is a packaged item, or an item whose name starts
// with a known brand followed by a product kind ("百事可乐").
func smartPackageReadCandidate(item map[string]any, keys []smartBrandKey) bool {
	if smartLooksPackaged(item) {
		return true
	}
	brand, _ := smartDetectBrandedProduct(stringFromAny(item["name"]), keys)
	return brand != ""
}

// smartLibraryBrand spells a brand read from the package the way the library
// does, falling back to the item name when the package shows another spelling
// ("Coke" on the can, 可口可乐 in the name). An unread brand stays unread.
func smartLibraryBrand(reading smartPackageReading, name string, keys []smartBrandKey) string {
	if reading.brand == "" {
		return ""
	}
	for _, text := range []string{reading.brand + reading.product, name, reading.product} {
		if brand, _ := smartDetectBrand(text, keys); brand != "" {
			return brand
		}
		// A name that is just the brand ("可口可乐") is not a branded product
		// for detection, but here the package already proved the brand.
		textKey := smartTextKey(text)
		for _, key := range keys {
			if key.key == textKey {
				return key.brand
			}
		}
	}
	return reading.brand
}

func buildSmartPackageReadPrompt(items []map[string]any, indexes []int) string {
	lines := make([]string, 0, len(indexes))
	for _, index := range indexes {
		lines = append(lines, fmt.Sprintf("[%d] %s，照片估计 %.0f 克", index, stringFromAny(items[index]["name"]), nutritionWeightFromItem(items[index])))
	}
	return fmt.Sprintf(smartPackageReadPromptTemplate, strings.Join(lines, "\n"))
}

type lowThinkingImageAnalyzer interface {
	AnalyzeWithImagesLowThinkingModel(ctx context.Context, prompt string, imageURLs []string, modelName string) (map[string]any, error)
}

// callSmartPackageRead tries the leading ordinary photo channels in order. It
// does not go through the balanced scheduler, so this side call never trips a
// channel's circuit or shortens the main call's hedge delay.
func (s *AnalyzeService) callSmartPackageRead(ctx context.Context, prompt string, images []string, executionMode string) (map[string]any, string, error) {
	callCtx, cancel := context.WithTimeout(ctx, smartPackageReadTimeout)
	defer cancel()
	plans := s.orderedBalancedPlans(executionMode, false, true)
	var lastErr error = fmt.Errorf("没有可用的餐照渠道")
	for attempt, p := range plans {
		if attempt >= smartPackageReadAttempts || callCtx.Err() != nil {
			break
		}
		u := &visionUsage{}
		attemptCtx := context.WithValue(callCtx, visionUsageKey{}, u)
		started := time.Now()
		var parsed map[string]any
		var err error
		if reader, ok := p.client.(lowThinkingImageAnalyzer); ok {
			parsed, err = reader.AnalyzeWithImagesLowThinkingModel(attemptCtx, prompt, images, smartPackageReadModel)
		} else {
			parsed, err = newAnalyzeWithImagesTemperatureModelCall(p.client, prompt, images, 0, smartPackageReadModel)(attemptCtx)
		}
		if err == nil {
			if _, ok := parsed["packages"].([]any); !ok {
				err = fmt.Errorf("包装读取结果缺少 packages")
			}
		}
		metrics.ObserveVisionChannel(ctx, executionMode, smartPackageReadStage, p.upstream, smartPackageReadModel, visionChannelStatus(err), false, time.Since(started), u.input, u.output)
		if err == nil {
			return parsed, p.upstream, nil
		}
		lastErr = err
	}
	return nil, "", lastErr
}

func parseSmartPackageReadings(parsed map[string]any, indexes []int) map[int]smartPackageReading {
	allowed := make(map[int]bool, len(indexes))
	for _, index := range indexes {
		allowed[index] = true
	}
	out := map[int]smartPackageReading{}
	packages, _ := parsed["packages"].([]any)
	for _, raw := range packages {
		entry := mapFromAny(raw)
		index := int(numberFromAny(entry["index"]))
		if !allowed[index] {
			continue
		}
		out[index] = smartPackageReading{
			brand:    smartPackagedField(entry, "brand"),
			product:  smartPackagedField(entry, "productName"),
			flavor:   smartPackagedField(entry, "flavor"),
			unit:     strings.ToLower(smartPackagedField(entry, "unitNetContentUnit")),
			state:    strings.ToLower(smartPackagedField(entry, "packageState")),
			evidence: smartPackagedField(entry, "evidence"),
			net:      numberFromAny(entry["unitNetContent"]),
			count:    numberFromAny(entry["unitCount"]),
			label:    smartLabelPer100(mapFromAny(entry["nutritionPer100"])),
		}
	}
	return out
}

// smartLabelPer100 accepts a printed per-100 panel whose energy agrees with its
// own protein, fat and carbohydrate; anything else is treated as unread.
func smartLabelPer100(panel map[string]any) map[string]any {
	kcal := numberFromAny(panel["energyKcal"])
	if kj := numberFromAny(panel["energyKJ"]); kcal <= 0 && kj > 0 {
		kcal = kj / 4.184
	}
	protein, fat, carbs := numberFromAny(panel["protein"]), numberFromAny(panel["fat"]), numberFromAny(panel["carbs"])
	if kcal <= 0 || kcal > smartLabelMaxKcalPer100g || protein < 0 || fat < 0 || carbs < 0 {
		return nil
	}
	if math.Abs(kcal-(4*protein+4*carbs+9*fat)) > math.Max(25, 0.25*kcal) {
		return nil
	}
	return map[string]any{"calories": round2(kcal), "protein": protein, "fat": fat, "carbs": carbs}
}

// applySmartPackageReading copies what was read onto the item. A sealed
// package sets the weight to net content times count, and a readable panel
// makes the label the nutrition source.
func applySmartPackageReading(item map[string]any, reading smartPackageReading) (map[string]any, []string) {
	next := copyAnyMap(item)
	applied := []string{}
	if reading.brand != "" {
		next["brand"] = reading.brand
		next["brand_source"] = "package_read"
		applied = append(applied, "brand")
	}
	if reading.product != "" {
		next["productName"] = reading.product
	}
	if reading.flavor != "" {
		next["flavorText"] = reading.flavor
	}
	if reading.evidence != "" {
		next["package_read_evidence"] = reading.evidence
	}
	if reading.net > 0 && (reading.unit == "g" || reading.unit == "ml") {
		next["specText"] = fmt.Sprintf("%g%s", reading.net, reading.unit)
	}
	weight := nutritionWeightFromItem(next)
	gross := numberFromAny(next["grossWeightGrams"])
	if gross < weight {
		gross = weight
	}
	if labelGross, ok := smartSealedPackageWeight(reading, gross); ok {
		// Net content includes bones and pits (a 132 g duck leg); the photo
		// estimate already split gross from edible weight, so keep its ratio.
		edible := labelGross
		if gross > 0 && weight > 0 {
			edible = round2(labelGross * weight / gross)
		}
		next["model_weight_grams"] = weight
		next["nutrients"] = scaleNutrition(nutritionUnitFromTotals(mapFromAny(next["nutrients"]), weight), edible)
		next["estimatedWeightGrams"] = edible
		next["grossWeightGrams"] = labelGross
		next["weight_source"] = "package_label"
		weight = edible
		applied = append(applied, "weight")
	}
	if reading.label != nil && weight > 0 {
		// The same field the main call uses for a label it read; the AI-direct
		// pass turns it into an ingredient_label item the library keeps.
		ingredients := copyAnyMap(mapFromAny(next["ingredients"]))
		ingredients["nutritionPer100g"] = reading.label
		next["ingredients"] = ingredients
		next["label_source"] = "package_read"
		applied = append(applied, "label")
	}
	return next, applied
}

// smartSealedPackageWeight snaps the photo estimate to whole sealed packages:
// the photo says roughly how much, the label says exactly how big one unit is.
// Two 190 ml cartons in the picture with a 195 g estimate count as one.
func smartSealedPackageWeight(reading smartPackageReading, photoWeight float64) (float64, bool) {
	count := math.Floor(reading.count)
	if reading.state != "sealed" || reading.net <= 0 || count < 1 || photoWeight <= 0 || (reading.unit != "g" && reading.unit != "ml") {
		return 0, false
	}
	// Drinks are labelled in ml; 1 ml is taken as 1 g, as the label values are.
	units := math.Max(1, math.Min(count, math.Round(photoWeight/reading.net)))
	weight := round2(reading.net * units)
	if weight < photoWeight*smartPackageWeightMinRatio || weight > photoWeight*smartPackageWeightMaxRatio {
		return 0, false
	}
	return weight, true
}
