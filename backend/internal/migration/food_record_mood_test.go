package migration

import (
	"context"
	"testing"

	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestMigrateFoodRecordMoodIsIdempotentAndConstrainsValues(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE user_food_records (id text PRIMARY KEY)`).Error)

	ctx := context.Background()
	require.NoError(t, MigrateFoodRecordMood(ctx, db, "public"))
	require.NoError(t, MigrateFoodRecordMood(ctx, db, "public"))
	require.True(t, db.Migrator().HasColumn(&do.FoodRecordDO{}, "eating_mood"))

	require.NoError(t, db.Exec(`INSERT INTO user_food_records (id, eating_mood) VALUES ('valid', 'calm'), ('empty', NULL)`).Error)
	require.Error(t, db.Exec(`INSERT INTO user_food_records (id, eating_mood) VALUES ('invalid', 'sad')`).Error)
}
