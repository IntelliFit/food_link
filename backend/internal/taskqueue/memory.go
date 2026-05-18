package taskqueue

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"food_link/backend/pkg/metrics"

	"go.uber.org/zap"
)

type MemoryQueue struct {
	messages chan TaskMessage
	done     chan struct{}
	once     sync.Once
	log      *zap.Logger
}

func NewMemoryQueue(bufferSize int, log *zap.Logger) *MemoryQueue {
	if bufferSize <= 0 {
		bufferSize = 1024
	}
	if log == nil {
		log = zap.NewNop()
	}
	queue := &MemoryQueue{
		messages: make(chan TaskMessage, bufferSize),
		done:     make(chan struct{}),
		log:      log,
	}
	metrics.SetTaskQueueDepth("memory", "default", 0)
	return queue
}

func (q *MemoryQueue) PublishTask(ctx context.Context, msg TaskMessage) error {
	msg = msg.normalized().withTraceContext(ctx)
	if msg.TaskID == "" {
		return fmt.Errorf("task id cannot be empty")
	}
	if msg.TaskType == "" {
		return fmt.Errorf("task type cannot be empty")
	}
	select {
	case <-q.done:
		return ErrClosed
	default:
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-q.done:
		return ErrClosed
	case q.messages <- msg:
		metrics.SetTaskQueueDepth("memory", "default", len(q.messages))
		return nil
	}
}

func (q *MemoryQueue) Subscribe(ctx context.Context, opts SubscribeOptions) (<-chan Delivery, error) {
	out := make(chan Delivery)
	allowed := taskTypeSet(opts.TaskTypes)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case <-q.done:
				return
			case msg := <-q.messages:
				metrics.SetTaskQueueDepth("memory", "default", len(q.messages))
				if len(allowed) > 0 && !allowed[msg.TaskType] {
					q.log.Warn("task queue message skipped because task type is not subscribed",
						zap.String("task_id", msg.TaskID),
						zap.String("task_type", msg.TaskType),
					)
					continue
				}
				delivery := Delivery{
					Message: msg,
					ack: func(context.Context) error {
						return nil
					},
					nack: func(context.Context, error) error {
						return nil
					},
				}
				select {
				case <-ctx.Done():
					return
				case <-q.done:
					return
				case out <- delivery:
				}
			}
		}
	}()
	return out, nil
}

func (q *MemoryQueue) Close(ctx context.Context) error {
	q.once.Do(func() {
		close(q.done)
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func taskTypeSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out[part] = true
			}
		}
	}
	return out
}
