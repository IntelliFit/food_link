package response

import (
	"encoding/json"
	"errors"
	"net/http"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"
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
			log.Warn("app error",
				zap.Int("http_status", appErr.HTTPStatus),
				zap.Int("code", appErr.Code),
				zap.String("message", appErr.Message),
				zap.String("path", c.Request.URL.Path),
				zap.String("method", c.Request.Method),
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
			log.Warn("gin binding error",
				zap.Int("code", 400),
				zap.String("message", err.Error()),
				zap.String("path", c.Request.URL.Path),
				zap.String("method", c.Request.Method),
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
			log.Warn("json parse error",
				zap.Int("code", 400),
				zap.String("message", err.Error()),
				zap.String("path", c.Request.URL.Path),
				zap.String("method", c.Request.Method),
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
			log.Warn("validation error",
				zap.Int("code", 400),
				zap.String("message", err.Error()),
				zap.String("path", c.Request.URL.Path),
				zap.String("method", c.Request.Method),
			)
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	if log != nil {
		log.Error("unhandled error",
			zap.Error(err),
			zap.String("path", c.Request.URL.Path),
			zap.String("method", c.Request.Method),
		)
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    commonerrors.ErrInternal.Code,
		"message": commonerrors.ErrInternal.Message,
	})
}
