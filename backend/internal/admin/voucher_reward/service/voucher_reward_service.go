package service

import (
	"context"
	"fmt"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	voucherdomain "food_link/backend/internal/voucher/domain"

	admindomain "food_link/backend/internal/admin/voucher_reward/domain"
	adminrepo "food_link/backend/internal/admin/voucher_reward/repo"
)

// VoucherIssuer issues admin points vouchers.
type VoucherIssuer interface {
	IssueAdminPointsVoucher(ctx context.Context, adminUserID, targetUserID string, points int, note string) (*voucherdomain.UserVoucher, error)
}

type VoucherRewardService struct {
	repo          *adminrepo.VoucherRewardRepo
	voucherIssuer VoucherIssuer
}

func NewVoucherRewardService(repo *adminrepo.VoucherRewardRepo, voucherIssuer VoucherIssuer) *VoucherRewardService {
	return &VoucherRewardService{repo: repo, voucherIssuer: voucherIssuer}
}

func (s *VoucherRewardService) SearchUsers(ctx context.Context, query string, limit int) ([]admindomain.UserSearchResult, error) {
	return s.repo.SearchUsers(ctx, query, limit)
}

func (s *VoucherRewardService) GetUserSummary(ctx context.Context, userID string) (*admindomain.UserSummary, error) {
	return s.repo.GetUserSummary(ctx, userID)
}

func (s *VoucherRewardService) IssuePointsVoucher(ctx context.Context, adminUserID, targetUserID string, input admindomain.IssuePointsVoucherInput) (*admindomain.IssuePointsVoucherResult, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	if input.Points <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "积分必须大于 0", HTTPStatus: 400}
	}
	if input.Points > 100000 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "单次赠送积分不能超过 100000", HTTPStatus: 400}
	}

	summary, err := s.repo.GetUserSummary(ctx, targetUserID)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户不存在", HTTPStatus: 404}
	}

	voucher, err := s.voucherIssuer.IssueAdminPointsVoucher(ctx, adminUserID, targetUserID, input.Points, strings.TrimSpace(input.Note))
	if err != nil {
		return nil, fmt.Errorf("发放积分礼券失败: %w", err)
	}
	return &admindomain.IssuePointsVoucherResult{VoucherID: voucher.ID}, nil
}
