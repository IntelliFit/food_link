package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/recipe/domain"
	"food_link/backend/internal/recipe/service"

	"github.com/gin-gonic/gin"
)

type RecipeService interface {
	Create(ctx context.Context, userID string, input service.CreateInput) (string, error)
	List(ctx context.Context, userID, mealType string, isFavorite *bool) ([]domain.Recipe, error)
	ListForViewer(ctx context.Context, viewerUserID, ownerUserID, mealType string, isFavorite *bool) ([]domain.Recipe, error)
	Count(ctx context.Context, userID string, isFavorite *bool) (int64, error)
	Get(ctx context.Context, userID, recipeID string) (*domain.Recipe, error)
	Update(ctx context.Context, userID, recipeID string, input service.UpdateInput) (*domain.Recipe, error)
	Delete(ctx context.Context, userID, recipeID string) error
	Use(ctx context.Context, userID, recipeID string, mealType *string, entryType *string) (string, error)
}

type RecipeHandler struct {
	svc RecipeService
}

func NewRecipeHandler(svc RecipeService) *RecipeHandler {
	return &RecipeHandler{svc: svc}
}

func (h *RecipeHandler) Create(c *gin.Context) {
	var body struct {
		RecipeName       string           `json:"recipe_name"`
		Description      *string          `json:"description"`
		ImagePath        *string          `json:"image_path"`
		Items            []map[string]any `json:"items"`
		TotalCalories    float64          `json:"total_calories"`
		TotalProtein     float64          `json:"total_protein"`
		TotalCarbs       float64          `json:"total_carbs"`
		TotalFat         float64          `json:"total_fat"`
		TotalWeightGrams float64          `json:"total_weight_grams"`
		Tags             []string         `json:"tags"`
		MealType         *string          `json:"meal_type"`
		IsFavorite       bool             `json:"is_favorite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	id, err := h.svc.Create(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), service.CreateInput{
		RecipeName:       body.RecipeName,
		Description:      body.Description,
		ImagePath:        body.ImagePath,
		Items:            body.Items,
		TotalCalories:    body.TotalCalories,
		TotalProtein:     body.TotalProtein,
		TotalCarbs:       body.TotalCarbs,
		TotalFat:         body.TotalFat,
		TotalWeightGrams: body.TotalWeightGrams,
		Tags:             body.Tags,
		MealType:         body.MealType,
		IsFavorite:       body.IsFavorite,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": id, "message": "食谱创建成功"})
}

func (h *RecipeHandler) List(c *gin.Context) {
	var fav *bool
	if raw := c.Query("is_favorite"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			fav = &v
		}
	}
	recipes, err := h.svc.List(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Query("meal_type"), fav)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"recipes": recipes})
}

func (h *RecipeHandler) Count(c *gin.Context) {
	var fav *bool
	if raw := c.Query("is_favorite"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			fav = &v
		}
	}
	count, err := h.svc.Count(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), fav)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"count": count})
}

func (h *RecipeHandler) Get(c *gin.Context) {
	recipe, err := h.svc.Get(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("recipe_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, recipe)
}

func (h *RecipeHandler) Update(c *gin.Context) {
	var body struct {
		RecipeName       *string          `json:"recipe_name"`
		Description      *string          `json:"description"`
		ImagePath        *string          `json:"image_path"`
		Items            []map[string]any `json:"items"`
		TotalCalories    *float64         `json:"total_calories"`
		TotalProtein     *float64         `json:"total_protein"`
		TotalCarbs       *float64         `json:"total_carbs"`
		TotalFat         *float64         `json:"total_fat"`
		TotalWeightGrams *float64         `json:"total_weight_grams"`
		Tags             []string         `json:"tags"`
		MealType         *string          `json:"meal_type"`
		IsFavorite       *bool            `json:"is_favorite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	_, tagsSet := c.GetPostForm("tags")
	recipe, err := h.svc.Update(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("recipe_id"), service.UpdateInput{
		RecipeName:       body.RecipeName,
		Description:      body.Description,
		ImagePath:        body.ImagePath,
		Items:            body.Items,
		TotalCalories:    body.TotalCalories,
		TotalProtein:     body.TotalProtein,
		TotalCarbs:       body.TotalCarbs,
		TotalFat:         body.TotalFat,
		TotalWeightGrams: body.TotalWeightGrams,
		Tags:             body.Tags,
		TagsSet:          tagsSet || body.Tags != nil,
		MealType:         body.MealType,
		IsFavorite:       body.IsFavorite,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功", "recipe": recipe})
}

func (h *RecipeHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("recipe_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "删除成功"})
}

func (h *RecipeHandler) Use(c *gin.Context) {
	var body struct {
		MealType  *string `json:"meal_type"`
		EntryType *string `json:"entry_type"`
	}
	_ = c.ShouldBindJSON(&body)
	recordID, err := h.svc.Use(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("recipe_id"), body.MealType, body.EntryType)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "记录成功", "record_id": recordID})
}

// GET /api/user/:user_id/favorite-recipes
func (h *RecipeHandler) GetUserFavoriteRecipes(c *gin.Context) {
	targetUserID := c.Param("user_id")
	fav := true
	recipes, err := h.svc.ListForViewer(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), targetUserID, "", &fav)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"recipes": recipes})
}
