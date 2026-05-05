package service

import (
	"context"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
)

type FoodNutritionService struct {
	nutritionRepo *repo.FoodNutritionRepo
}

func NewFoodNutritionService(nutritionRepo *repo.FoodNutritionRepo) *FoodNutritionService {
	return &FoodNutritionService{nutritionRepo: nutritionRepo}
}

func (s *FoodNutritionService) Search(ctx context.Context, query string, limit int) ([]map[string]any, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "query 不能为空", HTTPStatus: 400}
	}
	foods, err := s.nutritionRepo.Search(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	if len(foods) == 0 {
		_ = s.nutritionRepo.LogUnresolved(ctx, q)
	}

	qLower := strings.ToLower(q)
	items := make([]map[string]any, 0, len(foods))
	for _, f := range foods {
		matchSource := "canonical"
		if !strings.Contains(strings.ToLower(f.CanonicalName), qLower) {
			matchSource = "alias"
		}
		items = append(items, map[string]any{
			"food_id":   f.ID,
			"canonical_name": f.CanonicalName,
			"match_source": matchSource,
			"score": 0,
			"source": "nutrition_library",
			"unit_nutrition_per_100g": map[string]any{
				"calories": f.KcalPer100g,
				"protein":  f.ProteinPer100g,
				"carbs":    f.CarbsPer100g,
				"fat":      f.FatPer100g,
				"fiber":    f.FiberPer100g,
				"sugar":    f.SugarPer100g,
				"sodiumMg": f.SodiumMgPer100g,
			},
		})
	}
	return items, nil
}

func (s *FoodNutritionService) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	return s.nutritionRepo.GetUnresolvedTop(ctx, limit)
}
