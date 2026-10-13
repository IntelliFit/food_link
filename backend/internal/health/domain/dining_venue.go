package domain

import (
	"regexp"
	"strings"
)

// DiningVenueParts keeps a university qualifier separate from its canteen.
// "清华大学桃李食堂" must match the 桃李园 directory without matching another
// university's identically named venue. This is not a GPS or identity claim.
func DiningVenueParts(value string) (school, venue string) {
	value = strings.Join(strings.Fields(value), "")
	if match := regexp.MustCompile(`^(.+?(?:大学|学院))(.+)$`).FindStringSubmatch(value); len(match) > 2 {
		return match[1], match[2]
	}
	for _, alias := range []struct{ short, full string }{{"清华", "清华大学"}, {"北大", "北京大学"}} {
		if strings.HasPrefix(value, alias.short) && value != alias.short {
			return alias.full, strings.TrimPrefix(value, alias.short)
		}
	}
	return "", value
}

// DiningVenueKey normalizes a user-supplied venue alias, not a food keyword.
// Both catalog columns and final candidates must use the same comparison.
func DiningVenueKey(value string) string {
	_, value = DiningVenueParts(value)
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
	school, _ := DiningVenueParts(name)
	if school != "" && strings.Join(strings.Fields(candidate.SchoolName), "") != school {
		return false
	}
	key := DiningVenueKey(name)
	return key != "" && (strings.Contains(DiningVenueKey(candidate.CanteenName), key) ||
		strings.Contains(DiningVenueKey(candidate.MerchantName), key))
}
