package service

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"food_link/backend/internal/mealdish/domain"
)

// normalizeDishName folds width and case and drops spaces and punctuation so
// "如意蒸（汤）饺" and "如意蒸(汤)饺" compare equal.
func normalizeDishName(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r >= 0xFF01 && r <= 0xFF5E {
			r -= 0xFEE0
		}
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		builder.WriteRune(unicode.ToLower(r))
	}
	return builder.String()
}

func bigrams(value string) map[string]int {
	runes := []rune(value)
	grams := map[string]int{}
	if len(runes) == 1 {
		grams[value]++
		return grams
	}
	for index := 0; index+1 < len(runes); index++ {
		grams[string(runes[index:index+2])]++
	}
	return grams
}

// dishNameSimilarity scores a recognised food name against a menu name in
// [0,1]: equal names 1, one inside the other 0.9, otherwise the bigram Dice
// coefficient (烧麦 vs 手工虾仁烧麦 contains, 番茄炒蛋 vs 西红柿炒鸡蛋 overlaps).
func dishNameSimilarity(recognized, menu string) float64 {
	a, b := normalizeDishName(recognized), normalizeDishName(menu)
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1
	}
	shorter, longer := a, b
	if len([]rune(shorter)) > len([]rune(longer)) {
		shorter, longer = longer, shorter
	}
	if len([]rune(shorter)) >= 2 && strings.Contains(longer, shorter) {
		return 0.9
	}
	// Shared single characters, discounted, catch rewordings with no shared
	// pair (番茄炒蛋 vs 西红柿炒鸡蛋 share 炒 and 蛋).
	return math.Max(dice(bigrams(a), bigrams(b)), 0.7*dice(characters(a), characters(b)))
}

func characters(value string) map[string]int {
	chars := map[string]int{}
	for _, r := range value {
		chars[string(r)]++
	}
	return chars
}

func dice(a, b map[string]int) float64 {
	total, shared := 0, 0
	for key, count := range a {
		total += count
		if other, ok := b[key]; ok {
			shared += min(count, other)
		}
	}
	for _, count := range b {
		total += count
	}
	if total == 0 {
		return 0
	}
	return 2 * float64(shared) / float64(total)
}

// recognizedFoodNames reads the item names of a finished recognition result.
func recognizedFoodNames(result map[string]any) []string {
	names := []string{}
	items, _ := result["items"].([]any)
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"name", "food_name", "standard_name"} {
			if name := strings.TrimSpace(fmt.Sprint(item[key])); name != "" && name != "<nil>" {
				names = append(names, name)
				break
			}
		}
	}
	return names
}

// rankDishes orders a canteen's dishes for the "which dish" step: by name
// similarity to what recognition saw (when it has finished), then by how
// often others picked the dish, then dishes with real photos, then by name.
func rankDishes(dishes []domain.Dish, recognized []string) []domain.Dish {
	ranked := make([]domain.Dish, len(dishes))
	copy(ranked, dishes)
	for index := range ranked {
		best := 0.0
		for _, name := range recognized {
			best = math.Max(best, dishNameSimilarity(name, ranked[index].Name))
		}
		ranked[index].Score = math.Round(best*1000) / 1000
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		a, b := ranked[i], ranked[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Popularity != b.Popularity {
			return a.Popularity > b.Popularity
		}
		if a.HasRealPhoto != b.HasRealPhoto {
			return a.HasRealPhoto
		}
		return a.Name < b.Name
	})
	return ranked
}

// windowsOf lists windows in the order their best dish appears, so the
// window holding the likeliest dish is preselected.
func windowsOf(ranked []domain.Dish) []domain.Window {
	order := []string{}
	counts := map[string]int{}
	for _, dish := range ranked {
		name := strings.TrimSpace(dish.WindowName)
		if name == "" {
			name = "其他窗口"
		}
		if _, seen := counts[name]; !seen {
			order = append(order, name)
		}
		counts[name]++
	}
	windows := make([]domain.Window, 0, len(order))
	for _, name := range order {
		windows = append(windows, domain.Window{Name: name, DishCount: counts[name]})
	}
	return windows
}

// capPerWindow keeps the ranked order but at most limit dishes per window,
// which is all the grid shows for one window.
func capPerWindow(ranked []domain.Dish, limit int) []domain.Dish {
	kept := make([]domain.Dish, 0, len(ranked))
	counts := map[string]int{}
	for _, dish := range ranked {
		name := strings.TrimSpace(dish.WindowName)
		if counts[name] < limit {
			kept = append(kept, dish)
		}
		counts[name]++
	}
	return kept
}

// mergeCanteenSuggestions keeps the first occurrence of each canteen across
// sources (recent, nearby, school) and caps the list.
func mergeCanteenSuggestions(limit int, lists ...[]domain.Canteen) []domain.Canteen {
	seen := map[string]int{}
	merged := []domain.Canteen{}
	for _, list := range lists {
		for _, canteen := range list {
			if canteen.ID == "" {
				continue
			}
			if index, ok := seen[canteen.ID]; ok {
				if merged[index].DistanceM == nil && canteen.DistanceM != nil {
					merged[index].DistanceM = canteen.DistanceM
				}
				continue
			}
			if len(merged) >= limit {
				continue
			}
			seen[canteen.ID] = len(merged)
			merged = append(merged, canteen)
		}
	}
	for index := range merged {
		// A source that wrote its own text (the home recommendation) keeps it.
		if merged[index].ReasonText == "" {
			merged[index].ReasonText = canteenReasonText(merged[index])
		}
	}
	return merged
}

func canteenReasonText(canteen domain.Canteen) string {
	switch {
	case canteen.Reason == domain.ReasonNearby && canteen.DistanceM != nil:
		return fmt.Sprintf("定位 · 距你 %d m", *canteen.DistanceM)
	case canteen.Reason == domain.ReasonRecent && canteen.RecentCount > 0:
		return fmt.Sprintf("最近来过 %d 次", canteen.RecentCount)
	case canteen.Reason == domain.ReasonSchool:
		return "你所在的学校"
	case canteen.DistanceM != nil:
		return fmt.Sprintf("距你 %d m", *canteen.DistanceM)
	default:
		return ""
	}
}

// distanceMeters is the great-circle distance between two points.
func distanceMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6371000.0
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}

func validCoordinate(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0)
}

// formatPrice writes only what the menu gave; unknown stays empty.
func formatPrice(price, priceMin, priceMax float64, priceType string) string {
	trim := func(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }
	switch {
	case priceType == "range" && priceMin > 0 && priceMax > priceMin:
		return trim(priceMin) + "-" + trim(priceMax) + "元"
	case price > 0:
		return trim(price) + "元"
	case priceMin > 0:
		return trim(priceMin) + "元起"
	default:
		return ""
	}
}

func rankOf(id string, ids []string) *int {
	for index, candidate := range ids {
		if candidate == id {
			value := index
			return &value
		}
	}
	missing := -1
	return &missing
}
