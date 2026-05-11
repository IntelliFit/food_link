package taskqueue

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

var ErrClosed = errors.New("task queue is closed")

type TaskMessage struct {
	TaskID       string
	TaskType     string
	CreatedAt    time.Time
	TraceContext map[string]string
}

func (m TaskMessage) normalized() TaskMessage {
	m.TaskID = strings.TrimSpace(m.TaskID)
	m.TaskType = strings.TrimSpace(m.TaskType)
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now()
	}
	return m
}

func (m TaskMessage) withTraceContext(ctx context.Context) TaskMessage {
	if len(m.TraceContext) > 0 {
		m.TraceContext = copyStringMap(m.TraceContext)
		return m
	}
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if len(carrier) > 0 {
		m.TraceContext = copyStringMap(map[string]string(carrier))
	}
	return m
}

func (m TaskMessage) Context(parent context.Context) context.Context {
	if len(m.TraceContext) == 0 {
		return parent
	}
	return otel.GetTextMapPropagator().Extract(parent, propagation.MapCarrier(m.TraceContext))
}

func copyStringMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

type Delivery struct {
	Message TaskMessage
	ack     func(context.Context) error
	nack    func(context.Context, error) error
}

func (d Delivery) Ack(ctx context.Context) error {
	if d.ack == nil {
		return nil
	}
	return d.ack(ctx)
}

func (d Delivery) Nack(ctx context.Context, err error) error {
	if d.nack == nil {
		return nil
	}
	return d.nack(ctx, err)
}

type SubscribeOptions struct {
	TaskTypes []string
}

type Publisher interface {
	PublishTask(ctx context.Context, msg TaskMessage) error
}

type Consumer interface {
	Subscribe(ctx context.Context, opts SubscribeOptions) (<-chan Delivery, error)
}

type Queue interface {
	Publisher
	Consumer
	Close(ctx context.Context) error
}
