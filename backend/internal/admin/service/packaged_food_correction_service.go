package service

import (
	"context"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
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
	switch action {
	case "approve":
		submission, food, err := s.repo.ReviewPackagedFoodCorrectionSubmission(ctx, id, true, input.ReviewNote, adminAccountID)
		if err != nil {
			return nil, err
		}
		return &PackagedFoodCorrectionDetail{Submission: submission, PackagedFood: food}, nil
	case "reject":
		submission, food, err := s.repo.ReviewPackagedFoodCorrectionSubmission(ctx, id, false, input.ReviewNote, adminAccountID)
		if err != nil {
			return nil, err
		}
		return &PackagedFoodCorrectionDetail{Submission: submission, PackagedFood: food}, nil
	default:
		return nil, &commonerrors.AppError{Code: 10002, Message: "action 仅支持 approve 或 reject", HTTPStatus: 400}
	}
}
