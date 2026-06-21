package database

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	applogger "food_link/backend/pkg/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"gorm.io/gorm"
)

func TestGORMLogAdapterTraceLogsFailureWithRedactedSQL(t *testing.T) {
	var buf bytes.Buffer
	applogger.SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	ctx, span := otel.Tracer("database-test").Start(context.Background(), "request")
	err := errors.New("connection failed")
	newGORMLogger().Trace(ctx, time.Now().Add(-10*time.Millisecond), func() (string, int64) {
		return "SELECT * FROM weapp_user WHERE openid = 'secret-openid' AND deleted_at IS NULL", -1
	}, err)
	span.End()

	out := buf.String()
	assert.Contains(t, out, "数据库查询失败")
	assert.Contains(t, out, "connection failed")
	assert.Contains(t, out, "db.statement")
	assert.NotContains(t, out, "secret-openid")
	assert.Contains(t, out, "'?'")

	spans := recorder.Ended()
	require.Len(t, spans, 1)
	events := spans[0].Events()
	require.Len(t, events, 1)
	assert.Equal(t, "数据库查询失败", events[0].Name)
	assertSpanEventAttr(t, events[0].Attributes, "db.operation", "query")
	assertSpanEventAttr(t, events[0].Attributes, "db.statement", "SELECT * FROM weapp_user WHERE openid = '?' AND deleted_at IS NULL")
	assertSpanEventAttr(t, events[0].Attributes, "error", "connection failed")
}

func TestGORMLogAdapterSkipsSuccessWithoutTrace(t *testing.T) {
	var buf bytes.Buffer
	applogger.SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	newGORMLogger().Trace(context.Background(), time.Now().Add(-10*time.Millisecond), func() (string, int64) {
		return "SELECT * FROM food_expiry_notification_jobs WHERE status = 'queued'", 0
	}, nil)

	assert.Empty(t, strings.TrimSpace(buf.String()))
	assert.Empty(t, recorder.Ended())
}

func TestBeforeGORMLogOperationLogsStart(t *testing.T) {
	var buf bytes.Buffer
	applogger.SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	ctx, span := otel.Tracer("database-test").Start(context.Background(), "request")
	tx := &gorm.DB{Statement: &gorm.Statement{Context: ctx, Table: "weapp_user"}}
	beforeGORMLogOperation("query")(tx)
	span.End()

	out := buf.String()
	assert.Contains(t, out, "开始查询数据库")
	assert.Contains(t, out, "weapp_user")
	_, ok := tx.InstanceGet(gormLogStartKey)
	assert.True(t, ok)

	spans := recorder.Ended()
	require.Len(t, spans, 1)
	events := spans[0].Events()
	require.Len(t, events, 1)
	assert.Equal(t, "开始查询数据库", events[0].Name)
	assertSpanEventAttr(t, events[0].Attributes, "db.operation", "query")
	assertSpanEventAttr(t, events[0].Attributes, "db.table", "weapp_user")
}

func TestBeforeGORMLogOperationSkipsStartWithoutTrace(t *testing.T) {
	var buf bytes.Buffer
	applogger.SetGlobal(slog.New(slog.NewJSONHandler(&buf, nil)))
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	tx := &gorm.DB{Statement: &gorm.Statement{Context: context.Background(), Table: "food_expiry_notification_jobs"}}
	beforeGORMLogOperation("query")(tx)

	assert.Empty(t, strings.TrimSpace(buf.String()))
	assert.Empty(t, recorder.Ended())
	_, ok := tx.InstanceGet(gormLogStartKey)
	assert.True(t, ok)
}

func TestSanitizeSQLStatementRedactsAndTruncates(t *testing.T) {
	got, truncated := sanitizeSQLStatement("SELECT * FROM users WHERE token = 'super-secret' AND note = 'hello world'", 40)

	assert.True(t, truncated)
	assert.Contains(t, got, "'?'")
	assert.NotContains(t, got, "super-secret")
	assert.NotContains(t, got, "hello world")
	assert.True(t, strings.HasSuffix(got, "..."))
}

func TestOperationFromSQL(t *testing.T) {
	assert.Equal(t, "query", operationFromSQL("SELECT * FROM users"))
	assert.Equal(t, "create", operationFromSQL("INSERT INTO users(id) VALUES(1)"))
	assert.Equal(t, "update", operationFromSQL("UPDATE users SET nickname = 'x'"))
	assert.Equal(t, "delete", operationFromSQL("DELETE FROM users WHERE id = 1"))
	assert.Equal(t, "raw", operationFromSQL("ALTER TABLE users ADD COLUMN x text"))
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
