package service

import (
	"context"
	"strings"

	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
)

type PackagedProductNormalizer struct {
	inner repo.PackagedProductNormalizer
}

func (n PackagedProductNormalizer) Normalize(input PackagedFoodInput) repo.PackagedProductNormalizedFields {
	return n.inner.Normalize(repo.PackagedProductNormalizeInput{
		Brand:            input.Brand,
		ProductName:      input.ProductName,
		DisplayName:      input.DisplayName,
		SearchText:       input.SearchText,
		ProductFamilyKey: input.ProductFamilyKey,
		FlavorText:       input.FlavorText,
		SpecText:         input.SpecText,
		Barcode:          input.Barcode,
		PackageCategory:  input.PackageCategory,
		OCRRawText:       input.OCRRawText,
		NetWeightG:       input.NetWeightG,
		NetContentValue:  input.NetContentValue,
		NetContentUnit:   input.NetContentUnit,
		UnitCount:        input.UnitCount,
		UnitContentValue: input.UnitContentValue,
		UnitContentUnit:  input.UnitContentUnit,
		ReviewStatus:     input.ReviewStatus,
	})
}

type PackagedProductResolver struct {
	nutritionRepo *repo.FoodNutritionRepo
}

func NewPackagedProductResolver(nutritionRepo *repo.FoodNutritionRepo) *PackagedProductResolver {
	return &PackagedProductResolver{nutritionRepo: nutritionRepo}
}

func (r *PackagedProductResolver) Resolve(ctx context.Context, input repo.PackagedFoodResolveInput) (*repo.PackagedResolveResult, error) {
	if r == nil || r.nutritionRepo == nil {
		return &repo.PackagedResolveResult{Status: "unresolved", Score: 0}, nil
	}
	return r.nutritionRepo.ResolvePackagedFood(ctx, input)
}

type PackagedProductSearchService struct {
	nutritionRepo *repo.FoodNutritionRepo
}

func NewPackagedProductSearchService(nutritionRepo *repo.FoodNutritionRepo) *PackagedProductSearchService {
	return &PackagedProductSearchService{nutritionRepo: nutritionRepo}
}

func (s *PackagedProductSearchService) Search(ctx context.Context, query string, limit int) ([]domain.PackagedFood, error) {
	if s == nil || s.nutritionRepo == nil || strings.TrimSpace(query) == "" {
		return []domain.PackagedFood{}, nil
	}
	return s.nutritionRepo.SearchPackagedFood(ctx, query, limit)
}

type PackagedProductQualityService struct{}

func (PackagedProductQualityService) ReviewStatusForDelta(action string) string {
	return PackagedReviewStatusForDeltaAction(action)
}

func PackagedReviewStatusForDeltaAction(action string) string {
	switch strings.TrimSpace(action) {
	case "no_change":
		return "active"
	case "backfill_missing":
		return "needs_backfill"
	case "new_candidate":
		return "new_candidate"
	case "candidate_review", "conflict_review", "empty_extract":
		return "review"
	default:
		return "review"
	}
}
