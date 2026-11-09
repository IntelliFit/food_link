package repo

import (
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVisibleUsersCTEFollowsRecordSwitches(t *testing.T) {
	db := testdb.New(t)
	const (
		viewer        = "00000000-0000-4000-8000-000000000001"
		sharingFriend = "00000000-0000-4000-8000-000000000002"
		closedFriend  = "00000000-0000-4000-8000-000000000003"
		publicUser    = "00000000-0000-4000-8000-000000000004"
		stranger      = "00000000-0000-4000-8000-000000000005"
	)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id uuid PRIMARY KEY, public_records boolean, friends_can_view_records boolean NOT NULL DEFAULT true)`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE user_friends (user_id uuid NOT NULL, friend_id uuid NOT NULL)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records, friends_can_view_records) VALUES
		(?, FALSE, FALSE), (?, FALSE, TRUE), (?, FALSE, FALSE), (?, TRUE, TRUE), (?, FALSE, TRUE)`,
		viewer, sharingFriend, closedFriend, publicUser, stranger).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_friends (user_id, friend_id) VALUES (?, ?), (?, ?)`,
		viewer, sharingFriend, closedFriend, viewer).Error)

	var visible []string
	err := db.Raw(`WITH `+visibleUsersCTE+` SELECT user_id::text FROM _search_visible_users`, viewer, viewer, viewer, viewer).Scan(&visible).Error

	require.NoError(t, err)
	assert.ElementsMatch(t, []string{viewer, sharingFriend, publicUser}, visible)
}
