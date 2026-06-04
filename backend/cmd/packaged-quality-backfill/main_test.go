package main

import "testing"

import foodrecorddomain "food_link/backend/internal/foodrecord/domain"
import foodrecordservice "food_link/backend/internal/foodrecord/service"

func TestParseContentSpecRequiresNetContentEvidence(t *testing.T) {
	spec := parseContentSpec("营养成分表 每100g 能量 1600kJ 蛋白质 8g")
	if spec.Value != 0 || spec.Unit != "" {
		t.Fatalf("parseContentSpec()=%#v, want empty for nutrition basis text", spec)
	}
}

func TestParseContentSpecParsesExplicitNetContent(t *testing.T) {
	tests := []struct {
		name string
		text string
		want contentSpec
	}{
		{
			name: "ml",
			text: "大窑橙诺 橙味果汁汽水 净含量:520mL",
			want: contentSpec{Value: 520, Unit: "ml"},
		},
		{
			name: "tail",
			text: "桃李 豆沙小饼面包 红豆沙馅 55g",
			want: contentSpec{Value: 55, Unit: "g"},
		},
		{
			name: "additive",
			text: "净含量:(150+75)克",
			want: contentSpec{Value: 225, Unit: "g"},
		},
		{
			name: "kg",
			text: "规格:1.5千克",
			want: contentSpec{Value: 1500, Unit: "g"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseContentSpec(tt.text)
			if got != tt.want {
				t.Fatalf("parseContentSpec(%q)=%#v, want %#v", tt.text, got, tt.want)
			}
		})
	}
}

func TestFirstContentSpecChecksIndividualFields(t *testing.T) {
	spec := firstContentSpec("", "达利园 法式软面包 香奶味、五香味 200g", "法式软面包")
	if spec != (contentSpec{Value: 200, Unit: "g"}) {
		t.Fatalf("firstContentSpec()=%#v, want 200g", spec)
	}
}

func TestShouldReplaceInvalidNutritionNumbers(t *testing.T) {
	food := foodrecorddomain.PackagedFood{KcalPer100g: 1234}
	if !shouldReplaceInvalidNumber(food, "kcal_per_100g") {
		t.Fatal("expected kcal_per_100g over 900 to be replaceable")
	}

	food = foodrecorddomain.PackagedFood{ProteinPer100g: 0, CarbsPer100g: 0, FatPer100g: 0}
	if !shouldReplaceInvalidNumber(food, "protein_per_100g") {
		t.Fatal("expected all-zero macros to be replaceable")
	}

	ocr := "营养成分表 每100ml 能量 0kJ 蛋白质 0g 脂肪 0g 碳水化合物 0g"
	food = foodrecorddomain.PackagedFood{
		KcalPer100g:    0,
		ProteinPer100g: 0,
		CarbsPer100g:   0,
		FatPer100g:     0,
		OCRRawText:     &ocr,
	}
	if shouldReplaceInvalidNumber(food, "protein_per_100g") {
		t.Fatal("expected verified zero macros to stay protected")
	}

	food = foodrecorddomain.PackagedFood{ProteinPer100g: 8, CarbsPer100g: 50, FatPer100g: 20}
	if shouldReplaceInvalidNumber(food, "carbs_per_100g") {
		t.Fatal("expected normal macro value to stay protected")
	}
}

func TestIssueTagsSkipsVerifiedZeroNutritionEvidence(t *testing.T) {
	ocr := "营养成分表 每100ml 能量 0kJ 蛋白质 0g 脂肪 0g 碳水化合物 0g 钠 5mg"
	food := foodrecorddomain.PackagedFood{
		NetContentValue: 500,
		NetContentUnit:  ptrString("ml"),
		KcalPer100g:     0,
		ProteinPer100g:  0,
		CarbsPer100g:    0,
		FatPer100g:      0,
		OCRRawText:      &ocr,
		SourceImageURLs: []string{"front.jpg", "label.jpg"},
	}

	if tags := issueTags(food); len(tags) != 0 {
		t.Fatalf("issueTags()=%#v, want no issue for verified zero nutrition", tags)
	}
	if !foodrecordservice.PackagedFoodHasVerifiedZeroNutritionEvidence(&food) {
		t.Fatal("expected verified zero nutrition evidence")
	}
}

func TestIssueTagsRequiresZeroNutritionEvidence(t *testing.T) {
	food := foodrecorddomain.PackagedFood{
		NetContentValue: 500,
		NetContentUnit:  ptrString("ml"),
		KcalPer100g:     0,
		ProteinPer100g:  0,
		CarbsPer100g:    0,
		FatPer100g:      0,
		SourceImageURLs: []string{"front.jpg", "label.jpg"},
	}

	tags := issueTags(food)
	if !containsString(tags, "macros_all_zero") {
		t.Fatalf("issueTags()=%#v, want macros_all_zero without label evidence", tags)
	}
}

func TestVerifiedZeroNutritionRejectsNonZeroEnergyEvidence(t *testing.T) {
	ocr := "营养成分表 每100ml 能量 17kJ 蛋白质 0g 脂肪 0g 碳水化合物 0g"
	food := foodrecorddomain.PackagedFood{
		KcalPer100g:    0,
		ProteinPer100g: 0,
		CarbsPer100g:   0,
		FatPer100g:     0,
		OCRRawText:     &ocr,
	}

	if foodrecordservice.PackagedFoodHasVerifiedZeroNutritionEvidence(&food) {
		t.Fatal("non-zero energy evidence must not be treated as verified zero")
	}
}

func TestVerifiedZeroNutritionUsesRawLabelPayload(t *testing.T) {
	food := foodrecorddomain.PackagedFood{
		KcalPer100g:    0,
		ProteinPer100g: 0,
		CarbsPer100g:   0,
		FatPer100g:     0,
		RawLabelPayload: map[string]any{
			"nutrition": map[string]any{
				"energy":  "能量 0kJ",
				"protein": "蛋白质 0g",
			},
		},
	}

	if !foodrecordservice.PackagedFoodHasVerifiedZeroNutritionEvidence(&food) {
		t.Fatal("expected raw_label_payload zero nutrition evidence")
	}
}

func ptrString(value string) *string {
	return &value
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
