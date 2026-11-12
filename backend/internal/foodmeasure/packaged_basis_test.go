package foodmeasure

import "testing"

func TestPackagedPer100Unit(t *testing.T) {
	for _, raw := range []string{"g", "100g", "per_100g", "per/100 g", " 100G "} {
		if unit, ok := PackagedPer100Unit(raw); !ok || unit != Gram {
			t.Fatalf("%q: %s %v", raw, unit, ok)
		}
	}
	for _, raw := range []string{"ml", "100ml", "per_100ml", "100 mL"} {
		if unit, ok := PackagedPer100Unit(raw); !ok || unit != Milliliter {
			t.Fatalf("%q: %s %v", raw, unit, ok)
		}
	}
	for _, raw := range []string{"", "250ml", "每份", "kg"} {
		if _, ok := PackagedPer100Unit(raw); ok {
			t.Fatalf("must not invent basis for %q", raw)
		}
	}
}
