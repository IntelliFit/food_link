package taskqueue

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
)

func TestMemoryQueuePublishSubscribe(t *testing.T) {
	q := NewMemoryQueue(1, nil)
	defer func() { _ = q.Close(context.Background()) }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	deliveries, err := q.Subscribe(ctx, SubscribeOptions{TaskTypes: []string{"food"}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := q.PublishTask(ctx, TaskMessage{TaskID: "task-1", TaskType: "food"}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case delivery := <-deliveries:
		if delivery.Message.TaskID != "task-1" || delivery.Message.TaskType != "food" {
			t.Fatalf("unexpected delivery: %+v", delivery.Message)
		}
		if err := delivery.Ack(ctx); err != nil {
			t.Fatalf("ack: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for delivery")
	}
}

func TestMemoryQueueCloseRejectsPublish(t *testing.T) {
	q := NewMemoryQueue(1, nil)
	if err := q.Close(context.Background()); err != nil {
		t.Fatalf("close: %v", err)
	}
	err := q.PublishTask(context.Background(), TaskMessage{TaskID: "task-1", TaskType: "food"})
	if !errors.Is(err, ErrClosed) {
		t.Fatalf("expected ErrClosed, got %v", err)
	}
}

func TestMemoryQueuePropagatesTraceContext(t *testing.T) {
	oldProvider := otel.GetTracerProvider()
	oldPropagator := otel.GetTextMapPropagator()
	provider := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(oldProvider)
		otel.SetTextMapPropagator(oldPropagator)
	}()

	q := NewMemoryQueue(1, nil)
	defer func() { _ = q.Close(context.Background()) }()

	subCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	deliveries, err := q.Subscribe(subCtx, SubscribeOptions{TaskTypes: []string{"food"}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	publishCtx, span := otel.Tracer("taskqueue-test").Start(context.Background(), "publish")
	defer span.End()
	if err := q.PublishTask(publishCtx, TaskMessage{TaskID: "task-1", TaskType: "food"}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case delivery := <-deliveries:
		if delivery.Message.TraceContext["traceparent"] == "" {
			t.Fatalf("expected traceparent carrier, got %#v", delivery.Message.TraceContext)
		}
		extracted := delivery.Message.Context(context.Background())
		parent := oteltrace.SpanContextFromContext(extracted)
		if !parent.IsValid() {
			t.Fatal("expected valid extracted span context")
		}
		if parent.TraceID() != span.SpanContext().TraceID() {
			t.Fatalf("trace id mismatch: got %s want %s", parent.TraceID(), span.SpanContext().TraceID())
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for delivery")
	}
}
