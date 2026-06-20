package service

import (
	"context"
	"strings"
	"unicode"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/storage"
)

type FoodNutritionRepo interface {
	List(ctx context.Context, input repo.ListFoodNutritionInput) (*repo.ListFoodNutritionResult, error)
	Get(ctx context.Context, id string) (*domain.FoodNutrition, error)
	Create(ctx context.Context, item *domain.FoodNutrition) (*domain.FoodNutrition, error)
	Update(ctx context.Context, id string, patch repo.FoodNutritionPatch) (*domain.FoodNutrition, error)
	Delete(ctx context.Context, id string) error
}

type FoodNutritionService struct {
	repo    FoodNutritionRepo
	storage *storage.Client
}

func NewFoodNutritionService(repo FoodNutritionRepo, storage *storage.Client) *FoodNutritionService {
	return &FoodNutritionService{repo: repo, storage: storage}
}

type ListFoodNutritionInput struct {
	Query  string `form:"q"`
	Active string `form:"active"`
	Page   int    `form:"page"`
	Limit  int    `form:"limit"`
}

type CreateFoodNutritionInput struct {
	CanonicalName         string   `json:"canonical_name" binding:"required"`
	Source                string   `json:"source"`
	ImagePaths            []string `json:"image_paths"`
	KcalPer100g           float64  `json:"kcal_per_100g"`
	ProteinPer100g        float64  `json:"protein_per_100g"`
	CarbsPer100g          float64  `json:"carbs_per_100g"`
	FatPer100g            float64  `json:"fat_per_100g"`
	FiberPer100g          float64  `json:"fiber_per_100g"`
	SugarPer100g          float64  `json:"sugar_per_100g"`
	SaturatedFatPer100g   float64  `json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  float64  `json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       float64  `json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    float64  `json:"potassium_mg_per_100g"`
	CalciumMgPer100g      float64  `json:"calcium_mg_per_100g"`
	IronMgPer100g         float64  `json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    float64  `json:"magnesium_mg_per_100g"`
	ZincMgPer100g         float64  `json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g float64  `json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     float64  `json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    float64  `json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     float64  `json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    float64  `json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      float64  `json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   float64  `json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       float64  `json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    float64  `json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      float64  `json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  float64  `json:"vitamin_b12_mcg_per_100g"`
	IsActive              bool     `json:"is_active"`
}

type UpdateFoodNutritionInput struct {
	CanonicalName         *string   `json:"canonical_name,omitempty"`
	Source                *string   `json:"source,omitempty"`
	ImagePaths            *[]string `json:"image_paths,omitempty"`
	KcalPer100g           *float64  `json:"kcal_per_100g,omitempty"`
	ProteinPer100g        *float64  `json:"protein_per_100g,omitempty"`
	CarbsPer100g          *float64  `json:"carbs_per_100g,omitempty"`
	FatPer100g            *float64  `json:"fat_per_100g,omitempty"`
	FiberPer100g          *float64  `json:"fiber_per_100g,omitempty"`
	SugarPer100g          *float64  `json:"sugar_per_100g,omitempty"`
	SaturatedFatPer100g   *float64  `json:"saturated_fat_per_100g,omitempty"`
	CholesterolMgPer100g  *float64  `json:"cholesterol_mg_per_100g,omitempty"`
	SodiumMgPer100g       *float64  `json:"sodium_mg_per_100g,omitempty"`
	PotassiumMgPer100g    *float64  `json:"potassium_mg_per_100g,omitempty"`
	CalciumMgPer100g      *float64  `json:"calcium_mg_per_100g,omitempty"`
	IronMgPer100g         *float64  `json:"iron_mg_per_100g,omitempty"`
	MagnesiumMgPer100g    *float64  `json:"magnesium_mg_per_100g,omitempty"`
	ZincMgPer100g         *float64  `json:"zinc_mg_per_100g,omitempty"`
	VitaminARaeMcgPer100g *float64  `json:"vitamin_a_rae_mcg_per_100g,omitempty"`
	VitaminCMgPer100g     *float64  `json:"vitamin_c_mg_per_100g,omitempty"`
	VitaminDMcgPer100g    *float64  `json:"vitamin_d_mcg_per_100g,omitempty"`
	VitaminEMgPer100g     *float64  `json:"vitamin_e_mg_per_100g,omitempty"`
	VitaminKMcgPer100g    *float64  `json:"vitamin_k_mcg_per_100g,omitempty"`
	ThiaminMgPer100g      *float64  `json:"thiamin_mg_per_100g,omitempty"`
	RiboflavinMgPer100g   *float64  `json:"riboflavin_mg_per_100g,omitempty"`
	NiacinMgPer100g       *float64  `json:"niacin_mg_per_100g,omitempty"`
	VitaminB6MgPer100g    *float64  `json:"vitamin_b6_mg_per_100g,omitempty"`
	FolateMcgPer100g      *float64  `json:"folate_mcg_per_100g,omitempty"`
	VitaminB12McgPer100g  *float64  `json:"vitamin_b12_mcg_per_100g,omitempty"`
	IsActive              *bool     `json:"is_active,omitempty"`
}

func (s *FoodNutritionService) List(ctx context.Context, input ListFoodNutritionInput) (*repo.ListFoodNutritionResult, error) {
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
	result, err := s.repo.List(ctx, repo.ListFoodNutritionInput{
		Query:  input.Query,
		Active: input.Active,
		Limit:  limit,
		Offset: (page - 1) * limit,
	})
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		s.normalizeImages(&result.Items[i])
	}
	return result, nil
}

func (s *FoodNutritionService) Get(ctx context.Context, id string) (*domain.FoodNutrition, error) {
	item, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(item)
	return item, nil
}

func (s *FoodNutritionService) Create(ctx context.Context, input CreateFoodNutritionInput) (*domain.FoodNutrition, error) {
	name := strings.TrimSpace(input.CanonicalName)
	if name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食物名称不能为空", HTTPStatus: 400}
	}
	item := &domain.FoodNutrition{
		CanonicalName:         name,
		NormalizedName:        normalizeFoodNutritionName(name),
		Source:                strings.TrimSpace(input.Source),
		ImagePaths:            normalizeStringSlice(input.ImagePaths),
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
		IsActive:              input.IsActive,
	}
	if item.Source == "" {
		item.Source = "admin_manual"
	}
	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(created)
	return created, nil
}

func (s *FoodNutritionService) Update(ctx context.Context, id string, input UpdateFoodNutritionInput) (*domain.FoodNutrition, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食物 ID 不能为空", HTTPStatus: 400}
	}
	current, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	patch := repo.FoodNutritionPatch{}
	setStringPtr(patch, "canonical_name", input.CanonicalName)
	if input.CanonicalName != nil {
		patch["normalized_name"] = normalizeFoodNutritionName(*input.CanonicalName)
	}
	setStringPtr(patch, "source", input.Source)
	setStringSlicePtr(patch, "image_paths", input.ImagePaths)
	setFloatPtr(patch, "kcal_per_100g", input.KcalPer100g)
	setFloatPtr(patch, "protein_per_100g", input.ProteinPer100g)
	setFloatPtr(patch, "carbs_per_100g", input.CarbsPer100g)
	setFloatPtr(patch, "fat_per_100g", input.FatPer100g)
	setFloatPtr(patch, "fiber_per_100g", input.FiberPer100g)
	setFloatPtr(patch, "sugar_per_100g", input.SugarPer100g)
	setFloatPtr(patch, "saturated_fat_per_100g", input.SaturatedFatPer100g)
	setFloatPtr(patch, "cholesterol_mg_per_100g", input.CholesterolMgPer100g)
	setFloatPtr(patch, "sodium_mg_per_100g", input.SodiumMgPer100g)
	setFloatPtr(patch, "potassium_mg_per_100g", input.PotassiumMgPer100g)
	setFloatPtr(patch, "calcium_mg_per_100g", input.CalciumMgPer100g)
	setFloatPtr(patch, "iron_mg_per_100g", input.IronMgPer100g)
	setFloatPtr(patch, "magnesium_mg_per_100g", input.MagnesiumMgPer100g)
	setFloatPtr(patch, "zinc_mg_per_100g", input.ZincMgPer100g)
	setFloatPtr(patch, "vitamin_a_rae_mcg_per_100g", input.VitaminARaeMcgPer100g)
	setFloatPtr(patch, "vitamin_c_mg_per_100g", input.VitaminCMgPer100g)
	setFloatPtr(patch, "vitamin_d_mcg_per_100g", input.VitaminDMcgPer100g)
	setFloatPtr(patch, "vitamin_e_mg_per_100g", input.VitaminEMgPer100g)
	setFloatPtr(patch, "vitamin_k_mcg_per_100g", input.VitaminKMcgPer100g)
	setFloatPtr(patch, "thiamin_mg_per_100g", input.ThiaminMgPer100g)
	setFloatPtr(patch, "riboflavin_mg_per_100g", input.RiboflavinMgPer100g)
	setFloatPtr(patch, "niacin_mg_per_100g", input.NiacinMgPer100g)
	setFloatPtr(patch, "vitamin_b6_mg_per_100g", input.VitaminB6MgPer100g)
	setFloatPtr(patch, "folate_mcg_per_100g", input.FolateMcgPer100g)
	setFloatPtr(patch, "vitamin_b12_mcg_per_100g", input.VitaminB12McgPer100g)
	setBoolPtr(patch, "is_active", input.IsActive)
	if len(patch) == 0 {
		s.normalizeImages(current)
		return current, nil
	}
	updated, err := s.repo.Update(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(updated)
	return updated, nil
}

func (s *FoodNutritionService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, strings.TrimSpace(id))
}

func (s *FoodNutritionService) normalizeImages(item *domain.FoodNutrition) {
	if s.storage == nil || item == nil {
		return
	}
	item.ImagePaths = s.storage.ResolveReferenceURLs("food-images", item.ImagePaths)
	if item.ImagePath != nil {
		resolved := s.storage.ResolveReferenceURL("food-images", *item.ImagePath)
		if strings.TrimSpace(resolved) != "" && !stringSliceContains(item.ImagePaths, resolved) {
			*item.ImagePath = resolved
			item.ImagePaths = append([]string{resolved}, item.ImagePaths...)
		}
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func normalizeFoodNutritionName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}


