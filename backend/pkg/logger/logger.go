package logger

import (
	"sync"

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
