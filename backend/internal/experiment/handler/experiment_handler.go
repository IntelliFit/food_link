package handler

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/experiment/domain"
	"food_link/backend/internal/experiment/service"
	openplatformratelimit "food_link/backend/internal/openplatform/ratelimit"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type ExperimentService interface {
	Assignments(ctx context.Context, in service.AssignInput) (map[string]domain.Served, error)
	Expose(ctx context.Context, anonID, userID string, keys []string) (int64, error)
	Track(ctx context.Context, anonID, userID string, events []service.EventInput) (service.TrackResult, error)
	List(ctx context.Context) ([]domain.Experiment, error)
	Save(ctx context.Context, key string, in service.SaveInput) (domain.Experiment, error)
	Summary(ctx context.Context, key string) ([]domain.VariantSummary, error)
}

const (
	smallBodyLimit = 8 << 10
	eventBodyLimit = 128 << 10
	// Campus Wi-Fi puts many students behind one address, so the per-IP cap
	// is loose and the per-install cap does the real work.
	perIPLimit      = 600
	perInstallLimit = 60
	limitWindow     = time.Minute
)

var errTooManyRequests = &commonerrors.AppError{Code: 10029, Message: "请求过于频繁，请稍后再试", HTTPStatus: http.StatusTooManyRequests}

type ExperimentHandler struct {
	svc     ExperimentService
	limiter openplatformratelimit.Limiter
}

func NewExperimentHandler(svc ExperimentService) *ExperimentHandler {
	return &ExperimentHandler{svc: svc}
}

// ConfigureRateLimiter enables per-IP and per-install caps on the endpoints
// that accept requests without login. A limiter error lets the request
// through: experiments must never block the app.
func (h *ExperimentHandler) ConfigureRateLimiter(limiter openplatformratelimit.Limiter) {
	h.limiter = limiter
}

func (h *ExperimentHandler) allow(c *gin.Context, anonID string) bool {
	if h.limiter == nil {
		return true
	}
	for _, rule := range []struct {
		name  string
		key   string
		limit int
	}{
		{"ip", "experiments:ip:" + c.ClientIP(), perIPLimit},
		{"install", "experiments:anon:" + anonID, perInstallLimit},
	} {
		decision, err := h.limiter.Allow(c.Request.Context(), rule.key, rule.limit, limitWindow)
		if err != nil {
			continue
		}
		if !decision.Allowed {
			logger.Warn(c.Request.Context(), "实验接口触发限流", slog.String("rule", rule.name))
			return false
		}
	}
	return true
}

// bind caps the body before decoding and applies the rate limits, writing
// the error response itself when it returns false.
func (h *ExperimentHandler) bind(c *gin.Context, limit int64, body any, anonID func() string) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	if err := c.ShouldBindJSON(body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return false
	}
	if !h.allow(c, anonID()) {
		response.Error(c, errTooManyRequests)
		return false
	}
	return true
}

func (h *ExperimentHandler) Assignments(c *gin.Context) {
	var body struct {
		AnonID     string `json:"anon_id"`
		Platform   string `json:"platform"`
		AppVersion string `json:"app_version"`
	}
	if !h.bind(c, smallBodyLimit, &body, func() string { return body.AnonID }) {
		return
	}
	served, err := h.svc.Assignments(c.Request.Context(), service.AssignInput{
		AnonID:     body.AnonID,
		UserID:     c.GetString(authmw.ContextUserIDKey),
		Platform:   body.Platform,
		AppVersion: body.AppVersion,
	})
	if err != nil {
		logger.Error(c.Request.Context(), "获取实验分组失败", err)
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"assignments": served})
}

func (h *ExperimentHandler) Exposures(c *gin.Context) {
	var body struct {
		AnonID string   `json:"anon_id"`
		Keys   []string `json:"keys"`
	}
	if !h.bind(c, smallBodyLimit, &body, func() string { return body.AnonID }) {
		return
	}
	n, err := h.svc.Expose(c.Request.Context(), body.AnonID, c.GetString(authmw.ContextUserIDKey), body.Keys)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"exposed": n})
}

func (h *ExperimentHandler) Events(c *gin.Context) {
	var body struct {
		AnonID string               `json:"anon_id"`
		Events []service.EventInput `json:"events"`
	}
	if !h.bind(c, eventBodyLimit, &body, func() string { return body.AnonID }) {
		return
	}
	result, err := h.svc.Track(c.Request.Context(), body.AnonID, c.GetString(authmw.ContextUserIDKey), body.Events)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *ExperimentHandler) AdminList(c *gin.Context) {
	items, err := h.svc.List(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *ExperimentHandler) AdminSave(c *gin.Context) {
	var body service.SaveInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	key := c.Param("key")
	saved, err := h.svc.Save(c.Request.Context(), key, body)
	if err != nil {
		logger.Warn(c.Request.Context(), "保存实验配置失败", slog.String("experiment_key", key), slog.String("error", err.Error()))
		response.Error(c, err)
		return
	}
	response.Success(c, saved)
}

func (h *ExperimentHandler) AdminSummary(c *gin.Context) {
	rows, err := h.svc.Summary(c.Request.Context(), c.Param("key"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"variants": rows})
}
