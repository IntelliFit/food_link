package handler

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/onboarding/domain"
	"food_link/backend/internal/onboarding/service"
	openplatformratelimit "food_link/backend/internal/openplatform/ratelimit"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type OnboardingService interface {
	Config(ctx context.Context) (domain.Config, error)
	PublicConfig(ctx context.Context) domain.PublicConfig
	SaveConfig(ctx context.Context, in domain.Config, updatedBy string) (service.SaveResult, error)
	Stats(ctx context.Context) (domain.Stats, error)
	Try(ctx context.Context, userID string, in service.TryInput) (map[string]any, error)
}

const (
	// A compressed meal photo plus a previous result fits well inside this.
	tryBodyLimit  = 4 << 20
	configLimit   = 16 << 10
	tryPerIPLimit = 30
	tryIPWindow   = time.Hour
)

var errTryTooFast = &commonerrors.AppError{Code: 10029, Message: "操作太频繁了，稍后再试", HTTPStatus: http.StatusTooManyRequests}

type OnboardingHandler struct {
	svc     OnboardingService
	limiter openplatformratelimit.Limiter
}

func NewOnboardingHandler(svc OnboardingService) *OnboardingHandler {
	return &OnboardingHandler{svc: svc}
}

// ConfigureRateLimiter adds a per-IP cap in front of the guest try. The daily
// caps in the database still apply when the limiter is unavailable.
func (h *OnboardingHandler) ConfigureRateLimiter(limiter openplatformratelimit.Limiter) {
	h.limiter = limiter
}

func (h *OnboardingHandler) PublicConfig(c *gin.Context) {
	response.Success(c, h.svc.PublicConfig(c.Request.Context()))
}

func (h *OnboardingHandler) Stats(c *gin.Context) {
	stats, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		logger.Error(c.Request.Context(), "读取引导页数据统计失败", err)
		response.Error(c, err)
		return
	}
	response.Success(c, stats)
}

func (h *OnboardingHandler) Try(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	// The IP cap runs before the body is read. ClientIP trusts forwarded
	// headers behind the ingress, so the database caps stay the real guard.
	if userID == "" && h.limiter != nil {
		decision, err := h.limiter.Allow(c.Request.Context(), "onboarding:try:ip:"+c.ClientIP(), tryPerIPLimit, tryIPWindow)
		if err == nil && !decision.Allowed {
			response.Error(c, errTryTooFast)
			return
		}
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, tryBodyLimit)
	var body service.TryInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	data, err := h.svc.Try(c.Request.Context(), userID, body)
	if err != nil {
		logger.Warn(c.Request.Context(), "引导页体验识别失败", slog.String("error", err.Error()), slog.Bool("logged_in", userID != ""))
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

func (h *OnboardingHandler) AdminGetConfig(c *gin.Context) {
	cfg, err := h.svc.Config(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"config": cfg})
}

func (h *OnboardingHandler) AdminSaveConfig(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, configLimit)
	var body domain.Config
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	result, err := h.svc.SaveConfig(c.Request.Context(), body, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
