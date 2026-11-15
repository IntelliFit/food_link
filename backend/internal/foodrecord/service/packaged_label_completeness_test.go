package service

import (
	"context"
	"testing"
)

func TestAutomaticPublicationRejectsPartialLabelDespiteConvertedZeroes(t *testing.T) {
	r := packagedReadyExtractForConfirmation()
	r.ProductName, r.NetWeightG, r.SpecText = "士力架花生夹心巧克力", 51, "51克"
	r.RawNutritionPerBasis = PackagedLabelRawNutrition{
		Energy:  PackagedLabelNutritionValue{Value: 2011, Unit: "kj"},
		Protein: PackagedLabelNutritionValue{Value: 8.6, Unit: "g"},
	}
	convertPackagedNutrition(r)
	auto := EvaluatePackagedProductExtract(r)
	if auto.Status != "blocked" || auto.Reason != "incomplete_nutrition_label" || !containsString(auto.MissingFields, "fat") || !containsString(auto.MissingFields, "carbs") {
		t.Fatalf("partial source label was accepted: %#v", auto)
	}
	reasons, _ := determinePackagedConfirmation(r)
	if !containsString(reasons, "incomplete_nutrition_label") {
		t.Fatalf("incomplete label did not request confirmation: %v", reasons)
	}
	auto, item, err := NewFoodNutritionService(nil).IngestPackagedProductExtract(context.Background(), r, PackagedImportIngestOptions{ForceApply: true})
	if err != nil || item != nil || auto.Status != "blocked" {
		t.Fatalf("force bypassed missing source evidence: %#v %#v %v", auto, item, err)
	}
}

func TestAutomaticPublicationHonorsConflictsAndLowNutritionConfidence(t *testing.T) {
	r := packagedReadyExtractForConfirmation()
	r.SpecText = "70g"
	convertPackagedNutrition(r)
	if auto := EvaluatePackagedProductExtract(r); auto.Status != "blocked" || auto.Reason != "conflicting_label" {
		t.Fatalf("contradictory package was accepted: %#v", auto)
	}
	r = packagedReadyExtractForConfirmation()
	r.FieldConfidence["nutrition"] = 0.35
	convertPackagedNutrition(r)
	if auto := EvaluatePackagedProductExtract(r); auto.Status != "blocked" || auto.Reason != "needs_confirmation" {
		t.Fatalf("uncertain nutrition was accepted: %#v", auto)
	}
}

func TestAutomaticPublicationKeepsExplicitZeroAndOptionalMicrosOptional(t *testing.T) {
	r := packagedReadyExtractForConfirmation()
	r.RawNutritionPerBasis.Fat = PackagedLabelNutritionValue{Value: 0, Unit: "g"}
	r.UnitNutritionPer100g["fat"] = 0
	convertPackagedNutrition(r)
	if auto := EvaluatePackagedProductExtract(r); auto.Status != "ready" {
		t.Fatalf("explicit zero or optional micros blocked: %#v", auto)
	}
	r.RawNutritionPerBasis.Fat = PackagedLabelNutritionValue{}
	if auto := EvaluatePackagedProductExtract(r); auto.Status != "blocked" {
		t.Fatalf("default zero mistaken for printed zero: %#v", auto)
	}
}
