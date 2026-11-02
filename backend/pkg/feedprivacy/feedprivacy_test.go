package feedprivacy

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveHidden(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id text PRIMARY KEY, public_records boolean)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records) VALUES ('public', TRUE), ('private', FALSE), ('unset', NULL)`).Error)
	share, keep := true, false

	cases := []struct {
		name   string
		userID string
		choice *bool
		want   bool
	}{
		{"explicit share overrides a private owner", "private", &share, false},
		{"explicit opt-out overrides a public owner", "public", &keep, true},
		{"no choice follows a public owner", "public", nil, false},
		{"no choice follows a private owner", "private", nil, true},
		{"unset setting counts as private", "unset", nil, true},
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
