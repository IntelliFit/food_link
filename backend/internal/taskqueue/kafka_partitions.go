package taskqueue

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"food_link/backend/pkg/logger"

	"github.com/segmentio/kafka-go"
)

const (
	kafkaPartitionCheckInterval = 5 * time.Minute
	kafkaPartitionCheckTimeout  = 15 * time.Second
	// Readers notice partitions added at runtime and rebalance without a restart.
	kafkaPartitionWatchInterval = 30 * time.Second
)

// kafkaPartitionAdmin is the subset of *kafka.Client used to keep the task
// topic wide enough for every worker loop.
type kafkaPartitionAdmin interface {
	Metadata(context.Context, *kafka.MetadataRequest) (*kafka.MetadataResponse, error)
	CreateTopics(context.Context, *kafka.CreateTopicsRequest) (*kafka.CreateTopicsResponse, error)
	CreatePartitions(context.Context, *kafka.CreatePartitionsRequest) (*kafka.CreatePartitionsResponse, error)
}

// ensureTopicPartitions creates the topic or adds partitions until it has at
// least minPartitions. A broker that loses its data recreates topics with the
// default single partition, which serializes every analysis task; this check
// restores the width. Concurrent pods may race to expand the same topic, so a
// failed request counts as success when the topic already reached the target.
func ensureTopicPartitions(ctx context.Context, admin kafkaPartitionAdmin, topic string, minPartitions int) (int, error) {
	if minPartitions <= 0 {
		return 0, nil
	}
	current, exists, err := topicPartitionCount(ctx, admin, topic)
	if err != nil {
		return 0, err
	}
	if exists && current >= minPartitions {
		return current, nil
	}
	var changeErr error
	if !exists {
		res, err := admin.CreateTopics(ctx, &kafka.CreateTopicsRequest{Topics: []kafka.TopicConfig{{
			Topic: topic, NumPartitions: minPartitions, ReplicationFactor: -1,
		}}})
		changeErr = err
		if err == nil && res != nil {
			changeErr = res.Errors[topic]
		}
	} else {
		res, err := admin.CreatePartitions(ctx, &kafka.CreatePartitionsRequest{Topics: []kafka.TopicPartitionsConfig{{
			Name: topic, Count: int32(minPartitions),
		}}})
		changeErr = err
		if err == nil && res != nil {
			changeErr = res.Errors[topic]
		}
	}
	after, afterExists, err := topicPartitionCount(ctx, admin, topic)
	if err != nil {
		return current, errors.Join(changeErr, err)
	}
	if afterExists && after >= minPartitions {
		return after, nil
	}
	if changeErr == nil {
		changeErr = fmt.Errorf("topic %s still has %d partitions", topic, after)
	}
	return after, fmt.Errorf("expand kafka topic %s to %d partitions: %w", topic, minPartitions, changeErr)
}

func topicPartitionCount(ctx context.Context, admin kafkaPartitionAdmin, topic string) (int, bool, error) {
	md, err := admin.Metadata(ctx, &kafka.MetadataRequest{Topics: []string{topic}})
	if err != nil {
		return 0, false, fmt.Errorf("read kafka metadata for %s: %w", topic, err)
	}
	for _, t := range md.Topics {
		if t.Name != topic {
			continue
		}
		if errors.Is(t.Error, kafka.UnknownTopicOrPartition) {
			return 0, false, nil
		}
		if t.Error != nil {
			return 0, false, fmt.Errorf("read kafka metadata for %s: %w", topic, t.Error)
		}
		return len(t.Partitions), true, nil
	}
	return 0, false, nil
}

// guardTopicPartitions checks the topic on startup and then periodically until
// ctx is cancelled. Failures are logged and retried; they never stop the queue.
func guardTopicPartitions(ctx context.Context, admin kafkaPartitionAdmin, topic string, minPartitions int, interval time.Duration) {
	check := func() {
		checkCtx, cancel := context.WithTimeout(ctx, kafkaPartitionCheckTimeout)
		defer cancel()
		before, _, _ := topicPartitionCount(checkCtx, admin, topic)
		after, err := ensureTopicPartitions(checkCtx, admin, topic, minPartitions)
		if err != nil {
			if ctx.Err() == nil {
				logger.Warn(ctx, "Kafka 任务队列分区检查失败", logger.Err(err),
					slog.String("topic", topic), slog.Int("min_partitions", minPartitions))
			}
			return
		}
		if after != before {
			logger.Info(ctx, "Kafka 任务队列分区已补齐",
				slog.String("topic", topic), slog.Int("before", before), slog.Int("after", after))
		}
	}
	check()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}
