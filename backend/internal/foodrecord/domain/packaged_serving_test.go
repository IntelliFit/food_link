package domain

import "testing"

func TestSupportedPackagedServingWeightRequiresEvidenceForSmallerServing(t *testing.T) {
	item := PackagedFood{NetWeightG: 50, ServingWeightG: 25}
	if got, source := SupportedPackagedServingWeight(item); got != 0 || source != "" {
		t.Fatalf("got %v/%q, want unsupported", got, source)
	}
}

func TestSupportedPackagedServingWeightAcceptsEnglishServingSize(t *testing.T) {
	ocr := "Supplement Facts Serving Size 1 scoop (5g) Servings Per Container About 93"
	item := PackagedFood{NetWeightG: 464, ServingWeightG: 5, OCRRawText: &ocr}
	if got, source := SupportedPackagedServingWeight(item); got != 5 || source != "ocr_raw_text" {
		t.Fatalf("got %v/%q, want 5/ocr_raw_text", got, source)
	}
}

func TestSupportedPackagedServingWeightAcceptsUnitBreakdown(t *testing.T) {
	unit := "g"
	spec := "净含量91克(7条×13克)"
	item := PackagedFood{
		NetWeightG:       91,
		ServingWeightG:   13,
		SpecText:         &spec,
		UnitCount:        7,
		UnitContentValue: 13,
		UnitContentUnit:  &unit,
	}
	if got, source := SupportedPackagedServingWeight(item); got != 13 || source != "unit_content" {
		t.Fatalf("got %v/%q, want 13/unit_content", got, source)
	}
}

func TestSupportedPackagedServingWeightAcceptsRawPerServingBasis(t *testing.T) {
	item := PackagedFood{
		NetWeightG:     80,
		ServingWeightG: 30,
		RawLabelPayload: map[string]any{
			"raw_nutrition_basis": map[string]any{"type": "每份", "value": 30.0, "unit": "克"},
		},
	}
	if got, source := SupportedPackagedServingWeight(item); got != 30 || source != "raw_nutrition_basis" {
		t.Fatalf("got %v/%q, want 30/raw_nutrition_basis", got, source)
	}
}
