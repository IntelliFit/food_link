package handler

import (
	"context"
	"log/slog"
	"strconv"
	"strings"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type PackagedFoodService interface {
	List(ctx context.Context, input service.ListPackagedFoodsInput) (*repo.ListPackagedFoodsResult, error)
	Get(ctx context.Context, id string) (*domain.PackagedFood, error)
	Create(ctx context.Context, input service.CreatePackagedFoodInput) (*domain.PackagedFood, error)
	Update(ctx context.Context, id string, input service.UpdatePackagedFoodInput) (*domain.PackagedFood, error)
	Delete(ctx context.Context, id string) error
}

type PackagedFoodHandler struct {
	svc PackagedFoodService
}

func NewPackagedFoodHandler(svc PackagedFoodService) *PackagedFoodHandler {
	return &PackagedFoodHandler{svc: svc}
}

func (h *PackagedFoodHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListPackagedFoodsInput{
		Query:        c.Query("q"),
		ReviewStatus: c.DefaultQuery("review_status", "all"),
		Active:       c.DefaultQuery("active", "all"),
		ImageState:   c.DefaultQuery("image_state", "all"),
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

func (h *PackagedFoodHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("food_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

func (h *PackagedFoodHandler) Create(c *gin.Context) {
	var body service.CreatePackagedFoodInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Create(c.Request.Context(), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.LogAPI(c.Request.Context(), "管理员创建包装食品", "admin", "create_packaged_food",
		slog.String("packaged_food_id", item.ID),
		slog.String("display_name", item.DisplayName),
	)
	response.Success(c, gin.H{"message": "创建成功", "item": item})
}

func (h *PackagedFoodHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("food_id")); err != nil {
		response.Error(c, err)
		return
	}
	logger.LogAPI(c.Request.Context(), "管理员删除包装食品", "admin", "delete_packaged_food",
		slog.String("packaged_food_id", c.Param("food_id")),
	)
	response.Success(c, gin.H{"message": "删除成功"})
}

func (h *PackagedFoodHandler) Update(c *gin.Context) {
	var body service.UpdatePackagedFoodInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Update(c.Request.Context(), c.Param("food_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.LogAPI(c.Request.Context(), "管理员更新包装食品", "admin", "update_packaged_food",
		slog.String("packaged_food_id", item.ID),
		slog.String("display_name", item.DisplayName),
		slog.String("review_status", item.ReviewStatus),
		slog.Bool("is_active", item.IsActive),
	)
	response.Success(c, gin.H{"message": "保存成功", "item": item})
}

func positiveInt(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}
