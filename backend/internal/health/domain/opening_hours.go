package domain

import (
	"regexp"
	"strconv"
	"strings"
)

// OpeningWindow is one service period of a canteen. Minutes count from midnight; a period
// that runs past midnight ends above 1440. Meal is breakfast, lunch, dinner, evening_snack,
// or "" when the listing names no meal.
type OpeningWindow struct {
	Meal  string `json:"meal,omitempty"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

var (
	openingHoursRange = regexp.MustCompile(`(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:-{1,2}|－|—|–|~|～|〜|至|到)\s*(?:次日)?\s*(\d{1,2})\s*[:：]\s*(\d{2})`)
	// A stall's own hours in brackets ("（小火锅：11:00-22:00）") do not open the whole canteen.
	openingHoursAside = regexp.MustCompile(`[（(][^）)]*[）)]`)
	// Holiday, temporary or unverified schedules say nothing about an ordinary day.
	openingHoursUntrusted = regexp.MustCompile(`寒假|暑假|暑期|假期|放假|值守|停业|停餐|关停|待复核|待核`)
	openingHoursMealWord  = regexp.MustCompile(`夜宵|宵夜|夜餐|早餐|早饭|早点|午餐|中餐|午饭|中午|晚餐|晚饭|下午|早|午|中|晚`)
)

// ParseOpeningHours reads the time ranges of a collected opening-hours text such as
// "早6:30-10:30|午10:30-13:00|晚16:30-19:00|夜宵19:00-22:00". It returns nothing for text
// without times or with only a holiday, temporary or unverified schedule, so the caller
// falls back to its own default instead of trusting it.
func ParseOpeningHours(raw string) []OpeningWindow {
	text := strings.TrimSpace(raw)
	if text == "" || openingHoursUntrusted.MatchString(text) {
		return nil
	}
	if main := openingHoursAside.ReplaceAllString(text, " "); openingHoursRange.MatchString(main) {
		text = main
	}
	windows := []OpeningWindow{}
	previous := 0
	for _, m := range openingHoursRange.FindAllStringSubmatchIndex(text, -1) {
		label := text[previous:m[0]]
		previous = m[1]
		start, okStart := openingHoursMinute(text[m[2]:m[3]], text[m[4]:m[5]])
		end, okEnd := openingHoursMinute(text[m[6]:m[7]], text[m[8]:m[9]])
		if !okStart || !okEnd || start == end {
			continue
		}
		if end < start {
			end += 24 * 60
		}
		meal := ""
		if words := openingHoursMealWord.FindAllString(label, -1); len(words) > 0 {
			meal = openingHoursMeal(words[len(words)-1])
		}
		windows = append(windows, OpeningWindow{Meal: meal, Start: start, End: end})
	}
	return windows
}

func openingHoursMinute(hour, minute string) (int, bool) {
	h, errH := strconv.Atoi(hour)
	m, errM := strconv.Atoi(minute)
	if errH != nil || errM != nil || h > 24 || m > 59 || h == 24 && m > 0 {
		return 0, false
	}
	return h*60 + m, true
}

func openingHoursMeal(word string) string {
	switch word {
	case "夜宵", "宵夜", "夜餐":
		return "evening_snack"
	case "早餐", "早饭", "早点", "早":
		return "breakfast"
	case "午餐", "中餐", "午饭", "中午", "午", "中":
		return "lunch"
	}
	return "dinner"
}

// NormalizeMealPeriods maps the collected meal-period labels, English or Chinese, onto
// breakfast, lunch, dinner and evening_snack, in that order, and drops "unknown" and
// anything else.
func NormalizeMealPeriods(labels []string) []string {
	found := map[string]bool{}
	for _, label := range labels {
		switch strings.ToLower(strings.TrimSpace(label)) {
		case "breakfast", "早餐", "早饭", "早点":
			found["breakfast"] = true
		case "lunch", "午餐", "中餐", "午饭":
			found["lunch"] = true
		case "dinner", "晚餐", "晚饭":
			found["dinner"] = true
		case "evening_snack", "night_snack", "late_night", "夜宵", "宵夜", "夜餐":
			found["evening_snack"] = true
		}
	}
	out := []string{}
	for _, period := range []string{"breakfast", "lunch", "dinner", "evening_snack"} {
		if found[period] {
			out = append(out, period)
		}
	}
	return out
}
