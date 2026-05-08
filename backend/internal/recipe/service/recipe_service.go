package service

import (
	"context"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/recipe/domain"
	"food_link/backend/internal/recipe/repo"
	"gorm.io/gorm"
)

type RecipeService struct {
	repo *repo.RecipeRepo
}

func NewRecipeService(repo *repo.RecipeRepo) *RecipeService {
	return &RecipeService{repo: repo}
}

type CreateInput struct {
	RecipeName       string
	Description      *string
	ImagePath        *string
	Items            []map[string]any
	TotalCalories    float64
	TotalProtein     float64
	TotalCarbs       float64
	TotalFat         float64
	TotalWeightGrams float64
	Tags             []string
	MealType         *string
	IsFavorite       bool
}

type UpdateInput struct {
	RecipeName       *string
	Description      *string
	ImagePath        *string
	Items            []map[string]any
	TotalCalories    *float64
	TotalProtein     *float64
	TotalCarbs       *float64
	TotalFat         *float64
	TotalWeightGrams *float64
	Tags             []string
	TagsSet          bool
	MealType         *string
	IsFavorite       *bool
}

func (s *RecipeService) Create(ctx context.Context, userID string, input CreateInput) (string, error) {
	if strings.TrimSpace(input.RecipeName) == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "recipe_name 不能为空", HTTPStatus: 400}
	}
	recipe := &domain.Recipe{
		UserID:           userID,
		RecipeName:       input.RecipeName,
		Description:      input.Description,
		ImagePath:        input.ImagePath,
		Items:            input.Items,
		TotalCalories:    input.TotalCalories,
		TotalProtein:     input.TotalProtein,
		TotalCarbs:       input.TotalCarbs,
		TotalFat:         input.TotalFat,
		TotalWeightGrams: input.TotalWeightGrams,
		Tags:             domain.StringArray(input.Tags),
		MealType:         normalizeMealPtr(input.MealType),
		IsFavorite:       input.IsFavorite,
	}
	if err := s.repo.Create(ctx, recipe); err != nil {
		return "", err
	}
	return recipe.ID, nil
}

func (s *RecipeService) List(ctx context.Context, userID, mealType string, isFavorite *bool) ([]domain.Recipe, error) {
	return s.repo.List(ctx, userID, normalizeMeal(mealType), isFavorite)
}

func (s *RecipeService) Count(ctx context.Context, userID string, isFavorite *bool) (int64, error) {
	return s.repo.Count(ctx, userID, isFavorite)
}

func (s *RecipeService) Get(ctx context.Context, userID, recipeID string) (*domain.Recipe, error) {
	recipe, err := s.repo.Get(ctx, recipeID, userID)
	if err != nil {
		return nil, err
	}
	if recipe == nil {
		return nil, commonerrors.ErrNotFound
	}
	return recipe, nil
}

func (s *RecipeService) Update(ctx context.Context, userID, recipeID string, input UpdateInput) (*domain.Recipe, error) {
	updates := map[string]any{}
	if input.RecipeName != nil {
		if strings.TrimSpace(*input.RecipeName) == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "recipe_name 不能为空", HTTPStatus: 400}
		}
		updates["recipe_name"] = *input.RecipeName
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.ImagePath != nil {
		updates["image_path"] = *input.ImagePath
	}
	if input.Items != nil {
		updates["items"] = input.Items
	}
	if input.TotalCalories != nil {
		updates["total_calories"] = *input.TotalCalories
	}
	if input.TotalProtein != nil {
		updates["total_protein"] = *input.TotalProtein
	}
	if input.TotalCarbs != nil {
		updates["total_carbs"] = *input.TotalCarbs
	}
	if input.TotalFat != nil {
		updates["total_fat"] = *input.TotalFat
	}
	if input.TotalWeightGrams != nil {
		updates["total_weight_grams"] = *input.TotalWeightGrams
	}
	if input.TagsSet {
		updates["tags"] = domain.StringArray(input.Tags)
	}
	if input.MealType != nil {
		updates["meal_type"] = normalizeMeal(*input.MealType)
	}
	if input.IsFavorite != nil {
		updates["is_favorite"] = *input.IsFavorite
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有要更新的字段", HTTPStatus: 400}
	}
	recipe, err := s.repo.Update(ctx, recipeID, userID, updates)
	if err != nil {
		return nil, err
	}
	if recipe == nil {
		return nil, commonerrors.ErrNotFound
	}
	return recipe, nil
}

func (s *RecipeService) Delete(ctx context.Context, userID, recipeID string) error {
	if err := s.repo.Delete(ctx, recipeID, userID); err != nil {
		if err == gorm.ErrRecordNotFound {
			return commonerrors.ErrNotFound
		}
		return err
	}
	return nil
}

func (s *RecipeService) Use(ctx context.Context, userID, recipeID string, mealType *string) (string, error) {
	recipe, err := s.Get(ctx, userID, recipeID)
	if err != nil {
		return "", err
	}
	chosenMeal := "afternoon_snack"
	if recipe.MealType != nil && *recipe.MealType != "" {
		chosenMeal = *recipe.MealType
	}
	if mealType != nil && *mealType != "" {
		chosenMeal = *mealType
	}
	chosenMeal = normalizeMeal(chosenMeal)
	desc := "使用食谱：" + recipe.RecipeName
	record := &domain.FoodRecord{
		UserID:           userID,
		MealType:         chosenMeal,
		ImagePath:        recipe.ImagePath,
		Description:      &desc,
		Items:            recipe.Items,
		TotalCalories:    recipe.TotalCalories,
		TotalProtein:     recipe.TotalProtein,
		TotalCarbs:       recipe.TotalCarbs,
		TotalFat:         recipe.TotalFat,
		TotalWeightGrams: int(recipe.TotalWeightGrams),
	}
	if err := s.repo.InsertFoodRecord(ctx, record); err != nil {
		return "", err
	}
	_ = s.repo.MarkUsed(ctx, recipeID, userID, recipe.UseCount)
	return record.ID, nil
}

func normalizeMealPtr(v *string) *string {
	if v == nil || *v == "" {
		return v
	}
	normalized := normalizeMeal(*v)
	return &normalized
}

func normalizeMeal(v string) string {
	switch strings.TrimSpace(strings.ToLower(v)) {
	case "breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack":
		return strings.TrimSpace(strings.ToLower(v))
	case "snack":
		return "afternoon_snack"
	default:
		return v
	}
}
