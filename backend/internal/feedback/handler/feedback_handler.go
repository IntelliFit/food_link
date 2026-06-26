package handler

import (
	"context"
	"io"
	"log/slog"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	commonmw "food_link/backend/internal/common/middleware"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/feedback/domain"
	"food_link/backend/internal/feedback/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type FeedbackService interface {
	Submit(ctx context.Context, userID string, input service.SubmitInput) (string, error)
}

type FeedbackUploadService interface {
	UploadImage(userID string, fileBytes []byte, ext, contentType string) (string, error)
}

type FeedbackHandler struct {
	svc     FeedbackService
	uploads FeedbackUploadService
}

func NewFeedbackHandler(svc FeedbackService, uploads FeedbackUploadService) *FeedbackHandler {
	return &FeedbackHandler{svc: svc, uploads: uploads}
}

func (h *FeedbackHandler) Submit(c *gin.Context) {
	var body struct {
		Category       string                      `json:"category"`
		Source         string                      `json:"source"`
		Content        string                      `json:"content"`
		Contact        string                      `json:"contact"`
		PagePath       string                      `json:"page_path"`
		AppVersion     string                      `json:"app_version"`
		ClientInfo     map[string]any              `json:"client_info"`
		RecentRequests []domain.RecentRequestTrace `json:"recent_requests"`
		ImageURLs      []string                    `json:"image_urls"`
		Extra          map[string]any              `json:"extra"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}

	userID := c.GetString(authmw.ContextUserIDKey)
	traceID, requestID, hostName := commonmw.RequestIDs(c)
	id, err := h.svc.Submit(c.Request.Context(), userID, service.SubmitInput{
		Category:        body.Category,
		Source:          body.Source,
		Content:         body.Content,
		Contact:         body.Contact,
		PagePath:        body.PagePath,
		AppVersion:      body.AppVersion,
		ClientInfo:      body.ClientInfo,
		RecentRequests:  body.RecentRequests,
		ImageURLs:       body.ImageURLs,
		Extra:           body.Extra,
		SubmitTraceID:   traceID,
		SubmitRequestID: requestID,
		SubmitHostName:  hostName,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "用户提交意见反馈",
		slog.String("user_id", userID),
		slog.String("feedback_id", id),
		slog.String("category", body.Category),
		slog.String("source", body.Source),
		slog.Int("recent_request_count", len(body.RecentRequests)),
		slog.Int("image_count", len(body.ImageURLs)),
		slog.String("trace_id", traceID),
		slog.String("request_id", requestID),
	)
	response.Success(c, gin.H{"id": id, "message": "反馈已提交"})
}

// POST /api/feedback/upload-image
func (h *FeedbackHandler) UploadImage(c *gin.Context) {
	if h.uploads == nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "图片上传未配置", HTTPStatus: 503})
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "图片文件不能为空", HTTPStatus: 400})
		return
	}
	contentType := strings.TrimSpace(file.Header.Get("Content-Type"))
	if contentType != "" && !strings.HasPrefix(contentType, "image/") {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "仅支持图片文件上传", HTTPStatus: 400})
		return
	}
	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()

	fileBytes, err := io.ReadAll(opened)
	if err != nil {
		response.Error(c, err)
		return
	}

	userID := c.GetString(authmw.ContextUserIDKey)
	ext := filepathExt(file.Filename)
	imageURL, err := h.uploads.UploadImage(userID, fileBytes, ext, contentType)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "用户上传意见反馈图片",
		slog.String("user_id", userID),
		slog.Int("bytes", len(fileBytes)),
	)
	response.Success(c, gin.H{"imageUrl": imageURL})
}

func filepathExt(filename string) string {
	idx := strings.LastIndex(filename, ".")
	if idx < 0 || idx == len(filename)-1 {
		return ".jpg"
	}
	return strings.ToLower(filename[idx:])
}
