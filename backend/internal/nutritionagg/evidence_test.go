package nutritionagg

import "testing"

// A per-100g value stored as the serving's (184 g of fibre in a 16 g drink) is invalid,
// so the nutrient is unknown for that item instead of an impossible intake.
func TestObserveRejectsNutrientsHeavierThanTheServing(t *testing.T) {
	items := []map[string]any{
		{"name": "复合膳食纤维固体饮料", "weight": 16.0, "nutrients": map[string]any{"fiber": 184.0, "sodiumMg": 100.0}},
		{"name": "清炒油菜", "weight": 100.0, "nutrients": map[string]any{"fiber": 2.0, "sodiumMg": 400.0}},
	}
	v := Observe(items, true)
	if fiber := v["fiber"]; fiber.Value != 2 || fiber.KnownItems != 1 || fiber.Status != "partial" {
		t.Fatalf("fibre = %+v, want only the vegetable's 2 g, partial", fiber)
	}
	if sodium := v["sodiumMg"]; sodium.Value != 500 || sodium.KnownItems != 2 {
		t.Fatalf("sodium = %+v, want 500 mg from both items", sodium)
	}
}
