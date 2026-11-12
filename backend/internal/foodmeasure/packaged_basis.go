package foodmeasure

import "strings"

// PackagedPer100Unit recognizes historical spellings of the normalized
// per-100 nutrition columns. It never derives a basis from the food's name.
func PackagedPer100Unit(raw string) (Unit, bool) {
	value := strings.NewReplacer(" ", "", "_", "", "/", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(raw)))
	switch value {
	case "g", "100g", "per100g":
		return Gram, true
	case "ml", "100ml", "per100ml":
		return Milliliter, true
	default:
		return "", false
	}
}
