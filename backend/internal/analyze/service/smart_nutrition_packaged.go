package service

import (
	"context"
	"math"
	"sort"
	"strings"
	"unicode"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
)

const (
	smartPackagedSearchLimit      = 40
	smartPackagedNameMatchScore   = 0.6
	smartPackagedNameMargin       = 0.15
	smartPackagedFamilyKcalSpread = 0.12
	// A product whose label energy is this far from the photo estimate is a
	// different form of the food: dry noodles for a cooked bowl, coffee powder
	// for the drink, regular cola for the sugar-free can.
	smartPackagedMaxDensityRatio = 2.5
	smartPackagedDensityFloor    = 5.0
)

// smartPackagedHeadNouns are product kinds. A candidate must share the kind
// with the item, so "乐事薯片" can never resolve to a 乐事 drink.
var smartPackagedHeadNouns = []string{
	"薯片", "薯条", "巧克力", "饼干", "曲奇", "威化", "蛋卷", "薄饼", "面包", "吐司", "蛋糕", "蛋黄派", "派",
	"牛奶", "酸奶", "乳酸菌", "豆奶", "豆浆", "奶茶", "咖啡", "可乐", "雪碧", "汽水", "果汁", "茶", "饮料", "矿泉水", "苏打水",
	"辣条", "面筋", "魔芋爽", "海带", "方便面", "泡面", "拉面", "面", "粉丝", "米粉", "火腿肠", "香肠", "肠",
	"牛肉干", "鸭脖", "鸡爪", "凤爪", "鸭翅", "豆干", "果冻", "糖果", "软糖", "硬糖", "口香糖", "坚果", "瓜子", "花生",
	"麦片", "燕麦", "谷物", "能量棒", "蛋白棒", "饭团", "三明治", "汉堡", "冰淇淋", "雪糕",
}

func smartPackagedField(item map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(stringFromAny(item[key])); value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func smartHasPackagedIdentity(item map[string]any) bool {
	return smartPackagedField(item, "brand", "brandName") != "" || smartPackagedField(item, "barcode", "ean", "gtin") != ""
}

func (s *AnalyzeService) resolveSmartPackaged(ctx context.Context, item map[string]any) (map[string]any, string) {
	food, method, reason := s.matchSmartPackaged(ctx, item)
	if food == nil {
		return nil, reason
	}
	if !smartPackagedDensityPlausible(item, food.KcalPer100g) {
		return nil, "packaged_density_mismatch"
	}
	if !smartPackagedQualifiersAgree(item, food) {
		return nil, "packaged_qualifier_mismatch"
	}
	next := applySmartLibraryNutrition(item, packagedNutritionUnit(food), nutritionWeightFromItem(item))
	next["type"] = "snack"
	next["matched_food_id"] = food.ID
	next["packaged_food_id"] = food.ID
	next["matched_food_name"] = packagedFoodDisplayName(food)
	next["standardized_food_name"] = packagedFoodDisplayName(food)
	next["resolve_status"] = method
	next["resolve_score"] = 1
	next["is_unresolved"] = false
	next["nutrition_source"] = "packaged_food_library"
	next["package_match_status"] = "matched"
	next["smart_match_method"] = method
	return next, "matched_" + method
}

func (s *AnalyzeService) matchSmartPackaged(ctx context.Context, item map[string]any) (*foodrecorddomain.PackagedFood, string, string) {
	brand := smartPackagedField(item, "brand", "brandName")
	product := smartPackagedField(item, "productName", "product_name", "name")
	flavor := smartPackagedField(item, "flavorText", "flavor_text", "flavor")
	spec := smartPackagedField(item, "specText", "spec_text", "packageSpec")
	barcode := smartPackagedField(item, "barcode", "ean", "gtin")
	if product == "" && barcode == "" {
		return nil, "", "missing_product_name"
	}
	names := []string{product}
	if brand != "" && !strings.Contains(product, brand) {
		names = append(names, brand+product)
	}
	for _, name := range names {
		resolved, err := s.nutrition.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
			Name: name, Brand: brand, FlavorText: flavor, SpecText: spec, Barcode: barcode,
		})
		if err == nil && resolved != nil && resolved.Food != nil && resolved.Food.KcalPer100g > 0 {
			if !smartPackagedBrandConsistent(brand, resolved.Food) {
				// An alias like "牛奶巧克力" must not turn 德芙 into 好时.
				continue
			}
			return resolved.Food, "packaged_" + resolved.Status, ""
		}
	}
	if brand == "" {
		return nil, "", "packaged_without_brand"
	}
	candidates, err := s.nutrition.SearchPackagedFood(ctx, strings.TrimSpace(brand+" "+product), smartPackagedSearchLimit)
	if err != nil {
		return nil, "", "lookup_error"
	}
	food, method := smartPickPackagedCandidate(brand, product, flavor, candidates)
	if food == nil {
		return nil, "", method
	}
	return food, method, ""
}

// smartPickPackagedCandidate accepts a same-brand, same-kind candidate whose
// name clearly matches, or, when several flavours of the same product line
// share almost the same label values, the one closest to their median.
func smartPickPackagedCandidate(brand, product, flavor string, candidates []foodrecorddomain.PackagedFood) (*foodrecorddomain.PackagedFood, string) {
	brandKey := smartTextKey(brand)
	head := smartPackagedHead(product)
	target := smartTextKey(product + flavor)
	type scored struct {
		food  foodrecorddomain.PackagedFood
		score float64
	}
	pool := []scored{}
	for _, food := range candidates {
		if food.KcalPer100g <= 0 || !food.IsActive {
			continue
		}
		flavorText := derefString(food.FlavorText)
		text := smartTextKey(food.Brand + food.ProductName + food.DisplayName + flavorText)
		if brandKey == "" || !strings.Contains(text, brandKey) {
			continue
		}
		if head != "" && !strings.Contains(text, head) {
			continue
		}
		name := smartTextKey(strings.ReplaceAll(food.ProductName+flavorText, food.Brand, ""))
		pool = append(pool, scored{food: food, score: smartBigramDice(strings.ReplaceAll(target, brandKey, ""), strings.ReplaceAll(name, brandKey, ""))})
	}
	if len(pool) == 0 {
		return nil, "packaged_no_brand_candidate"
	}
	sort.SliceStable(pool, func(i, j int) bool { return pool[i].score > pool[j].score })
	if pool[0].score >= smartPackagedNameMatchScore && (head != "" || pool[0].score >= 0.8) {
		// Several rows can tie on the name (the same product in different
		// sizes). The match stands when they agree on the label values.
		tied := []foodrecorddomain.PackagedFood{}
		for _, entry := range pool {
			if pool[0].score-entry.score < smartPackagedNameMargin {
				tied = append(tied, entry.food)
			}
		}
		if food := smartConsistentPackagedChoice(tied); food != nil {
			return food, "packaged_name_match"
		}
	}
	if head == "" || len(pool) < 2 {
		return nil, "packaged_ambiguous"
	}
	family := make([]foodrecorddomain.PackagedFood, len(pool))
	for i, entry := range pool {
		family[i] = entry.food
	}
	food := smartConsistentPackagedChoice(family)
	if food == nil {
		return nil, "packaged_family_inconsistent"
	}
	return food, "packaged_brand_family"
}

// smartConsistentPackagedChoice returns the row closest to the median energy
// when every row is within the allowed spread, and nil when they disagree.
func smartConsistentPackagedChoice(rows []foodrecorddomain.PackagedFood) *foodrecorddomain.PackagedFood {
	if len(rows) == 0 {
		return nil
	}
	kcals := make([]float64, len(rows))
	for i, row := range rows {
		kcals[i] = row.KcalPer100g
	}
	sort.Float64s(kcals)
	median := kcals[len(kcals)/2]
	if kcals[0] < median*(1-smartPackagedFamilyKcalSpread) || kcals[len(kcals)-1] > median*(1+smartPackagedFamilyKcalSpread) {
		return nil
	}
	closest := rows[0]
	for _, row := range rows {
		if math.Abs(row.KcalPer100g-median) < math.Abs(closest.KcalPer100g-median) {
			closest = row
		}
	}
	return &closest
}

// smartPackagedQualifiers change the nutrition of the same product line.
var smartPackagedQualifiers = [][]string{{"脱脂"}, {"低脂"}, {"无糖", "零糖", "0糖", "零度", "zero"}, {"低糖", "减糖"}}

// smartPackagedQualifiersAgree rejects 纯牛奶 resolving to 脱脂纯牛奶 (or the
// reverse) through a shared alias: one side names a qualifier the other lacks.
func smartPackagedQualifiersAgree(item map[string]any, food *foodrecorddomain.PackagedFood) bool {
	itemText := strings.ToLower(stringFromAny(item["name"]) + smartPackagedField(item, "productName", "product_name") + smartPackagedField(item, "flavorText", "flavor_text"))
	foodText := strings.ToLower(food.ProductName + food.DisplayName + derefString(food.FlavorText))
	for _, group := range smartPackagedQualifiers {
		if containsAnyAnalyzeText(itemText, group) != containsAnyAnalyzeText(foodText, group) {
			return false
		}
	}
	return true
}

func smartPackagedDensityPlausible(item map[string]any, libraryKcalPer100g float64) bool {
	weight := nutritionWeightFromItem(item)
	modelKcal := numberFromAny(mapFromAny(item["nutrients"])["calories"])
	if weight <= 0 || modelKcal <= 0 {
		return true
	}
	model := modelKcal * 100 / weight
	high, low := math.Max(model, libraryKcalPer100g), math.Min(model, libraryKcalPer100g)
	return high/math.Max(low, smartPackagedDensityFloor) <= smartPackagedMaxDensityRatio
}

// smartPackagedBrandConsistent rejects a resolved row that carries another
// brand than the one read from the package.
func smartPackagedBrandConsistent(brand string, food *foodrecorddomain.PackagedFood) bool {
	brandKey := smartTextKey(brand)
	if brandKey == "" || food == nil {
		return true
	}
	foodBrand := smartTextKey(food.Brand)
	if foodBrand == "" {
		return strings.Contains(smartTextKey(food.ProductName+food.DisplayName), brandKey) || !smartLooksBranded(food.DisplayName)
	}
	return strings.Contains(foodBrand, brandKey) || strings.Contains(brandKey, foodBrand)
}

// smartLooksBranded treats a display name of the form "品牌 商品名" as branded.
func smartLooksBranded(displayName string) bool {
	return len(strings.Fields(displayName)) >= 2
}

func smartPackagedHead(product string) string {
	key := smartTextKey(product)
	best := ""
	for _, noun := range smartPackagedHeadNouns {
		if strings.Contains(key, noun) && len(noun) > len(best) {
			best = noun
		}
	}
	return best
}

// smartTextKey lowercases and keeps only letters and digits, so "乐事（Lay's）"
// and "乐事lays" compare equal.
func smartTextKey(text string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func smartBigramDice(a, b string) float64 {
	ga, gb := smartBigrams(a), smartBigrams(b)
	if len(ga) == 0 || len(gb) == 0 {
		if a != "" && a == b {
			return 1
		}
		return 0
	}
	shared := 0
	for gram, count := range ga {
		if other := gb[gram]; other > 0 {
			shared += min(count, other)
		}
	}
	total := 0
	for _, count := range ga {
		total += count
	}
	for _, count := range gb {
		total += count
	}
	return 2 * float64(shared) / float64(total)
}

func smartBigrams(text string) map[string]int {
	runes := []rune(text)
	out := map[string]int{}
	for i := 0; i+1 < len(runes); i++ {
		out[string(runes[i:i+2])]++
	}
	return out
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
