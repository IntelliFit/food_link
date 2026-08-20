package handler

import (
	"log/slog"
	"strconv"
	"strings"

	adminservice "food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type PackagedFoodCorrectionHandler struct {
	svc *adminservice.PackagedFoodCorrectionService
}

func NewPackagedFoodCorrectionHandler(svc *adminservice.PackagedFoodCorrectionService) *PackagedFoodCorrectionHandler {
	return &PackagedFoodCorrectionHandler{svc: svc}
}

func (h *PackagedFoodCorrectionHandler) List(c *gin.Context) {
	page := positiveCorrectionInt(c.Query("page"), 1)
	limit := positiveCorrectionInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), adminservice.ListPackagedFoodCorrectionInput{
		Query:  c.Query("q"),
		Status: c.DefaultQuery("status", "all"),
		Page:   page,
		Limit:  limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": result.Items, "page": page, "limit": limit, "total": result.Total})
}

func (h *PackagedFoodCorrectionHandler) Get(c *gin.Context) {
	detail, err := h.svc.Get(c.Request.Context(), c.Param("submission_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, detail)
}

func (h *PackagedFoodCorrectionHandler) Review(c *gin.Context) {
	var body adminservice.ReviewPackagedFoodCorrectionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	submissionID := strings.TrimSpace(c.Param("submission_id"))
	adminAccountID := strings.TrimSpace(c.GetString("admin_account_id"))
	logger.Info(c.Request.Context(), "包装食品纠错审批请求进入",
		slog.String("submission_id", submissionID),
		slog.String("admin_account_id", adminAccountID),
		slog.String("action", strings.TrimSpace(strings.ToLower(body.Action))),
	)
	detail, err := h.svc.Review(c.Request.Context(), submissionID, body, adminAccountID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "包装食品纠错审批请求完成",
		slog.String("submission_id", submissionID),
		slog.String("admin_account_id", adminAccountID),
		slog.String("status", detail.Submission.Status),
	)
	response.Success(c, gin.H{"message": reviewActionMessage(body.Action), "detail": detail})
}

func positiveCorrectionInt(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func reviewActionMessage(action string) string {
	if strings.EqualFold(strings.TrimSpace(action), "reject") {
		return "已驳回提案"
	}
	return "已应用提案"
}
