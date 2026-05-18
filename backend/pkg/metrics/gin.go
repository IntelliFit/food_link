package metrics

import (
	"time"

	"github.com/gin-gonic/gin"
)

func GinMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		method := ""
		requestBytes := int64(-1)
		if c.Request != nil {
			method = c.Request.Method
			requestBytes = c.Request.ContentLength
		}
		IncHTTPInFlight(method)
		start := time.Now()
		defer func() {
			DecHTTPInFlight(method)
			route := c.FullPath()
			statusCode := c.Writer.Status()
			responseBytes := int64(c.Writer.Size())
			ObserveHTTP(method, route, statusCode, time.Since(start), requestBytes, responseBytes)
		}()
		c.Next()
	}
}
