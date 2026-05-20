package logger

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	oteltrace "go.opentelemetry.io/otel/trace"
)

type ShutdownFunc func(context.Context) error

type Logger struct {
	inner *slog.Logger
}

var (
	global     = &Logger{inner: slog.New(slog.NewJSONHandler(os.Stdout, nil))}
	levelVar   = new(slog.LevelVar)
	outputFile *os.File
)

func Init(ctx context.Context, app config.AppConfig, cfg config.LogConfig, otelCfg config.OTelConfig) (ShutdownFunc, error) {
	if err := configureLocalLogger(cfg); err != nil {
		return nil, err
	}
	if !otelCfg.Enabled {
		return closeOutputFile, nil
	}

	provider, err := newOTelLoggerProvider(ctx, app.Name, app.Env, otelCfg)
	if err != nil {
		return closeOutputFile, err
	}
	localHandler := global.inner.Handler()
	otelHandler := otelslog.NewHandler(app.Name, otelslog.WithLoggerProvider(provider))
	SetGlobal(slog.New(multiHandler{handlers: []slog.Handler{localHandler, otelHandler}}))

	return func(ctx context.Context) error {
		return errors.Join(provider.Shutdown(ctx), closeOutputFile(ctx))
	}, nil
}

func New(cfg config.LogConfig) (*Logger, error) {
	if err := configureLocalLogger(cfg); err != nil {
		return nil, err
	}
	return global, nil
}

func SetGlobal(l *slog.Logger) {
	if l == nil {
		l = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	global = &Logger{inner: l}
	slog.SetDefault(l)
}

func L() *Logger {
	if global == nil {
		return &Logger{inner: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	}
	return global
}

func Info(ctx context.Context, msg string, attrs ...slog.Attr) {
	L().InfoContext(ctx, msg, attrs...)
}

func Warn(ctx context.Context, msg string, attrs ...slog.Attr) {
	L().WarnContext(ctx, msg, attrs...)
}

func Error(ctx context.Context, msg string, err error, attrs ...slog.Attr) {
	if err != nil {
		attrs = append(attrs, Err(err))
	}
	L().ErrorContext(ctx, msg, attrs...)
}

func Err(err error) slog.Attr {
	return NamedErr("error", err)
}

func NamedErr(name string, err error) slog.Attr {
	if err == nil {
		return slog.String(name, "")
	}
	return slog.String(name, err.Error())
}

func Stringp(name string, value *string) slog.Attr {
	if value == nil {
		return slog.Any(name, nil)
	}
	return slog.String(name, *value)
}

func Timep(name string, value *time.Time) slog.Attr {
	if value == nil {
		return slog.Any(name, nil)
	}
	return slog.Time(name, *value)
}

func WithTrace(ctx context.Context) *Logger {
	return L().WithContext(ctx)
}

func (l *Logger) WithContext(ctx context.Context) *Logger {
	if l == nil || l.inner == nil {
		return L().WithContext(ctx)
	}
	attrs := traceAttrs(ctx)
	if len(attrs) == 0 {
		return l
	}
	return &Logger{inner: l.inner.With(attrsToAny(attrs)...)}
}

func (l *Logger) Info(msg string, attrs ...slog.Attr) {
	l.InfoContext(context.Background(), msg, attrs...)
}

func (l *Logger) Warn(msg string, attrs ...slog.Attr) {
	l.WarnContext(context.Background(), msg, attrs...)
}

func (l *Logger) Error(msg string, attrs ...slog.Attr) {
	l.ErrorContext(context.Background(), msg, attrs...)
}

func (l *Logger) InfoContext(ctx context.Context, msg string, attrs ...slog.Attr) {
	l.logAttrs(ctx, slog.LevelInfo, msg, attrs...)
}

func (l *Logger) WarnContext(ctx context.Context, msg string, attrs ...slog.Attr) {
	l.logAttrs(ctx, slog.LevelWarn, msg, attrs...)
}

func (l *Logger) ErrorContext(ctx context.Context, msg string, attrs ...slog.Attr) {
	l.logAttrs(ctx, slog.LevelError, msg, attrs...)
}

func (l *Logger) logAttrs(ctx context.Context, level slog.Level, msg string, attrs ...slog.Attr) {
	if l == nil || l.inner == nil {
		l = L()
	}
	l.inner.LogAttrs(ctx, level, msg, appendTraceAttrs(ctx, attrs)...)
}

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		c.Next()

		ctx := c.Request.Context()
		attrs := []slog.Attr{
			slog.String("http.method", c.Request.Method),
			slog.String("url.path", path),
			slog.Int("http.status_code", c.Writer.Status()),
			slog.Int("http.response.body.size", c.Writer.Size()),
			slog.Duration("http.duration", time.Since(start)),
			slog.String("client.address", c.ClientIP()),
		}
		if requestID := strings.TrimSpace(c.GetHeader("X-Request-Id")); requestID != "" {
			attrs = append(attrs, slog.String("request_id", requestID))
		}
		if len(c.Errors) > 0 {
			attrs = append(attrs, slog.String("gin.errors", c.Errors.String()))
		}

		switch status := c.Writer.Status(); {
		case status >= http.StatusInternalServerError:
			Error(ctx, "请求失败", nil, attrs...)
		case status >= http.StatusBadRequest:
			Warn(ctx, "请求完成但返回客户端错误", attrs...)
		default:
			Info(ctx, "请求完成", attrs...)
		}
	}
}

func configureLocalLogger(cfg config.LogConfig) error {
	levelVar.Set(parseLevel(cfg.Level))

	var writer io.Writer = os.Stdout
	if strings.EqualFold(cfg.Output, "file") || strings.EqualFold(cfg.Output, "both") || strings.TrimSpace(cfg.FilePath) != "" {
		path := strings.TrimSpace(cfg.FilePath)
		if path == "" {
			path = "logs/food-link-backend.log"
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
		outputFile = file
		if strings.EqualFold(cfg.Output, "file") {
			writer = file
		} else {
			writer = io.MultiWriter(os.Stdout, file)
		}
	}

	opts := &slog.HandlerOptions{Level: levelVar}
	if strings.EqualFold(cfg.Format, "text") {
		SetGlobal(slog.New(slog.NewTextHandler(writer, opts)))
	} else {
		SetGlobal(slog.New(slog.NewJSONHandler(writer, opts)))
	}
	return nil
}

func newOTelLoggerProvider(ctx context.Context, serviceName, environment string, cfg config.OTelConfig) (*sdklog.LoggerProvider, error) {
	opts := []otlploggrpc.Option{}
	if endpoint := strings.TrimSpace(cfg.CollectorEndpoint); endpoint != "" {
		opts = append(opts, otlploggrpc.WithEndpoint(endpoint))
	}
	if cfg.Insecure {
		opts = append(opts, otlploggrpc.WithInsecure())
	}
	exporter, err := otlploggrpc.New(ctx, opts...)
	if err != nil {
		return nil, err
	}

	hostName, _ := os.Hostname()
	resAttrs := []resource.Option{
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.DeploymentEnvironment(normalizeResourceValue(environment, "unknown")),
		),
	}
	if hostName = strings.TrimSpace(hostName); hostName != "" {
		resAttrs = append(resAttrs, resource.WithAttributes(semconv.HostName(hostName), semconv.ServiceInstanceID(hostName)))
	}
	res, err := resource.New(ctx, resAttrs...)
	if err != nil {
		return nil, err
	}

	return sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
	), nil
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func traceAttrs(ctx context.Context) []slog.Attr {
	spanContext := oteltrace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return nil
	}
	return []slog.Attr{
		slog.String("trace_id", spanContext.TraceID().String()),
		slog.String("span_id", spanContext.SpanID().String()),
	}
}

func appendTraceAttrs(ctx context.Context, attrs []slog.Attr) []slog.Attr {
	trace := traceAttrs(ctx)
	if len(trace) == 0 {
		return attrs
	}
	return append(attrs, trace...)
}

func attrsToAny(attrs []slog.Attr) []any {
	out := make([]any, 0, len(attrs))
	for _, attr := range attrs {
		out = append(out, attr)
	}
	return out
}

func normalizeResourceValue(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func closeOutputFile(context.Context) error {
	if outputFile == nil {
		return nil
	}
	err := outputFile.Close()
	outputFile = nil
	return err
}

type multiHandler struct {
	handlers []slog.Handler
}

func (h multiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h multiHandler) Handle(ctx context.Context, record slog.Record) error {
	var err error
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, record.Level) {
			err = errors.Join(err, handler.Handle(ctx, record.Clone()))
		}
	}
	return err
}

func (h multiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithAttrs(attrs))
	}
	return multiHandler{handlers: next}
}

func (h multiHandler) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithGroup(name))
	}
	return multiHandler{handlers: next}
}
