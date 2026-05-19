package response

import (
	"encoding/json"
	"errors"
	"net/http"

	commonerrors "food_link/backend/internal/common/errors"
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

func Error(c *gin.Context, err error) {
	log := logger.L()
	var appErr *commonerrors.AppError
	if errors.As(err, &appErr) {
		if log != nil {
			log.Warn("应用错误",
				slog.Int("http_status", appErr.HTTPStatus),
				slog.Int("code", appErr.Code),
				slog.String("message", appErr.Message),
				slog.String("path", c.Request.URL.Path),
				slog.String("method", c.Request.Method),
			)
		}
		c.JSON(appErr.HTTPStatus, gin.H{
			"code":    appErr.Code,
			"message": appErr.Message,
		})
		return
	}
	// gin binding / validation errors → 400
	var ginErr *gin.Error
	if errors.As(err, &ginErr) {
		if log != nil {
			log.Warn("Gin 参数绑定错误",
				slog.Int("code", 400),
				slog.String("message", err.Error()),
				slog.String("path", c.Request.URL.Path),
				slog.String("method", c.Request.Method),
			)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	// JSON parse errors → 400
	var jsonErr *json.SyntaxError
	if errors.As(err, &jsonErr) {
		if log != nil {
			log.Warn("JSON 解析错误",
				slog.Int("code", 400),
				slog.String("message", err.Error()),
				slog.String("path", c.Request.URL.Path),
				slog.String("method", c.Request.Method),
			)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	// validator errors → 400
	var valErr validator.ValidationErrors
	if errors.As(err, &valErr) {
		if log != nil {
			log.Warn("参数校验错误",
				slog.Int("code", 400),
				slog.String("message", err.Error()),
				slog.String("path", c.Request.URL.Path),
				slog.String("method", c.Request.Method),
			)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	if log != nil {
		log.Error("未处理错误",
			logger.Err(err),
			slog.String("path", c.Request.URL.Path),
			slog.String("method", c.Request.Method),
		)
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    commonerrors.ErrInternal.Code,
		"message": commonerrors.ErrInternal.Message,
	})
}
