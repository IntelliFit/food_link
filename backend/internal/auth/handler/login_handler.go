package handler

import (
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
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

func (h *LoginHandler) AppWechatLogin(c *gin.Context) {
	var input service.AppWechatLoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.service.LoginWithAppWechat(c.Request.Context(), input)
	if err != nil {
		status := http.StatusInternalServerError
		if isClientAuthError(err) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *LoginHandler) PasswordLogin(c *gin.Context) {
	var input service.PasswordLoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.service.LoginWithPassword(c.Request.Context(), input)
	if err != nil {
		status := http.StatusUnauthorized
		if !strings.Contains(err.Error(), "手机号或密码错误") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *LoginHandler) PasswordRegister(c *gin.Context) {
	var input service.PasswordRegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.service.RegisterWithPassword(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *LoginHandler) SetPassword(c *gin.Context) {
	var input service.SetPasswordInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	out, err := h.service.SetPassword(c.Request.Context(), userID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func isClientAuthError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "code 不能为空") ||
		strings.Contains(msg, "未配置") ||
		strings.Contains(msg, "微信 App 登录失败")
}
