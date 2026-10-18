package taskqueue

import (
	"context"
	"errors"
	"testing"

	"github.com/segmentio/kafka-go"
)

type fakePartitionAdmin struct {
	partitions       int
	exists           bool
	metadataErr      error
	createTopics     []kafka.TopicConfig
	createPartitions []kafka.TopicPartitionsConfig
	changeErr        error
	// applyChange controls whether a create/expand request takes effect, so
	// tests can model another pod winning the race.
	applyChange bool
	raceWinner  int
}

func (f *fakePartitionAdmin) Metadata(_ context.Context, req *kafka.MetadataRequest) (*kafka.MetadataResponse, error) {
	if f.metadataErr != nil {
		return nil, f.metadataErr
	}
	topic := req.Topics[0]
	if !f.exists {
		return &kafka.MetadataResponse{Topics: []kafka.Topic{{Name: topic, Error: kafka.UnknownTopicOrPartition}}}, nil
	}
	return &kafka.MetadataResponse{Topics: []kafka.Topic{{Name: topic, Partitions: make([]kafka.Partition, f.partitions)}}}, nil
}

func (f *fakePartitionAdmin) CreateTopics(_ context.Context, req *kafka.CreateTopicsRequest) (*kafka.CreateTopicsResponse, error) {
	f.createTopics = append(f.createTopics, req.Topics...)
	if f.applyChange {
		f.exists, f.partitions = true, req.Topics[0].NumPartitions
	}
	return &kafka.CreateTopicsResponse{Errors: map[string]error{req.Topics[0].Topic: f.changeErr}}, nil
}

func (f *fakePartitionAdmin) CreatePartitions(_ context.Context, req *kafka.CreatePartitionsRequest) (*kafka.CreatePartitionsResponse, error) {
	f.createPartitions = append(f.createPartitions, req.Topics...)
	if f.applyChange {
		f.partitions = int(req.Topics[0].Count)
	}
	if f.raceWinner > 0 {
		f.partitions = f.raceWinner
	}
	return &kafka.CreatePartitionsResponse{Errors: map[string]error{req.Topics[0].Name: f.changeErr}}, nil
}

func TestEnsureTopicPartitionsLeavesWideTopicUntouched(t *testing.T) {
	admin := &fakePartitionAdmin{exists: true, partitions: 12}
	got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12)
	if err != nil || got != 12 {
		t.Fatalf("got %d, %v", got, err)
	}
	if len(admin.createPartitions) != 0 || len(admin.createTopics) != 0 {
		t.Fatalf("unexpected change requests: %+v %+v", admin.createPartitions, admin.createTopics)
	}
}

func TestEnsureTopicPartitionsExpandsSinglePartitionTopic(t *testing.T) {
	admin := &fakePartitionAdmin{exists: true, partitions: 1, applyChange: true}
	got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12)
	if err != nil || got != 12 {
		t.Fatalf("got %d, %v", got, err)
	}
	if len(admin.createPartitions) != 1 || admin.createPartitions[0].Count != 12 || admin.createPartitions[0].Name != "tasks" {
		t.Fatalf("expected one expansion to 12, got %+v", admin.createPartitions)
	}
}

func TestEnsureTopicPartitionsCreatesMissingTopic(t *testing.T) {
	admin := &fakePartitionAdmin{applyChange: true}
	got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12)
	if err != nil || got != 12 {
		t.Fatalf("got %d, %v", got, err)
	}
	if len(admin.createTopics) != 1 || admin.createTopics[0].NumPartitions != 12 {
		t.Fatalf("expected topic creation with 12 partitions, got %+v", admin.createTopics)
	}
}

func TestEnsureTopicPartitionsAcceptsConcurrentExpansionByAnotherPod(t *testing.T) {
	admin := &fakePartitionAdmin{exists: true, partitions: 1, raceWinner: 12, changeErr: kafka.InvalidPartitionNumber}
	got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12)
	if err != nil || got != 12 {
		t.Fatalf("a lost race must not fail when the topic reached the target: got %d, %v", got, err)
	}
}

func TestEnsureTopicPartitionsReportsFailedExpansion(t *testing.T) {
	admin := &fakePartitionAdmin{exists: true, partitions: 1, changeErr: kafka.PolicyViolation}
	got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12)
	if err == nil || !errors.Is(err, kafka.PolicyViolation) || got != 1 {
		t.Fatalf("expected policy error with 1 partition, got %d, %v", got, err)
	}
}

func TestEnsureTopicPartitionsReportsMetadataFailure(t *testing.T) {
	admin := &fakePartitionAdmin{metadataErr: errors.New("broker down")}
	if _, err := ensureTopicPartitions(context.Background(), admin, "tasks", 12); err == nil {
		t.Fatal("expected metadata error")
	}
	if len(admin.createPartitions) != 0 || len(admin.createTopics) != 0 {
		t.Fatal("must not try to change an unreadable topic")
	}
}

func TestEnsureTopicPartitionsDisabledWhenMinimumIsZero(t *testing.T) {
	admin := &fakePartitionAdmin{metadataErr: errors.New("must not be called")}
	if got, err := ensureTopicPartitions(context.Background(), admin, "tasks", 0); err != nil || got != 0 {
		t.Fatalf("got %d, %v", got, err)
	}
}
