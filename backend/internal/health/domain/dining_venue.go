package domain

import "strings"

// DiningVenueKey normalizes a user-supplied venue alias, not a food keyword.
// Both catalog columns and final candidates must use the same comparison.
func DiningVenueKey(value string) string {
	value = strings.ToLower(strings.Join(strings.Fields(value), ""))
	value = strings.TrimSuffix(value, "（名称待确认）")
	for _, suffix := range []string{"食堂", "餐厅"} {
		if strings.HasSuffix(value, suffix) && len([]rune(value)) > len([]rune(suffix))+1 {
			value = strings.TrimSuffix(value, suffix)
			break
		}
	}
	return value
}

func MatchesDiningVenue(name string, candidate DietRecommendationCandidate) bool {
	key := DiningVenueKey(name)
	return key != "" && (strings.Contains(DiningVenueKey(candidate.CanteenName), key) ||
		strings.Contains(DiningVenueKey(candidate.MerchantName), key))
}
