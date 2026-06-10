package service

import (
	"context"
	"strings"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	feedbackdomain "food_link/backend/internal/feedback/domain"
)

type FeedbackRepo interface {
	List(ctx context.Context, input repo.ListFeedbackInput) (*repo.ListFeedbackResult, error)
	UpdateStatus(ctx context.Context, id, status string) (*repo.FeedbackItem, error)
}

type FeedbackService struct {
	repo FeedbackRepo
}

type ListFeedbackInput struct {
	Query    string
	Category string
	Status   string
	Page     int
	Limit    int
}

func NewFeedbackService(repo FeedbackRepo) *FeedbackService {
	return &FeedbackService{repo: repo}
}

func (s *FeedbackService) List(ctx context.Context, input ListFeedbackInput) (*repo.ListFeedbackResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	return s.repo.List(ctx, repo.ListFeedbackInput{
		Query:    input.Query,
		Category: input.Category,
		Status:   input.Status,
		Limit:    limit,
		Offset:   (page - 1) * limit,
	})
}

func (s *FeedbackService) UpdateStatus(ctx context.Context, id, status string) (*repo.FeedbackItem, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "反馈 ID 不能为空", HTTPStatus: 400}
	}
	normalized := strings.TrimSpace(strings.ToLower(status))
	switch normalized {
	case feedbackdomain.StatusOpen, "processing", "resolved", "closed":
		return s.repo.UpdateStatus(ctx, id, normalized)
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "反馈状态无效", HTTPStatus: 400}
	}
}
