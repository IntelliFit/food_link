package domain

import "time"

const (
	PrivateMessageEvent    = "private_message"
	AnalysisCompletedEvent = "analysis_completed"
	EventProtocolVersion   = 2
	EventLifetime          = 24 * time.Hour
)

// Event contains routing metadata only; never copy message bodies or health data.
type Event struct {
	ID         string
	ActorID    string
	OccurredAt time.Time
}

func IsEvent(kind string) bool {
	return kind == PrivateMessageEvent || kind == AnalysisCompletedEvent
}

func enabled(value *bool) bool { return value != nil && *value }

func (p Preferences) EventEnabled(kind string) bool {
	if !p.Enabled {
		return false
	}
	switch kind {
	case PrivateMessageEvent:
		return enabled(p.PrivateMessageEnabled)
	case AnalysisCompletedEvent:
		return enabled(p.AnalysisCompletedEnabled)
	}
	return false
}

// Preserve fields omitted by old clients and ignore client-supplied activation times.
func (p *Preferences) MergeEventPreferences(old Preferences, now time.Time) {
	if p.PrivateMessageEnabled == nil {
		p.PrivateMessageEnabled = old.PrivateMessageEnabled
	}
	if p.AnalysisCompletedEnabled == nil {
		p.AnalysisCompletedEnabled = old.AnalysisCompletedEnabled
	}
	p.EventSince = make(map[string]time.Time)
	for _, kind := range []string{PrivateMessageEvent, AnalysisCompletedEvent} {
		if !p.EventEnabled(kind) {
			continue
		}
		since := old.EventSince[kind]
		if !old.EventEnabled(kind) || since.IsZero() {
			since = now
		}
		p.EventSince[kind] = since
	}
}

// Quiet hours defer event notifications, but never extend their 24-hour lifetime.
func (p Preferences) NextEventTime(now time.Time) time.Time {
	loc, err := time.LoadLocation(p.Timezone)
	if err != nil {
		return now.Add(EventLifetime)
	}
	for next := now; next.Before(now.Add(EventLifetime)); next = next.Add(time.Minute) {
		if !p.IsQuiet(next.In(loc).Format("15:04")) {
			return next
		}
	}
	return now.Add(EventLifetime)
}

func BuildEventMessage(token, owner, kind string, event Event, ttl int) Message {
	data := map[string]any{"source": "foodlink-reminder", "user_id": owner, "kind": kind, "event_id": event.ID}
	title, body := "食探分析已完成", "你提交的分析已完成，点击查看分析历史。"
	data["route"] = "AnalyzeHistory"
	if kind == PrivateMessageEvent {
		title, body = "食探新私信", "你有一条未读私信，点击查看。"
		data["route"], data["sender_id"] = "PrivateChat", event.ActorID
	}
	return Message{To: token, Title: title, Body: body, Sound: "default", Priority: "high", ChannelID: ChannelID,
		TTL: ttl, Tag: kind + ":" + event.ID, CollapseID: kind + ":" + event.ID, Data: data}
}
