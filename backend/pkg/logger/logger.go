package logger

import (
	"context"
	"sync"

	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var (
	global     *zap.Logger
	globalOnce sync.Once
)

func New(env string) (*zap.Logger, error) {
	if env == "production" {
		return zap.NewProduction()
	}
	return zap.NewDevelopment()
}

// SetGlobal sets the global logger instance.
func SetGlobal(l *zap.Logger) {
	global = l
	zap.ReplaceGlobals(l)
}

// L returns the global logger, or a no-op logger if none is set.
func L() *zap.Logger {
	if global != nil {
		return global
	}
	return zap.NewNop()
}

func WithTrace(ctx context.Context) *zap.Logger {
	log := L()
	span := oteltrace.SpanFromContext(ctx)
	spanContext := span.SpanContext()
	if !spanContext.IsValid() {
		return log
	}
	return log.With(
		zap.String("trace_id", spanContext.TraceID().String()),
		zap.String("span_id", spanContext.SpanID().String()),
	)
}
