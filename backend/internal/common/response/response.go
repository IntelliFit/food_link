package response

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	commonmw "food_link/backend/internal/common/middleware"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"log/slog"
)

func Success(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "ok",
		"data":    data,
	})
}

func Raw(c *gin.Context, status int, data any) {
	c.JSON(status, data)
}

func requestAttrs(c *gin.Context) []slog.Attr {
	if c == nil || c.Request == nil {
		return nil
	}
	attrs := []slog.Attr{
		slog.String("path", c.Request.URL.Path),
		slog.String("method", c.Request.Method),
	}
	traceID, requestID, hostName := commonmw.RequestIDs(c)
	if traceID != "" {
		attrs = append(attrs, slog.String("trace_id", traceID))
	}
	if requestID != "" {
		attrs = append(attrs, slog.String("request_id", requestID))
	}
	if hostName != "" {
		attrs = append(attrs, slog.String("host_name", hostName))
	}
	if taskID := strings.TrimSpace(c.GetString("analysis.task_id")); taskID != "" {
		attrs = append(attrs,
			slog.String("analysis.task_id", taskID),
			slog.String("task_id", taskID),
		)
	}
	return attrs
}

func Error(c *gin.Context, err error) {
	log := logger.L()
	var appErr *commonerrors.AppError
	if errors.As(err, &appErr) {
		if log != nil {
			attrs := append([]slog.Attr{
				slog.Int("http_status", appErr.HTTPStatus),
				slog.Int("code", appErr.Code),
				slog.String("message", appErr.Message),
			}, requestAttrs(c)...)
			log.WarnContext(c.Request.Context(), "应用错误", attrs...)
		}
		c.JSON(appErr.HTTPStatus, gin.H{
			"code":    appErr.Code,
			"message": appErr.Message,
		})
		return
	}

	var ginErr *gin.Error
	if errors.As(err, &ginErr) {
		if log != nil {
			attrs := append([]slog.Attr{
				slog.Int("code", 400),
				slog.String("message", err.Error()),
			}, requestAttrs(c)...)
			log.WarnContext(c.Request.Context(), "Gin 参数绑定错误", attrs...)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}

	var jsonErr *json.SyntaxError
	if errors.As(err, &jsonErr) {
		if log != nil {
			attrs := append([]slog.Attr{
				slog.Int("code", 400),
				slog.String("message", err.Error()),
			}, requestAttrs(c)...)
			log.WarnContext(c.Request.Context(), "JSON 解析错误", attrs...)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}

	var valErr validator.ValidationErrors
	if errors.As(err, &valErr) {
		if log != nil {
			attrs := append([]slog.Attr{
				slog.Int("code", 400),
				slog.String("message", err.Error()),
			}, requestAttrs(c)...)
			log.WarnContext(c.Request.Context(), "参数校验错误", attrs...)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}

	if log != nil {
		attrs := append([]slog.Attr{logger.Err(err)}, requestAttrs(c)...)
		log.ErrorContext(c.Request.Context(), "未处理错误", attrs...)
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    commonerrors.ErrInternal.Code,
		"message": commonerrors.ErrInternal.Message,
	})
}
