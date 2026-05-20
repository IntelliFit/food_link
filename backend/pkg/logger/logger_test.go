package logger

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitJSONLogger(t *testing.T) {
	shutdown, err := Init(context.Background(), config.AppConfig{Name: "test", Env: "test"}, config.LogConfig{
		Level:  "info",
		Format: "json",
		Output: "stdout",
	}, config.OTelConfig{})
	require.NoError(t, err)
	require.NotNil(t, shutdown)
	assert.NotNil(t, L())
	require.NoError(t, shutdown(context.Background()))
}

func TestLoggerWritesAttrs(t *testing.T) {
	var buf bytes.Buffer
	SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))

	Info(context.Background(), "测试日志", slog.String("user_id", "u1"))

	out := buf.String()
	assert.Contains(t, out, "测试日志")
	assert.Contains(t, out, "user_id")
	assert.True(t, strings.Contains(out, "u1"))
}
