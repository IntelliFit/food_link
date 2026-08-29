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
	SaveAnnotation(ctx context.Context, input service.SaveUserFoodPhotoAnnotationInput, reviewerID string) (*repo.UserFoodPhotoAnnotation, error)
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
		SortBy:           c.DefaultQuery("sort_by", "created_at"),
		SortOrder:        c.DefaultQuery("sort_order", "desc"),
		AnnotationStatus: c.DefaultQuery("annotation_status", "all"),
		AnnotationLabel:  c.DefaultQuery("annotation_label", "all"),
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
		slog.String("sort_by", c.DefaultQuery("sort_by", "created_at")),
		slog.String("sort_order", c.DefaultQuery("sort_order", "desc")),
	)
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  page,
		"limit": limit,
		"total": result.Total,
	})
}

func (h *UserFoodPhotoHandler) SaveAnnotation(c *gin.Context) {
	var body service.SaveUserFoodPhotoAnnotationInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.SaveAnnotation(c.Request.Context(), body, c.GetString("admin_account_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员标注用户食物照片",
		slog.String("user_id", item.UserID),
		slog.String("review_status", item.ReviewStatus),
		slog.Int("label_count", len(item.Labels)),
		slog.String("reviewer_id", c.GetString("admin_account_id")),
	)
	response.Success(c, gin.H{"message": "标注已保存", "annotation": item})
}
