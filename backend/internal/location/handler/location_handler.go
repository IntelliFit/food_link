package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"food_link/backend/pkg/location"
)

// GetLocation 根据请求 IP 返回当前地理位置
func GetLocation(c *gin.Context) {
	loc, err := location.GetLocationByContext(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": location.Location{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": loc})
}
