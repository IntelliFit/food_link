package handler

import (
	"context"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"

	"github.com/gin-gonic/gin"
)

type FoodNutritionService interface {
	List(ctx context.Context, input service.ListFoodNutritionInput) (*repo.ListFoodNutritionResult, error)
	Get(ctx context.Context, id string) (*domain.FoodNutrition, error)
	Create(ctx context.Context, input service.CreateFoodNutritionInput) (*domain.FoodNutrition, error)
	Update(ctx context.Context, id string, input service.UpdateFoodNutritionInput) (*domain.FoodNutrition, error)
	Delete(ctx context.Context, id string) error
}

type FoodNutritionHandler struct {
	svc FoodNutritionService
}

func NewFoodNutritionHandler(svc FoodNutritionService) *FoodNutritionHandler {
	return &FoodNutritionHandler{svc: svc}
}

func (h *FoodNutritionHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListFoodNutritionInput{
		Query:  c.Query("q"),
		Active: c.DefaultQuery("active", "all"),
		Page:   page,
		Limit:  limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  page,
		"limit": limit,
		"total": result.Total,
	})
}

func (h *FoodNutritionHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("food_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

func (h *FoodNutritionHandler) Create(c *gin.Context) {
	var body service.CreateFoodNutritionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Create(c.Request.Context(), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": item})
}

func (h *FoodNutritionHandler) Update(c *gin.Context) {
	var body service.UpdateFoodNutritionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Update(c.Request.Context(), c.Param("food_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "保存成功", "item": item})
}

func (h *FoodNutritionHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("food_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}
