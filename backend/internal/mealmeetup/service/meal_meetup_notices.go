package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"food_link/backend/internal/mealmeetup/repo"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
)

// Values of extra_data.kind on meal meetup inbox messages. The room marks its own kinds read when opened.
const (
	noticeRoomMessage = "room_message"
	noticeStartSoon   = "start_soon"
	noticeCloseSoon   = "close_soon"
	noticeApplyWait   = "apply_waiting"
)

const (
	// roomNoticeWindow bounds inbox noise: one "new message" notice per member, per meetup, per window.
	roomNoticeWindow = 10 * time.Minute
	reminderInterval = time.Minute
	reminderBatch    = 500
	// applyWaitAfter is how long an application may sit unanswered before the host is nudged.
	applyWaitAfter = 30 * time.Minute
)

func clip(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max]) + "…"
}

func uuidKey(parts ...any) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprint(parts...))).String()
}

// deliver writes one inbox message per recipient in the caller's transaction. keyFor makes ids deterministic,
// so a retried request or a repeated reminder pass never duplicates a message.
func (s *Service) deliver(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, keyFor func(userID string) string, recipients []string, content, action, page, kind string) error {
	if s.messages == nil {
		return fmt.Errorf("约饭系统消息服务未配置")
	}
	path := "/packageMeal/pages/detail/index?id=" + row.ID
	if page == "room" {
		path = "/packageMeal/pages/room/index?id=" + row.ID
	}
	seen := map[string]bool{}
	for _, id := range recipients {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		extra := map[string]any{"target": "meal-meetup", "meetup_id": row.ID, "path": path, "page": page}
		if kind != "" {
			extra["kind"] = kind
		}
		if err := s.messages.SendSystemMessageWithActionInTransaction(ctx, tx.DB(), keyFor(id), id, content, action, extra); err != nil {
			return err
		}
	}
	return nil
}

func without(ids []string, excluded string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != excluded {
			out = append(out, id)
		}
	}
	return out
}

// notifyRoomMessage tells the other members that someone spoke. Notices are collapsed per time window so a
// busy room shows one inbox entry instead of one per message.
func (s *Service) notifyRoomMessage(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, senderID, text string, now time.Time) error {
	recipients := without(acceptedIDs(row, ps), senderID)
	if len(recipients) == 0 {
		return nil
	}
	name := "饭搭子"
	if profiles, err := tx.Profiles(ctx, []string{senderID}); err != nil {
		return err
	} else if nick := profiles[senderID].Nickname; nick != "" {
		name = nick
	}
	bucket := now.Unix() / int64(roomNoticeWindow/time.Second)
	content := fmt.Sprintf("「%s」房间有新消息：%s：%s", clip(row.Title, 12), clip(name, 8), clip(text, 24))
	return s.deliver(ctx, tx, row, func(id string) string {
		return uuidKey("meal-room-message:", row.ID, ":", id, ":", bucket)
	}, recipients, content, "进入房间", "room", noticeRoomMessage)
}

func (s *Service) zone(row *migrationdo.MealMeetupDO) *time.Location {
	if zone, err := time.LoadLocation(row.Timezone); err == nil {
		return zone
	}
	return time.FixedZone("CST", 8*3600)
}

// SendDueReminders posts the pre-meal and room-closing reminders that are due. It is safe to call from several
// processes and as often as needed: ids are deterministic, so every reminder is delivered at most once.
func (s *Service) SendDueReminders(ctx context.Context) error {
	now := s.now()
	type window struct {
		stage    string
		starts   bool
		from, to time.Duration
	}
	// Windows are wider than the polling interval so a short outage does not skip a reminder.
	for _, w := range []window{
		{"start60", true, 45 * time.Minute, 60 * time.Minute},
		{"start15", true, 5 * time.Minute, 15 * time.Minute},
		{"close15", false, 0, 15 * time.Minute},
	} {
		var rows []migrationdo.MealMeetupDO
		var err error
		if w.starts {
			rows, err = s.repo.ActiveStartingBetween(ctx, now.Add(w.from), now.Add(w.to), reminderBatch)
		} else {
			rows, err = s.repo.ActiveEndingBetween(ctx, now.Add(w.from), now.Add(w.to), reminderBatch)
		}
		if err != nil {
			return err
		}
		for i := range rows {
			if err := s.remind(ctx, &rows[i], w.stage); err != nil {
				logger.Error(ctx, "约饭提醒发送失败", err, slog.String("meetup_id", rows[i].ID), slog.String("stage", w.stage))
			}
		}
	}
	// Applications the host has not answered: still joinable meetups with a pending request older than applyWaitAfter.
	waiting, err := s.repo.ActiveWithWaitingApplication(ctx, now.Add(-joinGrace), now.Add(-applyWaitAfter), reminderBatch)
	if err != nil {
		return err
	}
	for i := range waiting {
		if err := s.remindApplyWaiting(ctx, &waiting[i]); err != nil {
			logger.Error(ctx, "约饭申请提醒发送失败", err, slog.String("meetup_id", waiting[i].ID))
		}
	}
	return nil
}

// remindApplyWaiting nudges the host about the longest-waiting application. Each application is nudged at most
// once (the key holds its revision), so a host with several requests gets them one at a time rather than in a burst.
func (s *Service) remindApplyWaiting(ctx context.Context, meetup *migrationdo.MealMeetupDO) error {
	return s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		now := s.now()
		row, err := tx.Get(ctx, meetup.ID, false)
		if err != nil {
			return err
		}
		if row.Status != "active" || !now.Before(joinCutoff(row)) {
			return nil
		}
		ps, err := tx.Participants(ctx, row.ID)
		if err != nil {
			return err
		}
		if len(acceptedIDs(row, ps)) >= row.Capacity {
			return nil // full: there is no seat left to approve
		}
		var oldest *migrationdo.MealMeetupParticipantDO
		waiting := 0
		for i := range ps {
			if ps[i].Status != "pending" {
				continue
			}
			waiting++
			if ps[i].UpdatedAt.After(now.Add(-applyWaitAfter)) {
				continue
			}
			if oldest == nil || ps[i].UpdatedAt.Before(oldest.UpdatedAt) {
				oldest = &ps[i]
			}
		}
		if oldest == nil {
			return nil
		}
		content := fmt.Sprintf("「%s」有 %d 位饭搭子在等你确认申请，早点回复更容易成局。", clip(row.Title, 12), waiting)
		return s.deliver(ctx, tx, row, func(id string) string {
			return uuidKey("meal-remind:apply-waiting:", row.ID, ":", oldest.UserID, ":", oldest.Revision, ":", id)
		}, []string{row.HostUserID}, content, "去处理", "detail", noticeApplyWait)
	})
}

func (s *Service) remind(ctx context.Context, meetup *migrationdo.MealMeetupDO, stage string) error {
	return s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		row, err := tx.Get(ctx, meetup.ID, false)
		if err != nil {
			return err
		}
		ps, err := tx.Participants(ctx, row.ID)
		if err != nil {
			return err
		}
		members := acceptedIDs(row, ps)
		if row.Status != "active" || len(members) < 2 {
			return nil // nobody to meet yet, or the meetup was cancelled meanwhile
		}
		zone := s.zone(row)
		title := clip(row.Title, 12)
		switch stage {
		case "start60":
			content := fmt.Sprintf("「%s」将在 %s 开始，地点：%s。", title, row.StartsAt.In(zone).Format("15:04"), clip(row.VenueName, 16))
			return s.deliver(ctx, tx, row, func(id string) string { return uuidKey("meal-remind:", stage, ":", row.ID, ":", id) }, members, content, "查看约饭", "detail", noticeStartSoon)
		case "start15":
			content := fmt.Sprintf("「%s」马上在 %s 开始，地点：%s，别迟到。", title, row.StartsAt.In(zone).Format("15:04"), clip(row.VenueName, 16))
			return s.deliver(ctx, tx, row, func(id string) string { return uuidKey("meal-remind:", stage, ":", row.ID, ":", id) }, members, content, "查看约饭", "detail", noticeStartSoon)
		default: // close15, host only; the closing time is part of the key so an extended room is reminded again
			content := fmt.Sprintf("「%s」的房间将在 %s 关闭，聊得还没完可以在房间里延长。", title, row.EndsAt.In(zone).Format("15:04"))
			return s.deliver(ctx, tx, row, func(id string) string {
				return uuidKey("meal-remind:", stage, ":", row.ID, ":", id, ":", row.EndsAt.Unix())
			}, []string{row.HostUserID}, content, "进入房间", "room", noticeCloseSoon)
		}
	})
}

// RunReminders sends due reminders until ctx is cancelled.
func (s *Service) RunReminders(ctx context.Context) {
	pass := func() {
		passCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if err := s.SendDueReminders(passCtx); err != nil && ctx.Err() == nil {
			logger.Error(passCtx, "约饭提醒巡检失败", err)
		}
	}
	pass()
	ticker := time.NewTicker(reminderInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pass()
		}
	}
}
