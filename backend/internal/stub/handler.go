package stub

import (
	"fmt"
	"net/http"

	"food_link/backend/internal/common/routes"

	"github.com/gin-gonic/gin"
)

func Handler(spec routes.Spec) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusNotImplemented, gin.H{
			"code":    10004,
			"message": fmt.Sprintf("%s %s 已注册但尚未迁移", spec.Method, spec.Path),
			"doc":     spec.DocRef,
		})
	}
}
