package service

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/feedback/domain"
	"food_link/backend/pkg/logger"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
	"gorm.io/datatypes"
)

const (
	maxContentLength        = 2000
	maxContactLength        = 200
	maxRecentRequestCount   = 50
	maxRecentRequestPathLen = 240
)

type FeedbackRepo interface {
	Create(ctx context.Context, feedback *domain.UserFeedback) error
}

type FeedbackNotifier interface {
	NotifyNewFeedback(ctx context.Context, feedback *domain.UserFeedback) error
}

type FeedbackBotSyncer interface {
	SyncUserFeedback(ctx context.Context, feedback *domain.UserFeedback) error
}

type SystemMessageSender interface {
	SendSystemMessage(ctx context.Context, receiverID, content string) error
}

type FeedbackService struct {
	repo              FeedbackRepo
	uploads           *UploadService
	notifier          FeedbackNotifier
	feedbackBotSyncer FeedbackBotSyncer
	sender            SystemMessageSender
}

type SubmitInput struct {
	Category        string
	Content         string
	Contact         string
	PagePath        string
	AppVersion      string
	ClientInfo      map[string]any
	RecentRequests  []domain.RecentRequestTrace
	ImageURLs       []string
	SubmitTraceID   string
	SubmitRequestID string
	SubmitHostName  string
}

func NewFeedbackService(repo FeedbackRepo, uploads *UploadService, notifier FeedbackNotifier, sender ...SystemMessageSender) *FeedbackService {
	var messageSender SystemMessageSender
	if len(sender) > 0 {
		messageSender = sender[0]
	}
	return &FeedbackService{repo: repo, uploads: uploads, notifier: notifier, sender: messageSender}
}

func (s *FeedbackService) WithFeedbackBotSyncer(syncer FeedbackBotSyncer) *FeedbackService {
	if s != nil {
		s.feedbackBotSyncer = syncer
	}
	return s
}

func (s *FeedbackService) Submit(ctx context.Context, userID string, input SubmitInput) (string, error) {
	userID = strings.TrimSpace(userID)
	content := strings.TrimSpace(input.Content)
	if userID == "" || content == "" || utf8.RuneCountInString(content) < 5 {
		return "", commonerrors.ErrBadRequest
	}
	if utf8.RuneCountInString(content) > maxContentLength {
		content = truncateRunes(content, maxContentLength)
	}
	contact := truncateRunes(strings.TrimSpace(input.Contact), maxContactLength)
	imageURLs := []string{}
	if s.uploads != nil && len(input.ImageURLs) > 0 {
		normalized, err := s.uploads.NormalizeOwnedImageURLs(userID, input.ImageURLs)
		if err != nil {
			return "", err
		}
		imageURLs = normalized
	}
	feedback := &domain.UserFeedback{
		UserID:          userID,
		Category:        normalizeCategory(input.Category),
		Content:         content,
		Contact:         contact,
		PagePath:        truncateRunes(strings.TrimSpace(input.PagePath), maxRecentRequestPathLen),
		AppVersion:      truncateRunes(strings.TrimSpace(input.AppVersion), 80),
		ClientInfo:      datatypes.JSONMap(input.ClientInfo),
		RecentRequests:  datatypes.JSONSlice[domain.RecentRequestTrace](normalizeRecentRequests(input.RecentRequests)),
		ImageURLs:       datatypes.JSONSlice[string](imageURLs),
		SubmitTraceID:   truncateRunes(strings.TrimSpace(input.SubmitTraceID), 80),
		SubmitRequestID: truncateRunes(strings.TrimSpace(input.SubmitRequestID), 80),
		SubmitHostName:  truncateRunes(strings.TrimSpace(input.SubmitHostName), 120),
		Status:          domain.StatusOpen,
	}
	if feedback.ClientInfo == nil {
		feedback.ClientInfo = datatypes.JSONMap{}
	}
	if feedback.RecentRequests == nil {
		feedback.RecentRequests = datatypes.JSONSlice[domain.RecentRequestTrace]{}
	}
	if feedback.ImageURLs == nil {
		feedback.ImageURLs = datatypes.JSONSlice[string]{}
	}
	if err := s.repo.Create(ctx, feedback); err != nil {
		return "", err
	}
	s.notifySubmitSuccessAsync(ctx, feedback)
	s.notifyNewFeedbackAsync(ctx, feedback)
	s.syncFeedbackBotAsync(ctx, feedback)
	return feedback.ID, nil
}

func (s *FeedbackService) notifySubmitSuccessAsync(parentCtx context.Context, feedback *domain.UserFeedback) {
	if s == nil || s.sender == nil || feedback == nil {
		return
	}
	snapshot := *feedback
	go func() {
		spanCtx, endSpan := feedbackAsyncSpan(parentCtx, "意见反馈提交站内信发送", &snapshot)
		defer endSpan()
		notifyCtx, cancel := context.WithTimeout(spanCtx, 8*time.Second)
		defer cancel()
		if err := s.sender.SendSystemMessage(notifyCtx, snapshot.UserID, buildFeedbackSubmittedMessage(&snapshot)); err != nil {
			logger.Warn(notifyCtx, "意见反馈提交站内信发送失败",
				slog.String("feedback_id", snapshot.ID),
				slog.String("user_id", snapshot.UserID),
				slog.String("error", err.Error()),
			)
			return
		}
		logger.Info(notifyCtx, "意见反馈提交站内信发送成功",
			slog.String("feedback_id", snapshot.ID),
			slog.String("user_id", snapshot.UserID),
		)
	}()
}

func buildFeedbackSubmittedMessage(feedback *domain.UserFeedback) string {
	if feedback == nil {
		return "我们已经收到你的意见反馈，会尽快查看。"
	}
	category := feedbackCategoryLabel(feedback.Category)
	return "我们已经收到你的意见反馈。\n反馈类型：" + category + "\n反馈编号：" + feedback.ID + "\n感谢你帮我们把食探变得更好。"
}

func (s *FeedbackService) notifyNewFeedbackAsync(parentCtx context.Context, feedback *domain.UserFeedback) {
	if s == nil || s.notifier == nil || feedback == nil {
		return
	}
	snapshot := *feedback
	go func() {
		spanCtx, endSpan := feedbackAsyncSpan(parentCtx, "意见反馈飞书通知发送", &snapshot)
		defer endSpan()
		notifyCtx, cancel := context.WithTimeout(spanCtx, 12*time.Second)
		defer cancel()
		if err := s.notifier.NotifyNewFeedback(notifyCtx, &snapshot); err != nil {
			logger.Warn(notifyCtx, "意见反馈飞书通知失败",
				slog.String("feedback_id", snapshot.ID),
				slog.String("user_id", snapshot.UserID),
				slog.String("error", err.Error()),
			)
		}
	}()
}

func (s *FeedbackService) syncFeedbackBotAsync(parentCtx context.Context, feedback *domain.UserFeedback) {
	if s == nil || s.feedbackBotSyncer == nil || feedback == nil {
		return
	}
	snapshot := *feedback
	go func() {
		spanCtx, endSpan := feedbackAsyncSpan(parentCtx, "意见反馈同步到反馈机器人", &snapshot)
		defer endSpan()
		syncCtx, cancel := context.WithTimeout(spanCtx, 12*time.Second)
		defer cancel()
		if err := s.feedbackBotSyncer.SyncUserFeedback(syncCtx, &snapshot); err != nil {
			logger.Warn(syncCtx, "意见反馈同步反馈机器人失败",
				slog.String("feedback_id", snapshot.ID),
				slog.String("user_id", snapshot.UserID),
				slog.String("error", err.Error()),
			)
			return
		}
		logger.Info(syncCtx, "意见反馈已同步到反馈机器人",
			slog.String("feedback_id", snapshot.ID),
			slog.String("user_id", snapshot.UserID),
		)
	}()
}

func feedbackAsyncSpan(parentCtx context.Context, name string, feedback *domain.UserFeedback) (context.Context, func()) {
	baseCtx := context.Background()
	if parentCtx != nil {
		baseCtx = context.WithoutCancel(parentCtx)
	}
	attrs := []attribute.KeyValue{}
	if feedback != nil {
		attrs = append(attrs,
			attribute.String("feedback.id", feedback.ID),
			attribute.String("feedback.user_id", feedback.UserID),
			attribute.String("feedback.category", feedback.Category),
		)
	}
	ctx, span := apm.StartSpan(baseCtx, name, attrs...)
	return ctx, func() {
		span.End()
	}
}

func normalizeCategory(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case domain.CategoryBug, domain.CategorySuggestion, domain.CategoryExperience, domain.CategoryOther:
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return domain.CategoryOther
	}
}

func normalizeRecentRequests(items []domain.RecentRequestTrace) []domain.RecentRequestTrace {
	if len(items) == 0 {
		return []domain.RecentRequestTrace{}
	}
	if len(items) > maxRecentRequestCount {
		items = items[len(items)-maxRecentRequestCount:]
	}
	out := make([]domain.RecentRequestTrace, 0, len(items))
	for _, item := range items {
		method := strings.ToUpper(strings.TrimSpace(item.Method))
		if method == "" {
			method = "GET"
		}
		out = append(out, domain.RecentRequestTrace{
			Method:       truncateRunes(method, 12),
			Path:         truncateRunes(strings.TrimSpace(item.Path), maxRecentRequestPathLen),
			StatusCode:   item.StatusCode,
			DurationMs:   item.DurationMs,
			StartedAt:    truncateRunes(strings.TrimSpace(item.StartedAt), 40),
			TraceID:      truncateRunes(strings.TrimSpace(item.TraceID), 80),
			RequestID:    truncateRunes(strings.TrimSpace(item.RequestID), 80),
			HostName:     truncateRunes(strings.TrimSpace(item.HostName), 120),
			ErrorMessage: truncateRunes(strings.TrimSpace(item.ErrorMessage), 160),
		})
	}
	return out
}

func truncateRunes(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}
