package domain

import (
	"fmt"
	"regexp"
	"time"
	_ "time/tzdata"
)

const ChannelID = "foodlink-reminders"

type Preferences struct {
	Enabled       bool   `json:"enabled"`
	MealEnabled   bool   `json:"meal_enabled"`
	LogEnabled    bool   `json:"log_enabled"`
	ExpiryEnabled bool   `json:"expiry_enabled"`
	BreakfastTime string `json:"breakfast_time"`
	LunchTime     string `json:"lunch_time"`
	DinnerTime    string `json:"dinner_time"`
	LogTime       string `json:"log_time"`
	ExpiryTime    string `json:"expiry_time"`
	Timezone      string `json:"timezone"`
	QuietStart    string `json:"quiet_start"`
	QuietEnd      string `json:"quiet_end"`
}

func DefaultPreferences() Preferences {
	return Preferences{MealEnabled: true, ExpiryEnabled: true, BreakfastTime: "08:00", LunchTime: "12:00", DinnerTime: "18:30", LogTime: "21:00", ExpiryTime: "09:00", Timezone: "Asia/Shanghai", QuietStart: "22:00", QuietEnd: "07:00"}
}

var clockPattern = regexp.MustCompile(`^(?:[01][0-9]|2[0-3]):[0-5][0-9]$`)

func (p Preferences) Validate() error {
	for _, value := range []string{p.BreakfastTime, p.LunchTime, p.DinnerTime, p.LogTime, p.ExpiryTime, p.QuietStart, p.QuietEnd} {
		if !clockPattern.MatchString(value) {
			return fmt.Errorf("时间请使用 HH:mm 格式")
		}
	}
	if p.QuietStart == p.QuietEnd {
		return fmt.Errorf("免打扰开始与结束时间不能相同")
	}
	if len(p.Timezone) > 80 {
		return fmt.Errorf("时区无效")
	}
	if _, err := time.LoadLocation(p.Timezone); err != nil {
		return fmt.Errorf("时区无效")
	}
	for _, clock := range []string{p.BreakfastTime, p.LunchTime, p.DinnerTime, p.LogTime, p.ExpiryTime} {
		if p.IsQuiet(clock) {
			return fmt.Errorf("提醒时间不能位于免打扰时段")
		}
	}
	return nil
}

func (p Preferences) IsQuiet(clock string) bool {
	if p.QuietStart < p.QuietEnd {
		return clock >= p.QuietStart && clock < p.QuietEnd
	}
	return clock >= p.QuietStart || clock < p.QuietEnd
}

type Occurrence struct {
	Kind     string
	MealType string
	Date     string
	Due      time.Time
	Expires  time.Time
}

// Only a ten-minute catch-up window; never replay yesterday's meals after downtime.
func (p Preferences) Due(now time.Time) []Occurrence {
	if !p.Enabled || p.Validate() != nil {
		return nil
	}
	loc, _ := time.LoadLocation(p.Timezone)
	local := now.In(loc)
	if p.IsQuiet(local.Format("15:04")) {
		return nil
	}
	slots := []struct {
		kind, meal, clock string
		enabled           bool
	}{
		{"meal", "breakfast", p.BreakfastTime, p.MealEnabled},
		{"meal", "lunch", p.LunchTime, p.MealEnabled},
		{"meal", "dinner", p.DinnerTime, p.MealEnabled},
		{"log", "", p.LogTime, p.LogEnabled},
		{"expiry", "", p.ExpiryTime, p.ExpiryEnabled},
	}
	var out []Occurrence
	for _, slot := range slots {
		if !slot.enabled {
			continue
		}
		due, _ := time.ParseInLocation("2006-01-02 15:04", local.Format("2006-01-02")+" "+slot.clock, loc)
		if now.Before(due) || now.Sub(due) >= 10*time.Minute {
			continue
		}
		out = append(out, Occurrence{Kind: slot.kind, MealType: slot.meal, Date: local.Format("2006-01-02"), Due: due, Expires: due.Add(30 * time.Minute)})
	}
	return out
}

type Message struct {
	To         string         `json:"to"`
	Title      string         `json:"title"`
	Body       string         `json:"body"`
	Sound      string         `json:"sound"`
	Priority   string         `json:"priority"`
	ChannelID  string         `json:"channelId"`
	TTL        int            `json:"ttl"`
	Tag        string         `json:"tag"`
	CollapseID string         `json:"collapseId"`
	Data       map[string]any `json:"data"`
}

// Lock-screen copy deliberately excludes health metrics, private food names and AI billing.
func BuildMessage(token, userID string, o Occurrence, ttl int) Message {
	title, body, route := "记下今天的饮食", "方便时记录一下今天吃了什么，给自己留一份饮食参考。", "DayRecord"
	if o.Kind == "meal" {
		name := map[string]string{"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐"}[o.MealType]
		title, body, route = name+"时间，看看吃什么", "按自己的作息安排用餐。打开查看真实餐食建议，再选适合自己的搭配。", "MealSuggestions"
	} else if o.Kind == "expiry" {
		title, body, route = "检查一下食物保质期", "有尚未处理的食物临近标注日期。请核对标签和保存状况；变质或过期食物不要食用。", "Expiry"
	}
	tag := o.Kind + "-" + o.MealType + "-" + o.Date
	return Message{To: token, Title: title, Body: body, Sound: "default", Priority: "normal", ChannelID: ChannelID, TTL: ttl, Tag: tag, CollapseID: tag, Data: map[string]any{"source": "foodlink-reminder", "route": route, "user_id": userID, "date": o.Date, "meal_type": o.MealType}}
}
