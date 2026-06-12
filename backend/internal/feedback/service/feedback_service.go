package service

import (
	"context"
	"strings"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/feedback/domain"

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

type FeedbackService struct {
	repo     FeedbackRepo
	uploads  *UploadService
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

func NewFeedbackService(repo FeedbackRepo, uploads *UploadService) *FeedbackService {
	return &FeedbackService{repo: repo, uploads: uploads}
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
	return feedback.ID, nil
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
