package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/feedback/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

type fakeSubmitFeedbackRepo struct {
	created *domain.UserFeedback
}

func (r *fakeSubmitFeedbackRepo) Create(ctx context.Context, feedback *domain.UserFeedback) error {
	feedback.ID = "feedback-1"
	r.created = feedback
	return nil
}

type submitMessageSender struct {
	messages chan submitMessage
}

type submitMessage struct {
	receiverID string
	content    string
}

func (s *submitMessageSender) SendSystemMessage(ctx context.Context, receiverID, content string) error {
	s.messages <- submitMessage{receiverID: receiverID, content: content}
	return nil
}

func TestFeedbackServiceSubmitSendsSystemMessage(t *testing.T) {
	repo := &fakeSubmitFeedbackRepo{}
	sender := &submitMessageSender{messages: make(chan submitMessage, 1)}
	svc := NewFeedbackService(repo, nil, nil, sender)

	id, err := svc.Submit(context.Background(), "user-1", SubmitInput{
		Category: domain.CategorySuggestion,
		Content:  "这个建议希望被采纳",
	})

	require.NoError(t, err)
	assert.Equal(t, "feedback-1", id)
	require.NotNil(t, repo.created)
	select {
	case msg := <-sender.messages:
		assert.Equal(t, "user-1", msg.receiverID)
		assert.Contains(t, msg.content, "反馈编号：feedback-1")
		assert.Contains(t, msg.content, "感谢")
	case <-time.After(time.Second):
		t.Fatal("expected submit success system message")
	}
}

func TestFeedbackServiceSubmitAsyncTraceLinkedToRequest(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	repo := &fakeSubmitFeedbackRepo{}
	sender := &submitMessageSender{messages: make(chan submitMessage, 1)}
	svc := NewFeedbackService(repo, nil, nil, sender)

	ctx, parent := otel.Tracer("feedback-service-test").Start(context.Background(), "提交意见反馈请求")
	id, err := svc.Submit(ctx, "user-1", SubmitInput{
		Category: domain.CategorySuggestion,
		Content:  "这个建议希望被采纳",
	})
	require.NoError(t, err)
	assert.Equal(t, "feedback-1", id)

	select {
	case <-sender.messages:
	case <-time.After(time.Second):
		t.Fatal("expected submit success system message")
	}
	parent.End()

	require.Eventually(t, func() bool {
		return len(recorder.Ended()) >= 2
	}, time.Second, 10*time.Millisecond)

	var parentSpan, asyncSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "提交意见反馈请求":
			parentSpan = span
		case "意见反馈提交站内信发送":
			asyncSpan = span
		}
	}
	require.NotNil(t, parentSpan)
	require.NotNil(t, asyncSpan)
	assert.Equal(t, parentSpan.SpanContext().TraceID(), asyncSpan.SpanContext().TraceID())
	assert.Equal(t, parentSpan.SpanContext().SpanID(), asyncSpan.Parent().SpanID())
}
