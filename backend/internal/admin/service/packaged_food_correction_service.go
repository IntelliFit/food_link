package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
)

type PackagedFoodCorrectionRepo interface {
	ListPackagedFoodCorrectionSubmissions(ctx context.Context, input foodrecordrepo.ListPackagedFoodCorrectionsInput) (*foodrecordrepo.ListPackagedFoodCorrectionsResult, error)
	GetPackagedFoodCorrectionSubmission(ctx context.Context, id string) (*foodrecorddomain.PackagedFoodCorrectionSubmission, error)
	GetPackagedFoodByID(ctx context.Context, id string) (*foodrecorddomain.PackagedFood, error)
	ReviewPackagedFoodCorrectionSubmission(ctx context.Context, submissionID string, approved bool, reviewNote string, adminAccountID string) (*foodrecorddomain.PackagedFoodCorrectionSubmission, *foodrecorddomain.PackagedFood, error)
}

type ListPackagedFoodCorrectionInput struct {
	Query  string
	Status string
	Page   int
	Limit  int
}

type PackagedFoodCorrectionDetail struct {
	Submission   *foodrecorddomain.PackagedFoodCorrectionSubmission `json:"submission"`
	PackagedFood *foodrecorddomain.PackagedFood                     `json:"packaged_food"`
}

type ReviewPackagedFoodCorrectionInput struct {
	Action     string `json:"action"`
	ReviewNote string `json:"review_note"`
}

type PackagedFoodCorrectionService struct {
	repo PackagedFoodCorrectionRepo
}

func NewPackagedFoodCorrectionService(repo PackagedFoodCorrectionRepo) *PackagedFoodCorrectionService {
	return &PackagedFoodCorrectionService{repo: repo}
}

func (s *PackagedFoodCorrectionService) List(ctx context.Context, input ListPackagedFoodCorrectionInput) (*foodrecordrepo.ListPackagedFoodCorrectionsResult, error) {
	page := input.Page
	if page <= 0 {
		page = 1
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	return s.repo.ListPackagedFoodCorrectionSubmissions(ctx, foodrecordrepo.ListPackagedFoodCorrectionsInput{
		Query:  input.Query,
		Status: input.Status,
		Limit:  limit,
		Offset: (page - 1) * limit,
	})
}

func (s *PackagedFoodCorrectionService) Get(ctx context.Context, id string) (*PackagedFoodCorrectionDetail, error) {
	submission, err := s.repo.GetPackagedFoodCorrectionSubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	food, err := s.repo.GetPackagedFoodByID(ctx, submission.PackagedFoodID)
	if err != nil {
		return nil, err
	}
	return &PackagedFoodCorrectionDetail{Submission: submission, PackagedFood: food}, nil
}

func (s *PackagedFoodCorrectionService) Review(ctx context.Context, id string, input ReviewPackagedFoodCorrectionInput, adminAccountID string) (*PackagedFoodCorrectionDetail, error) {
	action := strings.TrimSpace(strings.ToLower(input.Action))
	approved := false
	switch action {
	case "approve":
		approved = true
	case "reject":
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "action 仅支持 approve 或 reject", HTTPStatus: 400}
	}

	submission, food, err := s.repo.ReviewPackagedFoodCorrectionSubmission(ctx, id, approved, input.ReviewNote, adminAccountID)
	if err != nil {
		mappedErr := packagedFoodCorrectionReviewError(err)
		attrs := []slog.Attr{
			slog.String("submission_id", strings.TrimSpace(id)),
			slog.String("admin_account_id", strings.TrimSpace(adminAccountID)),
			slog.String("action", action),
		}
		var appErr *commonerrors.AppError
		if errors.As(mappedErr, &appErr) && appErr.HTTPStatus == http.StatusConflict {
			logger.Warn(ctx, "包装食品纠错提案审批冲突", append(attrs, slog.String("error", mappedErr.Error()))...)
		} else {
			logger.Error(ctx, "包装食品纠错提案审批失败", mappedErr, attrs...)
		}
		return nil, mappedErr
	}
	logger.Info(ctx, "包装食品纠错提案审批完成",
		slog.String("submission_id", submission.ID),
		slog.String("packaged_food_id", submission.PackagedFoodID),
		slog.String("admin_account_id", strings.TrimSpace(adminAccountID)),
		slog.String("status", submission.Status),
	)
	return &PackagedFoodCorrectionDetail{Submission: submission, PackagedFood: food}, nil
}

func packagedFoodCorrectionReviewError(err error) error {
	switch {
	case errors.Is(err, foodrecordrepo.ErrPackagedFoodCorrectionAlreadyReviewed):
		return &commonerrors.AppError{Code: 10003, Message: "该纠错提案已处理，请刷新后查看", HTTPStatus: http.StatusConflict}
	case errors.Is(err, foodrecordrepo.ErrPackagedFoodCorrectionStale):
		return &commonerrors.AppError{Code: 10003, Message: "包装食品数据已更新，该提案已过期", HTTPStatus: http.StatusConflict}
	default:
		return err
	}
}
