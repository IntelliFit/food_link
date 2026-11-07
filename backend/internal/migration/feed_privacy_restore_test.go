package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const (
	restoreFlippedID  = "11111111-1111-4111-8111-111111111111"
	restoreExcludedID = "22222222-2222-4222-8222-222222222222"
	restoreChoseID    = "33333333-3333-4333-8333-333333333333"
)

func setupRestoreUsers(t *testing.T) *gorm.DB {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id uuid PRIMARY KEY, public_records boolean, public_records_consented_at timestamptz, public_records_reconfirm_pending boolean NOT NULL DEFAULT false)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, public_records, public_records_reconfirm_pending) VALUES
		(?, FALSE, TRUE), (?, FALSE, TRUE), (?, FALSE, FALSE)`, restoreFlippedID, restoreExcludedID, restoreChoseID).Error)
	return db
}

type restoreRow struct {
	PublicRecords bool
	Pending       bool
	Consented     bool
}

func readRestoreRow(t *testing.T, db *gorm.DB, id string) restoreRow {
	t.Helper()
	var row restoreRow
	require.NoError(t, db.Raw(`SELECT public_records, public_records_reconfirm_pending AS pending, public_records_consented_at IS NOT NULL AS consented FROM weapp_user WHERE id = ?`, id).Scan(&row).Error)
	return row
}

func TestRestoreFlippedRecordsPreviewChangesNothing(t *testing.T) {
	db := setupRestoreUsers(t)

	result, err := RestoreFlippedRecordsToPublic(context.Background(), db, "public", []string{restoreExcludedID}, false)

	require.NoError(t, err)
	assert.Equal(t, int64(2), result.Candidates)
	assert.Equal(t, int64(1), result.Excluded)
	assert.False(t, result.Applied)
	assert.False(t, readRestoreRow(t, db, restoreFlippedID).PublicRecords)
}

func TestRestoreFlippedRecordsKeepsChoicesAndExclusions(t *testing.T) {
	db := setupRestoreUsers(t)
	ctx := context.Background()

	result, err := RestoreFlippedRecordsToPublic(ctx, db, "public", []string{restoreExcludedID}, true)
	require.NoError(t, err)
	assert.Equal(t, int64(1), result.Restored)

	restored := readRestoreRow(t, db, restoreFlippedID)
	assert.True(t, restored.PublicRecords)
	assert.False(t, restored.Pending)
	assert.False(t, restored.Consented, "restoring is not consent")
	excluded := readRestoreRow(t, db, restoreExcludedID)
	assert.False(t, excluded.PublicRecords)
	assert.True(t, excluded.Pending, "excluded accounts are still asked")
	assert.False(t, readRestoreRow(t, db, restoreChoseID).PublicRecords, "accounts that already chose are untouched")

	again, err := RestoreFlippedRecordsToPublic(ctx, db, "public", []string{restoreExcludedID}, true)
	require.NoError(t, err)
	assert.Zero(t, again.Restored)
}

func TestRestoreFlippedRecordsRejectsBadExcludeIDs(t *testing.T) {
	db := setupRestoreUsers(t)

	_, err := RestoreFlippedRecordsToPublic(context.Background(), db, "public", []string{"not-a-uuid"}, true)

	require.Error(t, err)
	assert.False(t, readRestoreRow(t, db, restoreFlippedID).PublicRecords)
}
