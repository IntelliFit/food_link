package taskqueue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

type KafkaConfig struct {
	Brokers       []string
	Topic         string
	ConsumerGroup string
}

type KafkaQueue struct {
	brokers       []string
	topic         string
	consumerGroup string
	writer        *kafka.Writer
	log           *zap.Logger

	mu      sync.Mutex
	readers map[*kafka.Reader]struct{}
	closed  bool
}

func NewKafkaQueue(cfg KafkaConfig, log *zap.Logger) (*KafkaQueue, error) {
	if log == nil {
		log = zap.NewNop()
	}
	brokers := normalizeStringSlice(cfg.Brokers)
	topic := strings.TrimSpace(cfg.Topic)
	group := strings.TrimSpace(cfg.ConsumerGroup)
	if len(brokers) == 0 {
		return nil, fmt.Errorf("task_queue.brokers must be set when task_queue.driver=kafka")
	}
	if topic == "" {
		return nil, fmt.Errorf("task_queue.topic must be set when task_queue.driver=kafka")
	}
	if group == "" {
		return nil, fmt.Errorf("task_queue.consumer_group must be set when task_queue.driver=kafka")
	}
	return &KafkaQueue{
		brokers:       brokers,
		topic:         topic,
		consumerGroup: group,
		writer: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        topic,
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireAll,
			Async:        false,
		},
		log:     log,
		readers: map[*kafka.Reader]struct{}{},
	}, nil
}

func (q *KafkaQueue) PublishTask(ctx context.Context, msg TaskMessage) error {
	msg = msg.normalized().withTraceContext(ctx)
	if msg.TaskID == "" {
		return fmt.Errorf("task id cannot be empty")
	}
	if msg.TaskType == "" {
		return fmt.Errorf("task type cannot be empty")
	}
	q.mu.Lock()
	closed := q.closed
	q.mu.Unlock()
	if closed {
		return ErrClosed
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal task queue message: %w", err)
	}
	return q.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(msg.TaskID),
		Value: payload,
		Time:  msg.CreatedAt,
	})
}

func (q *KafkaQueue) Subscribe(ctx context.Context, opts SubscribeOptions) (<-chan Delivery, error) {
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return nil, ErrClosed
	}
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        q.brokers,
		Topic:          q.topic,
		GroupID:        q.consumerGroup,
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: 0,
		StartOffset:    kafka.FirstOffset,
	})
	q.readers[reader] = struct{}{}
	q.mu.Unlock()

	out := make(chan Delivery)
	allowed := taskTypeSet(opts.TaskTypes)
	go func() {
		defer close(out)
		defer q.removeReader(reader)
		defer func() {
			if err := reader.Close(); err != nil {
				q.log.Warn("kafka task queue reader close failed", zap.Error(err))
			}
		}()
		for {
			kmsg, err := reader.FetchMessage(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				q.log.Error("kafka task queue fetch failed", zap.Error(err))
				time.Sleep(time.Second)
				continue
			}
			msg, err := decodeKafkaTaskMessage(kmsg.Value)
			if err != nil {
				q.log.Error("kafka task queue message decode failed",
					zap.String("topic", kmsg.Topic),
					zap.Int("partition", kmsg.Partition),
					zap.Int64("offset", kmsg.Offset),
					zap.Error(err),
				)
				if commitErr := reader.CommitMessages(ctx, kmsg); commitErr != nil {
					q.log.Error("kafka task queue poison message commit failed", zap.Error(commitErr))
					return
				}
				continue
			}
			if len(allowed) > 0 && !allowed[msg.TaskType] {
				q.log.Warn("kafka task queue message skipped because task type is not subscribed",
					zap.String("task_id", msg.TaskID),
					zap.String("task_type", msg.TaskType),
					zap.Int("partition", kmsg.Partition),
					zap.Int64("offset", kmsg.Offset),
				)
				if commitErr := reader.CommitMessages(ctx, kmsg); commitErr != nil {
					q.log.Error("kafka task queue skipped message commit failed", zap.Error(commitErr))
					return
				}
				continue
			}

			settled := make(chan bool, 1)
			var once sync.Once
			delivery := Delivery{
				Message: msg,
				ack: func(ackCtx context.Context) error {
					err := reader.CommitMessages(ackCtx, kmsg)
					once.Do(func() { settled <- err == nil })
					return err
				},
				nack: func(context.Context, error) error {
					once.Do(func() { settled <- false })
					return nil
				},
			}
			select {
			case <-ctx.Done():
				return
			case out <- delivery:
			}
			select {
			case <-ctx.Done():
				return
			case committed := <-settled:
				if !committed {
					q.log.Warn("kafka task queue delivery not committed; reader will stop for redelivery",
						zap.String("task_id", msg.TaskID),
						zap.String("task_type", msg.TaskType),
						zap.Int("partition", kmsg.Partition),
						zap.Int64("offset", kmsg.Offset),
					)
					return
				}
			}
		}
	}()
	return out, nil
}

func (q *KafkaQueue) Close(ctx context.Context) error {
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return nil
	}
	q.closed = true
	readers := make([]*kafka.Reader, 0, len(q.readers))
	for reader := range q.readers {
		readers = append(readers, reader)
	}
	q.mu.Unlock()

	for _, reader := range readers {
		if err := reader.Close(); err != nil {
			q.log.Warn("kafka task queue reader close failed", zap.Error(err))
		}
	}
	done := make(chan error, 1)
	go func() {
		done <- q.writer.Close()
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func (q *KafkaQueue) removeReader(reader *kafka.Reader) {
	q.mu.Lock()
	delete(q.readers, reader)
	q.mu.Unlock()
}

func decodeKafkaTaskMessage(payload []byte) (TaskMessage, error) {
	var msg TaskMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return TaskMessage{}, err
	}
	msg = msg.normalized()
	if msg.TaskID == "" {
		return TaskMessage{}, fmt.Errorf("task id cannot be empty")
	}
	if msg.TaskType == "" {
		return TaskMessage{}, fmt.Errorf("task type cannot be empty")
	}
	if len(msg.TraceContext) > 0 {
		msg.TraceContext = copyStringMap(msg.TraceContext)
	}
	return msg, nil
}

func normalizeStringSlice(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}
