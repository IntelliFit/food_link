package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/campuscatalog/domain"
	campusrepo "food_link/backend/internal/campuscatalog/repo"
	"food_link/backend/internal/campuscatalog/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type CaptureService interface {
	CreateCaptureSession(ctx context.Context, userID string, input service.CaptureSessionInput) (*service.CaptureSessionView, error)
	GetCaptureSession(ctx context.Context, userID, sessionID string) (*service.CaptureSessionView, error)
	UploadCaptureAsset(ctx context.Context, userID, sessionID string, input service.CaptureAssetInput, sourceFilename, contentType string, data []byte) (*domain.CaptureAsset, error)
	UpdateCaptureAsset(ctx context.Context, userID, sessionID, assetID string, input service.CaptureAssetInput, remove bool) (*service.CaptureSessionView, error)
	StartCaptureExtraction(ctx context.Context, userID, sessionID string) (*service.CaptureSessionView, error)
	SubmitCaptureSession(ctx context.Context, userID, sessionID string) (*service.CaptureSessionView, error)
	ListCapturedWindows(ctx context.Context, venueType, canteenID, organization, canteen string) ([]campusrepo.CapturedWindowSummary, error)
	GetCaptureEarnings(ctx context.Context, userID string) (*service.CaptureEarnings, error)
	RedeemCaptureMembership(ctx context.Context, userID, optionCode, requestKey string) (*service.CaptureEarnings, error)
	RequestCaptureWithdrawal(ctx context.Context, userID string, amountCents int64, requestKey string) (*service.CaptureEarnings, error)
}

// CaptureHandler serves the mini-program window capture flow. Every route
// requires a signed-in user; anyone may collect.
type CaptureHandler struct {
	svc CaptureService
}

func NewCaptureHandler(svc CaptureService) *CaptureHandler {
	return &CaptureHandler{svc: svc}
}

func captureUserID(c *gin.Context) string {
	return strings.TrimSpace(c.GetString(authmw.ContextUserIDKey))
}

func (h *CaptureHandler) CreateSession(c *gin.Context) {
	var input service.CaptureSessionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("窗口信息格式不正确"))
		return
	}
	view, err := h.svc.CreateCaptureSession(c.Request.Context(), captureUserID(c), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *CaptureHandler) GetSession(c *gin.Context) {
	view, err := h.svc.GetCaptureSession(c.Request.Context(), captureUserID(c), c.Param("session_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *CaptureHandler) UploadAsset(c *gin.Context) {
	userID := captureUserID(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxCampusCatalogImageBytes+(1<<20))
	fileHeader, err := c.FormFile("file")
	if err != nil {
		response.Error(c, badRequest("请选择要上传的照片"))
		return
	}
	if fileHeader.Size > maxCampusCatalogImageBytes {
		response.Error(c, badRequest("单张照片不能超过 20MB"))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCampusCatalogImageBytes+1))
	if err != nil || int64(len(data)) > maxCampusCatalogImageBytes {
		response.Error(c, badRequest("照片读取失败或超过 20MB"))
		return
	}
	contentType := http.DetectContentType(data)
	if headerType := strings.ToLower(strings.TrimSpace(fileHeader.Header.Get("Content-Type"))); contentType == "application/octet-stream" && (headerType == "image/heic" || headerType == "image/heif") && looksLikeHEIF(data) {
		contentType = headerType
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		response.Error(c, badRequest("仅支持图片文件上传"))
		return
	}
	input := service.CaptureAssetInput{Kind: c.PostForm("kind"), ItemKey: c.PostForm("item_key"), DishName: c.PostForm("dish_name")}
	asset, err := h.svc.UploadCaptureAsset(c.Request.Context(), userID, c.Param("session_id"), input, fileHeader.Filename, contentType, data)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "窗口采集照片上传成功", slog.String("user_id", userID),
		slog.String("session_id", asset.SessionID), slog.String("kind", asset.Kind), slog.Int("bytes", len(data)))
	response.Success(c, asset)
}

type captureAssetPatch struct {
	Kind     string `json:"kind"`
	ItemKey  string `json:"item_key"`
	DishName string `json:"dish_name"`
	Remove   bool   `json:"remove"`
}

func (h *CaptureHandler) UpdateAsset(c *gin.Context) {
	var patch captureAssetPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		response.Error(c, badRequest("照片信息格式不正确"))
		return
	}
	input := service.CaptureAssetInput{Kind: patch.Kind, ItemKey: patch.ItemKey, DishName: patch.DishName}
	view, err := h.svc.UpdateCaptureAsset(c.Request.Context(), captureUserID(c), c.Param("session_id"), c.Param("asset_id"), input, patch.Remove)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *CaptureHandler) Extract(c *gin.Context) {
	view, err := h.svc.StartCaptureExtraction(c.Request.Context(), captureUserID(c), c.Param("session_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *CaptureHandler) Submit(c *gin.Context) {
	view, err := h.svc.SubmitCaptureSession(c.Request.Context(), captureUserID(c), c.Param("session_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *CaptureHandler) Windows(c *gin.Context) {
	windows, err := h.svc.ListCapturedWindows(c.Request.Context(), c.Query("venue_type"), c.Query("canteen_id"),
		c.Query("organization_name"), c.Query("canteen_name"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": windows})
}

func (h *CaptureHandler) Earnings(c *gin.Context) {
	earnings, err := h.svc.GetCaptureEarnings(c.Request.Context(), captureUserID(c))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, earnings)
}

type captureRedeemRequest struct {
	OptionCode string `json:"option_code"`
	RequestKey string `json:"request_key"`
}

func (h *CaptureHandler) RedeemMembership(c *gin.Context) {
	var input captureRedeemRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("兑换请求格式不正确"))
		return
	}
	earnings, err := h.svc.RedeemCaptureMembership(c.Request.Context(), captureUserID(c), input.OptionCode, input.RequestKey)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, earnings)
}

type captureWithdrawRequest struct {
	AmountCents int64  `json:"amount_cents"`
	RequestKey  string `json:"request_key"`
}

func (h *CaptureHandler) Withdraw(c *gin.Context) {
	var input captureWithdrawRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("提现请求格式不正确"))
		return
	}
	earnings, err := h.svc.RequestCaptureWithdrawal(c.Request.Context(), captureUserID(c), input.AmountCents, input.RequestKey)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, earnings)
}
