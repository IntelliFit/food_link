package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestContentConfigMigrationIsRepeatable(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, MigrateContentConfigs(ctx, db, "public"))
	require.NoError(t, db.Exec(`INSERT INTO app_content_configs (config_key, value) VALUES ('onboarding_v2', '{"badges":[]}')`).Error)
	require.NoError(t, MigrateContentConfigs(ctx, db, "public"))

	var count int64
	require.NoError(t, db.Raw("SELECT count(*) FROM app_content_configs").Scan(&count).Error)
	require.Equal(t, int64(1), count, "重复迁移不应清掉已有配置")
	require.Error(t, db.Exec(`UPDATE app_content_configs SET value = '[]'`).Error, "配置必须是 JSON 对象")
}
