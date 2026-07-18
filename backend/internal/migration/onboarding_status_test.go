package migration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/testdb"
)

func TestEnsureOnboardingStatusDoesNotModifyLegacyUsers(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id TEXT PRIMARY KEY, onboarding_completed BOOLEAN)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, onboarding_completed) VALUES ('legacy-complete', true), ('legacy-pending', false)`).Error)

	ctx := context.Background()
	require.NoError(t, MigrateOnboardingStatus(ctx, db, "public"))
	require.NoError(t, MigrateOnboardingStatus(ctx, db, "public"))

	var rows []struct {
		ID     string  `gorm:"column:id"`
		Status *string `gorm:"column:onboarding_status"`
	}
	require.NoError(t, db.Raw(`SELECT id, onboarding_status FROM weapp_user ORDER BY id`).Scan(&rows).Error)
	require.Equal(t, []struct {
		ID     string  `gorm:"column:id"`
		Status *string `gorm:"column:onboarding_status"`
	}{
		{ID: "legacy-complete", Status: nil},
		{ID: "legacy-pending", Status: nil},
	}, rows)

	assert.NoError(t, db.Exec(`UPDATE weapp_user SET onboarding_status = 'skipped' WHERE id = 'legacy-pending'`).Error)
	require.NoError(t, ensureOnboardingStatus(ctx, db))
	var status string
	require.NoError(t, db.Raw(`SELECT onboarding_status FROM weapp_user WHERE id = 'legacy-pending'`).Scan(&status).Error)
	assert.Equal(t, "skipped", status)
}
