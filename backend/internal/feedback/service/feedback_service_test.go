package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/feedback/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
