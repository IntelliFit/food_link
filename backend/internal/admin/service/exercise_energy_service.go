package service

import (
	"context"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
)

type ExerciseEnergyRepo interface {
	ListExerciseEnergyActivities(ctx context.Context, input healthrepo.ListExerciseEnergyActivitiesInput) (*healthrepo.ListExerciseEnergyActivitiesResult, error)
	GetExerciseEnergyActivity(ctx context.Context, id string) (*domain.ExerciseEnergyActivity, error)
	ListExerciseEnergyAliases(ctx context.Context, activityID string) ([]domain.ExerciseEnergyAlias, error)
	UpdateExerciseEnergyActivity(ctx context.Context, id string, patch healthrepo.ExerciseEnergyActivityPatch, aliases *[]string) (*domain.ExerciseEnergyActivity, error)
}

type ExerciseEnergyService struct {
	repo ExerciseEnergyRepo
}

type ListExerciseEnergyInput struct {
	Query        string
	ReviewStatus string
	Active       string
	Page         int
	Limit        int
}

type UpdateExerciseEnergyInput struct {
	CanonicalName *string   `json:"canonical_name"`
	Category      *string   `json:"category"`
	Intensity     *string   `json:"intensity"`
	METValue      *float64  `json:"met_value"`
	Source        *string   `json:"source"`
	Evidence      *string   `json:"evidence"`
	ReviewStatus  *string   `json:"review_status"`
	IsActive      *bool     `json:"is_active"`
	Aliases       *[]string `json:"aliases"`
}

func NewExerciseEnergyService(repo ExerciseEnergyRepo) *ExerciseEnergyService {
	return &ExerciseEnergyService{repo: repo}
}

func (s *ExerciseEnergyService) List(ctx context.Context, input ListExerciseEnergyInput) (*healthrepo.ListExerciseEnergyActivitiesResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	return s.repo.ListExerciseEnergyActivities(ctx, healthrepo.ListExerciseEnergyActivitiesInput{
		Query:        input.Query,
		ReviewStatus: input.ReviewStatus,
		Active:       input.Active,
		Limit:        limit,
		Offset:       (page - 1) * limit,
	})
}

func (s *ExerciseEnergyService) Get(ctx context.Context, id string) (map[string]any, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动 ID 不能为空", HTTPStatus: 400}
	}
	item, err := s.repo.GetExerciseEnergyActivity(ctx, id)
	if err != nil {
		return nil, err
	}
	aliases, err := s.repo.ListExerciseEnergyAliases(ctx, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"item": item, "aliases": aliases}, nil
}

func (s *ExerciseEnergyService) Update(ctx context.Context, id string, input UpdateExerciseEnergyInput) (map[string]any, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动 ID 不能为空", HTTPStatus: 400}
	}
	patch := healthrepo.ExerciseEnergyActivityPatch{}
	if input.CanonicalName != nil {
		name := strings.TrimSpace(*input.CanonicalName)
		if name == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "运动名称不能为空", HTTPStatus: 400}
		}
		patch["canonical_name"] = name
		patch["normalized_name"] = normalizeExerciseAdminName(name)
	}
	setStringPatch(patch, "category", input.Category)
	setStringPatch(patch, "intensity", input.Intensity)
	setStringPatch(patch, "source", input.Source)
	setStringPatch(patch, "evidence", input.Evidence)
	if input.ReviewStatus != nil {
		status := strings.TrimSpace(*input.ReviewStatus)
		switch status {
		case "pending", "active", "disabled":
			patch["review_status"] = status
		default:
			return nil, &commonerrors.AppError{Code: 10002, Message: "审核状态无效", HTTPStatus: 400}
		}
	}
	if input.METValue != nil {
		if *input.METValue <= 0 || *input.METValue > 30 {
			return nil, &commonerrors.AppError{Code: 10002, Message: "MET 必须在 0 到 30 之间", HTTPStatus: 400}
		}
		patch["met_value"] = *input.METValue
	}
	if input.IsActive != nil {
		patch["is_active"] = *input.IsActive
	}
	item, err := s.repo.UpdateExerciseEnergyActivity(ctx, id, patch, input.Aliases)
	if err != nil {
		return nil, err
	}
	aliases, err := s.repo.ListExerciseEnergyAliases(ctx, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"message": "保存成功", "item": item, "aliases": aliases}, nil
}

func setStringPatch(patch map[string]any, key string, value *string) {
	if value == nil {
		return
	}
	patch[key] = strings.TrimSpace(*value)
}

func normalizeExerciseAdminName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "", "，", "", ",", "", "。", "", ".", "", "；", "", ";", "", "：", "", ":", "")
	return replacer.Replace(value)
}
