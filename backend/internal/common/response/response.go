package response

import (
	"errors"
	"net/http"

	commonerrors "food_link/backend/internal/common/errors"

	"github.com/gin-gonic/gin"
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
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    commonerrors.ErrInternal.Code,
		"message": commonerrors.ErrInternal.Message,
	})
}
