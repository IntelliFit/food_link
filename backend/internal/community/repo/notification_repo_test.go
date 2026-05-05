package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/community/domain"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupNotificationTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&domain.FeedInteractionNotification{}, &domain.CommentTask{}))
	return db
}

func TestNotificationRepoCreateAndList(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	actorID := "u2"
	n := &domain.FeedInteractionNotification{
		RecipientUserID:  "u1",
		ActorUserID:      &actorID,
		NotificationType: "like_received",
		IsRead:           false,
	}
	assert.NoError(t, r.CreateNotification(ctx, n))
	assert.NotEmpty(t, n.ID)

	notifications, err := r.ListNotifications(ctx, "u1", 10)
	assert.NoError(t, err)
	assert.Len(t, notifications, 1)
	assert.Equal(t, "like_received", notifications[0].NotificationType)
}

func TestNotificationRepoCountUnread(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.CreateNotification(ctx, &domain.FeedInteractionNotification{
		RecipientUserID:  "u1",
		NotificationType: "like_received",
		IsRead:           false,
	}))
	assert.NoError(t, r.CreateNotification(ctx, &domain.FeedInteractionNotification{
		RecipientUserID:  "u1",
		NotificationType: "comment_received",
		IsRead:           true,
	}))

	count, err := r.CountUnread(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(1), count)
}

func TestNotificationRepoMarkRead(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.CreateNotification(ctx, &domain.FeedInteractionNotification{
		RecipientUserID:  "u1",
		NotificationType: "like_received",
		IsRead:           false,
	}))

	updated, err := r.MarkRead(ctx, "u1", nil)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), updated)

	count, err := r.CountUnread(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestNotificationRepoMarkReadWithIDs(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	n1 := &domain.FeedInteractionNotification{RecipientUserID: "u1", NotificationType: "like_received", IsRead: false}
	n2 := &domain.FeedInteractionNotification{RecipientUserID: "u1", NotificationType: "comment_received", IsRead: false}
	assert.NoError(t, r.CreateNotification(ctx, n1))
	assert.NoError(t, r.CreateNotification(ctx, n2))

	updated, err := r.MarkRead(ctx, "u1", []string{n1.ID})
	assert.NoError(t, err)
	assert.Equal(t, int64(1), updated)

	count, err := r.CountUnread(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(1), count)
}

func TestNotificationRepoFindRecentDuplicate(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	actorID := "u2"
	recordID := "r1"
	preview := "test"
	assert.NoError(t, r.CreateNotification(ctx, &domain.FeedInteractionNotification{
		RecipientUserID:  "u1",
		ActorUserID:      &actorID,
		RecordID:         &recordID,
		NotificationType: "like_received",
		ContentPreview:   &preview,
		IsRead:           false,
	}))

	dup, err := r.FindRecentDuplicate(ctx, "u1", "like_received", &actorID, &recordID, nil, nil, &preview)
	assert.NoError(t, err)
	assert.NotNil(t, dup)

	noDup, err := r.FindRecentDuplicate(ctx, "u1", "comment_received", &actorID, &recordID, nil, nil, &preview)
	assert.NoError(t, err)
	assert.Nil(t, noDup)
}

func TestNotificationRepoListCommentTasksByUser(t *testing.T) {
	db := setupNotificationTestDB(t)
	r := NewNotificationRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&domain.CommentTask{ID: "t1", UserID: "u1", Status: "pending", CommentType: "feed"}).Error)
	assert.NoError(t, db.Create(&domain.CommentTask{ID: "t2", UserID: "u1", Status: "completed", CommentType: "feed"}).Error)

	tasks, err := r.ListCommentTasksByUser(ctx, "u1", "feed", 10)
	assert.NoError(t, err)
	assert.Len(t, tasks, 2)
}
