package service

import (
	"context"
	"testing"

	adminrepo "food_link/backend/internal/admin/repo"
	feedbackdomain "food_link/backend/internal/feedback/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeFeedbackRepo struct {
	item         *adminrepo.FeedbackItem
	rewardValue  *int
	handledBy    string
	updateStatus string
}

func (r *fakeFeedbackRepo) List(ctx context.Context, input adminrepo.ListFeedbackInput) (*adminrepo.ListFeedbackResult, error) {
	return &adminrepo.ListFeedbackResult{}, nil
}

func (r *fakeFeedbackRepo) UpdateStatus(ctx context.Context, id, status, resolutionMessage string, rewardCredits *int, handledBy string) (*adminrepo.FeedbackItem, error) {
	r.updateStatus = status
	r.rewardValue = rewardCredits
	r.handledBy = handledBy
	r.item.Status = status
	r.item.ResolutionMessage = resolutionMessage
	if rewardCredits != nil {
		r.item.RewardCredits = *rewardCredits
	}
	return r.item, nil
}

func (r *fakeFeedbackRepo) CountByStatus(ctx context.Context) (map[string]int64, error) {
	return map[string]int64{}, nil
}

func TestFeedbackServiceUpdateStatusResolvedRequiresRewardCredits(t *testing.T) {
	repo := &fakeFeedbackRepo{item: &adminrepo.FeedbackItem{UserFeedback: feedbackdomain.UserFeedback{
		ID:     "feedback-1",
		UserID: "user-1",
		Status: "open",
	}}}
	svc := NewFeedbackService(repo)

	updated, err := svc.UpdateStatus(context.Background(), "feedback-1", "resolved", "感谢反馈", nil, "admin-user")

	require.Error(t, err)
	assert.Nil(t, updated)
	assert.Empty(t, repo.updateStatus)
	assert.Contains(t, err.Error(), "奖励积分")
}

func TestFeedbackServiceUpdateStatusResolvedAllowsZeroReward(t *testing.T) {
	repo := &fakeFeedbackRepo{item: &adminrepo.FeedbackItem{UserFeedback: feedbackdomain.UserFeedback{
		ID:     "feedback-1",
		UserID: "user-1",
		Status: "open",
	}}}
	svc := NewFeedbackService(repo)
	reward := 0

	updated, err := svc.UpdateStatus(context.Background(), "feedback-1", "resolved", "已采纳", &reward, "admin-user")

	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "resolved", updated.Status)
	assert.Equal(t, "已采纳", updated.ResolutionMessage)
	require.NotNil(t, repo.rewardValue)
	assert.Equal(t, 0, *repo.rewardValue)
	assert.Equal(t, "admin-user", repo.handledBy)
}

func TestFeedbackServiceUpdateStatusRejectsProcessing(t *testing.T) {
	repo := &fakeFeedbackRepo{item: &adminrepo.FeedbackItem{UserFeedback: feedbackdomain.UserFeedback{
		ID:     "feedback-1",
		UserID: "user-1",
		Status: "open",
	}}}
	svc := NewFeedbackService(repo)

	updated, err := svc.UpdateStatus(context.Background(), "feedback-1", "processing", "", nil, "admin-user")

	require.Error(t, err)
	assert.Nil(t, updated)
	assert.Empty(t, repo.updateStatus)
	assert.Contains(t, err.Error(), "反馈状态无效")
}

func TestFeedbackServiceUpdateStatusResolvedSendsResultMessage(t *testing.T) {
	repo := &fakeFeedbackRepo{item: &adminrepo.FeedbackItem{UserFeedback: feedbackdomain.UserFeedback{
		ID:     "feedback-1",
		UserID: "user-1",
		Status: "open",
	}}}
	sender := &feedbackRecordingSender{}
	svc := NewFeedbackService(repo, sender)
	reward := 3

	updated, err := svc.UpdateStatus(context.Background(), "feedback-1", "resolved", "这个建议已采纳", &reward, "admin-user")

	require.NoError(t, err)
	require.NotNil(t, updated)
	require.Len(t, sender.messages, 1)
	assert.Equal(t, "user-1", sender.messages[0].receiverID)
	assert.Contains(t, sender.messages[0].content, "这个建议已采纳")
	assert.Contains(t, sender.messages[0].content, "+3")
}

type feedbackRecordingSender struct {
	messages []feedbackRecordedSystemMessage
}

type feedbackRecordedSystemMessage struct {
	receiverID string
	content    string
}

func (s *feedbackRecordingSender) SendSystemMessage(ctx context.Context, receiverID, content string) error {
	s.messages = append(s.messages, feedbackRecordedSystemMessage{receiverID: receiverID, content: content})
	return nil
}
