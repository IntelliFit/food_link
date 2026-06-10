package handler

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"food_link/backend/internal/admin/domain"
	adminservice "food_link/backend/internal/admin/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

const adminSessionCookieName = "food_link_admin_session"

type AdminAuthService interface {
	Login(ctx context.Context, username, password string) (*adminservice.LoginResult, error)
	GetActiveAccount(ctx context.Context, id string) (*domain.AdminAccount, error)
}

type AuthHandler struct {
	svc AdminAuthService
}

func NewAuthHandler(svc AdminAuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

func (h *AuthHandler) Login(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.Login(c.Request.Context(), body.Username, body.Password)
	if err != nil {
		response.Error(c, err)
		return
	}
	setAdminSessionCookie(c, adminSessionToken(result.Account), 7*24*time.Hour)
	logger.Info(c.Request.Context(), "管理员登录成功",
		slog.String("admin_id", result.Account.ID),
		slog.String("admin_username", result.Account.Username),
		slog.String("client_ip", c.ClientIP()),
	)
	response.Success(c, gin.H{"authenticated": true, "account": adminAccountPayload(result.Account)})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	setAdminSessionCookie(c, "", -time.Second)
	response.Success(c, gin.H{"authenticated": false})
}

func (h *AuthHandler) Session(c *gin.Context) {
	account, ok := h.currentAccount(c)
	if ok {
		response.Success(c, gin.H{"authenticated": true, "account": adminAccountPayload(account)})
		return
	}
	response.Error(c, &commonerrors.AppError{Code: 20001, Message: "管理员未登录", HTTPStatus: http.StatusUnauthorized})
}

func (h *AuthHandler) AdminAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		account, ok := h.currentAccount(c)
		if ok {
			c.Set("admin_account_id", account.ID)
			c.Set("admin_username", account.Username)
			c.Next()
			return
		}
		response.Error(c, &commonerrors.AppError{Code: 20001, Message: "管理员未登录", HTTPStatus: http.StatusUnauthorized})
		c.Abort()
	}
}

func (h *AuthHandler) currentAccount(c *gin.Context) (*domain.AdminAccount, bool) {
	token, err := c.Cookie(adminSessionCookieName)
	if err != nil {
		return nil, false
	}
	adminID := parseAdminSessionToken(token)
	if adminID == "" {
		return nil, false
	}
	account, err := h.svc.GetActiveAccount(c.Request.Context(), adminID)
	if err != nil || account == nil {
		return nil, false
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(adminSessionToken(account))) != 1 {
		return nil, false
	}
	return account, true
}

func setAdminSessionCookie(c *gin.Context, value string, maxAge time.Duration) {
	sameSite := http.SameSiteLaxMode
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	if secure {
		sameSite = http.SameSiteNoneMode
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     adminSessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	})
}

func adminSessionToken(account *domain.AdminAccount) string {
	adminID := strings.TrimSpace(account.ID)
	sum := sha256.Sum256([]byte("food_link_admin_session:" + adminID + ":" + account.PasswordHash))
	return adminID + "." + hex.EncodeToString(sum[:])
}

func parseAdminSessionToken(token string) string {
	parts := strings.SplitN(strings.TrimSpace(token), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return parts[0]
}

func adminAccountPayload(account *domain.AdminAccount) gin.H {
	return gin.H{
		"id":           account.ID,
		"username":     account.Username,
		"display_name": account.DisplayName,
	}
}
