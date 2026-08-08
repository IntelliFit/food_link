package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/auth/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type LoginHandler struct {
	service *service.LoginService
	sms     *service.SMSService
}

func NewLoginHandler(service *service.LoginService) *LoginHandler {
	return &LoginHandler{service: service}
}

func (h *LoginHandler) ConfigureSMSService(sms *service.SMSService) {
	h.sms = sms
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

func (h *LoginHandler) SendSMSCode(c *gin.Context) {
	if h.sms == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "验证码服务未配置"})
		return
	}
	var input service.SendSMSCodeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.sms.SendCode(c.Request.Context(), input, clientIP(c))
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "频繁") {
			status = http.StatusTooManyRequests
		}
		if strings.Contains(err.Error(), "未配置") || strings.Contains(err.Error(), "配置不完整") {
			status = http.StatusInternalServerError
		}
		c.JSON(status, gin.H{"detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *LoginHandler) SMSLogin(c *gin.Context) {
	if h.sms == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "验证码服务未配置"})
		return
	}
	var input service.SMSLoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	out, err := h.sms.LoginWithCode(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
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
	logger.Info(c.Request.Context(), "App 账号安全设置请求进入", slog.String("user_id", userID))
	out, err := h.service.SetPassword(c.Request.Context(), userID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	logger.Info(c.Request.Context(), "App 账号安全设置请求完成", slog.String("user_id", userID))
	c.JSON(http.StatusOK, out)
}

func (h *LoginHandler) ResetPassword(c *gin.Context) {
	var input service.ResetPasswordInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请求参数无效"})
		return
	}
	logger.Info(c.Request.Context(), "App 短信重置密码请求进入")
	out, err := h.service.ResetPasswordWithSMS(c.Request.Context(), input)
	if err != nil {
		if errors.Is(err, service.ErrPasswordResetUnavailable) {
			c.JSON(http.StatusInternalServerError, gin.H{"detail": service.ErrPasswordResetUnavailable.Error()})
			return
		}
		if errors.Is(err, service.ErrPasswordResetFailed) {
			c.JSON(http.StatusBadRequest, gin.H{"detail": service.ErrPasswordResetFailed.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}
	logger.Info(c.Request.Context(), "App 短信重置密码请求完成", slog.String("user_id", out.UserID))
	c.JSON(http.StatusOK, out)
}

func isClientAuthError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "code 不能为空") ||
		strings.Contains(msg, "未配置") ||
		strings.Contains(msg, "微信 App 登录失败")
}

func clientIP(c *gin.Context) string {
	if forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-For")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return c.ClientIP()
}
