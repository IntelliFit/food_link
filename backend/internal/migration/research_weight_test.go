package migration

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestMigrateResearchWeightSamplesIsIdempotentAndConstrainsRows(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, db.AutoMigrate(&migrationdo.RewardTaskUploadDO{}))
	require.NoError(t, MigrateResearchWeightSamples(ctx, db, "public"))
	require.NoError(t, MigrateResearchWeightSamples(ctx, db, "public"))

	insert := `INSERT INTO research_weight_samples (user_id, client_key, scene, weighing_mode, container_type, tare_mode, total_net_grams, consent_version, consented_at)
VALUES ('11111111-1111-1111-1111-111111111111', ?, ?, 'whole', 'bowl', 'measured', ?, 'v', now())`
	require.NoError(t, db.Exec(insert, "key-1", "canteen", 320.5).Error)
	require.Error(t, db.Exec(insert, "key-1", "canteen", 320.5).Error, "client key is unique per user")
	require.Error(t, db.Exec(insert, "key-2", "space", 320.5).Error, "scene is constrained")
	require.Error(t, db.Exec(insert, "key-3", "home", 0).Error, "net grams must be positive")
	require.Error(t, db.Exec(`UPDATE research_weight_samples SET quality_tier = 'D'`).Error, "tier is constrained")

	reward := `INSERT INTO reward_task_uploads (user_id, task_type, bonus_date, status, reward_credits) VALUES ('11111111-1111-1111-1111-111111111111', ?, '2026-10-28', 'succeeded', 2)`
	require.NoError(t, db.Exec(reward, "research_weight_sample").Error)
	require.Error(t, db.Exec(reward, "unknown_task").Error)
}

// Production already has the v1 table with the narrower checks; rerunning the
// migration must widen them in place and add the saved container table.
func TestMigrateResearchWeightSamplesWidensV1ChecksAndAddsContainers(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, MigrateResearchWeightSamples(ctx, db, "public"))
	require.NoError(t, db.Exec(dropAndAddCheck("research_weight_samples", "research_weight_samples_mode_valid", `weighing_mode IN ('whole','itemized')`)).Error)
	require.NoError(t, db.Exec(dropAndAddCheck("research_weight_samples", "research_weight_samples_tare_mode_valid", `tare_mode IN ('measured','zeroed')`)).Error)
	require.NoError(t, db.Exec(`DROP TABLE research_weight_containers`).Error)

	insert := `INSERT INTO research_weight_samples (user_id, client_key, scene, weighing_mode, container_type, tare_mode, total_net_grams, consent_version, consented_at)
VALUES ('11111111-1111-1111-1111-111111111111', ?, 'takeout', ?, 'box', ?, 420, 'v', now())`
	require.NoError(t, db.Exec(insert, "v1-row", "whole", "measured").Error)
	require.Error(t, db.Exec(insert, "v2-before", "multi", "per_container").Error, "v1 checks reject multi")

	require.NoError(t, MigrateResearchWeightSamples(ctx, db, "public"))
	require.NoError(t, db.Exec(insert, "v2-multi", "multi", "per_container").Error)
	require.NoError(t, db.Exec(insert, "v2-after", "itemized", "after_meal").Error)
	require.Error(t, db.Exec(insert, "v2-bad", "pile", "measured").Error, "mode stays constrained")
	var kept int64
	require.NoError(t, db.Raw(`SELECT count(*) FROM research_weight_samples WHERE client_key = 'v1-row'`).Scan(&kept).Error)
	require.EqualValues(t, 1, kept)

	container := `INSERT INTO research_weight_containers (user_id, name, container_type, grams, photo_object_key) VALUES ('11111111-1111-1111-1111-111111111111', ?, ?, ?, 'k')`
	require.NoError(t, db.Exec(container, "750ml 圆盒", "box", 28.5).Error)
	require.Error(t, db.Exec(container, "x", "bag", 10).Error, "type is constrained")
	require.Error(t, db.Exec(container, "x", "box", 0).Error, "grams must be positive")
}
