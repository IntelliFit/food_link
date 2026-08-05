package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	healthservice "food_link/backend/internal/health/service"
	"food_link/backend/internal/pet/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type PetService interface {
	Summary(ctx context.Context, userID, date string) (*service.Summary, error)
	ClaimEvent(ctx context.Context, userID, eventID string) (*service.ClaimResult, error)
	RerollAppearance(ctx context.Context, userID string) (*service.AppearanceRerollResult, error)
	SelectAppearance(ctx context.Context, userID, candidateID string) (*service.AppearanceSelectResult, error)
	CustomizePixelAvatar(ctx context.Context, userID, name string, source []byte) (*service.PixelAvatarResult, error)
}

type PetChatService interface {
	EstimatePetChat(ctx context.Context, userID string, input healthservice.PetChatInput) (*healthservice.PetChatEstimateResult, error)
	GeneratePetChat(ctx context.Context, userID string, input healthservice.PetChatInput) (*healthservice.PetChatResult, error)
	GeneratePetChatStream(ctx context.Context, userID string, input healthservice.PetChatInput) (<-chan healthservice.PetChatStreamChunk, error)
	GetLatestPetChatSession(ctx context.Context, userID string) (*healthservice.PetChatHistoryResult, error)
	ListPetChatSessions(ctx context.Context, userID string) (*healthservice.PetChatSessionsResult, error)
	GetPetChatSessionHistory(ctx context.Context, userID, sessionID string) (*healthservice.PetChatHistoryResult, error)
	AppendPetChatMessages(ctx context.Context, userID string, input healthservice.PetChatAppendInput) (*healthservice.PetChatHistoryResult, error)
}

type PetHandler struct {
	svc  PetService
	chat PetChatService
}

func NewPetHandler(svc PetService, chat ...PetChatService) *PetHandler {
	h := &PetHandler{svc: svc}
	if len(chat) > 0 {
		h.chat = chat[0]
	}
	return h
}

func (h *PetHandler) Summary(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	date := strings.TrimSpace(c.Query("date"))
	data, err := h.svc.Summary(c.Request.Context(), userID, date)
	if err != nil {
		logger.Error(c.Request.Context(), "获取宠物状态失败", err,
			slog.String("user_id", userID),
			slog.String("date", date),
		)
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "获取宠物状态失败", HTTPStatus: 500})
		return
	}
	response.Success(c, data)
}

const maxPixelAvatarUploadBytes = 10 << 20

func (h *PetHandler) CustomizePixelAvatar(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPixelAvatarUploadBytes+1024)
	name := strings.TrimSpace(c.PostForm("name"))
	header, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请选择一张清晰的单人人像照片", HTTPStatus: http.StatusBadRequest})
		return
	}
	if header.Size <= 0 || header.Size > maxPixelAvatarUploadBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "照片大小不能超过 10MB", HTTPStatus: http.StatusBadRequest})
		return
	}

	file, err := header.Open()
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "读取照片失败", HTTPStatus: http.StatusInternalServerError})
		return
	}
	defer file.Close()

	source, err := io.ReadAll(io.LimitReader(file, maxPixelAvatarUploadBytes+1))
	if err != nil || len(source) == 0 || len(source) > maxPixelAvatarUploadBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "照片无效或超过 10MB", HTTPStatus: http.StatusBadRequest})
		return
	}
	contentType := http.DetectContentType(source)
	if !strings.HasPrefix(contentType, "image/") {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "仅支持常见图片格式", HTTPStatus: http.StatusBadRequest})
		return
	}

	logger.Info(c.Request.Context(), "开始生成用户像素分身",
		slog.String("user_id", userID),
		slog.Int("source_bytes", len(source)),
		slog.String("content_type", contentType),
	)
	data, err := h.svc.CustomizePixelAvatar(c.Request.Context(), userID, name, source)
	if err != nil {
		if errors.Is(err, service.ErrPixelAvatarGenerationUnavailable) {
			logger.Warn(c.Request.Context(), "像素分身生成服务未配置",
				slog.String("user_id", userID),
			)
			response.Error(c, &commonerrors.AppError{Code: 10000, Message: "像素分身生成服务暂不可用", HTTPStatus: http.StatusServiceUnavailable})
			return
		}
		if errors.Is(err, service.ErrInvalidPixelAvatarImage) {
			response.Error(c, &commonerrors.AppError{Code: 10002, Message: "无法识别这张照片，请换一张重试", HTTPStatus: http.StatusBadRequest})
			return
		}
		if errors.Is(err, service.ErrInvalidPetName) {
			response.Error(c, &commonerrors.AppError{Code: 10002, Message: "宠物名字最多 12 个字", HTTPStatus: http.StatusBadRequest})
			return
		}
		logger.Error(c.Request.Context(), "生成用户像素分身失败", err,
			slog.String("user_id", userID),
			slog.Int("source_bytes", len(source)),
		)
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "生成像素分身失败，请稍后重试", HTTPStatus: http.StatusInternalServerError})
		return
	}
	logger.Info(c.Request.Context(), "用户像素分身生成完成",
		slog.String("user_id", userID),
	)
	response.Success(c, data)
}

type petChatRequest struct {
	Question   string `json:"question"`
	Range      string `json:"range"`
	SessionID  string `json:"session_id"`
	NewSession bool   `json:"new_session"`
}

type petChatAppendRequest struct {
	SessionID string                               `json:"session_id"`
	Messages  []healthservice.PetChatAppendMessage `json:"messages"`
}

func (h *PetHandler) EstimateChat(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "小食探对话服务暂不可用", HTTPStatus: 503})
		return
	}
	var req petChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "宠物对话估价请求进入",
		slog.String("user_id", userID),
		slog.String("range", strings.TrimSpace(req.Range)),
		slog.Int("question_length", len([]rune(strings.TrimSpace(req.Question)))),
	)
	data, err := h.chat.EstimatePetChat(c.Request.Context(), userID, healthservice.PetChatInput{
		Question: strings.TrimSpace(req.Question),
		Range:    strings.TrimSpace(req.Range),
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "宠物对话估价完成",
		slog.String("user_id", userID),
		slog.String("range", data.Range),
		slog.Int("recorded_days", data.RecordedDays),
		slog.Int("credits_charged", data.Pricing.CreditsCharged),
		slog.Bool("capped", data.Pricing.Capped),
	)
	response.Success(c, data)
}

func (h *PetHandler) Chat(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "小食探对话服务暂不可用", HTTPStatus: 503})
		return
	}
	var req petChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "宠物对话生成请求进入",
		slog.String("user_id", userID),
		slog.String("range", strings.TrimSpace(req.Range)),
		slog.Int("question_length", len([]rune(strings.TrimSpace(req.Question)))),
	)
	data, err := h.chat.GeneratePetChat(c.Request.Context(), userID, healthservice.PetChatInput{
		Question:   strings.TrimSpace(req.Question),
		Range:      strings.TrimSpace(req.Range),
		SessionID:  strings.TrimSpace(req.SessionID),
		NewSession: req.NewSession,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "宠物对话生成完成",
		slog.String("user_id", userID),
		slog.String("range", data.Range),
		slog.Int("recorded_days", data.RecordedDays),
		slog.Int("credits_charged", data.CreditsCharged),
		slog.String("billing_status", data.BillingStatus),
	)
	response.Success(c, data)
}

func (h *PetHandler) ChatStream(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "小食探对话服务暂不可用", HTTPStatus: 503})
		return
	}
	var req petChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "宠物对话流式生成请求进入",
		slog.String("user_id", userID),
		slog.String("range", strings.TrimSpace(req.Range)),
		slog.Int("question_length", len([]rune(strings.TrimSpace(req.Question)))),
	)
	chunkChan, err := h.chat.GeneratePetChatStream(c.Request.Context(), userID, healthservice.PetChatInput{
		Question:   strings.TrimSpace(req.Question),
		Range:      strings.TrimSpace(req.Range),
		SessionID:  strings.TrimSpace(req.SessionID),
		NewSession: req.NewSession,
	})
	if err != nil {
		response.Error(c, err)
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "流式响应不支持", HTTPStatus: 500})
		return
	}

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	for chunk := range chunkChan {
		data, _ := json.Marshal(chunk)
		_, writeErr := io.WriteString(c.Writer, "data: "+string(data)+"\n\n")
		if writeErr != nil {
			logger.Warn(c.Request.Context(), "宠物对话 SSE 写入失败",
				slog.String("user_id", userID),
				logger.Err(writeErr),
			)
			return
		}
		flusher.Flush()
	}
}

func (h *PetHandler) LatestChat(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "宠物对话服务暂不可用", HTTPStatus: 503})
		return
	}
	data, err := h.chat.GetLatestPetChatSession(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) ChatSessions(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "宠物对话服务暂不可用", HTTPStatus: 503})
		return
	}
	data, err := h.chat.ListPetChatSessions(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) ChatSession(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "宠物对话服务暂不可用", HTTPStatus: 503})
		return
	}
	sessionID := strings.TrimSpace(c.Param("session_id"))
	data, err := h.chat.GetPetChatSessionHistory(c.Request.Context(), userID, sessionID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) AppendChatMessages(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	if h.chat == nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "宠物对话服务暂不可用", HTTPStatus: 503})
		return
	}
	var req petChatAppendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, err)
		return
	}
	data, err := h.chat.AppendPetChatMessages(c.Request.Context(), userID, healthservice.PetChatAppendInput{
		SessionID: strings.TrimSpace(req.SessionID),
		Messages:  req.Messages,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) ClaimEvent(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	eventID := strings.TrimSpace(c.Param("event_id"))
	if eventID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "event_id required", HTTPStatus: 400})
		return
	}
	data, err := h.svc.ClaimEvent(c.Request.Context(), userID, eventID)
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "领取宠物奖励失败", HTTPStatus: 500})
		return
	}
	if data == nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "宠物事件不存在", HTTPStatus: 404})
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) RerollAppearance(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.RerollAppearance(c.Request.Context(), userID)
	if err != nil {
		if service.IsInsufficientEarnedCreditsError(err) {
			response.Error(c, &commonerrors.AppError{Code: 10003, Message: "奖励积分不足，至少需要 5 积分", HTTPStatus: 400})
			return
		}
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "更换宠物外观失败", HTTPStatus: 500})
		return
	}
	response.Success(c, data)
}

type selectAppearanceRequest struct {
	CandidateID string `json:"candidate_id"`
}

func (h *PetHandler) SelectAppearance(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	var req selectAppearanceRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.CandidateID) == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "candidate_id required", HTTPStatus: 400})
		return
	}
	data, err := h.svc.SelectAppearance(c.Request.Context(), userID, strings.TrimSpace(req.CandidateID))
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "候选外观不存在", HTTPStatus: 400})
		return
	}
	if data == nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "宠物档案不存在", HTTPStatus: 404})
		return
	}
	response.Success(c, data)
}
