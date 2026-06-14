package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	admindomain "food_link/backend/internal/admin/domain"
	adminrepo "food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
)

type FeedReportRepo interface {
	List(ctx context.Context, input adminrepo.ListFeedReportInput) (*adminrepo.ListFeedReportResult, error)
	GetByID(ctx context.Context, id string) (*admindomain.FeedReportItem, error)
	UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string) (*admindomain.FeedReportItem, error)
	Delete(ctx context.Context, id string) error
	GetTargetSnapshot(ctx context.Context, targetType, targetID string) (*admindomain.FeedReportTargetSnapshot, error)
}

type SystemMessageSender interface {
	SendSystemMessage(ctx context.Context, receiverID, content string) error
}

type FeedReportService struct {
	repo    FeedReportRepo
	sender  SystemMessageSender
}

func NewFeedReportService(repo FeedReportRepo, sender SystemMessageSender) *FeedReportService {
	return &FeedReportService{repo: repo, sender: sender}
}

type ListFeedReportInput struct {
	Query      string
	Status     string
	TargetType string
	Page       int
	Limit      int
}

var validReportStatuses = map[string]bool{
	"pending":    true,
	"processing": true,
	"resolved":   true,
	"rejected":   true,
}

var terminalStatuses = map[string]bool{
	"resolved": true,
	"rejected": true,
}

var statusTransitionRules = map[string]map[string]bool{
	"pending":    {"processing": true, "resolved": true, "rejected": true},
	"processing": {"resolved": true, "rejected": true},
	"resolved":   {},
	"rejected":   {},
}

func (s *FeedReportService) List(ctx context.Context, input ListFeedReportInput) (*adminrepo.ListFeedReportResult, error) {
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
	return s.repo.List(ctx, adminrepo.ListFeedReportInput{
		Query:      input.Query,
		Status:     input.Status,
		TargetType: input.TargetType,
		Limit:      limit,
		Offset:     (page - 1) * limit,
	})
}

func (s *FeedReportService) Get(ctx context.Context, id string) (*admindomain.FeedReportItem, *admindomain.FeedReportTargetSnapshot, error) {
	item, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	snap, err := s.repo.GetTargetSnapshot(ctx, item.TargetType, item.TargetID)
	if err != nil {
		return item, nil, err
	}
	return item, snap, nil
}

func (s *FeedReportService) UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string) (*admindomain.FeedReportItem, error) {
	status = strings.TrimSpace(strings.ToLower(status))
	if !validReportStatuses[status] {
		return nil, &commonerrors.AppError{Code: 10002, Message: "举报状态无效", HTTPStatus: 400}
	}

	item, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	allowed := statusTransitionRules[item.Status]
	if allowed == nil || !allowed[status] {
		return nil, &commonerrors.AppError{Code: 10002, Message: fmt.Sprintf("不允许从 %s 变更为 %s", item.Status, status), HTTPStatus: 400}
	}

	updated, err := s.repo.UpdateStatus(ctx, id, status, resolutionNote, handledBy)
	if err != nil {
		return nil, err
	}

	if terminalStatuses[status] && s.sender != nil {
		reporterMsg := buildReportResultMessageForReporter(status, resolutionNote)
		reportedMsg := buildReportResultMessageForReported(status, resolutionNote)
		if err := s.sender.SendSystemMessage(ctx, item.ReporterUserID, reporterMsg); err != nil {
			// 记录日志但不阻塞状态更新
			// logger.Warn(ctx, "发送举报结果系统消息失败", slog.String("receiver", item.ReporterUserID), slog.Any("error", err))
		}
		if err := s.sender.SendSystemMessage(ctx, item.ReportedUserID, reportedMsg); err != nil {
			// logger.Warn(ctx, "发送举报结果系统消息失败", slog.String("receiver", item.ReportedUserID), slog.Any("error", err))
		}
	}

	return updated, nil
}

func (s *FeedReportService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func buildReportResultMessageForReporter(status, resolutionNote string) string {
	var base string
	switch status {
	case "resolved":
		base = "你举报的内容已被核实并处理。"
	case "rejected":
		base = "你举报的内容经核实未违规。"
	}
	note := strings.TrimSpace(resolutionNote)
	if note != "" {
		base += "\n处理说明：" + note
	}
	return base
}

func buildReportResultMessageForReported(status, resolutionNote string) string {
	var base string
	switch status {
	case "resolved":
		base = "你发布的内容被举报并核实违规，已做相应处理。"
	case "rejected":
		base = "你发布的内容被举报，经核实未违规。"
	}
	note := strings.TrimSpace(resolutionNote)
	if note != "" {
		base += "\n处理说明：" + note
	}
	return base
}

func (s *FeedReportService) Now() time.Time {
	return time.Now()
}
