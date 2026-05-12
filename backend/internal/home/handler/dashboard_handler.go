package handler

import (
	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/home/service"

	"github.com/gin-gonic/gin"
)

type DashboardHandler struct {
	service *service.DashboardService
}

func NewDashboardHandler(service *service.DashboardService) *DashboardHandler {
	return &DashboardHandler{service: service}
}

func (h *DashboardHandler) HomeDashboard(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := c.Query("date")
	if date == "" {
		date = service.ChinaToday()
	}
	data, err := h.service.HomeDashboard(c.Request.Context(), userID, date)
	if err != nil {
		c.JSON(500, gin.H{"detail": "获取首页数据失败"})
		return
	}
	c.JSON(200, data)
}

func (h *DashboardHandler) PosterCalorieCompare(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	data, err := h.service.PosterCalorieCompare(c.Request.Context(), userID, recordID)
	if err != nil {
		c.JSON(500, gin.H{"detail": "获取海报热量对比失败"})
		return
	}
	if data == nil {
		c.JSON(404, gin.H{"detail": "记录不存在"})
		return
	}
	c.JSON(200, data)
}
