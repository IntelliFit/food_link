package taskqueue

import (
	"context"
	"time"

	"food_link/backend/pkg/metrics"
)

type instrumentedQueue struct {
	driver string
	next   Queue
}

func instrumentQueue(driver string, next Queue) Queue {
	if next == nil {
		return nil
	}
	return &instrumentedQueue{driver: driver, next: next}
}

func (q *instrumentedQueue) PublishTask(ctx context.Context, msg TaskMessage) error {
	start := time.Now()
	err := q.next.PublishTask(ctx, msg)
	status := "success"
	if err != nil {
		status = "error"
		metrics.SetTaskQueueComponentUp(q.driver, "publisher", false)
	} else {
		metrics.SetTaskQueueComponentUp(q.driver, "publisher", true)
	}
	metrics.ObserveTaskQueuePublish(q.driver, msg.TaskType, status, time.Since(start))
	return err
}

func (q *instrumentedQueue) Subscribe(ctx context.Context, opts SubscribeOptions) (<-chan Delivery, error) {
	deliveries, err := q.next.Subscribe(ctx, opts)
	if err != nil {
		metrics.SetTaskQueueComponentUp(q.driver, "consumer", false)
		return nil, err
	}
	metrics.SetTaskQueueComponentUp(q.driver, "consumer", true)
	out := make(chan Delivery)
	go func() {
		defer close(out)
		for delivery := range deliveries {
			msg := delivery.Message
			age := time.Duration(-1)
			if !msg.CreatedAt.IsZero() {
				age = time.Since(msg.CreatedAt)
				if age < 0 {
					age = 0
				}
			}
			metrics.ObserveTaskQueueDelivery(q.driver, msg.TaskType, age)
			select {
			case <-ctx.Done():
				return
			case out <- q.wrapDelivery(delivery):
			}
		}
	}()
	return out, nil
}

func (q *instrumentedQueue) Close(ctx context.Context) error {
	return q.next.Close(ctx)
}

func (q *instrumentedQueue) wrapDelivery(delivery Delivery) Delivery {
	msg := delivery.Message
	ack := delivery.ack
	nack := delivery.nack
	delivery.ack = func(ctx context.Context) error {
		var err error
		if ack != nil {
			err = ack(ctx)
		}
		outcome := "acked"
		if err != nil {
			outcome = "ack_error"
			metrics.SetTaskQueueComponentUp(q.driver, "consumer", false)
		} else {
			metrics.SetTaskQueueComponentUp(q.driver, "consumer", true)
		}
		metrics.ObserveTaskQueueSettlement(q.driver, msg.TaskType, outcome)
		return err
	}
	delivery.nack = func(ctx context.Context, cause error) error {
		var err error
		if nack != nil {
			err = nack(ctx, cause)
		}
		outcome := "nacked"
		if err != nil {
			outcome = "nack_error"
			metrics.SetTaskQueueComponentUp(q.driver, "consumer", false)
		}
		metrics.ObserveTaskQueueSettlement(q.driver, msg.TaskType, outcome)
		return err
	}
	return delivery
}
