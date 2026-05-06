package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestFeedLike_Struct(t *testing.T) {
	now := time.Now()
	like := FeedLike{
		ID:       "like-1",
		UserID:   "user-1",
		RecordID: "record-1",
		CreatedAt: &now,
	}
	assert.Equal(t, "like-1", like.ID)
	assert.Equal(t, "feed_likes", like.TableName())
}

func TestFeedComment_Struct(t *testing.T) {
	now := time.Now()
	comment := FeedComment{
		ID:       "comment-1",
		UserID:   "user-1",
		RecordID: "record-1",
		Content:  "test comment",
		CreatedAt: &now,
	}
	assert.Equal(t, "test comment", comment.Content)
	assert.Equal(t, "feed_comments", comment.TableName())
}

func TestFeedInteractionNotification_Struct(t *testing.T) {
	now := time.Now()
	notif := FeedInteractionNotification{
		ID:               "notif-1",
		RecipientUserID:  "user-1",
		NotificationType: "like",
		IsRead:           false,
		CreatedAt:        &now,
	}
	assert.Equal(t, "notif-1", notif.ID)
	assert.Equal(t, "feed_interaction_notifications", notif.TableName())
}

func TestCommentTask_Struct(t *testing.T) {
	now := time.Now()
	task := CommentTask{
		ID:          "task-1",
		UserID:      "user-1",
		TargetID:    "target-1",
		Content:     "test",
		Status:      "pending",
		CommentType: "review",
		CreatedAt:   &now,
		UpdatedAt:   &now,
	}
	assert.Equal(t, "task-1", task.ID)
	assert.Equal(t, "comment_tasks", task.TableName())
}
