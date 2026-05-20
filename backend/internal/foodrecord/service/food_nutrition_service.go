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

type PackagedFoodInput struct {
	Brand                 string
	ProductName           string
	NetWeightG            float64
	ServingWeightG        float64
	KcalPer100g           float64
	ProteinPer100g        float64
	CarbsPer100g          float64
	FatPer100g            float64
	FiberPer100g          float64
	SugarPer100g          float64
	SaturatedFatPer100g   float64
	CholesterolMgPer100g  float64
	SodiumMgPer100g       float64
	PotassiumMgPer100g    float64
	CalciumMgPer100g      float64
	IronMgPer100g         float64
	MagnesiumMgPer100g    float64
	ZincMgPer100g         float64
	VitaminARaeMcgPer100g float64
	VitaminCMgPer100g     float64
	VitaminDMcgPer100g    float64
	VitaminEMgPer100g     float64
	VitaminKMcgPer100g    float64
	ThiaminMgPer100g      float64
	RiboflavinMgPer100g   float64
	NiacinMgPer100g       float64
	VitaminB6MgPer100g    float64
	FolateMcgPer100g      float64
	VitaminB12McgPer100g  float64
	SourceURL             string
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
			"food_id":        f.ID,
			"canonical_name": f.CanonicalName,
			"match_source":   matchSource,
			"score":          0,
			"source":         "nutrition_library",
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

func (s *FoodNutritionService) CreatePackagedFood(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, error) {
	productName := strings.TrimSpace(input.ProductName)
	if productName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "零食名称不能为空", HTTPStatus: 400}
	}
	if input.NetWeightG <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "零食重量必须大于0", HTTPStatus: 400}
	}
	if input.ServingWeightG <= 0 {
		input.ServingWeightG = input.NetWeightG
	}
	if input.KcalPer100g <= 0 && input.ProteinPer100g <= 0 && input.CarbsPer100g <= 0 && input.FatPer100g <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请至少填写热量或三大营养素", HTTPStatus: 400}
	}
	return s.nutritionRepo.UpsertPackagedFood(ctx, repo.PackagedFoodInput{
		Brand:                 input.Brand,
		ProductName:           productName,
		NetWeightG:            input.NetWeightG,
		ServingWeightG:        input.ServingWeightG,
		KcalPer100g:           input.KcalPer100g,
		ProteinPer100g:        input.ProteinPer100g,
		CarbsPer100g:          input.CarbsPer100g,
		FatPer100g:            input.FatPer100g,
		FiberPer100g:          input.FiberPer100g,
		SugarPer100g:          input.SugarPer100g,
		SaturatedFatPer100g:   input.SaturatedFatPer100g,
		CholesterolMgPer100g:  input.CholesterolMgPer100g,
		SodiumMgPer100g:       input.SodiumMgPer100g,
		PotassiumMgPer100g:    input.PotassiumMgPer100g,
		CalciumMgPer100g:      input.CalciumMgPer100g,
		IronMgPer100g:         input.IronMgPer100g,
		MagnesiumMgPer100g:    input.MagnesiumMgPer100g,
		ZincMgPer100g:         input.ZincMgPer100g,
		VitaminARaeMcgPer100g: input.VitaminARaeMcgPer100g,
		VitaminCMgPer100g:     input.VitaminCMgPer100g,
		VitaminDMcgPer100g:    input.VitaminDMcgPer100g,
		VitaminEMgPer100g:     input.VitaminEMgPer100g,
		VitaminKMcgPer100g:    input.VitaminKMcgPer100g,
		ThiaminMgPer100g:      input.ThiaminMgPer100g,
		RiboflavinMgPer100g:   input.RiboflavinMgPer100g,
		NiacinMgPer100g:       input.NiacinMgPer100g,
		VitaminB6MgPer100g:    input.VitaminB6MgPer100g,
		FolateMcgPer100g:      input.FolateMcgPer100g,
		VitaminB12McgPer100g:  input.VitaminB12McgPer100g,
		SourceURL:             input.SourceURL,
		Source:                "user_submitted",
	})
}
