package handler

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestWriteSSEStreamSendsHeartbeatsWhileTheAnswerIsSlow(t *testing.T) {
	chunks := make(chan map[string]string)
	go func() {
		time.Sleep(40 * time.Millisecond)
		chunks <- map[string]string{"type": "done"}
		close(chunks)
	}()
	recorder := httptest.NewRecorder()

	writeSSEStream(context.Background(), recorder, recorder, chunks, "user-1", 10*time.Millisecond)

	body := recorder.Body.String()
	assert.Contains(t, body, ": ping\n\n")
	assert.Contains(t, body, "data: {\"type\":\"done\"}\n\n")
}

type brokenPipe struct{}

func (brokenPipe) Write([]byte) (int, error) { return 0, errors.New("write: broken pipe") }
func (brokenPipe) Flush()                    {}

func TestWriteSSEStreamLetsTheAnswerFinishAfterTheClientLeaves(t *testing.T) {
	chunks := make(chan int) // unbuffered: the producer blocks unless someone keeps reading
	finished := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			chunks <- i
		}
		close(chunks)
		close(finished)
	}()

	writeSSEStream(context.Background(), brokenPipe{}, brokenPipe{}, chunks, "user-1", time.Hour)

	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("the producer stayed blocked after the client left, so the answer would never be saved")
	}
}

func TestWriteSSEStreamDrainsWhenTheRequestIsCancelled(t *testing.T) {
	chunks := make(chan int)
	finished := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	go func() {
		for i := 0; i < 10; i++ {
			chunks <- i
		}
		close(chunks)
		close(finished)
	}()

	writeSSEStream(ctx, httptest.NewRecorder(), httptest.NewRecorder(), chunks, "user-1", time.Hour)

	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("the producer stayed blocked after the request was cancelled")
	}
}
