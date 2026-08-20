package handler

import (
	"context"
	"log/slog"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type AdminUserFoodPhotoService interface {
	List(ctx context.Context, input service.ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error)
}

type UserFoodPhotoHandler struct {
	svc AdminUserFoodPhotoService
}

func NewUserFoodPhotoHandler(svc AdminUserFoodPhotoService) *UserFoodPhotoHandler {
	return &UserFoodPhotoHandler{svc: svc}
}

func (h *UserFoodPhotoHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListUserFoodPhotoInput{
		Query:            c.Query("q"),
		Source:           c.DefaultQuery("source", "all"),
		Status:           c.DefaultQuery("status", "all"),
		CircleVisibility: c.DefaultQuery("circle_visibility", "all"),
		Page:             page,
		Limit:            limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员查看用户食物照片",
		slog.Int64("photo_count", result.Total),
		slog.Int("page", page),
		slog.Int("limit", limit),
	)
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  page,
		"limit": limit,
		"total": result.Total,
	})
}
