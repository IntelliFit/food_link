package main

import "testing"

func TestCSVQuantityDoesNotScaleNormalizedProductQuantityTwice(t *testing.T) {
	columns := map[string]int{"quantity": 0, "product_quantity": 1}
	for _, tc := range []struct {
		label, amount, unit string
		want                float64
	}{
		{"1 l", "1000", "ml", 1000},
		{"1.53 l", "1530", "ml", 1530},
		{"2 kg", "2000", "g", 2000},
	} {
		p := productFromCSV([]string{tc.label, tc.amount}, columns)
		value, unit := normalizedQuantity(numberValue(p.ProductQuantity), p.ProductQuantityUnit)
		if value != tc.want || unit != tc.unit {
			t.Fatalf("%s: got %v%s, want %v%s", tc.label, value, unit, tc.want, tc.unit)
		}
	}
	columns["product_quantity_unit"] = 2
	p := productFromCSV([]string{"1 l", "1000", "ml"}, columns)
	if value, unit := normalizedQuantity(numberValue(p.ProductQuantity), p.ProductQuantityUnit); value != 1000 || unit != "ml" {
		t.Fatalf("explicit unit ignored: %v%s", value, unit)
	}
}
