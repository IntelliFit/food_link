package service

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

// adminTransitions lists the statuses an admin may move a promoter to from
// each status. Review (approve / reject) only acts on pending applications;
// terminated is final.
var adminTransitions = map[string][]string{
	domain.StatusActive:     {domain.StatusSuspended, domain.StatusTerminated},
	domain.StatusSuspended:  {domain.StatusActive, domain.StatusTerminated},
	domain.StatusTerminated: nil,
}

type AdminPromoterPage struct {
	Items []domain.AdminPromoter `json:"items"`
	Total int64                  `json:"total"`
}

func (s *PromoterService) AdminList(ctx context.Context, status string, page, size int) (*AdminPromoterPage, error) {
	status = strings.TrimSpace(status)
	limit, offset := pageBounds(page, size)
	rows, total, err := s.repo.List(ctx, status, limit, offset)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.UserID)
	}
	nicknames, err := s.repo.Nicknames(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	items := make([]domain.AdminPromoter, 0, len(rows))
	for _, row := range rows {
		summary, err := s.repo.Summary(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, domain.AdminPromoter{Promoter: row, Nickname: nicknames[row.UserID], Summary: summary})
	}
	return &AdminPromoterPage{Items: items, Total: total}, nil
}

type ReviewInput struct {
	Approve           bool   `json:"approve"`
	RealNameConfirmed bool   `json:"real_name_confirmed"`
	RateBps           *int   `json:"rate_bps"`
	Note              string `json:"note"`
}

// Review approves or rejects a pending application. Approval requires the
// reviewer to have confirmed the applicant's real name.
func (s *PromoterService) Review(ctx context.Context, admin, promoterID string, input ReviewInput) (*domain.Promoter, error) {
	if !isUUID(promoterID) {
		return nil, commonerrors.ErrNotFound
	}
	if err := validateRate(input.RateBps); err != nil {
		return nil, err
	}
	note := strings.TrimSpace(input.Note)
	updates := map[string]any{"review_note": note, "reviewed_by": admin, "reviewed_at": s.now()}
	if input.Approve {
		if !input.RealNameConfirmed {
			return nil, appError(http.StatusBadRequest, "通过前请先核实推广员实名信息")
		}
		updates["status"] = domain.StatusActive
		updates["real_name_confirmed"] = true
		if input.RateBps != nil {
			updates["commission_rate_bps"] = *input.RateBps
		}
	} else {
		if note == "" {
			return nil, appError(http.StatusBadRequest, "驳回时请填写原因，用户会看到这条说明")
		}
		updates["status"] = domain.StatusRejected
	}
	updated, err := s.repo.UpdateIfStatus(ctx, promoterID, []string{domain.StatusPendingReview}, updates)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, s.staleStateError(ctx, promoterID)
	}
	logger.Info(ctx, "推广员申请已审核",
		slog.String("promoter_id", promoterID), slog.String("admin", admin), slog.String("status", updated.Status))
	return updated, nil
}

type StatusInput struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

// ChangeStatus suspends, reactivates or terminates an approved promoter.
// Suspended promoters keep earning but will not be able to withdraw;
// terminated promoters stop earning on new orders.
func (s *PromoterService) ChangeStatus(ctx context.Context, admin, promoterID string, input StatusInput) (*domain.Promoter, error) {
	if !isUUID(promoterID) {
		return nil, commonerrors.ErrNotFound
	}
	target := strings.TrimSpace(input.Status)
	var from []string
	for status, targets := range adminTransitions {
		for _, t := range targets {
			if t == target {
				from = append(from, status)
			}
		}
	}
	if len(from) == 0 {
		return nil, appError(http.StatusBadRequest, "不支持的推广员状态")
	}
	updated, err := s.repo.UpdateIfStatus(ctx, promoterID, from, map[string]any{
		"status": target, "review_note": strings.TrimSpace(input.Note), "reviewed_by": admin, "reviewed_at": s.now(),
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, s.staleStateError(ctx, promoterID)
	}
	logger.Info(ctx, "推广员状态已变更",
		slog.String("promoter_id", promoterID), slog.String("admin", admin), slog.String("status", target))
	return updated, nil
}

type RateInput struct {
	RateBps *int `json:"rate_bps"`
}

// SetRate overrides one promoter's commission rate for orders accrued from
// now on; nil returns them to the default rate. Existing commissions keep
// the rate they were created with.
func (s *PromoterService) SetRate(ctx context.Context, admin, promoterID string, input RateInput) (*domain.Promoter, error) {
	if !isUUID(promoterID) {
		return nil, commonerrors.ErrNotFound
	}
	if err := validateRate(input.RateBps); err != nil {
		return nil, err
	}
	var rate any
	if input.RateBps != nil {
		rate = *input.RateBps
	}
	updated, err := s.repo.UpdateIfStatus(ctx, promoterID,
		[]string{domain.StatusPendingReview, domain.StatusActive, domain.StatusSuspended},
		map[string]any{"commission_rate_bps": rate, "reviewed_by": admin, "reviewed_at": s.now()})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, s.staleStateError(ctx, promoterID)
	}
	logger.Info(ctx, "推广员佣金比例已调整", slog.String("promoter_id", promoterID), slog.String("admin", admin))
	return updated, nil
}

func (s *PromoterService) staleStateError(ctx context.Context, promoterID string) error {
	current, err := s.repo.GetByID(ctx, promoterID)
	if err != nil {
		return err
	}
	if current == nil {
		return commonerrors.ErrNotFound
	}
	return appError(http.StatusConflict, "推广员当前状态不允许此操作，请刷新后重试")
}

func isUUID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

func validateRate(rate *int) error {
	if rate != nil && (*rate < 0 || *rate > 10000) {
		return appError(http.StatusBadRequest, "佣金比例须在 0% 到 100% 之间")
	}
	return nil
}
