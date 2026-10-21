package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"food_link/backend/internal/campuscatalog/domain"
	campusrepo "food_link/backend/internal/campuscatalog/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

// CaptureMembershipOption is one way to spend earnings on membership days.
type CaptureMembershipOption struct {
	Code      string `json:"code" mapstructure:"code"`
	Title     string `json:"title" mapstructure:"title"`
	PlanCode  string `json:"-" mapstructure:"plan_code"`
	Days      int    `json:"days" mapstructure:"days"`
	CostCents int64  `json:"cost_cents" mapstructure:"cost_cents"`
}

// CaptureRewardRules are the published amounts in fen. All zero means the
// amounts are not announced yet: rewards are recorded as rate_pending and
// priced later with ReleaseRatePendingCaptureRewards.
type CaptureRewardRules struct {
	WindowCents        int64
	PhotoHalfCents     int64
	PhotoFullCents     int64
	WithdrawMinCents   int64
	MembershipOptions  []CaptureMembershipOption
	DisableAutoPublish bool
}

func (r CaptureRewardRules) Published() bool {
	return r.WindowCents > 0 || r.PhotoHalfCents > 0 || r.PhotoFullCents > 0
}

const (
	capturePhotoTierNone = "none"
	capturePhotoTierHalf = "half"
	capturePhotoTierFull = "full"
)

// capturePhotoTier rewards dish photos: at least half of the sellable items
// photographed earns the half bonus, every item photographed the full one.
func capturePhotoTier(sellable, photographed int) string {
	switch {
	case sellable <= 0 || photographed <= 0:
		return capturePhotoTierNone
	case photographed >= sellable:
		return capturePhotoTierFull
	case photographed*2 >= sellable:
		return capturePhotoTierHalf
	default:
		return capturePhotoTierNone
	}
}

func (r CaptureRewardRules) amountFor(tier string) int64 {
	amount := r.WindowCents
	switch tier {
	case capturePhotoTierFull:
		amount += r.PhotoFullCents
	case capturePhotoTierHalf:
		amount += r.PhotoHalfCents
	}
	return amount
}

const (
	CaptureRewardEligible    = "eligible"
	CaptureRewardNoItems     = "no_items"
	CaptureRewardWindowTaken = "window_taken"
	CaptureRewardRejected    = "rejected"
	CaptureRewardConfirmed   = "confirmed"
	CaptureRewardRatePending = "rate_pending"
)

// CaptureRewardEstimate is what the collector sees before and after submit.
type CaptureRewardEstimate struct {
	Status         string `json:"status"`
	AmountCents    int64  `json:"amount_cents"`
	RatesPublished bool   `json:"rates_published"`
	PhotoTier      string `json:"photo_tier"`
	SellableItems  int    `json:"sellable_items"`
	PhotoItems     int    `json:"photo_items"`
	Message        string `json:"message"`
}

func (r CaptureRewardRules) estimate(status string, sellable, photographed int) CaptureRewardEstimate {
	tier := capturePhotoTier(sellable, photographed)
	estimate := CaptureRewardEstimate{
		Status: status, RatesPublished: r.Published(), PhotoTier: tier,
		SellableItems: sellable, PhotoItems: photographed,
	}
	switch status {
	case CaptureRewardEligible, CaptureRewardConfirmed, CaptureRewardRatePending:
		estimate.AmountCents = r.amountFor(tier)
		estimate.Message = captureRewardMessage(r, tier, sellable, photographed)
	case CaptureRewardNoItems:
		estimate.Message = "还没有识别到菜品，拍清楚菜单或给实物照写上菜名后可获得奖励"
	case CaptureRewardWindowTaken:
		estimate.Message = "这个窗口已有人领取过奖励，你的资料仍会帮助更新菜单"
	case CaptureRewardRejected:
		estimate.Message = "照片与其他窗口重复，本次不计奖励"
	}
	return estimate
}

func captureRewardMessage(r CaptureRewardRules, tier string, sellable, photographed int) string {
	if !r.Published() {
		return "奖励金额即将公布，这个窗口的奖励资格已为你记录"
	}
	if tier == capturePhotoTierFull {
		return "所有菜品都有实物图，已获得最高奖励"
	}
	missing := sellable - photographed
	if tier == capturePhotoTierHalf {
		return fmt.Sprintf("再补拍 %d 道菜的实物图可获得最高奖励", missing)
	}
	half := (sellable+1)/2 - photographed
	if half < 1 {
		half = 1
	}
	return fmt.Sprintf("再补拍 %d 道菜的实物图可获得实物图加成", half)
}

// recordCaptureReward writes the window reward after a successful submit.
// The ledger's unique keys keep it to one reward per session and per window.
func (s *CatalogService) recordCaptureReward(ctx context.Context, deps *captureDeps, session *domain.CaptureSession, hashes []string, sellable, photographed int) CaptureRewardEstimate {
	rules := deps.rules
	if sellable <= 0 {
		return rules.estimate(CaptureRewardNoItems, sellable, photographed)
	}
	sourceKey := "window_reward:" + session.ID
	if existing, err := deps.repo.FindLedgerBySourceKey(ctx, sourceKey); err == nil && existing != nil {
		return captureEstimateFromLedger(rules, existing, sellable, photographed)
	}
	reused, err := deps.repo.CountReusedCaptureHashes(ctx, hashes, session.ID, session.UserID, session.WindowKey)
	if err != nil {
		logger.Warn(ctx, "检查采集照片重复失败", slog.String("session_id", session.ID), logger.Err(err))
	}
	tier := capturePhotoTier(sellable, photographed)
	entry := &domain.CollectorLedgerEntry{
		ID: uuid.NewString(), UserID: session.UserID, EntryType: domain.LedgerWindowReward,
		SessionID: stringPointer(session.ID), WindowKey: stringPointer(session.WindowKey), SourceKey: sourceKey,
		Meta: map[string]any{"photo_tier": tier, "sellable_items": sellable, "photo_items": photographed},
	}
	switch {
	case reused > 0:
		entry.Status, entry.WindowKey = domain.LedgerStatusRejected, nil
		entry.ReviewNote = "照片与其他窗口或其他用户的提交重复"
		entry.Meta["reused_photos"] = reused
	case rules.Published():
		entry.Status, entry.AmountCents = domain.LedgerStatusConfirmed, rules.amountFor(tier)
	default:
		entry.Status = domain.LedgerStatusRatePending
	}
	if err := deps.repo.CreateLedgerEntry(ctx, entry); err != nil {
		if errors.Is(err, campusrepo.ErrLedgerDuplicate) {
			if existing, findErr := deps.repo.FindLedgerBySourceKey(ctx, sourceKey); findErr == nil && existing != nil {
				return captureEstimateFromLedger(rules, existing, sellable, photographed)
			}
			return rules.estimate(CaptureRewardWindowTaken, sellable, photographed)
		}
		logger.Error(ctx, "记录窗口采集奖励失败", err, slog.String("session_id", session.ID))
		return rules.estimate(CaptureRewardEligible, sellable, photographed)
	}
	logger.Info(ctx, "窗口采集奖励已记录", slog.String("session_id", session.ID), slog.String("user_id", session.UserID),
		slog.String("status", entry.Status), slog.Int64("amount_cents", entry.AmountCents), slog.String("photo_tier", tier))
	return captureEstimateFromLedger(rules, entry, sellable, photographed)
}

func captureEstimateFromLedger(rules CaptureRewardRules, entry *domain.CollectorLedgerEntry, sellable, photographed int) CaptureRewardEstimate {
	switch entry.Status {
	case domain.LedgerStatusRejected:
		estimate := rules.estimate(CaptureRewardRejected, sellable, photographed)
		if entry.ReviewNote != "" {
			estimate.Message = entry.ReviewNote
		}
		return estimate
	case domain.LedgerStatusRatePending:
		return rules.estimate(CaptureRewardRatePending, sellable, photographed)
	default:
		estimate := rules.estimate(CaptureRewardConfirmed, sellable, photographed)
		estimate.AmountCents = entry.AmountCents
		return estimate
	}
}

// CaptureEarnings is the collector's wallet page.
type CaptureEarnings struct {
	Totals            campusrepo.LedgerTotals       `json:"totals"`
	RatesPublished    bool                          `json:"rates_published"`
	WindowCents       int64                         `json:"window_cents"`
	PhotoHalfCents    int64                         `json:"photo_half_cents"`
	PhotoFullCents    int64                         `json:"photo_full_cents"`
	WithdrawMinCents  int64                         `json:"withdraw_min_cents"`
	MembershipOptions []CaptureMembershipOption     `json:"membership_options"`
	Entries           []domain.CollectorLedgerEntry `json:"entries"`
	Sessions          []domain.CaptureSession       `json:"sessions"`
	SessionTotal      int64                         `json:"session_total"`
}

func (s *CatalogService) GetCaptureEarnings(ctx context.Context, userID string) (*CaptureEarnings, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	totals, err := deps.repo.GetLedgerTotals(ctx, userID)
	if err != nil {
		return nil, err
	}
	entries, err := deps.repo.ListLedgerByUser(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	sessions, total, err := deps.repo.ListCaptureSessionsByUser(ctx, userID, 30, 0)
	if err != nil {
		return nil, err
	}
	options := append([]CaptureMembershipOption{}, deps.rules.MembershipOptions...)
	return &CaptureEarnings{
		Totals: *totals, RatesPublished: deps.rules.Published(),
		WindowCents: deps.rules.WindowCents, PhotoHalfCents: deps.rules.PhotoHalfCents, PhotoFullCents: deps.rules.PhotoFullCents,
		WithdrawMinCents: deps.rules.WithdrawMinCents, MembershipOptions: options,
		Entries: entries, Sessions: sessions, SessionTotal: total,
	}, nil
}

// RedeemCaptureMembership spends earnings on membership days. The request key
// from the client makes a double tap or a retry spend only once.
func (s *CatalogService) RedeemCaptureMembership(ctx context.Context, userID, optionCode, requestKey string) (*CaptureEarnings, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	if deps.membership == nil {
		return nil, appError("会员兑换暂未开放")
	}
	userID, requestKey = strings.TrimSpace(userID), strings.TrimSpace(requestKey)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if requestKey == "" || len(requestKey) > 80 {
		return nil, badRequest("兑换请求标识不正确")
	}
	var option *CaptureMembershipOption
	for index := range deps.rules.MembershipOptions {
		if deps.rules.MembershipOptions[index].Code == strings.TrimSpace(optionCode) {
			option = &deps.rules.MembershipOptions[index]
		}
	}
	if option == nil || option.CostCents <= 0 || option.Days <= 0 || option.PlanCode == "" {
		return nil, badRequest("兑换选项不存在")
	}
	entry := &domain.CollectorLedgerEntry{
		ID: uuid.NewString(), UserID: userID, EntryType: domain.LedgerMembershipSpend, Status: domain.LedgerStatusConfirmed,
		AmountCents: -option.CostCents, SourceKey: "membership:" + userID + ":" + requestKey,
		Meta: map[string]any{"option_code": option.Code, "plan_code": option.PlanCode, "days": option.Days},
	}
	err = deps.repo.CreateLedgerSpend(ctx, entry, func(totals *campusrepo.LedgerTotals) error {
		if totals.Available < option.CostCents {
			return badRequest("可用奖励不足")
		}
		return nil
	})
	if err != nil && !errors.Is(err, campusrepo.ErrLedgerDuplicate) {
		return nil, err
	}
	if entry.Status == domain.LedgerStatusConfirmed {
		grantErr := deps.membership.GrantCaptureMembership(ctx, userID, "canteen_capture_redeem:"+entry.ID, option.PlanCode, option.Days,
			map[string]any{"ledger_id": entry.ID, "option_code": option.Code})
		if grantErr != nil {
			_, _ = deps.repo.UpdateLedgerStatus(context.WithoutCancel(ctx), entry.ID, []string{domain.LedgerStatusConfirmed}, domain.LedgerStatusCancelled, "会员发放失败，已退回", nil)
			logger.Error(ctx, "采集奖励兑换会员失败", grantErr, slog.String("user_id", userID), slog.String("ledger_id", entry.ID))
			return nil, appError("兑换失败，奖励已退回，请稍后重试")
		}
	}
	logger.Info(ctx, "采集奖励已兑换会员", slog.String("user_id", userID), slog.String("ledger_id", entry.ID), slog.String("option", option.Code))
	return s.GetCaptureEarnings(ctx, userID)
}

// RequestCaptureWithdrawal reserves earnings for a manual payout. The money
// is paid outside the system; ops then mark the row paid or rejected.
func (s *CatalogService) RequestCaptureWithdrawal(ctx context.Context, userID string, amountCents int64, requestKey string) (*CaptureEarnings, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	userID, requestKey = strings.TrimSpace(userID), strings.TrimSpace(requestKey)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if requestKey == "" || len(requestKey) > 80 {
		return nil, badRequest("提现请求标识不正确")
	}
	if deps.rules.WithdrawMinCents <= 0 {
		return nil, appError("提现暂未开放")
	}
	if amountCents < deps.rules.WithdrawMinCents {
		return nil, badRequest(fmt.Sprintf("单次提现至少 %.2f 元", float64(deps.rules.WithdrawMinCents)/100))
	}
	entry := &domain.CollectorLedgerEntry{
		ID: uuid.NewString(), UserID: userID, EntryType: domain.LedgerWithdrawal, Status: domain.LedgerStatusRequested,
		AmountCents: -amountCents, SourceKey: "withdrawal:" + userID + ":" + requestKey, Meta: map[string]any{},
	}
	err = deps.repo.CreateLedgerSpend(ctx, entry, func(totals *campusrepo.LedgerTotals) error {
		if totals.Available < amountCents {
			return badRequest("可提现奖励不足")
		}
		return nil
	})
	if err != nil && !errors.Is(err, campusrepo.ErrLedgerDuplicate) {
		return nil, err
	}
	logger.Info(ctx, "采集奖励提现已申请", slog.String("user_id", userID), slog.String("ledger_id", entry.ID), slog.Int64("amount_cents", amountCents))
	return s.GetCaptureEarnings(ctx, userID)
}

// ListCaptureWithdrawals and ReviewCaptureWithdrawal are for the ops command.
func (s *CatalogService) ListCaptureWithdrawals(ctx context.Context, status string, limit int) ([]domain.CollectorLedgerEntry, error) {
	deps, err := s.captureReady()
	if err != nil {
		return nil, err
	}
	return deps.repo.ListLedgerByTypeStatus(ctx, domain.LedgerWithdrawal, firstNonEmpty(status, domain.LedgerStatusRequested), limit)
}

func (s *CatalogService) ReviewCaptureWithdrawal(ctx context.Context, ledgerID, decision, note string) error {
	deps, err := s.captureReady()
	if err != nil {
		return err
	}
	target := map[string]string{"paid": domain.LedgerStatusPaid, "rejected": domain.LedgerStatusCancelled}[decision]
	if target == "" {
		return badRequest("decision 只能是 paid 或 rejected")
	}
	changed, err := deps.repo.UpdateLedgerStatus(ctx, ledgerID, []string{domain.LedgerStatusRequested}, target, note, nil)
	if err != nil {
		return err
	}
	if !changed {
		return notFound("提现申请不存在或已处理")
	}
	return nil
}

// ReleaseRatePendingCaptureRewards prices rewards recorded before the amounts
// were published.
func (s *CatalogService) ReleaseRatePendingCaptureRewards(ctx context.Context, limit int) (int, error) {
	deps, err := s.captureReady()
	if err != nil {
		return 0, err
	}
	if !deps.rules.Published() {
		return 0, badRequest("奖励金额尚未配置")
	}
	return deps.repo.ReleaseRatePendingRewards(ctx, func(meta map[string]any) int64 {
		return deps.rules.amountFor(strings.TrimSpace(fmt.Sprint(meta["photo_tier"])))
	}, limit)
}
