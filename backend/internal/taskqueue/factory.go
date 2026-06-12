package taskqueue

import (
	"fmt"
	"strings"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/metrics"
)

func New(cfg config.TaskQueueConfig) (Queue, error) {
	driver := strings.ToLower(strings.TrimSpace(cfg.Driver))
	if driver == "" {
		driver = "memory"
	}
	switch driver {
	case "memory", "local", "in_memory", "in-memory":
		metrics.SetTaskQueueInfo("memory", "memory", "memory")
		metrics.SetTaskQueueComponentUp("memory", "publisher", true)
		metrics.SetTaskQueueComponentUp("memory", "consumer", true)
		return instrumentQueue("memory", NewMemoryQueue(cfg.BufferSize)), nil
	case "kafka":
		queue, err := NewKafkaQueue(KafkaConfig{
			Brokers:       cfg.Brokers,
			Topic:         cfg.Topic,
			ConsumerGroup: cfg.ConsumerGroup,
		})
		if err != nil {
			metrics.SetTaskQueueComponentUp("kafka", "publisher", false)
			metrics.SetTaskQueueComponentUp("kafka", "consumer", false)
			return nil, err
		}
		metrics.SetTaskQueueInfo("kafka", cfg.Topic, cfg.ConsumerGroup)
		metrics.SetTaskQueueComponentUp("kafka", "publisher", true)
		metrics.SetTaskQueueComponentUp("kafka", "consumer", true)
		return instrumentQueue("kafka", queue), nil
	default:
		return nil, fmt.Errorf("unsupported task_queue.driver %q", cfg.Driver)
	}
}
