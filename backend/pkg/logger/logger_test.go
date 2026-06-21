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
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
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

func TestLoggerAddsSpanEvent(t *testing.T) {
	var buf bytes.Buffer
	SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	ctx, span := otel.Tracer("logger-test").Start(context.Background(), "request")
	Info(ctx, "测试 Jaeger 可见日志", slog.String("user_id", "u1"), slog.Int("item_count", 2))
	slog.InfoContext(ctx, "直接 slog 日志", slog.String("source", "slog"))
	span.End()

	spans := recorder.Ended()
	require.Len(t, spans, 1)
	events := spans[0].Events()
	require.Len(t, events, 2)
	assert.Equal(t, "测试 Jaeger 可见日志", events[0].Name)
	assertSpanEventAttr(t, events[0].Attributes, "log.severity", "INFO")
	assertSpanEventAttr(t, events[0].Attributes, "log.message", "测试 Jaeger 可见日志")
	assertSpanEventAttr(t, events[0].Attributes, "user_id", "u1")
	assertSpanEventAttr(t, events[0].Attributes, "item_count", int64(2))
	assert.Equal(t, "直接 slog 日志", events[1].Name)
	assertSpanEventAttr(t, events[1].Attributes, "source", "slog")
}

func TestLoggerAddsOrphanSpanEvent(t *testing.T) {
	var buf bytes.Buffer
	SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	Info(context.Background(), "孤立日志也进入 Jaeger", slog.String("worker_id", "w1"))

	spans := recorder.Ended()
	require.Len(t, spans, 1)
	assert.Equal(t, "孤立日志也进入 Jaeger", spans[0].Name())
	assertSpanAttr(t, spans[0].Attributes(), "log.orphan", true)
	events := spans[0].Events()
	require.Len(t, events, 1)
	assert.Equal(t, "孤立日志也进入 Jaeger", events[0].Name)
	assertSpanEventAttr(t, events[0].Attributes, "worker_id", "w1")
}

func assertSpanEventAttr(t *testing.T, attrs []attribute.KeyValue, key string, want any) {
	t.Helper()
	for _, attr := range attrs {
		if string(attr.Key) == key {
			assert.Equal(t, want, attr.Value.AsInterface())
			return
		}
	}
	t.Fatalf("span event attr %s not found", key)
}

func assertSpanAttr(t *testing.T, attrs []attribute.KeyValue, key string, want any) {
	t.Helper()
	for _, attr := range attrs {
		if string(attr.Key) == key {
			assert.Equal(t, want, attr.Value.AsInterface())
			return
		}
	}
	t.Fatalf("span attr %s not found", key)
}
