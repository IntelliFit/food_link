package taskqueue

import (
	"fmt"
	"strings"

	"food_link/backend/pkg/config"

	"go.uber.org/zap"
)

func New(cfg config.TaskQueueConfig, log *zap.Logger) (Queue, error) {
	driver := strings.ToLower(strings.TrimSpace(cfg.Driver))
	if driver == "" {
		driver = "memory"
	}
	switch driver {
	case "memory", "local", "in_memory", "in-memory":
		return NewMemoryQueue(cfg.BufferSize, log), nil
	case "kafka":
		return nil, fmt.Errorf("task_queue.driver=kafka is reserved but not implemented yet")
	default:
		return nil, fmt.Errorf("unsupported task_queue.driver %q", cfg.Driver)
	}
}
