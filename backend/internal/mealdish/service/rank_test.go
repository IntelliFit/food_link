package service

import (
	"testing"

	"food_link/backend/internal/mealdish/domain"
)

func TestCapPerWindowKeepsEveryWindowFilled(t *testing.T) {
	ranked := []domain.Dish{}
	for i := 0; i < 30; i++ {
		ranked = append(ranked, domain.Dish{ID: "a" + string(rune('a'+i%26)) + string(rune('0'+i/26)), WindowName: "上海风味"})
	}
	ranked = append(ranked, domain.Dish{ID: "b1", WindowName: "东南亚风味"}, domain.Dish{ID: "c1"})
	kept := capPerWindow(ranked, 12)
	if len(kept) != 14 {
		t.Fatalf("kept %d dishes, want 12 + 1 + 1", len(kept))
	}
	if kept[0].ID != ranked[0].ID || kept[12].ID != "b1" || kept[13].ID != "c1" {
		t.Fatalf("ranked order lost: %+v", kept)
	}
}

func TestDishNameSimilarity(t *testing.T) {
	cases := []struct {
		recognized, menu string
		atLeast, below   float64
	}{
		{"手工虾仁烧麦", "手工虾仁烧麦", 1, 1.01},
		{"烧麦", "手工虾仁烧麦", 0.9, 0.91},
		{"如意蒸（汤）饺", "如意蒸(汤)饺", 1, 1.01},
		{"番茄炒蛋", "西红柿炒鸡蛋", 0.2, 0.5},
		{"红烧肉", "阳春面", 0, 0.01},
		{"", "阳春面", 0, 0.01},
	}
	for _, tc := range cases {
		got := dishNameSimilarity(tc.recognized, tc.menu)
		if got < tc.atLeast || got >= tc.below {
			t.Fatalf("%s vs %s = %.3f, want [%.2f, %.2f)", tc.recognized, tc.menu, got, tc.atLeast, tc.below)
		}
	}
}

func TestRankDishesPutsRecognisedDishFirstAndKeepsPopularityAsTieBreak(t *testing.T) {
	dishes := []domain.Dish{
		{ID: "a", Name: "蟹黄包", WindowName: "上海风味", Popularity: 5},
		{ID: "b", Name: "手工虾仁烧麦", WindowName: "上海风味", Popularity: 1},
		{ID: "c", Name: "柠檬酸汤鱼", WindowName: "东南亚风味", Popularity: 9},
	}
	ranked := rankDishes(dishes, []string{"烧麦"})
	if ranked[0].ID != "b" {
		t.Fatalf("first = %s, want the shaomai", ranked[0].ID)
	}
	before := rankDishes(dishes, nil)
	if before[0].ID != "c" || before[1].ID != "a" {
		t.Fatalf("without recognition order = %s,%s, want popularity order", before[0].ID, before[1].ID)
	}
	windows := windowsOf(ranked)
	if windows[0].Name != "上海风味" || windows[0].DishCount != 2 {
		t.Fatalf("windows = %+v", windows)
	}
}

func TestRecognizedFoodNames(t *testing.T) {
	result := map[string]any{"items": []any{
		map[string]any{"name": "烧麦"},
		map[string]any{"food_name": "豆浆"},
		map[string]any{"name": ""},
		"bad",
	}}
	names := recognizedFoodNames(result)
	if len(names) != 2 || names[0] != "烧麦" || names[1] != "豆浆" {
		t.Fatalf("names = %v", names)
	}
}

func TestMergeCanteenSuggestionsDedupesAndCaps(t *testing.T) {
	d := 30
	recent := []domain.Canteen{{ID: "zijing", Name: "紫荆园", Reason: domain.ReasonRecent, RecentCount: 3}}
	nearby := []domain.Canteen{
		{ID: "zijing", Name: "紫荆园", Reason: domain.ReasonNearby, DistanceM: &d},
		{ID: "taoli", Name: "桃李园", Reason: domain.ReasonNearby, DistanceM: &d},
	}
	school := []domain.Canteen{{ID: "qingfen", Name: "清芬园", Reason: domain.ReasonSchool}, {ID: "x", Name: "四", Reason: domain.ReasonSchool}}
	merged := mergeCanteenSuggestions(3, recent, nearby, school)
	if len(merged) != 3 || merged[0].ID != "zijing" || merged[1].ID != "taoli" || merged[2].ID != "qingfen" {
		t.Fatalf("merged = %+v", merged)
	}
	if merged[0].Reason != domain.ReasonRecent || merged[0].DistanceM == nil {
		t.Fatalf("recent entry should keep its reason and gain the distance: %+v", merged[0])
	}
	if merged[0].ReasonText != "最近来过 3 次" || merged[1].ReasonText != "定位 · 距你 30 m" {
		t.Fatalf("reason texts = %q, %q", merged[0].ReasonText, merged[1].ReasonText)
	}
}

func TestDistanceAndPrice(t *testing.T) {
	// Two points about 111 m apart in latitude.
	if d := distanceMeters(40.0, 116.3, 40.001, 116.3); d < 105 || d > 117 {
		t.Fatalf("distance = %.1f", d)
	}
	if !validCoordinate(40, 116) || validCoordinate(0, 0) || validCoordinate(91, 0) {
		t.Fatal("coordinate validation wrong")
	}
	if formatPrice(15, 0, 0, "fixed") != "15元" || formatPrice(0, 5, 15, "range") != "5-15元" || formatPrice(0, 0, 0, "unknown") != "" {
		t.Fatal("price formatting wrong")
	}
	if r := rankOf("b", []string{"a", "b"}); *r != 1 {
		t.Fatalf("rank = %d", *r)
	}
	if r := rankOf("z", []string{"a"}); *r != -1 {
		t.Fatalf("missing rank = %d", *r)
	}
}
