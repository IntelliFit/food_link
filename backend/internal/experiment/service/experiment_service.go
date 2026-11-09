package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/experiment/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

// ReservedEventPrefix marks events only the server writes (for example the
// guest-try counter); a client batch can never add them.
const ReservedEventPrefix = "srv."

const (
	maxEventsPerBatch   = 50
	maxEventPropsBytes  = 2048
	maxExposureKeys     = 10
	maxClientClockSkew  = 7 * 24 * time.Hour
	maxClientFieldRunes = 32
)

type Repository interface {
	TouchVisitor(ctx context.Context, v domain.Visitor) (domain.Visitor, error)
	ListServableExperiments(ctx context.Context) ([]domain.Experiment, error)
	FindAssignmentByUser(ctx context.Context, key, userID string) (*domain.Assignment, error)
	FindAssignmentByAnon(ctx context.Context, key, anonID string) (*domain.Assignment, error)
	CreateAssignment(ctx context.Context, a domain.Assignment) (domain.Assignment, error)
	BindAssignment(ctx context.Context, id, key, userID string, excludedReason *string) (bool, error)
	ExcludeUnboundAnon(ctx context.Context, key, anonID, reason string) error
	UserCreatedAt(ctx context.Context, userID string) (time.Time, bool, error)
	MarkExposed(ctx context.Context, anonID, userID string, keys []string, at time.Time) (int64, error)
	InsertEvents(ctx context.Context, events []domain.Event) error
	ListExperiments(ctx context.Context) ([]domain.Experiment, error)
	GetExperiment(ctx context.Context, key string) (*domain.Experiment, error)
	SaveExperiment(ctx context.Context, e domain.Experiment) error
	Summary(ctx context.Context, key string) ([]domain.VariantSummary, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

type AssignInput struct {
	AnonID     string
	UserID     string
	Platform   string
	AppVersion string
}

// Assignments records the visitor, binds it to the account when logged in and
// returns the variant to render for every running or stopped experiment. A
// failure inside one experiment serves its control instead of failing the call.
func (s *Service) Assignments(ctx context.Context, in AssignInput) (map[string]domain.Served, error) {
	if !anonIDPattern.MatchString(in.AnonID) {
		return nil, badRequest("访客标识无效")
	}
	now := s.now()
	visitor, err := s.repo.TouchVisitor(ctx, domain.Visitor{
		AnonID:      in.AnonID,
		UserID:      optional(in.UserID),
		Platform:    clip(in.Platform),
		AppVersion:  clip(in.AppVersion),
		FirstSeenAt: now,
		LastSeenAt:  now,
	})
	if err != nil {
		return nil, fmt.Errorf("记录访客失败: %w", err)
	}
	experiments, err := s.repo.ListServableExperiments(ctx)
	if err != nil {
		return nil, fmt.Errorf("读取实验列表失败: %w", err)
	}
	req := &assignRequest{in: in, visitor: visitor}
	out := make(map[string]domain.Served, len(experiments))
	for _, e := range experiments {
		served, err := s.serve(ctx, e, req)
		if err != nil {
			logger.Error(ctx, "实验分组失败，已回退到对照组", err, slog.String("experiment_key", e.Key))
			served = domain.Served{Variant: e.ControlKey()}
		}
		out[e.Key] = served
	}
	return out, nil
}

type assignRequest struct {
	in             AssignInput
	visitor        domain.Visitor
	userCreatedAt  time.Time
	userKnown      bool
	userLookupDone bool
}

func (s *Service) serve(ctx context.Context, e domain.Experiment, req *assignRequest) (domain.Served, error) {
	if e.OverrideVariant != nil {
		return domain.Served{Variant: *e.OverrideVariant}, nil
	}
	if e.Status != domain.StatusRunning {
		return domain.Served{Variant: e.ControlKey()}, nil
	}
	userID := req.in.UserID
	if userID != "" {
		a, err := s.repo.FindAssignmentByUser(ctx, e.Key, userID)
		if err != nil {
			return domain.Served{}, err
		}
		if a != nil {
			return s.serveUserRow(ctx, e, req, *a)
		}
	}
	a, err := s.repo.FindAssignmentByAnon(ctx, e.Key, req.in.AnonID)
	if err != nil {
		return domain.Served{}, err
	}
	if a != nil {
		return s.serveExisting(ctx, e, req, *a)
	}
	eligible, err := s.eligible(ctx, e, req)
	if err != nil || !eligible {
		return domain.Served{Variant: e.ControlKey()}, err
	}
	created, err := s.repo.CreateAssignment(ctx, domain.Assignment{
		ID:            uuid.NewString(),
		ExperimentKey: e.Key,
		AnonID:        req.in.AnonID,
		UserID:        optional(userID),
		Variant:       PickVariant(e.Variants, Bucket(e.Salt, req.in.AnonID)),
		AssignedAt:    s.now(),
	})
	if err != nil {
		return domain.Served{}, err
	}
	return servedFrom(created, e), nil
}

func (s *Service) serveExisting(ctx context.Context, e domain.Experiment, req *assignRequest, a domain.Assignment) (domain.Served, error) {
	userID := req.in.UserID
	switch {
	case userID == "" || (a.UserID != nil && *a.UserID == userID):
		return servedFrom(a, e), nil
	case a.UserID != nil:
		// A second account on a shared phone: render consistently for that
		// account but keep it out of the results.
		return domain.Served{Variant: PickVariant(e.Variants, Bucket(e.Salt, userID))}, nil
	}
	var reason *string
	if e.Audience == domain.AudienceNewUsers {
		eligible, err := s.userIsNew(ctx, e, req)
		if err != nil {
			return domain.Served{}, err
		}
		if !eligible {
			excluded := domain.ExcludedExistingUser
			reason = &excluded
		}
	}
	bound, err := s.repo.BindAssignment(ctx, a.ID, e.Key, userID, reason)
	if err != nil {
		return domain.Served{}, err
	}
	if !bound {
		// Another request bound this row, or the account enrolled on another
		// phone in the meantime: follow the account's row if there is one.
		owned, err := s.repo.FindAssignmentByUser(ctx, e.Key, userID)
		if err != nil || owned == nil {
			return domain.Served{Variant: e.ControlKey()}, err
		}
		return s.serveUserRow(ctx, e, req, *owned)
	}
	a.UserID = &userID
	a.ExcludedReason = reason
	return servedFrom(a, e), nil
}

// serveUserRow serves the account's own assignment and retires any unbound
// row this install created before login, so one person is counted once.
func (s *Service) serveUserRow(ctx context.Context, e domain.Experiment, req *assignRequest, a domain.Assignment) (domain.Served, error) {
	if a.AnonID != req.in.AnonID {
		if err := s.repo.ExcludeUnboundAnon(ctx, e.Key, req.in.AnonID, domain.ExcludedDuplicateUnit); err != nil {
			return domain.Served{}, err
		}
	}
	return servedFrom(a, e), nil
}

func (s *Service) eligible(ctx context.Context, e domain.Experiment, req *assignRequest) (bool, error) {
	if e.Audience == domain.AudienceAll {
		return true, nil
	}
	if e.StartedAt == nil {
		return false, nil
	}
	if req.in.UserID != "" {
		return s.userIsNew(ctx, e, req)
	}
	return !req.visitor.FirstSeenAt.Before(*e.StartedAt), nil
}

func (s *Service) userIsNew(ctx context.Context, e domain.Experiment, req *assignRequest) (bool, error) {
	if e.StartedAt == nil {
		return false, nil
	}
	if !req.userLookupDone {
		createdAt, known, err := s.repo.UserCreatedAt(ctx, req.in.UserID)
		if err != nil {
			return false, err
		}
		req.userCreatedAt, req.userKnown, req.userLookupDone = createdAt, known, true
	}
	return req.userKnown && !req.userCreatedAt.Before(*e.StartedAt), nil
}

func servedFrom(a domain.Assignment, e domain.Experiment) domain.Served {
	if a.ExcludedReason != nil || !hasVariant(e.Variants, a.Variant) {
		return domain.Served{Variant: e.ControlKey()}
	}
	return domain.Served{Variant: a.Variant, Tracked: true}
}

// Expose stamps the first time a tracked unit actually saw the experiment's
// screen; assignment alone does not count.
func (s *Service) Expose(ctx context.Context, anonID, userID string, keys []string) (int64, error) {
	if !anonIDPattern.MatchString(anonID) {
		return 0, badRequest("访客标识无效")
	}
	if len(keys) == 0 || len(keys) > maxExposureKeys {
		return 0, badRequest(fmt.Sprintf("一次需上报 1–%d 个实验", maxExposureKeys))
	}
	for _, k := range keys {
		if !experimentKeyPattern.MatchString(k) {
			return 0, badRequest("实验标识无效")
		}
	}
	return s.repo.MarkExposed(ctx, anonID, userID, keys, s.now())
}

type EventInput struct {
	Name     string         `json:"name"`
	Props    map[string]any `json:"props"`
	ClientTS int64          `json:"client_ts"`
}

type TrackResult struct {
	Recorded int `json:"recorded"`
	Rejected int `json:"rejected"`
}

// Track stores funnel events the backend cannot see on its own (screens,
// taps, drop-off). Outcomes the backend already records are computed from
// their own tables instead. A malformed event is dropped on its own so it
// cannot block the rest of the batch; props must never carry personal data.
func (s *Service) Track(ctx context.Context, anonID, userID string, inputs []EventInput) (TrackResult, error) {
	if !anonIDPattern.MatchString(anonID) {
		return TrackResult{}, badRequest("访客标识无效")
	}
	if len(inputs) == 0 || len(inputs) > maxEventsPerBatch {
		return TrackResult{}, badRequest(fmt.Sprintf("一次需上报 1–%d 条事件", maxEventsPerBatch))
	}
	now := s.now()
	events := make([]domain.Event, 0, len(inputs))
	for _, in := range inputs {
		if !eventNamePattern.MatchString(in.Name) || strings.HasPrefix(in.Name, ReservedEventPrefix) {
			continue
		}
		props := in.Props
		if props == nil {
			props = map[string]any{}
		}
		raw, err := json.Marshal(props)
		if err != nil || len(raw) > maxEventPropsBytes {
			continue
		}
		events = append(events, domain.Event{
			ID:        uuid.NewString(),
			AnonID:    anonID,
			UserID:    optional(userID),
			Name:      in.Name,
			Props:     props,
			ClientAt:  clientTime(in.ClientTS, now),
			CreatedAt: now,
		})
	}
	result := TrackResult{Recorded: len(events), Rejected: len(inputs) - len(events)}
	if result.Rejected > 0 {
		logger.Warn(ctx, "丢弃不合规的上报事件", slog.Int("rejected", result.Rejected), slog.Int("recorded", result.Recorded))
	}
	if err := s.repo.InsertEvents(ctx, events); err != nil {
		return TrackResult{}, fmt.Errorf("写入事件失败: %w", err)
	}
	return result, nil
}

type SaveInput struct {
	Description     string           `json:"description"`
	Status          string           `json:"status"`
	Audience        string           `json:"audience"`
	Variants        []domain.Variant `json:"variants"`
	Salt            string           `json:"salt"`
	OverrideVariant *string          `json:"override_variant"`
}

func (s *Service) List(ctx context.Context) ([]domain.Experiment, error) {
	return s.repo.ListExperiments(ctx)
}

// Save creates or updates a definition. Moving to running stamps started_at
// once; stopping stamps ended_at once. An empty override clears it.
func (s *Service) Save(ctx context.Context, key string, in SaveInput) (domain.Experiment, error) {
	prev, err := s.repo.GetExperiment(ctx, key)
	if err != nil {
		return domain.Experiment{}, err
	}
	now := s.now()
	next := domain.Experiment{
		Key:         key,
		Description: strings.TrimSpace(in.Description),
		Status:      in.Status,
		Audience:    in.Audience,
		Variants:    in.Variants,
		Salt:        strings.TrimSpace(in.Salt),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if next.Salt == "" {
		next.Salt = key
	}
	if in.OverrideVariant != nil && strings.TrimSpace(*in.OverrideVariant) != "" {
		override := strings.TrimSpace(*in.OverrideVariant)
		next.OverrideVariant = &override
	}
	if prev != nil {
		next.CreatedAt = prev.CreatedAt
		next.StartedAt = prev.StartedAt
		next.EndedAt = prev.EndedAt
	}
	if err := validateExperiment(next, prev); err != nil {
		return domain.Experiment{}, badRequest(err.Error())
	}
	if next.Status != domain.StatusDraft && next.StartedAt == nil {
		next.StartedAt = &now
	}
	if next.Status == domain.StatusStopped && next.EndedAt == nil {
		next.EndedAt = &now
	}
	if err := s.repo.SaveExperiment(ctx, next); err != nil {
		return domain.Experiment{}, err
	}
	logger.Info(ctx, "实验配置已保存",
		slog.String("experiment_key", next.Key),
		slog.String("status", next.Status),
		slog.Any("variants", next.Variants),
	)
	return next, nil
}

func (s *Service) Summary(ctx context.Context, key string) ([]domain.VariantSummary, error) {
	e, err := s.repo.GetExperiment(ctx, key)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, &commonerrors.AppError{Code: 10001, Message: "实验不存在", HTTPStatus: http.StatusNotFound}
	}
	return s.repo.Summary(ctx, key)
}

func badRequest(msg string) error {
	return &commonerrors.AppError{Code: 10002, Message: msg, HTTPStatus: http.StatusBadRequest}
}

func optional(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func clip(v string) string {
	r := []rune(strings.TrimSpace(v))
	if len(r) > maxClientFieldRunes {
		r = r[:maxClientFieldRunes]
	}
	return string(r)
}

// clientTime keeps the device clock only when it is plausible; the server
// time stays the source of truth for analysis.
func clientTime(ms int64, now time.Time) *time.Time {
	if ms <= 0 {
		return nil
	}
	t := time.UnixMilli(ms)
	if t.Before(now.Add(-maxClientClockSkew)) || t.After(now.Add(maxClientClockSkew)) {
		return nil
	}
	return &t
}
