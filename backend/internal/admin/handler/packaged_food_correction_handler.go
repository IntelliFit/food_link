package handler

import (
	"strconv"
	"strings"

	adminservice "food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"

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
	detail, err := h.svc.Review(c.Request.Context(), c.Param("submission_id"), body, c.GetString("admin_account_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
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
