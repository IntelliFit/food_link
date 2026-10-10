package handler

import (
	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"log/slog"
)

type NutritionPlanHandler struct{ svc *service.NutritionPlanService }

func NewNutritionPlanHandler(svc *service.NutritionPlanService) *NutritionPlanHandler {
	return &NutritionPlanHandler{svc: svc}
}
func (h *NutritionPlanHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.Use(func(c *gin.Context) {
		if !h.svc.SchemaReady() {
			response.Error(c, &commonerrors.AppError{Code: 10004, Message: "饮食方案尚未启用，请执行对应迁移并重启后端", HTTPStatus: 503})
			c.Abort()
			return
		}
		c.Next()
	})
	r.GET("", h.List)
	r.POST("", h.Create)
	r.GET("/day/:date", h.Day)
	r.PUT("/day/:date", h.ChangeDay)
	r.PUT("/default", h.Default)
	r.PUT("/:id", h.Update)
	r.DELETE("/:id", h.Delete)
}
func planBadRequest(c *gin.Context, message string) {
	response.Error(c, &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400})
}
func planRequest(c *gin.Context) string {
	id := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "接收饮食方案请求", slog.String("user_id", id), slog.String("action", c.Request.Method), slog.String("plan_id", c.Param("id")), slog.String("date", c.Param("date")))
	return id
}
func planResponse(c *gin.Context, data any, err error) {
	if err != nil {
		response.Error(c, service.NutritionPlanPublicError(err))
		return
	}
	logger.Info(c.Request.Context(), "饮食方案请求完成", slog.String("user_id", c.GetString(authmw.ContextUserIDKey)))
	response.Success(c, data)
}
func planIDValid(c *gin.Context, id string, allowBase bool) bool {
	if allowBase && id == "base" {
		return true
	}
	if _, err := uuid.Parse(id); err != nil {
		planBadRequest(c, "方案标识无效")
		return false
	}
	return true
}
func (h *NutritionPlanHandler) List(c *gin.Context) {
	v, err := h.svc.Library(c.Request.Context(), planRequest(c))
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) Day(c *gin.Context) {
	v, err := h.svc.Resolve(c.Request.Context(), planRequest(c), c.Param("date"))
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) Create(c *gin.Context) {
	id := planRequest(c)
	var input struct {
		Plans []domain.NutritionPlanValues `json:"plans"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		planBadRequest(c, "方案数据无效")
		return
	}
	v, err := h.svc.Create(c.Request.Context(), id, input.Plans)
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) Update(c *gin.Context) {
	id := planRequest(c)
	if !planIDValid(c, c.Param("id"), false) {
		return
	}
	var input struct {
		domain.NutritionPlanValues
		Revision int `json:"revision"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		planBadRequest(c, "方案数据无效")
		return
	}
	v, err := h.svc.Update(c.Request.Context(), id, c.Param("id"), input.Revision, input.NutritionPlanValues)
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) Delete(c *gin.Context) {
	id := planRequest(c)
	if !planIDValid(c, c.Param("id"), false) {
		return
	}
	v, err := h.svc.Delete(c.Request.Context(), id, c.Param("id"))
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) Default(c *gin.Context) {
	id := planRequest(c)
	var input struct {
		PlanID string `json:"plan_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		planBadRequest(c, "方案数据无效")
		return
	}
	if !planIDValid(c, input.PlanID, true) {
		return
	}
	v, err := h.svc.SetDefault(c.Request.Context(), id, input.PlanID)
	planResponse(c, v, err)
}
func (h *NutritionPlanHandler) ChangeDay(c *gin.Context) {
	id := planRequest(c)
	var input domain.ChangeNutritionDayInput
	if err := c.ShouldBindJSON(&input); err != nil {
		planBadRequest(c, "日期目标数据无效")
		return
	}
	if input.PlanID != "" && !planIDValid(c, input.PlanID, true) {
		return
	}
	v, err := h.svc.ChangeDay(c.Request.Context(), id, c.Param("date"), input)
	planResponse(c, v, err)
}
