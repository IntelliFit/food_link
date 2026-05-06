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
	var appErr *commonerrors.AppError
	if errors.As(err, &appErr) {
		c.JSON(appErr.HTTPStatus, gin.H{
			"code":    appErr.Code,
			"message": appErr.Message,
		})
		return
	}
	// gin binding / validation errors → 400
	var ginErr *gin.Error
	if errors.As(err, &ginErr) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	// JSON parse errors → 400
	var jsonErr *json.SyntaxError
	if errors.As(err, &jsonErr) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	// validator errors → 400
	var valErr validator.ValidationErrors
	if errors.As(err, &valErr) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}
	log := logger.L()
	if log != nil {
		log.Error("unhandled error", zap.Error(err))
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    commonerrors.ErrInternal.Code,
		"message": commonerrors.ErrInternal.Message,
	})
}
