package trace

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

const tracerName = "food_link/backend"

func StartSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, oteltrace.Span) {
	return otel.Tracer(tracerName).Start(ctx, name, oteltrace.WithAttributes(attrs...))
}

func AddEvent(ctx context.Context, name string, attrs ...attribute.KeyValue) {
	span := oteltrace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	span.AddEvent(name, oteltrace.WithAttributes(attrs...))
}

func SetAttributes(ctx context.Context, attrs ...attribute.KeyValue) {
	span := oteltrace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	span.SetAttributes(attrs...)
}

func RecordError(ctx context.Context, err error, attrs ...attribute.KeyValue) {
	if err == nil {
		return
	}
	span := oteltrace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	span.RecordError(err, oteltrace.WithAttributes(attrs...))
	span.SetStatus(codes.Error, err.Error())
}

func DurationMS(key string, duration time.Duration) attribute.KeyValue {
	return attribute.Int64(key, duration.Milliseconds())
}
