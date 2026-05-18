package trace

import (
	"context"
	"os"
	"strings"
	"time"

	"food_link/backend/pkg/config"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func Init(cfg config.OTelConfig, serviceName, environment string) (func(context.Context) error, error) {
	if !cfg.Enabled {
		return func(context.Context) error { return nil }, nil
	}
	ctx := context.Background()
	res, err := newResource(ctx, serviceName, environment)
	if err != nil {
		return nil, err
	}

	var shutdowns []func(context.Context) error
	if cfg.TracesEnabled {
		tp, err := initTracerProvider(ctx, cfg, res)
		if err != nil {
			return nil, err
		}
		otel.SetTracerProvider(tp)
		shutdowns = append(shutdowns, tp.Shutdown)
	}
	if cfg.MetricsEnabled {
		mp, err := initMeterProvider(ctx, cfg, res)
		if err != nil {
			return nil, err
		}
		otel.SetMeterProvider(mp)
		shutdowns = append(shutdowns, mp.Shutdown)
		_ = runtime.Start(runtime.WithMeterProvider(mp))
	}
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return func(ctx context.Context) error {
		var firstErr error
		for i := len(shutdowns) - 1; i >= 0; i-- {
			if err := shutdowns[i](ctx); err != nil && firstErr == nil {
				firstErr = err
			}
		}
		return firstErr
	}, nil
}

func initTracerProvider(ctx context.Context, cfg config.OTelConfig, res *resource.Resource) (*sdktrace.TracerProvider, error) {
	exp, err := otlptrace.New(ctx, otlptracegrpc.NewClient(traceExporterOptions(cfg)...))
	if err != nil {
		return nil, err
	}
	return sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	), nil
}

func initMeterProvider(ctx context.Context, cfg config.OTelConfig, res *resource.Resource) (*sdkmetric.MeterProvider, error) {
	exp, err := otlpmetricgrpc.New(ctx, metricExporterOptions(cfg)...)
	if err != nil {
		return nil, err
	}
	interval := time.Duration(cfg.MetricExportIntervalSeconds * float64(time.Second))
	if interval <= 0 {
		interval = 15 * time.Second
	}
	reader := sdkmetric.NewPeriodicReader(
		exp,
		sdkmetric.WithInterval(interval),
		sdkmetric.WithTimeout(10*time.Second),
	)
	return sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(reader),
		sdkmetric.WithCardinalityLimit(2000),
	), nil
}

func traceExporterOptions(cfg config.OTelConfig) []otlptracegrpc.Option {
	opts := []otlptracegrpc.Option{}
	if endpoint := strings.TrimSpace(cfg.CollectorEndpoint); endpoint != "" {
		opts = append(opts, otlptracegrpc.WithEndpoint(endpoint))
	}
	if cfg.Insecure {
		opts = append(opts, otlptracegrpc.WithInsecure())
	}
	return opts
}

func metricExporterOptions(cfg config.OTelConfig) []otlpmetricgrpc.Option {
	opts := []otlpmetricgrpc.Option{}
	if endpoint := strings.TrimSpace(cfg.CollectorEndpoint); endpoint != "" {
		opts = append(opts, otlpmetricgrpc.WithEndpoint(endpoint))
	}
	if cfg.Insecure {
		opts = append(opts, otlpmetricgrpc.WithInsecure())
	}
	return opts
}

func newResource(ctx context.Context, serviceName, environment string) (*resource.Resource, error) {
	hostName, _ := os.Hostname()
	attrs := []attribute.KeyValue{
		semconv.ServiceName(serviceName),
		semconv.DeploymentEnvironment(normalizeResourceValue(environment, "unknown")),
	}
	if hostName = strings.TrimSpace(hostName); hostName != "" {
		attrs = append(attrs, semconv.HostName(hostName), semconv.ServiceInstanceID(hostName))
	}
	return resource.New(ctx, resource.WithAttributes(attrs...))
}

func normalizeResourceValue(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
