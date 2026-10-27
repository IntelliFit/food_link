package service

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/promoter/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

const (
	defaultRateBps          = 2000
	defaultSettleDelayHours = 7 * 24
	defaultBindingValidDays = 365
	defaultBindWindowHours  = 24
	defaultAgreementVersion = "v1"
	defaultSyncInterval     = 10 * time.Minute
	applyNoteMaxRunes       = 200
	maxPageSize             = 50
	promoCodeLength         = 8
	promoCodeAttempts       = 5
	// promoCodeAlphabet leaves out 0/O and 1/I, which are easy to mistype
	// from a poster.
	promoCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

var promoCodePattern = regexp.MustCompile(`^[A-Z0-9]{6,12}$`)

// Bind outcomes reported to the mini program. Binding is best effort, so
// these are not errors.
const (
	BindBound        = "bound"
	BindDisabled     = "disabled"
	BindInvalidCode  = "invalid_code"
	BindSelf         = "self"
	BindNotNewUser   = "not_new_user"
	BindAlreadyBound = "already_bound"
)

// Rules are the commission rules after config defaults are applied.
type Rules struct {
	Enabled          bool
	DefaultRateBps   int
	SettleDelay      time.Duration
	BindingValidity  time.Duration
	BindWindow       time.Duration
	AgreementVersion string
	SyncInterval     time.Duration
	WithdrawMinCents int64
	WithdrawMaxCents int64
	WithdrawPerDay   int
}

func RulesFromConfig(cfg config.PromoterConfig) Rules {
	rules := Rules{
		Enabled:          cfg.Enabled,
		DefaultRateBps:   cfg.DefaultRateBps,
		SettleDelay:      time.Duration(cfg.SettleDelayHours) * time.Hour,
		BindingValidity:  time.Duration(cfg.BindingValidDays) * 24 * time.Hour,
		BindWindow:       time.Duration(cfg.BindWindowHours) * time.Hour,
		AgreementVersion: strings.TrimSpace(cfg.AgreementVersion),
		SyncInterval:     time.Duration(cfg.SyncIntervalSecs) * time.Second,
		WithdrawMinCents: cfg.WithdrawMinCents,
		WithdrawMaxCents: cfg.WithdrawMaxCents,
		WithdrawPerDay:   cfg.WithdrawPerDay,
	}
	if rules.DefaultRateBps <= 0 || rules.DefaultRateBps > 10000 {
		rules.DefaultRateBps = defaultRateBps
	}
	if rules.SettleDelay <= 0 {
		rules.SettleDelay = defaultSettleDelayHours * time.Hour
	}
	if rules.BindingValidity <= 0 {
		rules.BindingValidity = defaultBindingValidDays * 24 * time.Hour
	}
	if rules.BindWindow <= 0 {
		rules.BindWindow = defaultBindWindowHours * time.Hour
	}
	if rules.AgreementVersion == "" {
		rules.AgreementVersion = defaultAgreementVersion
	}
	if rules.SyncInterval <= 0 {
		rules.SyncInterval = defaultSyncInterval
	}
	if rules.WithdrawMinCents <= 0 {
		rules.WithdrawMinCents = defaultWithdrawMinCents
	}
	if rules.WithdrawMaxCents < rules.WithdrawMinCents {
		rules.WithdrawMaxCents = max(defaultWithdrawMaxCents, rules.WithdrawMinCents)
	}
	if rules.WithdrawPerDay <= 0 {
		rules.WithdrawPerDay = defaultWithdrawPerDay
	}
	return rules
}

type PromoterService struct {
	repo  *repo.PromoterRepo
	rules Rules
	now   func() time.Time
}

func NewPromoterService(r *repo.PromoterRepo, rules Rules) *PromoterService {
	return &PromoterService{repo: r, rules: rules, now: time.Now}
}

func (s *PromoterService) Rules() Rules { return s.rules }

// Me is the promoter center header: application state, promo code and
// balance. Status is "none" when the user never applied.
type Me struct {
	Enabled          bool            `json:"enabled"`
	Status           string          `json:"status"`
	PromoCode        string          `json:"promo_code,omitempty"`
	RateBps          int             `json:"rate_bps"`
	ReviewNote       string          `json:"review_note,omitempty"`
	AgreementVersion string          `json:"agreement_version"`
	SettleDelayDays  int             `json:"settle_delay_days"`
	WithdrawMinCents int64           `json:"withdraw_min_cents"`
	WithdrawMaxCents int64           `json:"withdraw_max_cents"`
	Summary          *domain.Summary `json:"summary,omitempty"`
}

func (s *PromoterService) Me(ctx context.Context, userID string) (*Me, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	me := &Me{
		Enabled:          s.rules.Enabled,
		Status:           "none",
		RateBps:          s.rules.DefaultRateBps,
		AgreementVersion: s.rules.AgreementVersion,
		SettleDelayDays:  int((s.rules.SettleDelay + 24*time.Hour - 1) / (24 * time.Hour)),
		WithdrawMinCents: s.rules.WithdrawMinCents,
		WithdrawMaxCents: s.rules.WithdrawMaxCents,
	}
	promoter, err := s.repo.GetByUser(ctx, userID)
	if err != nil || promoter == nil {
		return me, err
	}
	me.Status = promoter.Status
	if promoter.CommissionRateBps != nil {
		me.RateBps = *promoter.CommissionRateBps
	}
	switch promoter.Status {
	case domain.StatusActive, domain.StatusSuspended:
		me.PromoCode = promoter.PromoCode
	case domain.StatusRejected:
		me.ReviewNote = promoter.ReviewNote
	}
	if promoter.Status == domain.StatusPendingReview || promoter.Status == domain.StatusRejected {
		return me, nil
	}
	summary, err := s.repo.Summary(ctx, promoter.ID)
	if err != nil {
		return nil, err
	}
	me.Summary = &summary
	return me, nil
}

type ApplyInput struct {
	AgreementVersion  string `json:"agreement_version"`
	AgreementAccepted bool   `json:"agreement_accepted"`
	ApplyNote         string `json:"apply_note"`
}

// Apply submits or resubmits a promoter application. Applying again while
// pending or approved is a no-op; a rejected user may apply again.
func (s *PromoterService) Apply(ctx context.Context, userID string, input ApplyInput) (*Me, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if !s.rules.Enabled {
		return nil, appError(http.StatusForbidden, "推广功能暂未开放")
	}
	if !input.AgreementAccepted || strings.TrimSpace(input.AgreementVersion) != s.rules.AgreementVersion {
		return nil, appError(http.StatusBadRequest, "请先阅读并同意最新的推广协议")
	}
	note := strings.TrimSpace(input.ApplyNote)
	if utf8.RuneCountInString(note) > applyNoteMaxRunes {
		return nil, appError(http.StatusBadRequest, "申请说明不能超过 200 字")
	}
	existing, err := s.repo.GetByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	switch {
	case existing == nil:
		if err := s.createApplication(ctx, userID, note, now); err != nil {
			return nil, err
		}
	case existing.Status == domain.StatusRejected:
		updated, err := s.repo.UpdateIfStatus(ctx, existing.ID, []string{domain.StatusRejected}, map[string]any{
			"status": domain.StatusPendingReview, "apply_note": note,
			"agreement_version": s.rules.AgreementVersion, "agreement_signed_at": now,
			"review_note": "", "reviewed_by": "", "reviewed_at": nil,
		})
		if err != nil {
			return nil, err
		}
		if updated != nil {
			logger.Info(ctx, "推广员重新提交申请", slog.String("user_id", userID), slog.String("promoter_id", existing.ID))
		}
	case existing.Status == domain.StatusTerminated:
		return nil, appError(http.StatusForbidden, "推广资格已终止，如有疑问请联系客服")
	}
	return s.Me(ctx, userID)
}

func (s *PromoterService) createApplication(ctx context.Context, userID, note string, now time.Time) error {
	for attempt := 0; attempt < promoCodeAttempts; attempt++ {
		code, err := newPromoCode()
		if err != nil {
			return err
		}
		row := &domain.Promoter{
			ID: uuid.NewString(), UserID: userID, PromoCode: code, Status: domain.StatusPendingReview, ApplyNote: note,
			AgreementVersion: s.rules.AgreementVersion, AgreementSignedAt: &now,
		}
		err = s.repo.Create(ctx, row)
		switch {
		case err == nil:
			logger.Info(ctx, "推广员申请已提交", slog.String("user_id", userID), slog.String("promoter_id", row.ID))
			return nil
		case errors.Is(err, repo.ErrPromoterExists):
			// A concurrent request created it first; that row stands.
			return nil
		case !errors.Is(err, repo.ErrPromoCodeTaken):
			return err
		}
	}
	return errors.New("could not allocate a unique promo code")
}

type BindInput struct {
	PromoCode string `json:"promo_code"`
	Source    string `json:"source"`
}

type BindResult struct {
	Bound  bool   `json:"bound"`
	Reason string `json:"reason"`
}

// Bind attributes a newly registered user to the promoter whose code they
// arrived with. Only accounts registered within the bind window and without
// any paid order qualify, and a user is never re-bound.
func (s *PromoterService) Bind(ctx context.Context, userID string, input BindInput) (*BindResult, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if !s.rules.Enabled {
		return &BindResult{Reason: BindDisabled}, nil
	}
	code := strings.ToUpper(strings.TrimSpace(input.PromoCode))
	if !promoCodePattern.MatchString(code) {
		return &BindResult{Reason: BindInvalidCode}, nil
	}
	source := strings.TrimSpace(input.Source)
	switch source {
	case "":
		source = domain.SourcePromoCode
	case domain.SourcePromoCode, domain.SourceShareLink, domain.SourceQR:
	default:
		return nil, appError(http.StatusBadRequest, "推广来源不正确")
	}
	existing, err := s.repo.GetBindingByInvitee(ctx, userID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &BindResult{Reason: BindAlreadyBound}, nil
	}
	promoter, err := s.repo.GetByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if promoter == nil || promoter.Status != domain.StatusActive {
		return &BindResult{Reason: BindInvalidCode}, nil
	}
	if promoter.UserID == userID {
		return &BindResult{Reason: BindSelf}, nil
	}
	now := s.now()
	createdAt, err := s.repo.UserCreatedAt(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Without a registration time the account cannot be shown to be new.
	if createdAt == nil || now.Sub(*createdAt) > s.rules.BindWindow {
		return &BindResult{Reason: BindNotNewUser}, nil
	}
	paid, err := s.repo.HasPaidMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	if paid {
		return &BindResult{Reason: BindNotNewUser}, nil
	}
	expiresAt := now.Add(s.rules.BindingValidity)
	created, err := s.repo.CreateBinding(ctx, &domain.Binding{
		ID: uuid.NewString(), InviteeUserID: userID, PromoterID: promoter.ID, PromoCode: code, Source: source,
		Status: domain.BindingActive, BoundAt: now, ExpiresAt: &expiresAt,
	})
	if err != nil {
		return nil, err
	}
	if !created {
		return &BindResult{Reason: BindAlreadyBound}, nil
	}
	logger.Info(ctx, "推广归因绑定完成",
		slog.String("user_id", userID), slog.String("promoter_id", promoter.ID), slog.String("source", source))
	return &BindResult{Bound: true, Reason: BindBound}, nil
}

type CommissionPage struct {
	Items []domain.CommissionItem `json:"items"`
	Total int64                   `json:"total"`
}

func (s *PromoterService) Commissions(ctx context.Context, userID string, page, size int) (*CommissionPage, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	limit, offset := pageBounds(page, size)
	promoter, err := s.repo.GetByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if promoter == nil {
		return &CommissionPage{Items: []domain.CommissionItem{}}, nil
	}
	items, total, err := s.repo.ListCommissions(ctx, promoter.ID, limit, offset)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].InviteeNickname = maskNickname(items[i].InviteeNickname)
	}
	if items == nil {
		items = []domain.CommissionItem{}
	}
	return &CommissionPage{Items: items, Total: total}, nil
}

// SyncCommissions runs one accrue / reverse / settle pass. It reports
// skipped when another replica holds the sync lock.
func (s *PromoterService) SyncCommissions(ctx context.Context) (domain.SyncResult, bool, error) {
	result, acquired, err := s.repo.SyncCommissions(ctx, s.now(), s.rules.DefaultRateBps, s.rules.SettleDelay)
	return result, !acquired, err
}

func pageBounds(page, size int) (int, int) {
	if size <= 0 || size > maxPageSize {
		size = 20
	}
	if page <= 0 {
		page = 1
	}
	return size, (page - 1) * size
}

func maskNickname(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "食探用户"
	}
	first, _ := utf8.DecodeRuneInString(name)
	return string(first) + "**"
}

func newPromoCode() (string, error) {
	max := big.NewInt(int64(len(promoCodeAlphabet)))
	var b strings.Builder
	for i := 0; i < promoCodeLength; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(promoCodeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

func appError(status int, message string) error {
	code := 10002
	if status == http.StatusForbidden {
		code = 20003
	}
	if status == http.StatusNotFound {
		code = 10001
	}
	return &commonerrors.AppError{Code: code, Message: message, HTTPStatus: status}
}
