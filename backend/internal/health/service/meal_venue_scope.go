package service

import (
	"regexp"
	"slices"
	"strings"

	"food_link/backend/internal/health/domain"
)

var mealVenueRequest = regexp.MustCompile(`(?:只(?:给我|帮我)?(?:推荐|看|要|去|在|吃)|仅(?:推荐|看|限)|(?:已经)?(?:决定|准备|打算|想)去|就在|就去|换到|指定|锁定)([^，。；！？,;!?]{2,32}?(?:社区(?:食堂)?|食堂|餐厅|园))`)
var mealNamedDestination = regexp.MustCompile(`(?:决定|准备|打算)去([^，。；！？,;!?]{2,24}?)(?:吃(?:饭)?|用餐|就餐)`)
var mealCurrentVenue = regexp.MustCompile(`(?:(?:我|本人)(?:现在|目前|今天|已经|此刻)?在|(?:现在|目前|今天)在|我?(?:已经)?(?:来到|到了|到达))([^，。；！？,;!?]{2,32}?(?:社区(?:食堂)?|食堂|餐厅|园))`)
var mealOtherVenue = regexp.MustCompile(`(?:推荐|看看|换(?:个|一个|家|一家|到)?|想去|去|找)(?:一下|给我)?(?:其他|别的|另一个|另一家)(?:的)?(?:食堂|餐厅|地方)|换(?:个|一个|家|一家)(?:食堂|餐厅)`)

func mealRequestsOtherVenue(question string) bool {
	q := strings.Join(strings.Fields(question), "")
	if regexp.MustCompile(`^(?:那|还有)?(?:其他|别的)(?:的)?(?:食堂|餐厅)(?:呢|怎么样|有没有|有什么|吗)?[？?。！!]*$`).MatchString(q) {
		return true
	}
	for _, match := range mealOtherVenue.FindAllStringIndex(q, -1) {
		prefix := q[:match[0]]
		if !regexp.MustCompile(`(?:不要|别|不用|不想|不需要|不是)(?:再|给我|帮我|让你|叫你|要你|你)?$`).MatchString(prefix) {
			return true
		}
	}
	return false
}

// Only selection/destination wording locks a venue; merely mentioning where
// someone lives or asking about a venue must not start the meal agent.
func mealExplicitVenue(question string) string {
	q := strings.Join(strings.Fields(question), "")
	name, latest := "", -1
	for _, pattern := range []*regexp.Regexp{mealVenueRequest, mealNamedDestination, mealCurrentVenue} {
		for _, match := range pattern.FindAllStringSubmatchIndex(q, -1) {
			value := q[match[2]:match[3]]
			if match[0] < latest || regexp.MustCompile(`附近|周边|公里|范围|哪个|什么|所有|其他|别的|不要|不去|不吃|这里|那里|这儿|那儿|这个|那个|同一个|同一`).MatchString(value) {
				continue
			}
			if regexp.MustCompile(`(?:不|没|没有|不要|别|不用|不想|不需要)(?:再|给我|帮我)?$`).MatchString(q[:match[0]]) {
				continue
			}
			key := domain.DiningVenueKey(value)
			if key == "食堂" || key == "餐厅" || key == "社区" || key == "" {
				continue
			}
			name, latest = value, match[0]
		}
	}
	return name
}

func applyMealVenueConstraints(c *CampusDietRecommendationConstraints, question string) {
	if mealRequestsOtherVenue(question) {
		if c.CanteenName != "" && !slices.Contains(c.ExcludedCanteens, c.CanteenName) {
			c.ExcludedCanteens = append(c.ExcludedCanteens, c.CanteenName)
		}
		c.CanteenName = ""
	} else if mealCanteenRelease.MatchString(question) {
		c.CanteenName, c.ExcludedCanteens = "", nil
	}
	if venue := mealExplicitVenue(question); venue != "" {
		c.CanteenName = venue
		c.ExcludedCanteens = slices.DeleteFunc(c.ExcludedCanteens, func(old string) bool {
			return domain.DiningVenueKey(old) == domain.DiningVenueKey(venue)
		})
		if school, _ := domain.DiningVenueParts(venue); school != "" {
			c.Scene = "campus"
		} else if strings.Contains(venue, "社区") {
			c.Scene = "any"
		}
	}
}

// User topic continuity survives a legacy plain-text assistant response. A
// genuine user topic switch still ends it; assistant prose is never a menu.
func mealConversationContinues(messages []domain.PetChatMessage) bool {
	active := false
	for _, message := range messages {
		if normalizePetChatRole(message.Role) != "user" {
			continue
		}
		q := message.Content
		active = !campusDietAgentExplicitTopicSwitch(q) && (campusDietAgentFoodQuestion(q) || mealHistoryQuestion(q) || active && campusDietAgentContextualQuestion(q))
	}
	return active
}

func mealMatchesVenue(state *campusDietAgentRunState, candidate DietRecommendationCandidate) bool {
	for _, excluded := range state.Constraints.ExcludedCanteens {
		if domain.MatchesDiningVenue(excluded, candidate) {
			return false
		}
	}
	if state.Constraints.CanteenName == "" {
		return true
	}
	// An intake record does not establish that the meal is sold at this venue.
	return candidate.Source != "food_record" && domain.MatchesDiningVenue(state.Constraints.CanteenName, candidate)
}
