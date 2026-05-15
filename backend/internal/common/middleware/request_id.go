package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	oteltrace "go.opentelemetry.io/otel/trace"
)

const (
	HeaderTraceID   = "X-Trace-Id"
	HeaderRequestID = "X-Request-Id"
)

// RequestID guarantees every HTTP response carries an identifier that can be
// copied from the mini program even when OpenTelemetry is disabled.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader(HeaderRequestID))
		if requestID == "" || isPlaceholderID(requestID) {
			requestID = uuid.NewString()
		}

		traceID := traceIDFromContext(c)
		if traceID == "" {
			traceID = normalizeTraceID(c.GetHeader(HeaderTraceID))
		}
		if traceID == "" {
			traceID = strings.ReplaceAll(uuid.NewString(), "-", "")
		}

		c.Header(HeaderRequestID, requestID)
		c.Header(HeaderTraceID, traceID)
		c.Set("request_id", requestID)
		c.Set("trace_id", traceID)
		c.Next()
	}
}

func traceIDFromContext(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	spanContext := oteltrace.SpanContextFromContext(c.Request.Context())
	if !spanContext.HasTraceID() {
		return ""
	}
	return spanContext.TraceID().String()
}

func normalizeTraceID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || isPlaceholderID(value) {
		return ""
	}
	return value
}

func isPlaceholderID(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), "no-trace-id")
}
