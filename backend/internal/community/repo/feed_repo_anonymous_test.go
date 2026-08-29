package repo

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFeedRepoGetLikesForTargetsSupportsAnonymousViewerWithUUIDColumns(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE feed_likes (
			id uuid PRIMARY KEY,
			user_id uuid NOT NULL,
			record_id uuid,
			target_type text,
			target_id uuid,
			created_at timestamptz
		)
	`).Error)

	recordID := uuid.NewString()
	likerID := uuid.NewString()
	require.NoError(t, db.Exec(`
		INSERT INTO feed_likes (id, user_id, record_id, target_type, target_id)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.NewString(), likerID, recordID, FeedTargetFoodRecord, recordID).Error)

	repo := NewFeedRepo(db)
	targets := []FeedTarget{{TargetType: FeedTargetFoodRecord, TargetID: recordID}}

	anonymous, err := repo.GetLikesForTargets(context.Background(), targets, "")
	require.NoError(t, err)
	require.NotNil(t, anonymous[FeedTargetKey(FeedTargetFoodRecord, recordID)])
	assert.Equal(t, 1, anonymous[FeedTargetKey(FeedTargetFoodRecord, recordID)].Count)
	assert.False(t, anonymous[FeedTargetKey(FeedTargetFoodRecord, recordID)].Liked)

	authenticated, err := repo.GetLikesForTargets(context.Background(), targets, likerID)
	require.NoError(t, err)
	require.NotNil(t, authenticated[FeedTargetKey(FeedTargetFoodRecord, recordID)])
	assert.Equal(t, 1, authenticated[FeedTargetKey(FeedTargetFoodRecord, recordID)].Count)
	assert.True(t, authenticated[FeedTargetKey(FeedTargetFoodRecord, recordID)].Liked)
}
