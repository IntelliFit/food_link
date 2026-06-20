package handler

import (
	"context"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/publicfood/domain"

	"github.com/gin-gonic/gin"
)

type PublicFoodService interface {
	List(ctx context.Context, input service.ListPublicFoodInput) (*repo.ListPublicFoodResult, error)
	Get(ctx context.Context, id string) (*domain.PublicFoodItem, error)
	Create(ctx context.Context, input service.CreatePublicFoodInput) (*domain.PublicFoodItem, error)
	Update(ctx context.Context, id string, input service.UpdatePublicFoodInput) (*domain.PublicFoodItem, error)
	Delete(ctx context.Context, id string) error
}

type PublicFoodHandler struct {
	svc PublicFoodService
}

func NewPublicFoodHandler(svc PublicFoodService) *PublicFoodHandler {
	return &PublicFoodHandler{svc: svc}
}

func (h *PublicFoodHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListPublicFoodInput{
		Query:        c.Query("q"),
		Status:       c.DefaultQuery("status", "all"),
		IsCampusFood: c.DefaultQuery("is_campus_food", "all"),
		Type:         c.DefaultQuery("type", "all"),
		Page:         page,
		Limit:        limit,
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

func (h *PublicFoodHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("item_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

func (h *PublicFoodHandler) Create(c *gin.Context) {
	var body service.CreatePublicFoodInput
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

func (h *PublicFoodHandler) Update(c *gin.Context) {
	var body service.UpdatePublicFoodInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Update(c.Request.Context(), c.Param("item_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "保存成功", "item": item})
}

func (h *PublicFoodHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}
