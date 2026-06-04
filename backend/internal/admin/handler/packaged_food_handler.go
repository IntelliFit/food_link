package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type PackagedFoodService interface {
	List(ctx context.Context, input service.ListPackagedFoodsInput) (*repo.ListPackagedFoodsResult, error)
	Get(ctx context.Context, id string) (*domain.PackagedFood, error)
	Update(ctx context.Context, id string, input service.UpdatePackagedFoodInput) (*domain.PackagedFood, error)
}

type PackagedFoodHandler struct {
	svc      PackagedFoodService
	adminKey string
}

func NewPackagedFoodHandler(svc PackagedFoodService, adminKey string) *PackagedFoodHandler {
	return &PackagedFoodHandler{svc: svc, adminKey: strings.TrimSpace(adminKey)}
}

func (h *PackagedFoodHandler) AdminAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := c.Cookie("test_backend_token"); err == nil {
			c.Next()
			return
		}
		expected := h.adminKey
		provided := strings.TrimSpace(c.GetHeader("X-Admin-Key"))
		if provided == "" {
			provided = strings.TrimSpace(c.Query("admin_key"))
		}
		if expected != "" && provided == expected {
			c.Next()
			return
		}
		if expected == "" {
			response.Error(c, &commonerrors.AppError{Code: 20001, Message: "请先登录测试后台，或配置 ADMIN_API_KEY 后使用管理员密钥", HTTPStatus: http.StatusUnauthorized})
			c.Abort()
			return
		}
		response.Error(c, &commonerrors.AppError{Code: 20003, Message: "管理员密钥无效", HTTPStatus: http.StatusForbidden})
		c.Abort()
	}
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
	if log := logger.L(); log != nil {
		log.InfoContext(c.Request.Context(), "管理员更新包装食品",
			slog.String("packaged_food_id", item.ID),
			slog.String("display_name", item.DisplayName),
			slog.String("review_status", item.ReviewStatus),
			slog.Bool("is_active", item.IsActive),
		)
	}
	response.Success(c, gin.H{"message": "保存成功", "item": item})
}

func positiveInt(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}
