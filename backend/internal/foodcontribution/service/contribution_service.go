package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"unicode"

	commonerrors "food_link/backend/internal/common/errors"
	contributiondomain "food_link/backend/internal/foodcontribution/domain"
	contributionrepo "food_link/backend/internal/foodcontribution/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"github.com/jackc/pgx/v5/pgconn"
)

type RewardAwarder interface {
	AwardStandardFoodContribution(ctx context.Context, userID, contributionID string, meta map[string]any) (map[string]any, error)
}

type ContributionRepository interface {
	Create(ctx context.Context, item *contributiondomain.FoodNutritionContribution) error
	Mine(ctx context.Context, userID string) ([]contributiondomain.FoodNutritionContribution, error)
	List(ctx context.Context, input contributionrepo.ListInput) (*contributionrepo.ListResult, error)
	Get(ctx context.Context, id string) (*contributiondomain.FoodNutritionContribution, error)
	MarkRewarded(ctx context.Context, id string) error
	Review(ctx context.Context, id, action, targetFoodID, note, reviewerID string) (*contributiondomain.FoodNutritionContribution, error)
}

type ContributionService struct {
	repo    ContributionRepository
	rewards RewardAwarder
	storage *storage.Client
}

func NewContributionService(repo ContributionRepository, rewards RewardAwarder, storageClients ...*storage.Client) *ContributionService {
	service := &ContributionService{repo: repo, rewards: rewards}
	if len(storageClients) > 0 {
		service.storage = storageClients[0]
	}
	return service
}

type SubmitInput struct {
	CanonicalName      string   `json:"canonical_name"`
	KcalPer100g        float64  `json:"kcal_per_100g"`
	ProteinPer100g     float64  `json:"protein_per_100g"`
	CarbsPer100g       float64  `json:"carbs_per_100g"`
	FatPer100g         float64  `json:"fat_per_100g"`
	SourceText         string   `json:"source_text"`
	EvidenceImagePaths []string `json:"evidence_image_paths"`
}

type ReviewInput struct {
	Action       string `json:"action"`
	TargetFoodID string `json:"target_food_id"`
	ReviewNote   string `json:"review_note"`
}

func (s *ContributionService) Submit(ctx context.Context, userID string, input SubmitInput) (*contributiondomain.FoodNutritionContribution, error) {
	name := strings.TrimSpace(input.CanonicalName)
	if name == "" || len([]rune(name)) > 100 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请输入不超过100字的食物名称", HTTPStatus: 400}
	}
	if input.KcalPer100g <= 0 || input.ProteinPer100g < 0 || input.CarbsPer100g < 0 || input.FatPer100g < 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请填写有效的每100g热量和三大营养素", HTTPStatus: 400}
	}
	normalizedName := normalizeName(name)
	if normalizedName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食物名称必须包含文字或数字", HTTPStatus: 400}
	}
	images := uniqueNonEmpty(input.EvidenceImagePaths, 0)
	if len(images) > 5 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "证据图片最多上传5张", HTTPStatus: 400}
	}
	if strings.TrimSpace(input.SourceText) == "" && len(images) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "来源说明或证据图片至少填写一项", HTTPStatus: 400}
	}
	if s.storage != nil {
		for index, raw := range images {
			key := s.storage.ResolveObjectKey("food-images", raw)
			if key == "" || strings.HasPrefix(key, "../") || strings.Contains(key, "/../") {
				return nil, &commonerrors.AppError{Code: 10002, Message: "证据图片必须来自食探图片存储", HTTPStatus: 400}
			}
			images[index] = key
		}
	}
	item := &contributiondomain.FoodNutritionContribution{
		UserID: userID, CanonicalName: name, NormalizedName: normalizedName,
		KcalPer100g: input.KcalPer100g, ProteinPer100g: input.ProteinPer100g,
		CarbsPer100g: input.CarbsPer100g, FatPer100g: input.FatPer100g,
		SourceText: strings.TrimSpace(input.SourceText), EvidenceImagePaths: images,
		ExtraNutrients: map[string]any{}, Status: "pending",
	}
	if err := s.repo.Create(ctx, item); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "该食物已有待审核贡献，请勿重复提交", HTTPStatus: 409}
		}
		return nil, err
	}
	logger.Info(ctx, "标准食物贡献提交完成", slog.String("user_id", userID), slog.String("contribution_id", item.ID))
	return s.resolveEvidenceURLItem(item), nil
}

func (s *ContributionService) Mine(ctx context.Context, userID string) ([]contributiondomain.FoodNutritionContribution, error) {
	items, err := s.repo.Mine(ctx, userID)
	return s.resolveEvidenceURLs(items), err
}

func (s *ContributionService) List(ctx context.Context, input contributionrepo.ListInput) (*contributionrepo.ListResult, error) {
	result, err := s.repo.List(ctx, input)
	if result != nil {
		result.Items = s.resolveEvidenceURLs(result.Items)
	}
	return result, err
}

func (s *ContributionService) Get(ctx context.Context, id string) (*contributiondomain.FoodNutritionContribution, error) {
	item, err := s.repo.Get(ctx, id)
	return s.resolveEvidenceURLItem(item), err
}

func (s *ContributionService) Review(ctx context.Context, id, reviewerID string, input ReviewInput) (*contributiondomain.FoodNutritionContribution, error) {
	action := strings.ToLower(strings.TrimSpace(input.Action))
	if action != "approve_new" && action != "merge_existing" && action != "reject" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "审核动作不正确", HTTPStatus: 400}
	}
	if action == "reject" && strings.TrimSpace(input.ReviewNote) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "驳回时必须填写原因", HTTPStatus: 400}
	}
	item, err := s.repo.Review(ctx, id, action, input.TargetFoodID, strings.TrimSpace(input.ReviewNote), reviewerID)
	if err != nil {
		return nil, err
	}
	if item.Status == "approved" && s.rewards != nil {
		_, rewardErr := s.rewards.AwardStandardFoodContribution(ctx, item.UserID, item.ID, map[string]any{
			"food_name": item.CanonicalName, "target_food_id": item.TargetFoodID,
		})
		if rewardErr != nil {
			logger.Error(ctx, "标准食物贡献审核通过但积分发放失败", rewardErr,
				slog.String("contribution_id", item.ID), slog.String("user_id", item.UserID))
			return nil, rewardErr
		}
		if err := s.repo.MarkRewarded(ctx, item.ID); err != nil {
			return nil, err
		}
	}
	logger.Info(ctx, "标准食物贡献审核完成", slog.String("contribution_id", item.ID), slog.String("review.action", action), slog.String("reviewer_id", reviewerID))
	result, getErr := s.repo.Get(ctx, item.ID)
	return s.resolveEvidenceURLItem(result), getErr
}

func (s *ContributionService) resolveEvidenceURLs(items []contributiondomain.FoodNutritionContribution) []contributiondomain.FoodNutritionContribution {
	if s.storage == nil {
		return items
	}
	for index := range items {
		items[index].EvidenceImagePaths = s.storage.ResolveReferenceURLs("food-images", items[index].EvidenceImagePaths)
	}
	return items
}

func (s *ContributionService) resolveEvidenceURLItem(item *contributiondomain.FoodNutritionContribution) *contributiondomain.FoodNutritionContribution {
	if item == nil || s.storage == nil {
		return item
	}
	copyItem := *item
	copyItem.EvidenceImagePaths = s.storage.ResolveReferenceURLs("food-images", item.EvidenceImagePaths)
	return &copyItem
}

func normalizeName(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || strings.ContainsRune("，。,.、·-_/()（）[]【】", r) {
			return -1
		}
		return unicode.ToLower(r)
	}, strings.TrimSpace(value))
}

func uniqueNonEmpty(values []string, limit int) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		if limit > 0 && len(result) >= limit {
			break
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
