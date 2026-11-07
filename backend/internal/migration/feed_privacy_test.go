package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupFeedPrivacyUsers(t *testing.T) *gorm.DB {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id text PRIMARY KEY, public_records boolean DEFAULT true)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records) VALUES ('defaulted', TRUE), ('already_private', FALSE), ('unset', NULL)`).Error)
	require.NoError(t, MigrateFeedPrivacySchema(context.Background(), db, "public"))
	return db
}

type feedPrivacyRow struct {
	PublicRecords  *bool
	Pending        bool
	HasConsentTime bool
}

func readFeedPrivacyRow(t *testing.T, db *gorm.DB, id string) feedPrivacyRow {
	t.Helper()
	var row feedPrivacyRow
	require.NoError(t, db.Raw(`SELECT public_records, public_records_reconfirm_pending AS pending, public_records_consented_at IS NOT NULL AS has_consent_time FROM weapp_user WHERE id = ?`, id).Scan(&row).Error)
	return row
}

func TestMigrateFeedPrivacySchemaIsIdempotentAndDefaultsPublic(t *testing.T) {
	db := setupFeedPrivacyUsers(t)
	require.NoError(t, MigrateFeedPrivacySchema(context.Background(), db, "public"))

	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id) VALUES ('new_user')`).Error)
	newUser := readFeedPrivacyRow(t, db, "new_user")
	require.NotNil(t, newUser.PublicRecords)
	assert.True(t, *newUser.PublicRecords, "new accounts are public by default and told on their first record")
	assert.False(t, newUser.Pending)

	unset := readFeedPrivacyRow(t, db, "unset")
	assert.Nil(t, unset.PublicRecords, "the schema step leaves rows to the flip")

	defaulted := readFeedPrivacyRow(t, db, "defaulted")
	require.NotNil(t, defaulted.PublicRecords)
	assert.True(t, *defaulted.PublicRecords, "the schema step must not flip existing choices")
}

func TestFlipUnconsentedRecordsDryRunChangesNothing(t *testing.T) {
	db := setupFeedPrivacyUsers(t)

	result, err := FlipUnconsentedRecordsToPrivate(context.Background(), db, "public", false)

	require.NoError(t, err)
	assert.Equal(t, int64(2), result.Candidates)
	assert.Zero(t, result.Flipped)
	assert.False(t, result.Applied)
	row := readFeedPrivacyRow(t, db, "defaulted")
	assert.True(t, *row.PublicRecords)
	assert.False(t, row.Pending)
}

func TestMigrateFeedFriendsSchemaDefaultsExistingAccountsToOn(t *testing.T) {
	db := setupFeedPrivacyUsers(t)
	ctx := context.Background()

	require.NoError(t, MigrateFeedFriendsSchema(ctx, db, "public"))
	require.NoError(t, MigrateFeedFriendsSchema(ctx, db, "public"), "safe to run twice")

	var off, total int64
	require.NoError(t, db.Table("weapp_user").Count(&total).Error)
	require.NoError(t, db.Table("weapp_user").Where("friends_can_view_records = FALSE").Count(&off).Error)
	assert.Positive(t, total)
	assert.Zero(t, off)
	row := readFeedPrivacyRow(t, db, "defaulted")
	assert.True(t, *row.PublicRecords, "other settings are untouched")
	already := readFeedPrivacyRow(t, db, "already_private")
	assert.False(t, *already.PublicRecords, "existing private choices are untouched")
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id) VALUES ('after_friends')`).Error)
	assert.True(t, *readFeedPrivacyRow(t, db, "after_friends").PublicRecords, "new accounts default to public")
}

func TestFlipUnconsentedRecordsKeepsExplicitChoices(t *testing.T) {
	db := setupFeedPrivacyUsers(t)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records, public_records_consented_at) VALUES ('consented', TRUE, now())`).Error)
	ctx := context.Background()

	result, err := FlipUnconsentedRecordsToPrivate(ctx, db, "public", true)
	require.NoError(t, err)
	assert.Equal(t, int64(2), result.Flipped)

	defaulted := readFeedPrivacyRow(t, db, "defaulted")
	assert.False(t, *defaulted.PublicRecords)
	assert.True(t, defaulted.Pending)

	unset := readFeedPrivacyRow(t, db, "unset")
	assert.False(t, *unset.PublicRecords)
	assert.True(t, unset.Pending)

	consented := readFeedPrivacyRow(t, db, "consented")
	assert.True(t, *consented.PublicRecords)
	assert.False(t, consented.Pending)

	alreadyPrivate := readFeedPrivacyRow(t, db, "already_private")
	assert.False(t, *alreadyPrivate.PublicRecords)
	assert.False(t, alreadyPrivate.Pending, "accounts that already chose private are not asked again")

	again, err := FlipUnconsentedRecordsToPrivate(ctx, db, "public", true)
	require.NoError(t, err)
	assert.Zero(t, again.Flipped)
}
