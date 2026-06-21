package logger

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	commonmw "food_link/backend/internal/common/middleware"
	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
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
	global     = &Logger{inner: withSpanEvents(slog.New(slog.NewJSONHandler(os.Stdout, nil)))}
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
	localHandler := unwrapSpanEventHandler(global.inner.Handler())
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
	l = withSpanEvents(l)
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

func AnalysisTaskID(taskID string) slog.Attr {
	return slog.String("analysis.task_id", strings.TrimSpace(taskID))
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
	attrs = appendTraceAttrs(ctx, attrs)
	l.inner.LogAttrs(ctx, level, msg, attrs...)
}

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		if shouldSkipRequestLog(c.Request) {
			c.Next()
			return
		}
		start := time.Now()
		rawPath := requestPath(c.Request)
		Info(c.Request.Context(), "收到请求", requestStartAttrs(c, rawPath)...)

		c.Next()

		ctx := c.Request.Context()
		routePath := c.FullPath()
		if routePath == "" {
			routePath = rawPath
		}
		attrs := []slog.Attr{
			slog.String("http.method", c.Request.Method),
			slog.String("url.path", rawPath),
			slog.String("http.route", routePath),
			slog.Int("http.status_code", c.Writer.Status()),
			slog.Int("http.response.body.size", c.Writer.Size()),
			slog.Duration("http.duration", time.Since(start)),
			slog.String("client.address", c.ClientIP()),
		}
		traceID, requestID, hostName := commonmw.RequestIDs(c)
		if traceID != "" {
			attrs = append(attrs, slog.String("trace_id", traceID))
		}
		if requestID != "" {
			attrs = append(attrs, slog.String("request_id", requestID))
		}
		if hostName != "" {
			attrs = append(attrs, slog.String("host_name", hostName))
		}
		if taskID := strings.TrimSpace(c.GetString("analysis.task_id")); taskID != "" {
			attrs = append(attrs,
				slog.String("analysis.task_id", taskID),
				slog.String("task_id", taskID),
			)
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

func requestStartAttrs(c *gin.Context, path string) []slog.Attr {
	attrs := []slog.Attr{
		slog.String("http.method", c.Request.Method),
		slog.String("url.path", path),
		slog.String("client.address", c.ClientIP()),
	}
	if userAgent := strings.TrimSpace(c.Request.UserAgent()); userAgent != "" {
		attrs = append(attrs, Truncated("user_agent", userAgent, 200))
	}
	traceID, requestID, hostName := commonmw.RequestIDs(c)
	if traceID != "" {
		attrs = append(attrs, slog.String("trace_id", traceID))
	}
	if requestID != "" {
		attrs = append(attrs, slog.String("request_id", requestID))
	}
	if hostName != "" {
		attrs = append(attrs, slog.String("host_name", hostName))
	}
	return attrs
}

func requestPath(req *http.Request) string {
	if req == nil || req.URL == nil {
		return ""
	}
	return req.URL.Path
}

func shouldSkipRequestLog(req *http.Request) bool {
	if req == nil || req.URL == nil {
		return false
	}
	return strings.TrimSpace(req.URL.Path) == "/api/health"
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
	for _, attr := range trace {
		if !hasAttr(attrs, attr.Key) {
			attrs = append(attrs, attr)
		}
	}
	return attrs
}

func hasAttr(attrs []slog.Attr, key string) bool {
	for _, attr := range attrs {
		if attr.Key == key {
			return true
		}
	}
	return false
}

func withSpanEvents(l *slog.Logger) *slog.Logger {
	if l == nil {
		return slog.New(spanEventHandler{handler: slog.NewJSONHandler(io.Discard, nil)})
	}
	if _, ok := l.Handler().(spanEventHandler); ok {
		return l
	}
	return slog.New(spanEventHandler{handler: l.Handler()})
}

func unwrapSpanEventHandler(handler slog.Handler) slog.Handler {
	if wrapped, ok := handler.(spanEventHandler); ok {
		return wrapped.handler
	}
	return handler
}

func addLogSpanEvent(ctx context.Context, level slog.Level, msg string, attrs []slog.Attr) {
	if ctx == nil {
		ctx = context.Background()
	}
	span := oteltrace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		addOrphanLogSpanEvent(level, msg, attrs)
		return
	}
	addLogEventToSpan(span, level, msg, attrs)
}

func addOrphanLogSpanEvent(level slog.Level, msg string, attrs []slog.Attr) {
	_, span := otel.Tracer("food_link/backend/pkg/logger").Start(context.Background(), msg,
		oteltrace.WithAttributes(
			attribute.Bool("log.orphan", true),
			attribute.String("log.message", msg),
			attribute.String("log.severity", level.String()),
		),
	)
	if !span.SpanContext().IsValid() {
		return
	}
	addLogEventToSpan(span, level, msg, attrs)
	span.End()
}

func addLogEventToSpan(span oteltrace.Span, level slog.Level, msg string, attrs []slog.Attr) {
	eventAttrs := []attribute.KeyValue{
		attribute.String("log.severity", level.String()),
		attribute.String("log.message", msg),
	}
	for _, attr := range attrs {
		eventAttrs = appendLogAttr(eventAttrs, attr)
	}
	span.AddEvent(msg, oteltrace.WithAttributes(eventAttrs...))
	if level >= slog.LevelError {
		span.SetStatus(codes.Error, msg)
	}
}

type spanEventHandler struct {
	handler slog.Handler
	attrs   []slog.Attr
	groups  []string
}

func (h spanEventHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.handler.Enabled(ctx, level)
}

func (h spanEventHandler) Handle(ctx context.Context, record slog.Record) error {
	attrs := make([]slog.Attr, 0, len(h.attrs)+record.NumAttrs())
	attrs = append(attrs, h.attrs...)
	record.Attrs(func(attr slog.Attr) bool {
		attrs = append(attrs, prefixLogAttr(h.groups, attr))
		return true
	})
	addLogSpanEvent(ctx, record.Level, record.Message, attrs)
	return h.handler.Handle(ctx, record)
}

func (h spanEventHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	nextAttrs := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	nextAttrs = append(nextAttrs, h.attrs...)
	for _, attr := range attrs {
		nextAttrs = append(nextAttrs, prefixLogAttr(h.groups, attr))
	}
	return spanEventHandler{
		handler: h.handler.WithAttrs(attrs),
		attrs:   nextAttrs,
		groups:  append([]string(nil), h.groups...),
	}
}

func (h spanEventHandler) WithGroup(name string) slog.Handler {
	groups := append([]string(nil), h.groups...)
	if name = strings.TrimSpace(name); name != "" {
		groups = append(groups, name)
	}
	return spanEventHandler{
		handler: h.handler.WithGroup(name),
		attrs:   append([]slog.Attr(nil), h.attrs...),
		groups:  groups,
	}
}

func prefixLogAttr(groups []string, attr slog.Attr) slog.Attr {
	if len(groups) == 0 || attr.Key == "" {
		return attr
	}
	prefix := strings.Join(groups, ".")
	attr.Key = prefix + "." + attr.Key
	return attr
}

func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			ctx := c.Request.Context()
			err := fmt.Errorf("%v", recovered)
			Error(ctx, "请求 panic 已恢复", err,
				slog.String("http.method", c.Request.Method),
				slog.String("url.path", c.Request.URL.Path),
				slog.Any("panic", recovered),
				Truncated("panic.stack", string(debug.Stack()), 4000),
			)
			c.AbortWithStatus(http.StatusInternalServerError)
		}()
		c.Next()
	}
}

func appendLogAttr(out []attribute.KeyValue, attr slog.Attr) []attribute.KeyValue {
	attr.Value = attr.Value.Resolve()
	if attr.Key == "" {
		return out
	}
	switch attr.Value.Kind() {
	case slog.KindString:
		return append(out, attribute.String(attr.Key, attr.Value.String()))
	case slog.KindBool:
		return append(out, attribute.Bool(attr.Key, attr.Value.Bool()))
	case slog.KindInt64:
		return append(out, attribute.Int64(attr.Key, attr.Value.Int64()))
	case slog.KindUint64:
		return append(out, attribute.Int64(attr.Key, int64(attr.Value.Uint64())))
	case slog.KindFloat64:
		return append(out, attribute.Float64(attr.Key, attr.Value.Float64()))
	case slog.KindDuration:
		return append(out, attribute.Int64(attr.Key+".ms", attr.Value.Duration().Milliseconds()))
	case slog.KindTime:
		return append(out, attribute.String(attr.Key, attr.Value.Time().Format(time.RFC3339Nano)))
	case slog.KindGroup:
		for _, child := range attr.Value.Group() {
			child.Key = attr.Key + "." + child.Key
			out = appendLogAttr(out, child)
		}
		return out
	case slog.KindAny:
		return append(out, attribute.String(attr.Key, fmt.Sprint(attr.Value.Any())))
	default:
		return append(out, attribute.String(attr.Key, attr.Value.String()))
	}
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
