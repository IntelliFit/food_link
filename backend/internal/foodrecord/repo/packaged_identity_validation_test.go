package repo

import (
	"testing"

	"food_link/backend/internal/foodrecord/domain"
)

func TestPackagedIdentityRejectsKnownSkuConflicts(t *testing.T) {
	u, f := "g", "咖啡味"
	old := domain.PackagedFood{Brand: "士力架", NetContentValue: 40, NetContentUnit: &u, FlavorText: &f}
	next := PackagedProductNormalizedFields{Brand: "士力架", NetContentValue: 40, NetContentUnit: "g"}
	if err := rejectConflictingPackagedIdentity(old, next, "咖啡"); err != nil {
		t.Fatalf("equivalent identity rejected: %v", err)
	}
	next.NetContentValue = 51
	if err := rejectConflictingPackagedIdentity(old, next, "咖啡味"); err == nil {
		t.Fatal("different package amount accepted for existing SKU")
	}
	next.NetContentValue = 40
	if err := rejectConflictingPackagedIdentity(old, next, "原味"); err == nil {
		t.Fatal("different flavor accepted for existing SKU")
	}
	next.Brand = "其他品牌"
	if err := rejectConflictingPackagedIdentity(old, next, "咖啡味"); err == nil {
		t.Fatal("different brand accepted for existing SKU")
	}
}

func TestPackagedContentUnitConversionIsPairedAndIdempotent(t *testing.T) {
	for _, tc := range []struct {
		unit        string
		value, want float64
		base        string
	}{
		{"l", 1.53, 1530, "ml"}, {"kg", 2, 2000, "g"},
	} {
		first := normalizePackagedProductFields(PackagedProductNormalizeInput{ProductName: "测试", NetContentValue: tc.value, NetContentUnit: tc.unit, UnitContentValue: tc.value, UnitContentUnit: tc.unit})
		if first.NetContentValue != tc.want || first.UnitContentValue != tc.want || first.NetContentUnit != tc.base {
			t.Fatalf("conversion mismatch: %#v", first)
		}
		second := normalizePackagedProductFields(PackagedProductNormalizeInput{ProductName: "测试", NetContentValue: first.NetContentValue, NetContentUnit: first.NetContentUnit})
		if second.NetContentValue != tc.want {
			t.Fatalf("repeated conversion changed amount: %#v", second)
		}
	}
}

func TestPackagedSpecDoesNotTreatShelfLifeAsPieceCount(t *testing.T) {
	for _, tc := range []struct {
		text string
		want float64
	}{
		{"净含量90g 保质期12个月", 0},
		{"90g 12个月", 0},
		{"90g 12 个 月", 0},
		{"保质期12个月 净含量90g 内含15个", 15},
		{"净含量90g 内含15个 保质期12个月", 15},
		{"6g×15个 保质期12个月", 15},
	} {
		t.Run(tc.text, func(t *testing.T) {
			fields := normalizePackagedProductFields(PackagedProductNormalizeInput{
				ProductName: "样例零食", NetContentValue: 90, NetContentUnit: "g", OCRRawText: tc.text,
			})
			if fields.UnitCount != tc.want || fields.NetContentValue != 90 {
				t.Fatalf("shelf life changed package count or weight: %#v", fields)
			}
			if tc.want == 0 && fields.UnitContentValue != 0 {
				t.Fatalf("shelf life invented individual weight: %#v", fields)
			}
		})
	}
	if label := packagedCountLabel("保质期12个月 内含12个", 12); label != "12个装" {
		t.Fatalf("real count after duration was lost: %q", label)
	}
	if label := packagedCountLabel("保质期12个月", 12); label != "" {
		t.Fatalf("duration became a display count: %q", label)
	}
}
