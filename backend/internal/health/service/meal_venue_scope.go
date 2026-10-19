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
var mealOtherVenue = regexp.MustCompile(`(?:推荐|看看|换(?:个|一个|家|一家|到)?|想去|去|找|给我)(?:一下|给我)?(?:其他|别的|另一个|另一家)(?:的)?(?:食堂|餐厅|地方|商家|店|餐馆)|换(?:个|一个|家|一家)(?:食堂|餐厅|商家|店|餐馆)|换(?:个|一个|家|一家)?(?:商家|餐馆)`)

// A venue the user rejects by name: "X不是外卖", "别再推荐X", "你还在推荐X".
var mealVenueNamePattern = `([^，。；！？,;!?]{2,24}?(?:社区食堂|食堂|社区|餐厅|园|店|商家))`
var mealVenueNotTakeout = regexp.MustCompile(mealVenueNamePattern + `(?:这个(?:食堂|商家|店)?)?(?:不是|不算|不属于|并不是|根本不是)(?:外卖|商家|餐馆)`)
var mealVenueRejected = regexp.MustCompile(`(?:不要|别|不想要|不想吃|不用|不去|不吃|拒绝)(?:再|给我|帮我)?(?:一直|继续|总是)?(?:推荐|给我推荐|来|选|要)?` + mealVenueNamePattern)

// Only complaint wording counts: "还是推荐X吧" / "一直推荐X就行" ask to keep X.
var mealVenueStillRecommended = regexp.MustCompile(`(?:还在|又在|老是|总是|怎么还|怎么又)(?:继续)?(?:给我)?(?:推荐|推)(?:这个|这家|那个)?` + mealVenueNamePattern)
var mealVenueNotAName = regexp.MustCompile(`附近|周边|公里|范围|哪个|什么|所有|其他|别的|这里|那里|这儿|那儿|这个|那个|这家|那家|同一|只|仅|推荐|啊|呀|吧|呢|吗|了|的`)

// The clause before a venue name ("我都说了", "你推荐的") is not part of it.
var mealVenueLeadIn = regexp.MustCompile(`^.*(?:说了|说过|讲了|讲过|告诉你|强调过?|推荐的|的|了|这个|那个|这家|那家)`)

// What follows the name can turn it around: "桃李园以外的" keeps X out of the rejection,
// "X吧" / "X就行" asks for X, "X不是外卖吗" is a question.
var mealVenueNotRejectedAfter = regexp.MustCompile(`^(?:以外|之外|外的|吧|就行|就好|也行|也可以|吗|么|嘛|[？?])`)

// mealRejectedVenues names the venues the user turned down in this message. The
// specific wording matters: "不要只推荐X" means do not offer ONLY X, and
// "不要推荐其他食堂" asks to stay, so neither rejects a venue.
func mealRejectedVenues(question string) []string {
	q := strings.Join(strings.Fields(question), "")
	var venues []string
	for _, pattern := range []*regexp.Regexp{mealVenueNotTakeout, mealVenueRejected, mealVenueStillRecommended} {
		for _, match := range pattern.FindAllStringSubmatchIndex(q, -1) {
			if mealVenueNotRejectedAfter.MatchString(q[match[1]:]) {
				continue
			}
			name := mealVenueLeadIn.ReplaceAllString(q[match[2]:match[3]], "")
			key := domain.DiningVenueKey(name)
			if mealVenueNotAName.MatchString(name) || key == "" || slices.Contains([]string{"", "食堂", "餐厅", "社区", "商家", "店", "园", "学校", "校园", "校内", "大学", "学院", "公司", "企业"}, key) {
				continue
			}
			duplicate := false
			for _, seen := range venues {
				duplicate = duplicate || domain.DiningVenueKey(seen) == key
			}
			if !duplicate {
				venues = append(venues, name)
			}
		}
	}
	return venues
}

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

// mealAsksForTakeout is an explicit request for delivery, not merely saying what is not takeout.
func mealAsksForTakeout(question string) bool {
	return strings.Contains(question, "外卖") && !regexp.MustCompile(`(?:不要|不点|不吃|不是|不算|不想要?)外卖`).MatchString(question)
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
	for _, rejected := range mealRejectedVenues(question) {
		if !slices.ContainsFunc(c.ExcludedCanteens, func(old string) bool {
			return domain.DiningVenueKey(old) == domain.DiningVenueKey(rejected)
		}) {
			c.ExcludedCanteens = append(c.ExcludedCanteens, rejected)
		}
		if c.CanteenName != "" && domain.DiningVenueKey(c.CanteenName) == domain.DiningVenueKey(rejected) {
			c.CanteenName = ""
		}
	}
	// With an explicit takeout request a place the user names is where they are, not
	// where they want to eat: "我在AI原点社区，想点外卖" asks for delivery there.
	if mealAsksForTakeout(question) {
		c.CanteenName = ""
		return
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
		if normalizePetChatRole(message.Role) != "user" || petChatFreeAcknowledgementMessage(message) {
			continue
		}
		q := message.Content
		active = mealTurnByAgent(message) || !campusDietAgentExplicitTopicSwitch(q) && (campusDietAgentFoodQuestion(q) || mealHistoryQuestion(q) || active && campusDietAgentContextualQuestion(q))
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
