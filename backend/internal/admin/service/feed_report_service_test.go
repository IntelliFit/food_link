package service

import (
	"context"
	"testing"

	admindomain "food_link/backend/internal/admin/domain"
	adminrepo "food_link/backend/internal/admin/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeFeedReportRepo struct {
	item              *admindomain.FeedReportItem
	deletedTargetType string
	deletedTargetID   string
}

func (r *fakeFeedReportRepo) List(ctx context.Context, input adminrepo.ListFeedReportInput) (*adminrepo.ListFeedReportResult, error) {
	return &adminrepo.ListFeedReportResult{}, nil
}

func (r *fakeFeedReportRepo) GetByID(ctx context.Context, id string) (*admindomain.FeedReportItem, error) {
	return r.item, nil
}

func (r *fakeFeedReportRepo) UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string, rewardCredits *int, reporterUserID string) (*admindomain.FeedReportItem, error) {
	r.item.Status = status
	r.item.ResolutionNote = resolutionNote
	if rewardCredits != nil {
		r.item.RewardCredits = *rewardCredits
	}
	return r.item, nil
}

func (r *fakeFeedReportRepo) Delete(ctx context.Context, id string) error {
	return nil
}

func (r *fakeFeedReportRepo) GetTargetSnapshot(ctx context.Context, targetType, targetID string) (*admindomain.FeedReportTargetSnapshot, error) {
	return nil, nil
}

func (r *fakeFeedReportRepo) DeleteFeedTargetContent(ctx context.Context, targetType, targetID string) error {
	r.deletedTargetType = targetType
	r.deletedTargetID = targetID
	return nil
}

func (r *fakeFeedReportRepo) CountByStatus(ctx context.Context) (map[string]int64, error) {
	return map[string]int64{}, nil
}

type recordingSystemMessageSender struct {
	messages []recordedSystemMessage
}

type recordedSystemMessage struct {
	receiverID string
	content    string
}

func (s *recordingSystemMessageSender) SendSystemMessage(ctx context.Context, receiverID, content string) error {
	s.messages = append(s.messages, recordedSystemMessage{receiverID: receiverID, content: content})
	return nil
}

func TestFeedReportServiceUpdateStatusRejectedNotifiesReporterOnly(t *testing.T) {
	repo := &fakeFeedReportRepo{item: &admindomain.FeedReportItem{
		ID:             "report-1",
		ReporterUserID: "reporter-user",
		ReportedUserID: "reported-user",
		TargetType:     "circle_post",
		TargetID:       "post-1",
		Status:         "pending",
	}}
	sender := &recordingSystemMessageSender{}
	svc := NewFeedReportService(repo, sender)

	updated, err := svc.UpdateStatus(context.Background(), "report-1", "rejected", "未发现违规", "admin-user", nil)

	require.NoError(t, err)
	assert.Equal(t, "rejected", updated.Status)
	require.Len(t, sender.messages, 1)
	assert.Equal(t, "reporter-user", sender.messages[0].receiverID)
	assert.Contains(t, sender.messages[0].content, "未违规")
}

func TestFeedReportServiceDeleteTargetContentNotifiesBothSides(t *testing.T) {
	reward := 0
	repo := &fakeFeedReportRepo{item: &admindomain.FeedReportItem{
		ID:             "report-1",
		ReporterUserID: "reporter-user",
		ReportedUserID: "reported-user",
		TargetType:     "circle_post",
		TargetID:       "post-1",
		Status:         "pending",
	}}
	sender := &recordingSystemMessageSender{}
	svc := NewFeedReportService(repo, sender)

	updated, err := svc.DeleteTargetContent(context.Background(), "report-1", "违规内容已删除", "admin-user", &reward)

	require.NoError(t, err)
	assert.Equal(t, "resolved", updated.Status)
	assert.Equal(t, "circle_post", repo.deletedTargetType)
	assert.Equal(t, "post-1", repo.deletedTargetID)
	require.Len(t, sender.messages, 2)
	assert.Equal(t, "reporter-user", sender.messages[0].receiverID)
	assert.Equal(t, "reported-user", sender.messages[1].receiverID)
	assert.Contains(t, sender.messages[0].content, "已被核实")
	assert.Contains(t, sender.messages[1].content, "核实违规")
}

func TestFeedReportServiceDeleteFoodRecordTargetContentNotifiesBothSides(t *testing.T) {
	reward := 1
	repo := &fakeFeedReportRepo{item: &admindomain.FeedReportItem{
		ID:             "report-1",
		ReporterUserID: "reporter-user",
		ReportedUserID: "reported-user",
		TargetType:     "food_record",
		TargetID:       "record-1",
		Status:         "pending",
	}}
	sender := &recordingSystemMessageSender{}
	svc := NewFeedReportService(repo, sender)

	updated, err := svc.DeleteTargetContent(context.Background(), "report-1", "", "admin-user", &reward)

	require.NoError(t, err)
	assert.Equal(t, "resolved", updated.Status)
	assert.Equal(t, "food_record", repo.deletedTargetType)
	assert.Equal(t, "record-1", repo.deletedTargetID)
	assert.Equal(t, "已从圈子中移除被举报内容。", updated.ResolutionNote)
	require.Len(t, sender.messages, 2)
	assert.Equal(t, "reporter-user", sender.messages[0].receiverID)
	assert.Equal(t, "reported-user", sender.messages[1].receiverID)
}
