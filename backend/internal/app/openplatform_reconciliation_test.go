package app

import (
	"context"
	"testing"
	"time"

	openplatformservice "food_link/backend/internal/openplatform/service"

	"github.com/stretchr/testify/require"
)

type recordingOpenPlatformReconciler struct {
	leadership chan struct{}
	runs       chan int
}

func (r *recordingOpenPlatformReconciler) ReconcileUsage(_ context.Context, limit int) (openplatformservice.ReconciliationSummary, error) {
	r.runs <- limit
	return openplatformservice.ReconciliationSummary{Scanned: 1, Refunded: 1}, nil
}

func (r *recordingOpenPlatformReconciler) TryReconciliationLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	r.leadership <- struct{}{}
	return true, fn(ctx)
}

func TestStartOpenPlatformReconciliationRunsImmediatelyAndStops(t *testing.T) {
	application := &App{}
	reconciler := &recordingOpenPlatformReconciler{leadership: make(chan struct{}, 1), runs: make(chan int, 1)}
	application.startOpenPlatformReconciliation(reconciler)
	t.Cleanup(func() {
		application.openPlatformCancel()
		select {
		case <-application.openPlatformDone:
		case <-time.After(time.Second):
			t.Fatal("开放平台对账器未及时停止")
		}
	})
	select {
	case <-reconciler.leadership:
	case <-time.After(time.Second):
		t.Fatal("开放平台对账器未尝试获取领导权")
	}
	select {
	case limit := <-reconciler.runs:
		require.Equal(t, 100, limit)
	case <-time.After(time.Second):
		t.Fatal("开放平台对账器未立即执行")
	}
}
