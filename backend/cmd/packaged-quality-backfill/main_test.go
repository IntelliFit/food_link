package main

import "testing"

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
