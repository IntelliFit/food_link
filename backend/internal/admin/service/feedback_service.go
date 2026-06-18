package service

import (
	"context"
	"fmt"
	"strings"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	feedbackdomain "food_link/backend/internal/feedback/domain"
)

type FeedbackRepo interface {
	List(ctx context.Context, input repo.ListFeedbackInput) (*repo.ListFeedbackResult, error)
	UpdateStatus(ctx context.Context, id, status, resolutionMessage string, rewardCredits *int, handledBy string) (*repo.FeedbackItem, error)
	CountByStatus(ctx context.Context) (map[string]int64, error)
}

type FeedbackSystemMessageSender interface {
	SendSystemMessage(ctx context.Context, receiverID, content string) error
}

type FeedbackService struct {
	repo   FeedbackRepo
	sender FeedbackSystemMessageSender
}

type ListFeedbackInput struct {
	Query    string
	Category string
	Status   string
	Page     int
	Limit    int
}

func NewFeedbackService(repo FeedbackRepo, sender ...FeedbackSystemMessageSender) *FeedbackService {
	var messageSender FeedbackSystemMessageSender
	if len(sender) > 0 {
		messageSender = sender[0]
	}
	return &FeedbackService{repo: repo, sender: messageSender}
}

func (s *FeedbackService) GetStatusStats(ctx context.Context) (map[string]int64, error) {
	return s.repo.CountByStatus(ctx)
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

func (s *FeedbackService) UpdateStatus(ctx context.Context, id, status, resolutionMessage string, rewardCredits *int, handledBy string) (*repo.FeedbackItem, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "反馈 ID 不能为空", HTTPStatus: 400}
	}
	normalized := strings.TrimSpace(strings.ToLower(status))
	switch normalized {
	case feedbackdomain.StatusOpen, "processing", "resolved", "closed":
		if normalized == "resolved" && rewardCredits == nil {
			return nil, &commonerrors.AppError{Code: 10002, Message: "处理为已解决时必须选择奖励积分，可填写 0", HTTPStatus: 400}
		}
		if rewardCredits != nil && *rewardCredits < 0 {
			return nil, &commonerrors.AppError{Code: 10002, Message: "奖励积分不能小于 0", HTTPStatus: 400}
		}
		updated, err := s.repo.UpdateStatus(ctx, id, normalized, resolutionMessage, rewardCredits, handledBy)
		if err != nil {
			return nil, err
		}
		if (normalized == "resolved" || normalized == "closed") && s.sender != nil {
			if err := s.sender.SendSystemMessage(ctx, updated.UserID, buildFeedbackResultMessage(normalized, updated.ResolutionMessage, updated.RewardCredits)); err != nil {
				// 站内信失败不阻塞反馈处理结果落库。
			}
		}
		return updated, nil
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "反馈状态无效", HTTPStatus: 400}
	}
}

func buildFeedbackResultMessage(status, resolutionMessage string, rewardCredits int) string {
	base := "你的意见反馈已处理完成。"
	if status == "closed" {
		base = "你的意见反馈已关闭。"
	}
	if note := strings.TrimSpace(resolutionMessage); note != "" {
		base += "\n处理说明：" + note
	}
	if status == "resolved" && rewardCredits > 0 {
		base += fmt.Sprintf("\n奖励积分：+%d", rewardCredits)
	}
	return base
}
