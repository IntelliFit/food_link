package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"food_link/backend/internal/taskqueue"
)

type fakeExpiryNotificationProcessor struct {
	mu sync.Mutex

	processCalls  int
	recoveryCalls int
	active        int
	maxActive     int
	staleAfter    []time.Duration

	process func(context.Context, int) (bool, error)
	recover func(context.Context, int, time.Duration) (int64, error)
}

func (f *fakeExpiryNotificationProcessor) ProcessNext(ctx context.Context) (bool, error) {
	f.mu.Lock()
	call := f.processCalls
	f.processCalls++
	f.active++
	if f.active > f.maxActive {
		f.maxActive = f.active
	}
	process := f.process
	f.mu.Unlock()

	defer func() {
		f.mu.Lock()
		f.active--
		f.mu.Unlock()
	}()
	if process == nil {
		return false, nil
	}
	return process(ctx, call)
}

func (f *fakeExpiryNotificationProcessor) RecoverStaleProcessingJobs(ctx context.Context, staleAfter time.Duration) (int64, error) {
	f.mu.Lock()
	call := f.recoveryCalls
	f.recoveryCalls++
	f.staleAfter = append(f.staleAfter, staleAfter)
	recoverFn := f.recover
	f.mu.Unlock()
	if recoverFn == nil {
		return 0, nil
	}
	return recoverFn(ctx, call, staleAfter)
}

func (f *fakeExpiryNotificationProcessor) snapshot() (processCalls, recoveryCalls, maxActive int, staleAfter []time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.processCalls, f.recoveryCalls, f.maxActive, append([]time.Duration(nil), f.staleAfter...)
}

type blockingWorkerQueue struct {
	subscribeCalls atomic.Int32
}

func (q *blockingWorkerQueue) PublishTask(context.Context, taskqueue.TaskMessage) error {
	return nil
}

func (q *blockingWorkerQueue) Subscribe(context.Context, taskqueue.SubscribeOptions) (<-chan taskqueue.Delivery, error) {
	q.subscribeCalls.Add(1)
	return make(chan taskqueue.Delivery), nil
}

func (q *blockingWorkerQueue) Close(context.Context) error {
	return nil
}

func TestExpiryNotificationPollerWorkerCountStartsOnlyOnePoller(t *testing.T) {
	started := make(chan struct{})
	var startedOnce sync.Once
	notifier := &fakeExpiryNotificationProcessor{
		process: func(ctx context.Context, _ int) (bool, error) {
			startedOnce.Do(func() { close(started) })
			<-ctx.Done()
			return false, ctx.Err()
		},
	}
	queue := &blockingWorkerQueue{}
	runner := &Runner{
		notifier: notifier,
		queue:    queue,
		expiryPoll: expiryNotificationPollOptions{
			operationTimeout: time.Hour,
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- runner.Run(ctx, Options{
			WorkerID:         "test-worker",
			TaskTypes:        []string{"food", "expiry_notification"},
			WorkerCount:      12,
			RecoveryInterval: time.Hour,
		})
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("expiry notification poller did not start")
	}

	deadline := time.Now().Add(time.Second)
	for queue.subscribeCalls.Load() < 12 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := queue.subscribeCalls.Load(); got != 12 {
		t.Fatalf("queue worker subscriptions = %d, want 12", got)
	}
	processCalls, _, maxActive, _ := notifier.snapshot()
	if processCalls != 1 {
		t.Fatalf("ProcessNext calls = %d, want 1 regardless of WorkerCount", processCalls)
	}
	if maxActive != 1 {
		t.Fatalf("max concurrent ProcessNext calls = %d, want 1", maxActive)
	}

	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Run error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not wait for and stop all poller/worker goroutines")
	}
}

func TestExpiryNotificationPollerNoTaskUsesExponentialBackoff(t *testing.T) {
	notifier := &fakeExpiryNotificationProcessor{}
	current := time.Unix(0, 0)
	delays := make([]time.Duration, 0, 6)
	runner := &Runner{notifier: notifier}
	runner.runExpiryNotificationPoller(context.Background(), "expiry-test", expiryNotificationPollOptions{
		initialBackoff: 2 * time.Second,
		maxBackoff:     30 * time.Second,
		recoveryEvery:  time.Hour,
		now:            func() time.Time { return current },
		jitter:         func(delay time.Duration) time.Duration { return delay },
		wait: func(_ context.Context, delay time.Duration) bool {
			delays = append(delays, delay)
			current = current.Add(delay)
			return len(delays) < 6
		},
	})

	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	if len(delays) != len(want) {
		t.Fatalf("backoff count = %d, want %d: %v", len(delays), len(want), delays)
	}
	for i := range want {
		if delays[i] != want[i] {
			t.Fatalf("backoff[%d] = %s, want %s", i, delays[i], want[i])
		}
	}
}

func TestExpiryNotificationPollerHandledTaskResetsBackoff(t *testing.T) {
	notifier := &fakeExpiryNotificationProcessor{
		process: func(_ context.Context, call int) (bool, error) {
			return call == 2, nil
		},
	}
	delays := make([]time.Duration, 0, 3)
	runner := &Runner{notifier: notifier}
	runner.runExpiryNotificationPoller(context.Background(), "expiry-test", expiryNotificationPollOptions{
		initialBackoff: 2 * time.Second,
		maxBackoff:     30 * time.Second,
		recoveryEvery:  time.Hour,
		jitter:         func(delay time.Duration) time.Duration { return delay },
		wait: func(_ context.Context, delay time.Duration) bool {
			delays = append(delays, delay)
			return len(delays) < 3
		},
	})

	want := []time.Duration{2 * time.Second, 4 * time.Second, 2 * time.Second}
	if len(delays) != len(want) {
		t.Fatalf("backoff count = %d, want %d: %v", len(delays), len(want), delays)
	}
	for i := range want {
		if delays[i] != want[i] {
			t.Fatalf("backoff[%d] = %s, want %s", i, delays[i], want[i])
		}
	}
}

func TestExpiryNotificationPollerRecoversStaleJobsOnlyOncePerInterval(t *testing.T) {
	notifier := &fakeExpiryNotificationProcessor{}
	current := time.Unix(0, 0)
	waits := 0
	runner := &Runner{notifier: notifier}
	runner.runExpiryNotificationPoller(context.Background(), "expiry-test", expiryNotificationPollOptions{
		initialBackoff: time.Second,
		maxBackoff:     time.Second,
		recoveryEvery:  5 * time.Second,
		staleAfter:     7 * time.Minute,
		now:            func() time.Time { return current },
		jitter:         func(delay time.Duration) time.Duration { return delay },
		wait: func(_ context.Context, delay time.Duration) bool {
			waits++
			current = current.Add(delay)
			return waits < 7
		},
	})

	processCalls, recoveryCalls, _, staleAfter := notifier.snapshot()
	if processCalls != 7 {
		t.Fatalf("ProcessNext calls = %d, want 7", processCalls)
	}
	if recoveryCalls != 2 {
		t.Fatalf("recovery calls = %d, want 2 (startup and after interval)", recoveryCalls)
	}
	for i, got := range staleAfter {
		if got != 7*time.Minute {
			t.Fatalf("staleAfter[%d] = %s, want 7m", i, got)
		}
	}
}

func TestExpiryNotificationPollerCancellationStopsInFlightOperation(t *testing.T) {
	started := make(chan struct{})
	notifier := &fakeExpiryNotificationProcessor{
		process: func(ctx context.Context, _ int) (bool, error) {
			close(started)
			<-ctx.Done()
			return false, ctx.Err()
		},
	}
	runner := &Runner{notifier: notifier}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runner.runExpiryNotificationPoller(ctx, "expiry-test", expiryNotificationPollOptions{operationTimeout: time.Hour})
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("ProcessNext did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("poller did not exit after context cancellation")
	}
}

func TestExpiryNotificationPollerContinuesAfterError(t *testing.T) {
	notifier := &fakeExpiryNotificationProcessor{
		process: func(_ context.Context, call int) (bool, error) {
			if call == 0 {
				return false, errors.New("temporary database error")
			}
			return false, nil
		},
	}
	waits := 0
	runner := &Runner{notifier: notifier}
	runner.runExpiryNotificationPoller(context.Background(), "expiry-test", expiryNotificationPollOptions{
		jitter: func(delay time.Duration) time.Duration { return delay },
		wait: func(context.Context, time.Duration) bool {
			waits++
			return waits < 2
		},
	})

	processCalls, _, _, _ := notifier.snapshot()
	if processCalls != 2 {
		t.Fatalf("ProcessNext calls = %d, want 2 after a temporary error", processCalls)
	}
}

func TestExpiryNotificationPollerRecoversFromPanic(t *testing.T) {
	notifier := &fakeExpiryNotificationProcessor{
		process: func(_ context.Context, call int) (bool, error) {
			if call == 0 {
				panic("temporary panic")
			}
			return false, nil
		},
	}
	waits := 0
	runner := &Runner{notifier: notifier}
	runner.runExpiryNotificationPoller(context.Background(), "expiry-test", expiryNotificationPollOptions{
		jitter: func(delay time.Duration) time.Duration { return delay },
		wait: func(context.Context, time.Duration) bool {
			waits++
			return waits < 2
		},
	})

	processCalls, _, maxActive, _ := notifier.snapshot()
	if processCalls != 2 {
		t.Fatalf("ProcessNext calls = %d, want 2 after panic recovery", processCalls)
	}
	if maxActive != 1 {
		t.Fatalf("max concurrent ProcessNext calls = %d, want 1", maxActive)
	}
}
