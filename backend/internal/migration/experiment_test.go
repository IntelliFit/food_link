package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestExperimentMigrationIsAdditiveAndRepeatable(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, db.Exec(`CREATE TABLE business_marker (id integer primary key, value text); INSERT INTO business_marker VALUES (1,'unchanged');`).Error)

	require.NoError(t, MigrateExperiments(ctx, db, "public"))
	require.NoError(t, db.Exec(`INSERT INTO experiments (experiment_key, status, audience, variants, salt)
		VALUES ('onboarding_v2', 'draft', 'new_users', '[{"key":"control","weight":50},{"key":"pet_flow","weight":50}]', 'onboarding_v2')`).Error)
	require.NoError(t, MigrateExperiments(ctx, db, "public"))

	var count int64
	require.NoError(t, db.Raw("SELECT count(*) FROM experiments").Scan(&count).Error)
	require.Equal(t, int64(1), count, "重复迁移不应清掉已有实验")
	var value string
	require.NoError(t, db.Raw("SELECT value FROM business_marker WHERE id=1").Scan(&value).Error)
	require.Equal(t, "unchanged", value)

	require.Error(t, db.Exec(`UPDATE experiments SET status = 'paused'`).Error, "非法状态应被约束拒绝")
	require.Error(t, db.Exec(`UPDATE experiments SET variants = '{}'`).Error, "分组必须是数组")
	require.Error(t, db.Exec(`INSERT INTO app_events (id, anon_id, name, props, created_at) VALUES (gen_random_uuid(), 'anon_x', 'a_b', '[]', now())`).Error, "事件属性必须是对象")

	require.NoError(t, db.Exec(`INSERT INTO experiment_assignments (id, experiment_key, anon_id, variant, assigned_at)
		VALUES (gen_random_uuid(), 'onboarding_v2', 'anon_unique', 'control', now())`).Error)
	require.Error(t, db.Exec(`INSERT INTO experiment_assignments (id, experiment_key, anon_id, variant, assigned_at)
		VALUES (gen_random_uuid(), 'onboarding_v2', 'anon_unique', 'pet_flow', now())`).Error, "同一访客在同一实验只能有一条分组")
}
