package routes

import "testing"

func TestLoadFromRouteMap(t *testing.T) {
	specs, err := LoadFromRouteMap("../../../docs/backend-api-prd/ROUTE_MAP.md")
	if err != nil {
		t.Fatalf("load route map: %v", err)
	}
	if len(specs) != 143 {
		t.Fatalf("unexpected route count: got %d want 143", len(specs))
	}
}
