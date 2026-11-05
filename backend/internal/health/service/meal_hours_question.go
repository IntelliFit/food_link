package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"food_link/backend/internal/health/domain"
)

// "这家现在还开着吗" right after a recommendation asks about the venues on the card. The answer
// is in the data (the canteen's collected hours, or that none were collected), so it is given
// at once, free, without a model; the replay of 2026-11-05 sent it through the whole meal
// Agent and failed.

var mealHoursQuestionPattern = regexp.MustCompile(`(?:还)?(?:开着|开门|营业|在营业)(?:吗|没|呢|不)|营业(?:时间|到几点|到什么时候)|几点(?:关门|打烊|开门|下班)|(?:关门|打烊)了(?:吗|没)|现在(?:还)?(?:能去|去得了)(?:吗)?`)

// mealHoursQuestion is a short question about opening hours, not a request for other food.
func mealHoursQuestion(question string) bool {
	compact := mealChatCompact(question)
	return utf8.RuneCountInString(compact) <= 24 && mealHoursQuestionPattern.MatchString(compact) && !campusDietAgentFoodQuestion(question) && !mealRequestsOtherVenue(compact)
}

// petChatHoursReply answers an opening-hours question about the card being talked about.
func (s *StatsService) petChatHoursReply(ctx context.Context, userID string, input PetChatInput) (string, bool) {
	sessionID := strings.TrimSpace(input.SessionID)
	if s == nil || s.repo == nil || len(input.ImageURLs) > 0 || sessionID == "" || input.NewSession || !mealHoursQuestion(normalizePetChatQuestion(input.Question)) {
		return "", false
	}
	history, err := s.repo.GetPetChatSessionMessages(ctx, userID, sessionID, 16)
	if err != nil {
		return "", false
	}
	active, _ := activeCampusDietRecommendation(history)
	if active == nil || len(active.Recommendations) == 0 {
		return "", false
	}
	now := mealClock().In(chinaTZ)
	return mealHoursAnswer(now.Hour()*60+now.Minute(), active.Recommendations), true
}

// mealHoursAnswer says, venue by venue, what is known about the hours and whether that means
// open now. Canteens without collected hours are judged by ordinary campus meal times.
func mealHoursAnswer(minute int, options []DietRecommendationOption) string {
	lines, seen := []string{}, map[string]bool{}
	anyClosed := false
	for _, o := range options {
		venue := strings.TrimSpace(strings.Join(compactDietStrings(o.SchoolName, mealCleanVenueName(defaultIfEmpty(o.CanteenName, o.MerchantName))), ""))
		if venue == "" || seen[venue] {
			continue
		}
		seen[venue] = true
		candidate := DietRecommendationCandidate{IsCampusFood: o.IsCampusFood, CanteenName: o.CanteenName, MerchantName: o.MerchantName}
		if !domain.IsCanteenVenue(candidate) {
			lines = append(lines, venue+"没有收录营业时间，去之前在地图或外卖平台上看一下是否营业")
			continue
		}
		windows, source := domain.ParseOpeningHours(o.OpeningHours), "按收录的营业时间"
		if len(windows) == 0 {
			windows, source = mealDefaultCanteenHours, "没有收录营业时间，按一般食堂饭点"
		}
		open := mealOpenMinutes(windows, "", minute, minute+1) > 0
		anyClosed = anyClosed || !open
		state := "现在不在供餐时间"
		if open {
			state = "现在在供餐时间内"
		}
		lines = append(lines, fmt.Sprintf("%s%s（%s），%s", venue, source, mealFormatWindows(windows), state))
		if len(lines) == 3 {
			break
		}
	}
	if len(lines) == 0 {
		return "这几份推荐没有可核对的营业时间，去之前先确认一下是否营业。"
	}
	answer := strings.Join(lines, "；") + "。"
	if anyClosed {
		answer += "想换成现在开着的，直接告诉我。"
	}
	return answer
}

func mealFormatWindows(windows []domain.OpeningWindow) string {
	labels := map[string]string{"breakfast": "早", "lunch": "午", "dinner": "晚", "evening_snack": "夜宵"}
	clock := func(m int) string { return fmt.Sprintf("%d:%02d", (m/60)%24, m%60) }
	parts := []string{}
	for _, w := range windows {
		parts = append(parts, labels[w.Meal]+clock(w.Start)+"–"+clock(w.End))
	}
	return strings.Join(parts, "、")
}
