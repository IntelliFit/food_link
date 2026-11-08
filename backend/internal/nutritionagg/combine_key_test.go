package nutritionagg

import (
	"reflect"
	"testing"
)

func TestCombineKeyMatchesCombine(t *testing.T) {
	vectors := []Vector{
		{"fiber": {Value: 3, Unit: "g", Status: "recorded", KnownItems: 1, TotalItems: 1}, "sodiumMg": {Value: 500, Unit: "mg", Status: "estimated", KnownItems: 1, TotalItems: 2}},
		{"fiber": {Value: 2, Unit: "mg", Status: "recorded", KnownItems: 1, TotalItems: 1}},
		nil,
	}
	all := Combine(vectors...)
	for _, def := range Definitions {
		if got := CombineKey(def.Key, vectors...); !reflect.DeepEqual(got, all[def.Key]) {
			t.Fatalf("%s: CombineKey %+v, Combine %+v", def.Key, got, all[def.Key])
		}
	}
	if got := CombineKey("noSuchNutrient", vectors...); !reflect.DeepEqual(got, all["noSuchNutrient"]) {
		t.Fatalf("unknown key: %+v", got)
	}
}
