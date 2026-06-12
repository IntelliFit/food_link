package taskqueue

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"food_link/backend/pkg/config"
)

func TestDecodeKafkaTaskMessage(t *testing.T) {
	payload, err := json.Marshal(TaskMessage{
		TaskID:       "task-1",
		TaskType:     "food",
		TraceContext: map[string]string{"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	msg, err := decodeKafkaTaskMessage(payload)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if msg.TaskID != "task-1" || msg.TaskType != "food" {
		t.Fatalf("unexpected message: %+v", msg)
	}
	if msg.TraceContext["traceparent"] == "" {
		t.Fatalf("expected trace context: %+v", msg.TraceContext)
	}
	if msg.CreatedAt.IsZero() {
		t.Fatal("expected normalized created_at")
	}
}

func TestKafkaQueueRequiresBrokerConfig(t *testing.T) {
	_, err := New(config.TaskQueueConfig{
		Driver:        "kafka",
		Topic:         "food-link-analysis-tasks",
		ConsumerGroup: "food-link-workers",
	})
	if err == nil {
		t.Fatal("expected missing broker error")
	}
	if !strings.Contains(err.Error(), "task_queue.brokers") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestKafkaQueueRejectsPublishAfterClose(t *testing.T) {
	q := &KafkaQueue{closed: true}
	err := q.PublishTask(context.Background(), TaskMessage{TaskID: "task-1", TaskType: "food"})
	if err != ErrClosed {
		t.Fatalf("expected ErrClosed, got %v", err)
	}
}
