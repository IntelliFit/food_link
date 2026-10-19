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

// IsCanteenVenue is true for a place to eat in (a school, community or company
// canteen) as opposed to an ordinary restaurant. The catalogue stores some canteens
// as placeholder "merchants" such as "AI原点社区食堂（名称待确认）"; they are not
// takeout merchants whatever table they were imported into.
func IsCanteenVenue(candidate DietRecommendationCandidate) bool {
	return candidate.IsCampusFood || strings.TrimSpace(candidate.CanteenName) != "" || canteenMerchantName.MatchString(candidate.MerchantName)
}

// Words that make a "merchant" a canteen; 名称待确认 marks rows imported from the canteen
// directory before the venue was confirmed.
var canteenMerchantName = regexp.MustCompile(`食堂|饭堂|(?:职工|员工|学生|教工|社区)餐厅|名称待确认`)

func MatchesDiningVenue(name string, candidate DietRecommendationCandidate) bool {
	school, _ := DiningVenueParts(name)
	if school != "" && strings.Join(strings.Fields(candidate.SchoolName), "") != school {
		return false
	}
	key := DiningVenueKey(name)
	return key != "" && (strings.Contains(DiningVenueKey(candidate.CanteenName), key) ||
		strings.Contains(DiningVenueKey(candidate.MerchantName), key))
}
