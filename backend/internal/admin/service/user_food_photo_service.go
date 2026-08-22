package service

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"gorm.io/datatypes"
)

type UserFoodPhotoRepository interface {
	List(ctx context.Context, input repo.ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error)
	UpsertAnnotation(ctx context.Context, input repo.UpsertUserFoodPhotoAnnotationInput) (*repo.UserFoodPhotoAnnotation, error)
}

type UserFoodPhotoService struct {
	repo    UserFoodPhotoRepository
	storage *storage.Client
}

func NewUserFoodPhotoService(repo UserFoodPhotoRepository, storageClient *storage.Client) *UserFoodPhotoService {
	return &UserFoodPhotoService{repo: repo, storage: storageClient}
}

type ListUserFoodPhotoInput struct {
	Query            string
	Source           string
	Status           string
	CircleVisibility string
	SortBy           string
	SortOrder        string
	AnnotationStatus string
	AnnotationLabel  string
	Page             int
	Limit            int
}

func (s *UserFoodPhotoService) List(ctx context.Context, input ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error) {
	page := input.Page
	if page <= 0 {
		page = 1
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	result, err := s.repo.List(ctx, repo.ListUserFoodPhotoInput{
		Query:            strings.TrimSpace(input.Query),
		Source:           strings.TrimSpace(input.Source),
		Status:           strings.TrimSpace(input.Status),
		CircleVisibility: strings.TrimSpace(input.CircleVisibility),
		SortBy:           strings.TrimSpace(input.SortBy),
		SortOrder:        strings.TrimSpace(input.SortOrder),
		AnnotationStatus: strings.TrimSpace(input.AnnotationStatus),
		AnnotationLabel:  strings.TrimSpace(input.AnnotationLabel),
		Limit:            limit,
		Offset:           (page - 1) * limit,
	})
	if err != nil {
		logger.Error(ctx, "读取用户食物照片失败", err,
			slog.Int("page", page),
			slog.Int("limit", limit),
		)
		return nil, err
	}
	for i := range result.Items {
		item := &result.Items[i]
		if normalized, valid := NormalizeUserFoodPhotoLabels([]string(item.AnnotationLabels)); valid {
			item.AnnotationLabels = datatypes.NewJSONSlice(normalized)
		}
		if s.storage == nil {
			item.ImageURL = item.ImagePath
			item.ThumbnailURL = item.ImagePath
			continue
		}
		item.ImageURL = s.storage.ResolveReferenceURL("food-images", item.ImagePath)
		item.ThumbnailURL = s.storage.BuildImageThumbnailURL("food-images", item.ImagePath, 640)
		item.UserAvatar = s.storage.ResolveUserAvatarURL(item.UserAvatar)
	}
	return result, nil
}

type SaveUserFoodPhotoAnnotationInput struct {
	UserID          string   `json:"user_id" binding:"required"`
	ImageKey        string   `json:"image_key" binding:"required"`
	ReviewStatus    string   `json:"review_status" binding:"required"`
	Labels          []string `json:"labels"`
	ExclusionReason string   `json:"exclusion_reason"`
}

var userFoodPhotoLabels = map[string]struct{}{
	"snack": {}, "fruit": {}, "takeout": {}, "home_cooked": {},
	"restaurant": {}, "beverage": {},
}

var userFoodPhotoExclusionReasons = map[string]struct{}{
	"non_food": {}, "multi_dish_scene": {}, "unusable": {},
	"duplicate": {}, "label_or_package_only": {}, "other": {},
}

func (s *UserFoodPhotoService) SaveAnnotation(ctx context.Context, input SaveUserFoodPhotoAnnotationInput, reviewerID string) (*repo.UserFoodPhotoAnnotation, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.ImageKey = strings.TrimSpace(input.ImageKey)
	input.ReviewStatus = strings.TrimSpace(input.ReviewStatus)
	input.ExclusionReason = strings.TrimSpace(input.ExclusionReason)
	if input.UserID == "" || input.ImageKey == "" {
		return nil, badUserFoodPhotoAnnotationRequest("用户 ID 和图片标识不能为空")
	}
	if input.ReviewStatus != "pending" && input.ReviewStatus != "kept" && input.ReviewStatus != "excluded" {
		return nil, badUserFoodPhotoAnnotationRequest("清洗状态无效")
	}
	labels, validLabels := NormalizeUserFoodPhotoLabels(input.Labels)
	if !validLabels {
		return nil, badUserFoodPhotoAnnotationRequest("包含不支持的食物标签")
	}
	if input.ReviewStatus == "excluded" {
		if _, ok := userFoodPhotoExclusionReasons[input.ExclusionReason]; !ok {
			return nil, badUserFoodPhotoAnnotationRequest("排除图片时必须选择有效原因")
		}
		labels = nil
	} else {
		input.ExclusionReason = ""
	}
	item, err := s.repo.UpsertAnnotation(ctx, repo.UpsertUserFoodPhotoAnnotationInput{
		UserID: input.UserID, ImagePath: input.ImageKey, ReviewStatus: input.ReviewStatus,
		Labels: labels, ExclusionReason: input.ExclusionReason, ReviewedBy: strings.TrimSpace(reviewerID),
	})
	if err != nil {
		logger.Error(ctx, "保存用户食物照片标注失败", err,
			slog.String("user_id", input.UserID), slog.String("review_status", input.ReviewStatus))
		return nil, err
	}
	return item, nil
}

// NormalizeUserFoodPhotoLabels keeps the ranking taxonomy canonical while
// accepting the two retired values from stale Admin clients and stored rows.
func NormalizeUserFoodPhotoLabels(rawLabels []string) ([]string, bool) {
	labels := make([]string, 0, len(rawLabels))
	seen := make(map[string]struct{}, len(rawLabels))
	for _, raw := range rawLabels {
		label := strings.TrimSpace(raw)
		switch label {
		case "dessert":
			label = "snack"
		case "packaged_food":
			continue
		}
		if _, ok := userFoodPhotoLabels[label]; !ok {
			return nil, false
		}
		if _, ok := seen[label]; ok {
			continue
		}
		seen[label] = struct{}{}
		labels = append(labels, label)
	}
	sort.Strings(labels)
	return labels, true
}

func badUserFoodPhotoAnnotationRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}
