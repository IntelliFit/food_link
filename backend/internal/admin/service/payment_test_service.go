package service

import (
	"context"
	"strings"

	admindomain "food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
)

type PaymentTestRepo interface {
	GetSummary(ctx context.Context) (*admindomain.PaymentTestSummary, error)
	UpdateSettings(ctx context.Context, enabled bool, updatedBy string) (*admindomain.PaymentTestSettings, error)
	SearchUsers(ctx context.Context, query string, limit int) ([]admindomain.PaymentTestUserSearchResult, error)
	AddUser(ctx context.Context, userID, note, createdBy string) (*admindomain.PaymentTestUser, error)
	RemoveUser(ctx context.Context, userID string) error
}

type PaymentTestService struct {
	repo PaymentTestRepo
}

func NewPaymentTestService(repo PaymentTestRepo) *PaymentTestService {
	return &PaymentTestService{repo: repo}
}

func (s *PaymentTestService) Summary(ctx context.Context) (*admindomain.PaymentTestSummary, error) {
	return s.repo.GetSummary(ctx)
}

func (s *PaymentTestService) UpdateSettings(ctx context.Context, enabled bool, updatedBy string) (*admindomain.PaymentTestSettings, error) {
	return s.repo.UpdateSettings(ctx, enabled, updatedBy)
}

func (s *PaymentTestService) SearchUsers(ctx context.Context, query string, limit int) ([]admindomain.PaymentTestUserSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []admindomain.PaymentTestUserSearchResult{}, nil
	}
	return s.repo.SearchUsers(ctx, query, limit)
}

func (s *PaymentTestService) AddUser(ctx context.Context, userID, note, createdBy string) (*admindomain.PaymentTestUser, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	note = strings.TrimSpace(note)
	if len([]rune(note)) > 200 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "备注不能超过 200 个字符", HTTPStatus: 400}
	}
	return s.repo.AddUser(ctx, userID, note, createdBy)
}

func (s *PaymentTestService) RemoveUser(ctx context.Context, userID string) error {
	return s.repo.RemoveUser(ctx, userID)
}
