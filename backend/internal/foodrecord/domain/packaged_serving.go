package domain

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var packagedServingWords = []string{
	"每份", "每一份", "单份", "一份", "每包", "每袋", "每条", "每支", "每个", "每颗", "每粒", "每枚",
	"serving size", "per serving",
}

// SupportedPackagedServingWeight only returns a serving weight when the value
// is backed by package evidence. A smaller model-generated value is not proof
// by itself: it must be corroborated by a per-serving nutrition basis, OCR,
// specification text, or explicit unit-content fields.
func SupportedPackagedServingWeight(item PackagedFood) (float64, string) {
	serving := item.ServingWeightG
	if serving <= 0 {
		return 0, ""
	}
	container := PackagedContainerWeight(item)
	if container > 0 {
		if serving > container*1.05 {
			return 0, ""
		}
		if packagedWeightsClose(serving, container) {
			return container, "net_content"
		}
	}
	if item.UnitContentValue > 0 && packagedWeightUnit(item.UnitContentUnit) && packagedWeightsClose(serving, item.UnitContentValue) {
		return serving, "unit_content"
	}
	if packagedServingTextEvidence(stringPointer(item.SpecText), serving, container) {
		return serving, "spec_text"
	}
	if packagedServingTextEvidence(stringPointer(item.OCRRawText), serving, container) {
		return serving, "ocr_raw_text"
	}
	if packagedServingBasisEvidence(item.RawLabelPayload, serving) {
		return serving, "raw_nutrition_basis"
	}
	if packagedServingTextEvidence(flattenPackagedEvidence(item.RawLabelPayload), serving, container) {
		return serving, "raw_label_payload"
	}
	basis := stringPointer(item.NutritionBasisUnit)
	if basis != "" && !packagedHundredBasis(basis) && packagedServingTextEvidence("每份 "+basis, serving, container) {
		return serving, "nutrition_basis_unit"
	}
	return 0, ""
}

func PackagedContainerWeight(item PackagedFood) float64 {
	if item.NetWeightG > 0 {
		return item.NetWeightG
	}
	if item.NetContentValue > 0 && packagedWeightUnit(item.NetContentUnit) {
		return item.NetContentValue
	}
	return 0
}

func packagedServingTextEvidence(text string, serving, container float64) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	text = strings.NewReplacer("×", "x", "＊", "*", "（", "(", "）", ")").Replace(text)
	if text == "" || serving <= 0 {
		return false
	}
	token := regexp.QuoteMeta(packagedWeightToken(serving))
	unit := `(?:g|克|ml|毫升)`
	words := make([]string, 0, len(packagedServingWords))
	for _, word := range packagedServingWords {
		words = append(words, regexp.QuoteMeta(word))
	}
	wordPattern := strings.Join(words, "|")
	for _, pattern := range []string{
		`(?i)(?:` + wordPattern + `).{0,40}?` + token + `\s*` + unit,
		token + `\s*` + unit + `.{0,24}?(?:` + wordPattern + `)`,
	} {
		if regexp.MustCompile(pattern).MatchString(text) {
			return true
		}
	}

	countPatterns := []string{
		`(?i)([0-9]+(?:\.[0-9]+)?)\s*(?:条|包|袋|支|个|颗|粒|枚|杯|份)?\s*[x*]\s*` + token + `\s*` + unit,
		`(?i)` + token + `\s*` + unit + `\s*[x*]\s*([0-9]+(?:\.[0-9]+)?)`,
	}
	for _, pattern := range countPatterns {
		match := regexp.MustCompile(pattern).FindStringSubmatch(text)
		if len(match) != 2 {
			continue
		}
		count, err := strconv.ParseFloat(match[1], 64)
		if err == nil && count > 1 && (container <= 0 || packagedWeightsCloseWithTolerance(count*serving, container, 0.08)) {
			return true
		}
	}
	return false
}

func packagedServingBasisEvidence(value any, serving float64) bool {
	switch typed := value.(type) {
	case map[string]any:
		basisType := strings.ToLower(strings.TrimSpace(fmt.Sprint(firstPackagedValue(typed, "type", "basis_type", "basis"))))
		if strings.Contains(basisType, "每份") || strings.Contains(basisType, "单份") || strings.Contains(basisType, "serving") {
			basisValue := packagedNumber(firstPackagedValue(typed, "value", "weight", "serving_weight_g"))
			basisUnit := firstPackagedValue(typed, "unit", "weight_unit")
			if packagedWeightsClose(basisValue, serving) && packagedWeightUnitValue(basisUnit) {
				return true
			}
		}
		for _, nested := range typed {
			if packagedServingBasisEvidence(nested, serving) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if packagedServingBasisEvidence(nested, serving) {
				return true
			}
		}
	}
	return false
}

func flattenPackagedEvidence(value any) string {
	parts := make([]string, 0, 16)
	var visit func(any)
	visit = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			for key, nested := range typed {
				parts = append(parts, key)
				visit(nested)
			}
		case []any:
			for _, nested := range typed {
				visit(nested)
			}
		case nil:
		default:
			parts = append(parts, fmt.Sprint(typed))
		}
	}
	visit(value)
	return strings.Join(parts, " ")
}

func firstPackagedValue(values map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			return value
		}
	}
	return nil
}

func packagedNumber(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case jsonNumberLike:
		parsed, _ := strconv.ParseFloat(typed.String(), 64)
		return parsed
	case string:
		match := regexp.MustCompile(`[-+]?[0-9]+(?:\.[0-9]+)?`).FindString(typed)
		parsed, _ := strconv.ParseFloat(match, 64)
		return parsed
	default:
		return 0
	}
}

type jsonNumberLike interface {
	String() string
}

func packagedWeightUnit(unit *string) bool {
	if unit == nil {
		return false
	}
	return packagedWeightUnitValue(*unit)
}

func packagedWeightUnitValue(value any) bool {
	unit := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(value)), " ", ""))
	switch unit {
	case "g", "克", "gram", "grams", "ml", "毫升", "milliliter", "milliliters":
		return true
	default:
		return false
	}
}

func packagedHundredBasis(value string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
	return regexp.MustCompile(`100(?:g|克|ml|毫升)`).MatchString(normalized)
}

func packagedWeightsClose(left, right float64) bool {
	return packagedWeightsCloseWithTolerance(left, right, 0.05)
}

func packagedWeightsCloseWithTolerance(left, right, tolerance float64) bool {
	if left <= 0 || right <= 0 {
		return false
	}
	return math.Abs(left-right) <= math.Max(0.5, math.Max(left, right)*tolerance)
}

func packagedWeightToken(weight float64) string {
	if math.Abs(weight-math.Round(weight)) < 1e-9 {
		return strconv.FormatInt(int64(math.Round(weight)), 10)
	}
	return strconv.FormatFloat(weight, 'f', -1, 64)
}

func stringPointer(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
