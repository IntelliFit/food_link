package handler

import (
	"log/slog"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	contributionrepo "food_link/backend/internal/foodcontribution/repo"
	contributionservice "food_link/backend/internal/foodcontribution/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type ContributionHandler struct {
	svc *contributionservice.ContributionService
}

func NewContributionHandler(svc *contributionservice.ContributionService) *ContributionHandler {
	return &ContributionHandler{svc: svc}
}

func (h *ContributionHandler) Submit(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "标准食物贡献提交请求", slog.String("user_id", userID))
	var body contributionservice.SubmitInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Submit(c.Request.Context(), userID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "标准食物贡献提交接口完成", slog.String("user_id", userID), slog.String("contribution_id", item.ID))
	response.Success(c, gin.H{"item": item, "message": "已提交审核"})
}

func (h *ContributionHandler) Mine(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	items, err := h.svc.Mine(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "用户标准食物贡献列表查询完成", slog.String("user_id", userID), slog.Int("result_count", len(items)))
	response.Success(c, gin.H{"items": items})
}

func (h *ContributionHandler) AdminList(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), contributionrepo.ListInput{
		Query: c.Query("q"), Status: c.DefaultQuery("status", "pending"), Limit: limit, Offset: (page - 1) * limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "后台标准食物贡献列表查询完成", slog.Int("result_count", len(result.Items)), slog.Int64("total", result.Total))
	response.Success(c, gin.H{"items": result.Items, "total": result.Total, "page": page, "limit": limit})
}

func (h *ContributionHandler) AdminGet(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("contribution_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "后台标准食物贡献详情查询完成", slog.String("contribution_id", item.ID))
	response.Success(c, gin.H{"item": item})
}

func (h *ContributionHandler) AdminReview(c *gin.Context) {
	contributionID := c.Param("contribution_id")
	reviewerID := c.GetString("admin_account_id")
	logger.Info(c.Request.Context(), "后台标准食物贡献审核请求", slog.String("contribution_id", contributionID), slog.String("reviewer_id", reviewerID))
	var body contributionservice.ReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Review(c.Request.Context(), contributionID, reviewerID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "后台标准食物贡献审核接口完成", slog.String("contribution_id", item.ID), slog.String("reviewer_id", reviewerID), slog.String("status", item.Status))
	response.Success(c, gin.H{"item": item, "message": "审核完成"})
}

func positiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
