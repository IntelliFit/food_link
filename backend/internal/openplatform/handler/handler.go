package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/openplatform/domain"
	openratelimit "food_link/backend/internal/openplatform/ratelimit"
	openservice "food_link/backend/internal/openplatform/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

const principalContextKey = "open_api_principal"

type Handler struct {
	service *openservice.Service
	limiter openratelimit.Limiter
}

func (h *Handler) ConfigureRateLimiter(limiter openratelimit.Limiter) {
	h.limiter = limiter
}

func New(service *openservice.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/open/v1")
	group.Use(h.authenticate())
	group.GET("/account", h.Account)
	group.POST("/uploads", h.Upload)
	group.POST("/food-analyses", h.SubmitAnalysis)
	group.GET("/food-analyses/:task_id", h.GetAnalysis)
	group.GET("/foods/search", h.SearchNutrition)
}

func (h *Handler) RegisterDeveloperRoutes(engine *gin.Engine, requireJWT gin.HandlerFunc) {
	engine.GET("/api/developer/packages", h.ListPackages)
	engine.POST("/api/developer/payment/wechat/notify", h.WechatPaymentNotify)
	group := engine.Group("/api/developer")
	group.Use(requireJWT)
	group.GET("/apps", h.ListDeveloperApps)
	group.POST("/apps", h.CreateDeveloperApp)
	group.POST("/apps/:app_id/keys", h.CreateDeveloperKey)
	group.DELETE("/apps/:app_id/keys/:key_id", h.RevokeDeveloperKey)
	group.GET("/apps/:app_id/ledger", h.ListDeveloperLedger)
	group.POST("/payment-orders", h.CreatePaymentOrder)
	group.GET("/payment-orders/:order_no", h.GetPaymentOrder)
	group.POST("/payment-orders/:order_no/sync", h.SyncPaymentOrder)
}

func (h *Handler) ListDeveloperApps(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	apps, err := h.service.ListDeveloperApps(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"apps": apps})
}

func (h *Handler) CreateDeveloperApp(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.service.CreateDeveloperApp(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), input.Name)
	if err != nil {
		response.Error(c, err)
		return
	}
	writeSuccess(c, http.StatusCreated, result)
}

func (h *Handler) CreateDeveloperKey(c *gin.Context) {
	var input struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.service.CreateDeveloperKey(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("app_id"), input.Name, input.Scopes)
	if err != nil {
		response.Error(c, err)
		return
	}
	writeSuccess(c, http.StatusCreated, result)
}

func (h *Handler) RevokeDeveloperKey(c *gin.Context) {
	if err := h.service.RevokeDeveloperKey(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("app_id"), c.Param("key_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"revoked": true})
}

func (h *Handler) ListDeveloperLedger(c *gin.Context) {
	limit, _ := strconv.Atoi(strings.TrimSpace(c.Query("limit")))
	entries, err := h.service.ListDeveloperLedger(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("app_id"), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"entries": entries})
}

func (h *Handler) ListPackages(c *gin.Context) {
	packages, err := h.service.ListCreditPackages(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"packages": packages})
}

func (h *Handler) CreatePaymentOrder(c *gin.Context) {
	var input struct {
		AppID       string `json:"app_id"`
		PackageCode string `json:"package_code"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.service.CreatePaymentOrder(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), input.AppID, input.PackageCode)
	if err != nil {
		response.Error(c, err)
		return
	}
	writeSuccess(c, http.StatusCreated, result)
}

func (h *Handler) GetPaymentOrder(c *gin.Context) {
	order, err := h.service.GetPaymentOrder(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("order_no"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, order)
}

func (h *Handler) SyncPaymentOrder(c *gin.Context) {
	order, err := h.service.SyncPaymentOrder(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("order_no"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, order)
}

func (h *Handler) WechatPaymentNotify(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "读取回调失败"})
		return
	}
	result, err := h.service.HandleWechatPaymentNotify(c.Request.Context(), c.Request.Header, body)
	if err != nil {
		logger.Warn(c.Request.Context(), "开放平台微信支付回调失败", slog.Int("http.request.body.size", len(body)), logger.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"code": "FAIL", "message": "处理失败"})
		return
	}
	// Marshal through Gin to guarantee a top-level WeChat-compatible response.
	encoded, _ := json.Marshal(result)
	logger.Info(c.Request.Context(), "开放平台微信支付回调完成", slog.Int("http.request.body.size", len(body)), slog.Int("http.response.body.size", len(encoded)))
	c.JSON(http.StatusOK, result)
}

func (h *Handler) authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawKey := strings.TrimSpace(c.GetHeader("X-API-Key"))
		if rawKey == "" {
			header := strings.TrimSpace(c.GetHeader("Authorization"))
			if len(header) > 7 && strings.EqualFold(header[:7], "Bearer ") {
				rawKey = strings.TrimSpace(header[7:])
			}
		}
		if rawKey != "" && !h.allow(c, "credential:"+openservice.HashAPIKey(rawKey), 120) {
			return
		}
		principal, err := h.service.Authenticate(c.Request.Context(), rawKey)
		if err != nil {
			response.Error(c, err)
			c.Abort()
			return
		}
		if !h.allow(c, "app:"+principal.App.ID, 300) {
			return
		}
		c.Set(principalContextKey, principal)
		c.Set("open_api.app_id", principal.App.ID)
		c.Next()
	}
}

func (h *Handler) allow(c *gin.Context, key string, limit int) bool {
	if h.limiter == nil {
		return true
	}
	decision, err := h.limiter.Allow(c.Request.Context(), key, limit, time.Minute)
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 50010, Message: "API 限流服务暂不可用", HTTPStatus: http.StatusServiceUnavailable})
		c.Abort()
		return false
	}
	c.Header("X-RateLimit-Limit", strconv.Itoa(decision.Limit))
	c.Header("X-RateLimit-Remaining", strconv.Itoa(decision.Remaining))
	resetSeconds := int(time.Until(decision.ResetAt).Seconds())
	if resetSeconds < 0 {
		resetSeconds = 0
	}
	c.Header("X-RateLimit-Reset", strconv.FormatInt(decision.ResetAt.Unix(), 10))
	if !decision.Allowed {
		c.Header("Retry-After", strconv.Itoa(resetSeconds+1))
		response.Error(c, &commonerrors.AppError{Code: 50011, Message: "API 请求过于频繁，请稍后重试", HTTPStatus: http.StatusTooManyRequests})
		c.Abort()
		return false
	}
	return true
}

func (h *Handler) Account(c *gin.Context) {
	principal, ok := principalFromContext(c)
	if !ok {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	scopes := make([]string, 0, len(principal.Scopes))
	for scope := range principal.Scopes {
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)
	response.Success(c, gin.H{
		"app_id":        principal.App.ID,
		"app_name":      principal.App.Name,
		"balance_units": principal.App.BalanceUnits,
		"scopes":        scopes,
	})
}

func (h *Handler) Upload(c *gin.Context) {
	principal, ok := principalFromContext(c)
	if !ok {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if !h.allow(c, "upload:"+principal.App.ID, 60) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, openservice.MaxOpenAPIImageBytes+1024*1024)
	file, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 50002, Message: "file 图片文件必填且不能超过 8MB", HTTPStatus: http.StatusBadRequest})
		return
	}
	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()
	fileBytes, err := io.ReadAll(io.LimitReader(opened, openservice.MaxOpenAPIImageBytes+1))
	if err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.service.UploadImage(c.Request.Context(), principal, fileBytes, file.Filename)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *Handler) SubmitAnalysis(c *gin.Context) {
	principal, ok := principalFromContext(c)
	if !ok {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if !h.allow(c, "analysis:"+principal.App.ID, 60) {
		return
	}
	var input openservice.AnalysisInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	result, err := h.service.SubmitAnalysis(c.Request.Context(), principal, idempotencyKey, input)
	if err != nil {
		logger.Warn(c.Request.Context(), "开放平台食物分析提交失败",
			slog.String("open_api.app_id", principal.App.ID),
			slog.Bool("has_idempotency_key", idempotencyKey != ""),
			logger.Err(err),
		)
		response.Error(c, err)
		return
	}
	c.Header("Location", result.StatusEndpoint)
	writeSuccess(c, http.StatusAccepted, result)
}

func (h *Handler) GetAnalysis(c *gin.Context) {
	principal, ok := principalFromContext(c)
	if !ok {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	result, err := h.service.GetAnalysis(c.Request.Context(), principal, c.Param("task_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *Handler) SearchNutrition(c *gin.Context) {
	principal, ok := principalFromContext(c)
	if !ok {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(c.Query("limit")))
	items, err := h.service.SearchNutrition(c.Request.Context(), principal, c.Query("query"), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func principalFromContext(c *gin.Context) (*domain.Principal, bool) {
	value, ok := c.Get(principalContextKey)
	if !ok {
		return nil, false
	}
	principal, ok := value.(*domain.Principal)
	return principal, ok && principal != nil
}

func writeSuccess(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"code": 0, "message": "ok", "data": data})
}
