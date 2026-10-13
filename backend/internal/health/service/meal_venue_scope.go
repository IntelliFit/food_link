package service

import (
	"regexp"
	"strings"

	"food_link/backend/internal/health/domain"
)

var mealVenueRequest = regexp.MustCompile(`(?:只(?:给我|帮我)?(?:推荐|看|要|去|在|吃)|仅(?:推荐|看|限)|(?:已经)?(?:决定|准备|打算|想)去|就在|就去|换到|指定)([^，。；！？,;!?]{2,32}?(?:社区(?:食堂)?|食堂|餐厅|园))`)
var mealNamedDestination = regexp.MustCompile(`(?:决定|准备|打算)去([^，。；！？,;!?]{2,24}?)(?:吃(?:饭)?|用餐|就餐)`)

// Only selection/destination wording locks a venue; merely mentioning where
// someone lives or asking about a venue must not start the meal agent.
func mealExplicitVenue(question string) string {
	q := strings.Join(strings.Fields(question), "")
	matches := mealVenueRequest.FindAllStringSubmatch(q, -1)
	if len(matches) == 0 {
		matches = mealNamedDestination.FindAllStringSubmatch(q, -1)
		if len(matches) == 0 {
			return ""
		}
	}
	name := matches[len(matches)-1][1]
	if regexp.MustCompile(`附近|周边|公里|范围|哪个|什么|所有|其他|别的|不要|不去|不吃|这里|那里|这儿|那儿`).MatchString(name) {
		return ""
	}
	return name
}

func mealMatchesVenue(state *campusDietAgentRunState, candidate DietRecommendationCandidate) bool {
	if state.Constraints.CanteenName == "" {
		return true
	}
	// An intake record does not establish that the meal is sold at this venue.
	return candidate.Source != "food_record" && domain.MatchesDiningVenue(state.Constraints.CanteenName, candidate)
}
