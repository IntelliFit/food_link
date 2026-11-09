package feedprivacy

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVisibleToFriends(t *testing.T) {
	on, off := true, false
	cases := []struct {
		name    string
		friends *bool
		public  *bool
		want    bool
	}{
		{"friends on", &on, &off, true},
		{"friends off", &off, &off, false},
		{"public implies friends", &off, &on, true},
		{"never set means on", nil, nil, true},
		{"never set public keeps friends off", &off, nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, VisibleToFriends(tc.friends, tc.public))
		})
	}
}

func TestResolveHidden(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id text PRIMARY KEY, public_records boolean, friends_can_view_records boolean)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records, friends_can_view_records) VALUES
		('public', TRUE, TRUE),
		('friends', FALSE, TRUE),
		('private', FALSE, FALSE),
		('unset', NULL, NULL)`).Error)
	share, keep := true, false

	cases := []struct {
		name   string
		userID string
		choice *bool
		want   bool
	}{
		{"explicit share overrides a private owner", "private", &share, false},
		{"explicit opt-out overrides a public owner", "public", &keep, true},
		{"no choice joins the feed for a public owner", "public", nil, false},
		{"no choice joins the feed for friends", "friends", nil, false},
		{"no choice stays hidden with both switches off", "private", nil, true},
		{"unset settings use the friends default", "unset", nil, false},
		{"unknown owner stays hidden", "missing", nil, true},
		{"blank owner stays hidden", " ", nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ResolveHidden(context.Background(), db, tc.userID, tc.choice))
		})
	}
}

func TestResolveHiddenFailsClosedOnLookupError(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`DROP TABLE IF EXISTS weapp_user`).Error)

	assert.True(t, ResolveHidden(context.Background(), db, "anyone", nil))
	assert.True(t, ResolveHidden(context.Background(), nil, "anyone", nil))
}
