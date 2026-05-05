package handler

import (
	"food_link/backend/internal/auth/service"

	"github.com/gin-gonic/gin"
)

type LoginHandler struct {
	service *service.LoginService
}

func NewLoginHandler(service *service.LoginService) *LoginHandler {
	return &LoginHandler{service: service}
}

func (h *LoginHandler) Login(c *gin.Context) {
	var input service.LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.service.Login(c.Request.Context(), input)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(200, out)
}
