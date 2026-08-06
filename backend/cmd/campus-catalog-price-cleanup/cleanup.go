package main

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"food_link/backend/internal/campuscatalog/domain"
)

var (
	moneyAmountPattern = regexp.MustCompile(`(?:[¥￥]\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*元)`)
	priceUnitPattern   = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)?\s*元\s*/\s*([^，；。、,;\s]+)`)
	portionTextPattern = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?\s*(?:人份|千克|公斤|kg|克|g|斤|两|份|支|个|只|枚|块|片|串|碗|盘|盒|杯|瓶|包|袋|卷|根|条|球|勺))`)
)

type itemSnapshot struct {
	PriceType          string   `json:"price_type"`
	Price              *float64 `json:"price,omitempty"`
	PriceMin           *float64 `json:"price_min,omitempty"`
	PriceMax           *float64 `json:"price_max,omitempty"`
	PriceUnit          string   `json:"price_unit,omitempty"`
	PriceText          string   `json:"price_text,omitempty"`
	PortionDescription string   `json:"portion_description,omitempty"`
	MissingFields      []string `json:"missing_fields"`
	CompletenessStatus string   `json:"completeness_status"`
	Status             string   `json:"status"`
}

type cleanupCandidate struct {
	ItemID         string       `json:"item_id"`
	BatchID        string       `json:"batch_id"`
	Name           string       `json:"name"`
	School         string       `json:"school"`
	Canteen        string       `json:"canteen"`
	Reason         string       `json:"reason"`
	NormalizedUnit string       `json:"normalized_unit"`
	Before         itemSnapshot `json:"before"`
	After          itemSnapshot `json:"after"`
}

func cleanCatalogPrice(item domain.CatalogItem) (domain.CatalogItem, cleanupCandidate, bool) {
	updated := item
	reasons := make([]string, 0, 3)
	rawUnit := strings.TrimSpace(item.PriceUnit)
	if rawUnit != "" && hasNumericPrice(item) {
		canonicalUnit := canonicalPriceUnit(rawUnit, item.PriceText)
		if canonicalUnit != rawUnit {
			updated.PriceUnit = canonicalUnit
			reasons = append(reasons, "价格单位缺少货币标记")
		}
	}

	amounts := monetaryAmounts(item.PriceText)
	if len(amounts) == 1 && item.PriceMin != nil && item.PriceMax != nil {
		minMatches := containsAmount(amounts, *item.PriceMin)
		maxMatches := containsAmount(amounts, *item.PriceMax)
		if minMatches != maxMatches {
			price := amounts[0]
			updated.Price = &price
			updated.PriceMin = nil
			updated.PriceMax = nil
			if item.PriceType != "by_weight" {
				updated.PriceType = "fixed"
			}
			for _, portion := range portionsFromPriceText(item.PriceText) {
				updated.PortionDescription = appendPortion(updated.PortionDescription, portion)
			}
			reasons = append(reasons, "价格区间混入起售数量或克重")
		}
	}

	if item.Price != nil && len(amounts) == 0 && strings.TrimSpace(item.PriceText) != "" {
		updated.PriceText = formatNumber(*item.Price) + "元；" + strings.TrimSpace(item.PriceText)
		if strings.TrimSpace(updated.PriceUnit) == "" {
			updated.PriceUnit = "元"
		}
		reasons = append(reasons, "价格原文补充货币标记")
	}
	if len(reasons) == 0 {
		return item, cleanupCandidate{}, false
	}
	updated.MissingFields = calculateMissingFields(updated)
	if len(updated.MissingFields) == 0 {
		updated.CompletenessStatus = "complete"
	} else {
		updated.CompletenessStatus = "incomplete"
	}
	candidate := cleanupCandidate{
		ItemID: item.ID, BatchID: item.BatchID, Name: item.Name, School: item.OrganizationName, Canteen: item.CanteenName,
		Reason: strings.Join(uniqueStrings(reasons), "；"), NormalizedUnit: updated.PriceUnit, Before: snapshot(item), After: snapshot(updated),
	}
	return updated, candidate, true
}

func canonicalPriceUnit(rawUnit, priceText string) string {
	unit := strings.TrimSpace(rawUnit)
	unit = strings.ReplaceAll(unit, "￥", "元")
	unit = strings.ReplaceAll(unit, "¥", "元")
	if unit == "元" || strings.HasPrefix(unit, "元/") {
		return unit
	}
	if strings.HasPrefix(unit, "元") {
		unit = strings.TrimSpace(strings.TrimPrefix(unit, "元"))
		unit = strings.TrimPrefix(unit, "/")
	}
	if inferred := inferPriceUnit(priceText); inferred != "" {
		unit = inferred
	}
	unit = strings.TrimSpace(unit)
	if unit == "" {
		return "元"
	}
	return "元/" + unit
}

func inferPriceUnit(priceText string) string {
	matches := priceUnitPattern.FindStringSubmatch(strings.TrimSpace(priceText))
	if len(matches) != 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}

func portionsFromPriceText(priceText string) []string {
	withoutMoney := moneyAmountPattern.ReplaceAllString(priceText, "")
	matches := portionTextPattern.FindAllStringSubmatch(withoutMoney, -1)
	portions := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) == 2 {
			portions = append(portions, strings.ReplaceAll(strings.TrimSpace(match[1]), " ", ""))
		}
	}
	return uniqueStrings(portions)
}

func auditPriceIssues(item domain.CatalogItem) []string {
	issues := make([]string, 0, 2)
	if !hasNumericPrice(item) {
		return issues
	}
	if strings.TrimSpace(item.PriceText) == "" {
		return append(issues, "数值价格缺少原文")
	}
	amounts := monetaryAmounts(item.PriceText)
	if len(amounts) == 0 {
		return append(issues, "价格原文缺少货币标记")
	}
	if item.Price != nil && !containsAmount(amounts, *item.Price) {
		issues = append(issues, "数值价格与原文不一致")
	}
	if item.PriceMin != nil && !containsAmount(amounts, *item.PriceMin) {
		issues = append(issues, "最低价与原文不一致")
	}
	if item.PriceMax != nil && !containsAmount(amounts, *item.PriceMax) {
		issues = append(issues, "最高价与原文不一致")
	}
	return uniqueStrings(issues)
}

func monetaryAmounts(value string) []float64 {
	matches := moneyAmountPattern.FindAllStringSubmatch(value, -1)
	amounts := make([]float64, 0, len(matches))
	for _, match := range matches {
		raw := match[1]
		if raw == "" {
			raw = match[2]
		}
		amount, err := strconv.ParseFloat(raw, 64)
		if err == nil {
			amounts = append(amounts, amount)
		}
	}
	return amounts
}

func containsAmount(amounts []float64, expected float64) bool {
	for _, amount := range amounts {
		if math.Abs(amount-expected) < 0.000001 {
			return true
		}
	}
	return false
}

func formatNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func appendPortion(existing, addition string) string {
	existing = strings.TrimSpace(existing)
	addition = strings.TrimSpace(addition)
	if existing == "" {
		return addition
	}
	for _, part := range strings.FieldsFunc(existing, func(r rune) bool { return r == '；' || r == ';' || r == '、' }) {
		if strings.TrimSpace(part) == addition {
			return existing
		}
	}
	return existing + "；" + addition
}

func hasNumericPrice(item domain.CatalogItem) bool {
	return item.Price != nil || item.PriceMin != nil || item.PriceMax != nil
}

func hasPrice(item domain.CatalogItem) bool {
	return hasNumericPrice(item) || strings.TrimSpace(item.PriceText) != "" || len(item.PriceOptions) > 0
}

func calculateMissingFields(item domain.CatalogItem) []string {
	missing := make([]string, 0, 3)
	if strings.TrimSpace(item.Name) == "" {
		missing = append(missing, "name")
	}
	if len(item.ImagePaths) == 0 {
		missing = append(missing, "image")
	}
	if item.PriceType == "unknown" || !hasPrice(item) {
		missing = append(missing, "price")
	}
	sort.Strings(missing)
	return missing
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func snapshot(item domain.CatalogItem) itemSnapshot {
	return itemSnapshot{
		PriceType: item.PriceType, Price: item.Price, PriceMin: item.PriceMin, PriceMax: item.PriceMax,
		PriceUnit: item.PriceUnit, PriceText: item.PriceText, PortionDescription: item.PortionDescription,
		MissingFields: append([]string(nil), item.MissingFields...), CompletenessStatus: item.CompletenessStatus, Status: item.Status,
	}
}

func targetName(host, databaseName, schema string) string {
	return fmt.Sprintf("%s/%s/%s", strings.TrimSpace(host), strings.TrimSpace(databaseName), strings.TrimSpace(schema))
}
