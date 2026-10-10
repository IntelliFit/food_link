package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/internal/mealmeetup/domain"
	"food_link/backend/internal/mealmeetup/repo"
	messageservice "food_link/backend/internal/message/service"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
)

type ContentChecker interface {
	CheckPublication(context.Context, string, int, map[string]any, *storage.Client) error
}
type Service struct {
	repo     *repo.Repo
	checker  ContentChecker
	messages *messageservice.MessageService
	storage  *storage.Client
	now      func() time.Time
}

func New(r *repo.Repo, checker ContentChecker, messages *messageservice.MessageService, store *storage.Client) *Service {
	return &Service{repo: r, checker: checker, messages: messages, storage: store, now: time.Now}
}
func bad(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}
func conflict(message string) error {
	return &commonerrors.AppError{Code: 10005, Message: message, HTTPStatus: 409}
}
func denied() error {
	return &commonerrors.AppError{Code: 20003, Message: "暂时无法访问这场约饭", HTTPStatus: 403}
}
func validKey(key string) bool { _, err := uuid.Parse(key); return err == nil }
func validCoordinates(lat, lng *float64) bool {
	if lat == nil && lng == nil {
		return true
	}
	return lat != nil && lng != nil && !math.IsNaN(*lat) && !math.IsNaN(*lng) && !math.IsInf(*lat, 0) && !math.IsInf(*lng, 0) && *lat >= -90 && *lat <= 90 && *lng >= -180 && *lng <= 180
}
func limited(value string, max int) bool { return utf8.RuneCountInString(value) <= max }
func (s *Service) audit(ctx context.Context, userID string, doc map[string]any) error {
	if s.checker == nil {
		return contentsecurity.ErrUnavailable
	}
	if err := s.checker.CheckPublication(ctx, userID, 4, doc, s.storage); err != nil {
		logger.Warn(ctx, "约饭内容审核未通过", slog.String("user_id", userID))
		return err
	}
	return nil
}
func (s *Service) Create(ctx context.Context, userID string, req domain.CreateRequest) (string, error) {
	logger.Info(ctx, "开始发布约饭", slog.String("user_id", userID))
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.VenueName = strings.TrimSpace(req.VenueName)
	req.Address = strings.TrimSpace(req.Address)
	if req.Timezone == "" {
		req.Timezone = "Asia/Shanghai"
	}
	zone, err := time.LoadLocation(req.Timezone)
	if err != nil {
		return "", bad("地点时区无效")
	}
	if !validKey(req.RequestID) || req.Title == "" || !limited(req.Title, 60) || !limited(req.Description, 500) || req.VenueName == "" || !limited(req.VenueName, 120) || req.Address == "" || !limited(req.Address, 240) || !validCoordinates(req.Latitude, req.Longitude) || req.Capacity < 2 || req.Capacity > 4 || req.Budget < 0 || req.Budget > 2000 || (req.Payment != "aa" && req.Payment != "separate") {
		return "", bad("请检查标题、公共地点、预算和2–4人的人数设置")
	}
	raw, _ := json.Marshal(req)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	if old, e := s.repo.ByRequest(ctx, userID, req.RequestID); e == nil {
		if old.RequestHash != hash {
			return "", conflict("发布请求已变更，请重新提交")
		}
		return old.ID, nil
	} else if !repo.IsMissing(e) {
		logger.Error(ctx, "查询约饭发布请求失败", e, slog.String("user_id", userID))
		return "", e
	}
	if !req.StartsAt.After(s.now()) || req.StartsAt.After(s.now().AddDate(0, 0, 30)) {
		return "", bad("请选择未来30天内的约饭时间")
	}
	if err := s.audit(ctx, userID, map[string]any{"title": req.Title, "description": req.Description, "venue_name": req.VenueName, "address": req.Address}); err != nil {
		return "", err
	}
	id := ""
	err = s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		now := s.now()
		if !req.StartsAt.After(now) {
			return conflict("约饭时间已到，请重新选择")
		}
		hour := req.StartsAt.In(zone).Hour()
		meal := "dinner"
		if hour < 11 {
			meal = "breakfast"
		} else if hour < 16 {
			meal = "lunch"
		}
		row := &migrationdo.MealMeetupDO{ID: uuid.NewString(), HostUserID: userID, RequestID: req.RequestID, RequestHash: hash, Title: req.Title, Description: req.Description, VenueName: req.VenueName, Address: req.Address, Latitude: req.Latitude, Longitude: req.Longitude, StartsAt: req.StartsAt, EndsAt: req.StartsAt.Add(90 * time.Minute), Timezone: req.Timezone, MealType: meal, Budget: req.Budget, Payment: req.Payment, Capacity: req.Capacity, Status: "active", CreatedAt: now, UpdatedAt: now}
		created, e := tx.Create(ctx, row)
		if e != nil {
			return e
		}
		if !created {
			old, e := tx.ByRequest(ctx, userID, req.RequestID)
			if e != nil {
				return e
			}
			if old.RequestHash != hash {
				return conflict("发布请求已变更，请重新提交")
			}
			id = old.ID
			return nil
		}
		id = row.ID
		_, e = tx.AddEvent(ctx, id, userID, "created", "约饭已发起", nil, now)
		return e
	})
	if err == nil {
		logger.Info(ctx, "约饭发布完成", slog.String("user_id", userID), slog.String("meetup_id", id))
	} else if _, expected := err.(*commonerrors.AppError); expected {
		logger.Warn(ctx, "约饭发布未完成", slog.String("user_id", userID))
	} else {
		logger.Error(ctx, "约饭发布失败", err, slog.String("user_id", userID))
	}
	return id, err
}
func (s *Service) List(ctx context.Context, userID string, mine bool, q domain.ListQuery) ([]domain.Meetup, error) {
	if mine && userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if q.Limit <= 0 || q.Limit > 30 {
		q.Limit = 20
	}
	if q.Offset < 0 || q.Offset > 3000 {
		return nil, bad("分页范围无效")
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	if !limited(q.Keyword, 100) || q.Budget < 0 || q.Budget > 2000 || !validCoordinates(q.Latitude, q.Longitude) || math.IsNaN(q.RadiusKM) || math.IsInf(q.RadiusKM, 0) || q.RadiusKM < 0 || q.RadiusKM > 100 {
		return nil, bad("筛选条件无效")
	}
	if q.RadiusKM > 0 && (q.Latitude == nil || q.Longitude == nil) {
		return nil, bad("附近筛选需要可靠位置")
	}
	if q.MealType != "" && q.MealType != "breakfast" && q.MealType != "lunch" && q.MealType != "dinner" {
		return nil, bad("餐次无效")
	}
	if q.Timezone == "" {
		q.Timezone = "Asia/Shanghai"
	}
	zone, e := time.LoadLocation(q.Timezone)
	if e != nil {
		return nil, bad("时区无效")
	}
	if q.Date != "" {
		if _, e := time.ParseInLocation("2006-01-02", q.Date, zone); e != nil {
			return nil, bad("日期无效")
		}
	}
	rows, err := s.repo.List(ctx, userID, mine, q, s.now())
	if err != nil {
		logger.Error(ctx, "查询约饭列表失败", err, slog.String("user_id", userID), slog.Bool("mine", mine))
		return nil, err
	}
	out := []domain.Meetup{}
	for i := range rows {
		view, e := s.view(ctx, s.repo, &rows[i], userID, false)
		if e != nil {
			logger.Error(ctx, "读取约饭列表详情失败", e, slog.String("meetup_id", rows[i].ID))
			return nil, e
		}
		out = append(out, *view)
	}
	return out, nil
}
func acceptedIDs(row *migrationdo.MealMeetupDO, participants []migrationdo.MealMeetupParticipantDO) []string {
	ids := []string{row.HostUserID}
	for _, p := range participants {
		if p.Status == "accepted" {
			ids = append(ids, p.UserID)
		}
	}
	return ids
}
func participant(rows []migrationdo.MealMeetupParticipantDO, userID string) *migrationdo.MealMeetupParticipantDO {
	for i := range rows {
		if rows[i].UserID == userID {
			return &rows[i]
		}
	}
	return nil
}
func (s *Service) canInteract(ctx context.Context, tx *repo.Repo, userID string, ids []string) error {
	for _, id := range ids {
		blocked, err := tx.Blocked(ctx, userID, id)
		if err != nil {
			return err
		}
		if blocked {
			return denied()
		}
	}
	return nil
}
func (s *Service) view(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, userID string, detail bool) (*domain.Meetup, error) {
	ps, err := tx.Participants(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	ids := acceptedIDs(row, ps)
	own := participant(ps, userID)
	host := row.HostUserID == userID
	profileIDs := append([]string{}, ids...)
	if detail && host {
		for _, p := range ps {
			if p.Status == "pending" {
				profileIDs = append(profileIDs, p.UserID)
			}
		}
	}
	profiles, err := tx.Profiles(ctx, profileIDs)
	if err != nil {
		return nil, err
	}
	profile := func(id string) domain.Profile {
		p := profiles[id]
		p.UserID = id
		if p.Nickname == "" {
			p.Nickname = "饭搭子"
		}
		if s.storage != nil && p.Avatar != "" {
			key := s.storage.ResolveObjectKey("user-avatars", p.Avatar)
			if key != "" {
				p.Avatar = s.storage.BuildAccessURL("user-avatars", key)
			}
		}
		return p
	}
	status := row.Status
	if status == "active" {
		if !s.now().Before(row.EndsAt) {
			status = "ended"
		} else if !s.now().Before(row.StartsAt) {
			status = "started"
		} else if len(ids) >= row.Capacity {
			status = "full"
		}
	}
	view := &domain.Meetup{ID: row.ID, Host: profile(row.HostUserID), Title: row.Title, Description: row.Description, VenueName: row.VenueName, Address: row.Address, Latitude: row.Latitude, Longitude: row.Longitude, StartsAt: row.StartsAt, EndsAt: row.EndsAt, Timezone: row.Timezone, MealType: row.MealType, Budget: row.Budget, Payment: row.Payment, Capacity: row.Capacity, MemberCount: len(ids), Status: status, IsHost: host, OwnStatus: "none", Members: []domain.Profile{}}
	if own != nil {
		view.OwnStatus = own.Status
		view.OwnRevision = own.Revision
	}
	if host {
		view.OwnStatus = "host"
	}
	member := host || (own != nil && own.Status == "accepted")
	if row.Status == "hidden" && !member {
		return nil, commonerrors.ErrNotFound
	}
	// Detailed membership/applications are only visible to current members/host.
	if detail && member {
		for _, id := range ids {
			view.Members = append(view.Members, profile(id))
		}
	}
	if detail && host {
		for _, p := range ps {
			if p.Status == "pending" {
				view.Applications = append(view.Applications, domain.Participant{Profile: profile(p.UserID), Status: p.Status, Revision: p.Revision, Note: p.Note})
			} else if p.Status == "accepted" {
				view.ManagedMembers = append(view.ManagedMembers, domain.Participant{Profile: profile(p.UserID), Status: p.Status, Revision: p.Revision})
			}
		}
	}
	if member {
		if err := s.canInteract(ctx, tx, userID, ids); err == nil {
			view.CanEnterRoom = true
		} else if _, ok := err.(*commonerrors.AppError); !ok {
			return nil, err
		}
	}
	return view, nil
}
func (s *Service) Detail(ctx context.Context, userID, id string) (*domain.Meetup, error) {
	var view *domain.Meetup
	err := s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		row, err := tx.Get(ctx, id, true)
		if err != nil {
			return err
		}
		ps, err := tx.Participants(ctx, id)
		if err != nil {
			return err
		}
		// Cleanup actions remain available via their dedicated endpoints when blocked.
		if err := s.canInteract(ctx, tx, userID, acceptedIDs(row, ps)); err != nil {
			return err
		}
		view, err = s.view(ctx, tx, row, userID, true)
		return err
	})
	if err != nil && !repo.IsMissing(err) {
		if _, expected := err.(*commonerrors.AppError); expected {
			logger.Warn(ctx, "约饭详情访问未通过", slog.String("user_id", userID), slog.String("meetup_id", id))
		} else {
			logger.Error(ctx, "读取约饭详情失败", err, slog.String("meetup_id", id))
		}
	}
	return view, err
}
func (s *Service) notice(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, event *migrationdo.MealMeetupEventDO, recipients []string, content string) error {
	if s.messages == nil {
		return fmt.Errorf("约饭系统消息服务未配置")
	}
	seen := map[string]bool{}
	for _, id := range recipients {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		key := uuid.NewSHA1(uuid.NameSpaceOID, []byte("meal-meetup:"+event.ID+":"+id)).String()
		if err := s.messages.SendSystemMessageWithActionInTransaction(ctx, tx.DB(), key, id, content, "查看约饭", map[string]any{"target": "meal-meetup", "meetup_id": row.ID, "path": "/packageMeal/pages/detail/index?id=" + row.ID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Apply(ctx context.Context, userID, id string, req domain.ApplyRequest) error {
	req.Note = strings.TrimSpace(req.Note)
	if !validKey(req.RequestID) || !limited(req.Note, 240) {
		return bad("申请留言最多240字")
	}
	if err := s.audit(ctx, userID, map[string]any{"content": req.Note}); err != nil {
		return err
	}
	return s.mutate(ctx, userID, id, "申请", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if old, err := tx.EventByRequest(ctx, id, userID, req.RequestID); err == nil {
			if old.Kind != "application" || old.Content != req.Note {
				return conflict("申请请求已变更，请重新提交")
			}
			return nil
		} else if !repo.IsMissing(err) {
			return err
		}
		if row.HostUserID == userID {
			return bad("你已经是发起人")
		}
		p := participant(ps, userID)
		if p != nil && (p.Status == "pending" || p.Status == "accepted") {
			_, err := tx.AddEvent(ctx, id, userID, "application", req.Note, &req.RequestID, now)
			return err
		}
		if p != nil && (p.Status == "rejected" || p.Status == "removed") {
			return denied()
		}
		if row.Status != "active" || !now.Before(row.StartsAt) {
			return conflict("这场约饭已停止报名")
		}
		ids := acceptedIDs(row, ps)
		if len(ids) >= row.Capacity {
			return conflict("这场约饭已满员")
		}
		if err := s.canInteract(ctx, tx, userID, ids); err != nil {
			return err
		}
		if p == nil {
			p = &migrationdo.MealMeetupParticipantDO{ID: uuid.NewString(), MeetupID: id, UserID: userID, Revision: 1, CreatedAt: now}
		} else {
			p.Revision++
		}
		p.Status = "pending"
		p.Note = req.Note
		p.UpdatedAt = now
		if err := tx.SaveParticipant(ctx, p); err != nil {
			return err
		}
		event, err := tx.AddEvent(ctx, id, userID, "application", req.Note, &req.RequestID, now)
		if err != nil {
			return err
		}
		return s.notice(ctx, tx, row, event, []string{row.HostUserID}, "你的约饭收到一条加入申请，请确认是否接受。")
	})
}
func (s *Service) Respond(ctx context.Context, userID, id, applicantID string, req domain.RespondRequest) error {
	if req.Revision < 1 || (req.Action != "accept" && req.Action != "reject" && req.Action != "remove") {
		return bad("申请处理参数无效")
	}
	return s.mutate(ctx, userID, id, "处理申请", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if row.HostUserID != userID {
			return denied()
		}
		p := participant(ps, applicantID)
		if p == nil {
			return commonerrors.ErrNotFound
		}
		if p.Revision != req.Revision {
			return conflict("申请已更新，请刷新后再处理")
		}
		target := "accepted"
		if req.Action == "reject" {
			target = "rejected"
		} else if req.Action == "remove" {
			target = "removed"
		}
		if p.Status == target {
			return nil
		}
		if (req.Action == "remove" && p.Status != "accepted") || (req.Action != "remove" && p.Status != "pending") {
			return conflict("申请状态已变化，请刷新")
		}
		if row.Status != "active" || !now.Before(row.StartsAt) {
			return conflict("约饭已停止处理申请")
		}
		if target == "accepted" {
			ids := acceptedIDs(row, ps)
			if len(ids) >= row.Capacity {
				return conflict("这场约饭已满员")
			}
			if err := s.canInteract(ctx, tx, applicantID, ids); err != nil {
				return err
			}
		}
		p.Status = target
		p.UpdatedAt = now
		if err := tx.SaveParticipant(ctx, p); err != nil {
			return err
		}
		kind, content := "application", "发起人婉拒了你的加入申请。"
		if target == "accepted" {
			kind = "joined"
			content = "发起人已同意你的申请，可以进入约饭房间沟通。"
		}
		if target == "removed" {
			kind = "left"
			content = "发起人已将你移出这场约饭，房间访问已关闭。"
		}
		event, err := tx.AddEvent(ctx, id, applicantID, kind, map[string]string{"accepted": "一位饭搭子加入了约饭", "rejected": "申请已处理", "removed": "一位饭搭子已离开"}[target], nil, now)
		if err != nil {
			return err
		}
		return s.notice(ctx, tx, row, event, []string{applicantID}, content)
	})
}
func (s *Service) Leave(ctx context.Context, userID, id string, revision int) error {
	if revision < 1 {
		return bad("请刷新参与状态后重试")
	}
	return s.mutate(ctx, userID, id, "退出", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if row.HostUserID == userID {
			return bad("发起人请使用取消约饭")
		}
		p := participant(ps, userID)
		if p == nil {
			return commonerrors.ErrNotFound
		}
		if p.Revision != revision {
			return conflict("参与状态已更新，请刷新")
		}
		if p.Status == "withdrawn" || p.Status == "left" || p.Status == "removed" || p.Status == "rejected" {
			return nil
		}
		if !now.Before(row.EndsAt) {
			return conflict("约饭已经结束")
		}
		kind, content := "application", "加入申请已撤回"
		status := "withdrawn"
		if p.Status == "accepted" {
			kind = "left"
			content = "一位饭搭子已退出约饭"
			status = "left"
		}
		p.Status = status
		p.UpdatedAt = now
		if err := tx.SaveParticipant(ctx, p); err != nil {
			return err
		}
		event, err := tx.AddEvent(ctx, id, userID, kind, content, nil, now)
		if err != nil {
			return err
		}
		return s.notice(ctx, tx, row, event, []string{row.HostUserID}, content+"。")
	})
}
func (s *Service) cancel(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, actor, status string, now time.Time) error {
	if row.Status == status || row.Status == "hidden" {
		return nil
	}
	if err := tx.SetStatus(ctx, row.ID, status, now); err != nil {
		return err
	}
	event, err := tx.AddEvent(ctx, row.ID, actor, "cancelled", "约饭已取消，房间停止新留言", nil, now)
	if err != nil {
		return err
	}
	ids := []string{}
	for _, p := range ps {
		if p.Status == "accepted" || p.Status == "pending" {
			ids = append(ids, p.UserID)
		}
	}
	if actor != row.HostUserID || status == "hidden" {
		ids = append(ids, row.HostUserID)
	}
	return s.notice(ctx, tx, row, event, ids, "这场约饭已取消，请勿按原安排赴约。")
}
func (s *Service) Cancel(ctx context.Context, userID, id string) error {
	return s.mutate(ctx, userID, id, "取消", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if row.HostUserID != userID {
			return denied()
		}
		if row.Status == "active" && !now.Before(row.EndsAt) {
			return conflict("约饭已经结束")
		}
		return s.cancel(ctx, tx, row, ps, userID, "cancelled", now)
	})
}
func (s *Service) mutate(ctx context.Context, userID, id, action string, fn func(*repo.Repo, *migrationdo.MealMeetupDO, []migrationdo.MealMeetupParticipantDO, time.Time) error) error {
	if userID == "" {
		return commonerrors.ErrUnauthorized
	}
	err := s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		row, err := tx.Get(ctx, id, true)
		if err != nil {
			return err
		}
		ps, err := tx.Participants(ctx, id)
		if err != nil {
			return err
		}
		return fn(tx, row, ps, s.now())
	})
	if err != nil {
		if _, ok := err.(*commonerrors.AppError); ok {
			logger.Warn(ctx, "约饭状态操作未完成", slog.String("user_id", userID), slog.String("meetup_id", id), slog.String("action", action))
		} else {
			logger.Error(ctx, "约饭状态操作失败", err, slog.String("user_id", userID), slog.String("meetup_id", id), slog.String("action", action))
		}
	} else {
		logger.Info(ctx, "约饭状态操作完成", slog.String("user_id", userID), slog.String("meetup_id", id), slog.String("action", action))
	}
	return err
}
func (s *Service) room(ctx context.Context, tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, userID string, write bool, now time.Time) error {
	p := participant(ps, userID)
	if row.HostUserID != userID && (p == nil || p.Status != "accepted") {
		return denied()
	}
	if err := s.canInteract(ctx, tx, userID, acceptedIDs(row, ps)); err != nil {
		return err
	}
	if write && (row.Status != "active" || !now.Before(row.EndsAt)) {
		return conflict("约饭已结束或取消，房间停止新留言")
	}
	return nil
}
func (s *Service) Messages(ctx context.Context, userID, id string) ([]domain.Event, error) {
	out := []domain.Event{}
	err := s.mutate(ctx, userID, id, "读取房间", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if err := s.room(ctx, tx, row, ps, userID, false, now); err != nil {
			return err
		}
		events, err := tx.Events(ctx, id)
		if err != nil {
			return err
		}
		ids := []string{}
		for _, e := range events {
			ids = append(ids, e.ActorUserID)
		}
		profiles, err := tx.Profiles(ctx, ids)
		if err != nil {
			return err
		}
		for i := len(events) - 1; i >= 0; i-- {
			e := events[i]
			blocked, err := tx.Blocked(ctx, userID, e.ActorUserID)
			if err != nil {
				return err
			}
			if blocked {
				continue
			}
			p := profiles[e.ActorUserID]
			p.UserID = e.ActorUserID
			out = append(out, domain.Event{ID: e.ID, Actor: p, Kind: e.Kind, Content: e.Content, CreatedAt: e.CreatedAt})
		}
		return nil
	})
	return out, err
}
func (s *Service) SendMessage(ctx context.Context, userID, id string, req domain.MessageRequest) error {
	req.Content = strings.TrimSpace(req.Content)
	if !validKey(req.RequestID) || req.Content == "" || !limited(req.Content, 500) {
		return bad("留言需要1–500字")
	}
	if err := s.audit(ctx, userID, map[string]any{"content": req.Content}); err != nil {
		return err
	}
	return s.mutate(ctx, userID, id, "发送留言", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		if err := s.room(ctx, tx, row, ps, userID, true, now); err != nil {
			return err
		}
		if old, err := tx.EventByRequest(ctx, id, userID, req.RequestID); err == nil {
			if old.Kind != "text" || old.Content != req.Content {
				return conflict("留言请求已变更")
			}
			return nil
		} else if !repo.IsMissing(err) {
			return err
		}
		_, err := tx.AddEvent(ctx, id, userID, "text", req.Content, &req.RequestID, now)
		return err
	})
}
func (s *Service) Report(ctx context.Context, userID, id string, req domain.ReportRequest) error {
	if req.Reason != "spam" && req.Reason != "harassment" && req.Reason != "unsafe" && req.Reason != "other" {
		return bad("举报原因无效")
	}
	return s.mutate(ctx, userID, id, "举报", func(tx *repo.Repo, row *migrationdo.MealMeetupDO, ps []migrationdo.MealMeetupParticipantDO, now time.Time) error {
		target := id
		snapshot := any(map[string]any{"title": row.Title, "description": row.Description, "venue_name": row.VenueName, "address": row.Address})
		var eventID *string
		if req.EventID != "" {
			p := participant(ps, userID)
			if row.HostUserID != userID && (p == nil || p.Status != "accepted") {
				return denied()
			}
			event, err := tx.Event(ctx, id, req.EventID)
			if err != nil {
				return err
			}
			target = req.EventID
			eventID = &req.EventID
			snapshot = map[string]any{"actor_user_id": event.ActorUserID, "content": event.Content}
		}
		raw, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		return tx.CreateReport(ctx, &migrationdo.MealMeetupReportDO{ID: uuid.NewString(), MeetupID: id, EventID: eventID, TargetKey: target, ReporterUserID: userID, Reason: req.Reason, Snapshot: string(raw), Status: "pending", CreatedAt: now, UpdatedAt: now})
	})
}
func (s *Service) Reports(ctx context.Context) ([]migrationdo.MealMeetupReportDO, error) {
	reports, err := s.repo.Reports(ctx)
	if err != nil {
		logger.Error(ctx, "读取约饭举报队列失败", err)
	}
	return reports, err
}
func (s *Service) ResolveReport(ctx context.Context, reportID string, hide bool) error {
	err := s.repo.Transaction(ctx, func(tx *repo.Repo) error {
		// Lock order remains activity then report, matching participant actions.
		found, err := tx.Report(ctx, reportID, false)
		if err != nil {
			return err
		}
		row, err := tx.Get(ctx, found.MeetupID, true)
		if err != nil {
			return err
		}
		report, err := tx.Report(ctx, reportID, true)
		if err != nil {
			return err
		}
		if report.Status != "pending" {
			return nil
		}
		now := s.now()
		if hide && report.EventID == nil {
			ps, err := tx.Participants(ctx, row.ID)
			if err != nil {
				return err
			}
			if err := s.cancel(ctx, tx, row, ps, row.HostUserID, "hidden", now); err != nil {
				return err
			}
		}
		if err := tx.ResolveReport(ctx, report, hide, now); err != nil {
			return err
		}
		logger.Info(ctx, "约饭举报处置完成", slog.String("report_id", reportID), slog.String("meetup_id", row.ID), slog.Bool("hidden", hide))
		return nil
	})
	if err != nil && !repo.IsMissing(err) {
		logger.Error(ctx, "约饭举报处置失败", err, slog.String("report_id", reportID))
	}
	return err
}
